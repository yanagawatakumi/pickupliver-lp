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
      `CREATE TABLE IF NOT EXISTS animal_tower_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        score INTEGER NOT NULL,
        survival_sec REAL NOT NULL,
        placed_count INTEGER NOT NULL,
        run_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );`
    )
    .run();

  await db.prepare('CREATE INDEX IF NOT EXISTS idx_animal_tower_scores_score ON animal_tower_scores(score DESC, created_at ASC);').run();
}

function readJsonBody(request) {
  return request.json().catch(() => {
    throw new Error('invalid json body');
  });
}

function normalizeName(raw) {
  const value = String(raw || '').trim();
  if (value.length < 2 || value.length > 10) {
    throw new Error('name must be 2-10 chars');
  }
  return value;
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

async function insertScore(db, data) {
  const result = await db
    .prepare(
      `INSERT INTO animal_tower_scores
        (name, score, survival_sec, placed_count, run_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(data.name, data.score, data.survivalSec, data.placedCount, data.runId)
    .run();

  if (!result.success) {
    throw new Error('failed to save score');
  }
}

async function listTop(db) {
  const rows = await db
    .prepare(
      `SELECT name, score, survival_sec, placed_count, created_at
       FROM animal_tower_scores
       ORDER BY score DESC, created_at ASC
       LIMIT 10`
    )
    .all();

  const list = Array.isArray(rows?.results) ? rows.results : [];

  return list.map((row, index) => ({
    rank: index + 1,
    name: String(row?.name || ''),
    score: Number(row?.score || 0),
    survivalSec: Number(row?.survival_sec || 0),
    placedCount: Number(row?.placed_count || 0),
    createdAt: String(row?.created_at || '')
  }));
}

function isUniqueViolation(error) {
  const message = String(error?.message || '');
  return message.toLowerCase().includes('unique') || message.includes('SQLITE_CONSTRAINT');
}

export async function onRequestGet(context) {
  try {
    const db = requireDb(context.env);
    await ensureSchema(db);
    const top = await listTop(db);
    return json({ ok: true, top });
  } catch (error) {
    console.error('l-singer-tower-scores GET failed', error);
    return json({ ok: false, error: String(error?.message || 'failed to list scores') }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = requireDb(context.env);
    await ensureSchema(db);

    const body = await readJsonBody(context.request);
    const input = {
      name: normalizeName(body?.name),
      score: Math.round(normalizePositiveNumber(body?.score, 'score')),
      survivalSec: Number(normalizePositiveNumber(body?.survivalSec, 'survivalSec').toFixed(3)),
      placedCount: Math.round(normalizePositiveNumber(body?.placedCount, 'placedCount')),
      runId: normalizeRunId(body?.runId)
    };

    await insertScore(db, input);
    const top = await listTop(db);

    return json({ ok: true, top }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return json({ ok: false, error: 'runId already submitted' }, 409);
    }

    const message = String(error?.message || 'failed to submit score');
    const isValidationError =
      message.includes('2-10') ||
      message.includes('required') ||
      message.includes('non-negative') ||
      message.includes('invalid json');

    if (isValidationError) {
      return json({ ok: false, error: message }, 400);
    }

    console.error('l-singer-tower-scores POST failed', error);
    return json({ ok: false, error: message }, 500);
  }
}
