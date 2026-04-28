function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function requireDb(env) {
  if (env?.DB) return env.DB;
  throw new Error('D1 binding `DB` is not configured. Add DB to Cloudflare Pages Functions bindings.');
}

async function ensureSchema(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS l_singer_tower_plays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL UNIQUE,
        score INTEGER NOT NULL,
        placed_count INTEGER NOT NULL,
        fallen_count INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );`
    )
    .run();

  await db.prepare('CREATE INDEX IF NOT EXISTS idx_l_singer_tower_plays_score ON l_singer_tower_plays(score DESC, created_at ASC);').run();
}

function readJsonBody(request) {
  return request.json().catch(() => {
    throw new Error('invalid json body');
  });
}

function normalizePositiveNumber(raw, fieldName) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }
  return value;
}

function normalizeRunId(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('runId is required');
  if (value.length > 128) throw new Error('runId is too long');
  return value;
}

function parseScoreFromUrl(url) {
  const raw = url.searchParams.get('score');
  if (raw === null || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('score query must be a non-negative number');
  }
  return Math.round(parsed);
}

async function insertPlay(db, data) {
  const result = await db
    .prepare(
      `INSERT INTO l_singer_tower_plays
        (run_id, score, placed_count, fallen_count)
       VALUES (?, ?, ?, ?)`
    )
    .bind(data.runId, data.score, data.placedCount, data.fallenCount)
    .run();

  if (!result.success) {
    throw new Error('failed to save play');
  }
}

async function getScoreStats(db, score) {
  const totalRow = await db.prepare('SELECT COUNT(*) AS total_count FROM l_singer_tower_plays').first();
  const higherRow = await db
    .prepare('SELECT COUNT(*) AS higher_count FROM l_singer_tower_plays WHERE score > ?')
    .bind(score)
    .first();

  const totalCount = Math.max(0, Number(totalRow?.total_count || 0));
  const higherCount = Math.max(0, Number(higherRow?.higher_count || 0));
  const rank = higherCount + 1;
  const topPercent = totalCount > 0 ? (rank / totalCount) * 100 : 100;

  return {
    totalCount,
    rank,
    topPercent
  };
}

function isUniqueViolation(error) {
  const message = String(error?.message || '');
  return message.toLowerCase().includes('unique') || message.includes('SQLITE_CONSTRAINT');
}

export async function onRequestGet(context) {
  try {
    const db = requireDb(context.env);
    await ensureSchema(db);
    const requestUrl = new URL(context.request.url);
    const score = parseScoreFromUrl(requestUrl);
    if (score === null) {
      return json({ ok: true, stats: null });
    }
    const stats = await getScoreStats(db, score);
    return json({ ok: true, stats });
  } catch (error) {
    const message = String(error?.message || 'failed to fetch play stats');
    if (message.includes('non-negative')) return json({ ok: false, error: message }, 400);
    console.error('l-singer-tower-plays GET failed', error);
    return json({ ok: false, error: message }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = requireDb(context.env);
    await ensureSchema(db);

    const body = await readJsonBody(context.request);
    const input = {
      runId: normalizeRunId(body?.runId),
      score: Math.round(normalizePositiveNumber(body?.score, 'score')),
      placedCount: Math.round(normalizePositiveNumber(body?.placedCount, 'placedCount')),
      fallenCount: Math.round(normalizePositiveNumber(body?.fallenCount, 'fallenCount'))
    };

    await insertPlay(db, input);
    const stats = await getScoreStats(db, input.score);
    return json({ ok: true, stats }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) return json({ ok: false, error: 'runId already submitted' }, 409);
    const message = String(error?.message || 'failed to save play');
    const isValidationError = message.includes('required') || message.includes('non-negative') || message.includes('invalid json');
    if (isValidationError) return json({ ok: false, error: message }, 400);
    console.error('l-singer-tower-plays POST failed', error);
    return json({ ok: false, error: message }, 500);
  }
}
