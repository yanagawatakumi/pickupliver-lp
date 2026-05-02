function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

const DEFAULT_MODE = 'vol3';
const ALLOWED_MODES = new Set(['vol3', 'allstar']);

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
        mode TEXT NOT NULL DEFAULT 'vol3',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );`
    )
    .run();

  await db.prepare('CREATE INDEX IF NOT EXISTS idx_l_singer_tower_plays_score ON l_singer_tower_plays(score DESC, created_at ASC);').run();
  const modeReady = await ensureModeColumn(db);
  if (modeReady) {
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_l_singer_tower_plays_mode_score ON l_singer_tower_plays(mode, score DESC, created_at ASC);').run();
  }
  return modeReady;
}

async function ensureModeColumn(db) {
  const getColumns = async () => {
    const rows = await db.prepare('PRAGMA table_info(l_singer_tower_plays)').all();
    return Array.isArray(rows?.results) ? rows.results : [];
  };

  const columns = await getColumns();
  if (columns.some((row) => String(row?.name || '') === 'mode')) {
    await db.prepare("UPDATE l_singer_tower_plays SET mode = 'vol3' WHERE mode IS NULL OR mode = '';").run();
    return true;
  }

  try {
    await db.prepare("ALTER TABLE l_singer_tower_plays ADD COLUMN mode TEXT NOT NULL DEFAULT 'vol3';").run();
  } catch (_) {
    // ignore and fallback to legacy mode-less behavior
  }
  const updatedColumns = await getColumns();
  const modeReady = updatedColumns.some((row) => String(row?.name || '') === 'mode');
  if (modeReady) {
    await db.prepare("UPDATE l_singer_tower_plays SET mode = 'vol3' WHERE mode IS NULL OR mode = '';").run();
  }
  return modeReady;
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

function normalizeMode(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return DEFAULT_MODE;
  if (!ALLOWED_MODES.has(value)) throw new Error('mode must be vol3 or allstar');
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

function parseModeFromUrl(url) {
  return normalizeMode(url.searchParams.get('mode'));
}

async function insertPlay(db, data, modeReady) {
  const result = modeReady
    ? await db
        .prepare(
          `INSERT INTO l_singer_tower_plays
            (run_id, score, placed_count, fallen_count, mode)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(data.runId, data.score, data.placedCount, data.fallenCount, data.mode)
        .run()
    : await db
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

async function getScoreStats(db, score, mode, modeReady) {
  const totalRow = modeReady
    ? await db.prepare('SELECT COUNT(*) AS total_count FROM l_singer_tower_plays WHERE mode = ?').bind(mode).first()
    : await db.prepare('SELECT COUNT(*) AS total_count FROM l_singer_tower_plays').first();
  const higherRow = modeReady
    ? await db
        .prepare('SELECT COUNT(*) AS higher_count FROM l_singer_tower_plays WHERE mode = ? AND score > ?')
        .bind(mode, score)
        .first()
    : await db.prepare('SELECT COUNT(*) AS higher_count FROM l_singer_tower_plays WHERE score > ?').bind(score).first();

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
    const modeReady = await ensureSchema(db);
    const requestUrl = new URL(context.request.url);
    const mode = parseModeFromUrl(requestUrl);
    const score = parseScoreFromUrl(requestUrl);
    if (score === null) {
      return json({ ok: true, mode, stats: null });
    }
    const stats = await getScoreStats(db, score, mode, modeReady);
    return json({ ok: true, mode, stats });
  } catch (error) {
    const message = String(error?.message || 'failed to fetch play stats');
    if (message.includes('non-negative') || message.includes('mode must')) return json({ ok: false, error: message }, 400);
    console.error('l-singer-tower-plays GET failed', error);
    return json({ ok: false, error: message }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = requireDb(context.env);
    const modeReady = await ensureSchema(db);

    const body = await readJsonBody(context.request);
    const input = {
      runId: normalizeRunId(body?.runId),
      score: Math.round(normalizePositiveNumber(body?.score, 'score')),
      placedCount: Math.round(normalizePositiveNumber(body?.placedCount, 'placedCount')),
      fallenCount: Math.round(normalizePositiveNumber(body?.fallenCount, 'fallenCount')),
      mode: normalizeMode(body?.mode)
    };

    await insertPlay(db, input, modeReady);
    const stats = await getScoreStats(db, input.score, input.mode, modeReady);
    return json({ ok: true, mode: input.mode, stats }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) return json({ ok: false, error: 'runId already submitted' }, 409);
    const message = String(error?.message || 'failed to save play');
    const isValidationError =
      message.includes('required') || message.includes('non-negative') || message.includes('invalid json') || message.includes('mode must');
    if (isValidationError) return json({ ok: false, error: message }, 400);
    console.error('l-singer-tower-plays POST failed', error);
    return json({ ok: false, error: message }, 500);
  }
}
