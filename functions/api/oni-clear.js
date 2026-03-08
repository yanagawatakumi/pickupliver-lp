const ONI_COUNTER_KEY = 'oni_clear_count_v2';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

async function ensureSchema(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL);').run();
}

async function nextOniClearRank(db) {
  const row = await db
    .prepare(
      'INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = counters.value + 1 RETURNING value;'
    )
    .bind(ONI_COUNTER_KEY)
    .first();

  const rank = Number(row?.value || 0);
  if (!Number.isFinite(rank) || rank <= 0) {
    throw new Error('failed to compute oni clear rank');
  }
  return rank;
}

async function getCurrentRank(db) {
  const row = await db.prepare('SELECT value FROM counters WHERE key = ?;').bind(ONI_COUNTER_KEY).first();
  const rank = Number(row?.value || 0);
  return Number.isFinite(rank) && rank > 0 ? rank : 0;
}

function requireDb(env) {
  if (env?.DB) return env.DB;
  throw new Error('D1 binding `DB` is not configured. Add DB to Cloudflare Pages Functions bindings.');
}

export async function onRequestPost(context) {
  try {
    const db = requireDb(context.env);
    await ensureSchema(db);
    const rank = await nextOniClearRank(db);
    return json({ ok: true, rank });
  } catch (error) {
    console.error('oni-clear api failed', error);
    return json({ ok: false, error: String(error?.message || 'oni-clear api failed') }, 500);
  }
}

export async function onRequestGet(context) {
  try {
    const db = requireDb(context.env);
    await ensureSchema(db);
    const current = await getCurrentRank(db);
    return json({ ok: true, endpoint: 'oni-clear', methods: ['GET', 'POST'], current });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || 'oni-clear api failed') }, 500);
  }
}
