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

const DEFAULT_MODE = 'vol3';
const ALLOWED_MODES = new Set(['vol3', 'allstar']);

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

  await db.prepare('CREATE INDEX IF NOT EXISTS idx_animal_tower_scores_score_latest ON animal_tower_scores(score DESC, created_at DESC);').run();
  const columns = await db.prepare("PRAGMA table_info('animal_tower_scores')").all();
  const hasMode = Array.isArray(columns?.results) && columns.results.some((col) => String(col?.name || '') === 'mode');
  if (!hasMode) {
    await db.prepare(`ALTER TABLE animal_tower_scores ADD COLUMN mode TEXT NOT NULL DEFAULT '${DEFAULT_MODE}'`).run();
  }
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_animal_tower_scores_mode_score_latest ON animal_tower_scores(mode, score DESC, created_at DESC);').run();
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

function normalizeMode(raw) {
  const value = String(raw || DEFAULT_MODE).trim().toLowerCase();
  if (!ALLOWED_MODES.has(value)) {
    throw new Error('mode must be vol3 or allstar');
  }
  return value;
}

async function insertScore(db, data) {
  const result = await db
    .prepare(
      `INSERT INTO animal_tower_scores
        (name, score, survival_sec, placed_count, run_id, mode)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(data.name, data.score, data.survivalSec, data.placedCount, data.runId, data.mode)
    .run();

  if (!result.success) {
    throw new Error('failed to save score');
  }
}

async function listTop(db, mode) {
  const rows = await db
    .prepare(
      `SELECT name, score, survival_sec, placed_count, created_at
       FROM animal_tower_scores
       WHERE mode = ?
       ORDER BY score DESC, created_at DESC
       LIMIT 50`
    )
    .bind(mode)
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

async function getScoreStats(db, score, mode) {
  const totalRow = await db.prepare('SELECT COUNT(*) AS total_count FROM animal_tower_scores WHERE mode = ?').bind(mode).first();
  const higherRow = await db
    .prepare('SELECT COUNT(*) AS higher_count FROM animal_tower_scores WHERE mode = ? AND score > ?')
    .bind(mode, score)
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
  const raw = url.searchParams.get('mode');
  return normalizeMode(raw || DEFAULT_MODE);
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
    const mode = parseModeFromUrl(requestUrl);
    const score = parseScoreFromUrl(requestUrl);
    const top = await listTop(db, mode);
    const payload = { ok: true, top };
    if (score !== null) {
      payload.stats = await getScoreStats(db, score, mode);
    }
    return json(payload);
  } catch (error) {
    console.error('l-singer-tower-scores GET failed', error);
    const message = String(error?.message || 'failed to list scores');
    if (message.includes('non-negative') || message.includes('mode must')) {
      return json({ ok: false, error: message }, 400);
    }
    return json({ ok: false, error: message }, 500);
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
      runId: normalizeRunId(body?.runId),
      mode: normalizeMode(body?.mode)
    };

    await insertScore(db, input);
    const [top, stats] = await Promise.all([listTop(db, input.mode), getScoreStats(db, input.score, input.mode)]);

    return json({ ok: true, top, stats }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return json({ ok: false, error: 'runId already submitted' }, 409);
    }

    const message = String(error?.message || 'failed to submit score');
    const isValidationError =
      message.includes('2-10') ||
      message.includes('required') ||
      message.includes('non-negative') ||
      message.includes('mode must') ||
      message.includes('invalid json');

    if (isValidationError) {
      return json({ ok: false, error: message }, 400);
    }

    console.error('l-singer-tower-scores POST failed', error);
    return json({ ok: false, error: message }, 500);
  }
}
