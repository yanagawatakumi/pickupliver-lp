const CONFIG_PATH_DEFAULT = '/content/games/l-singer-tower-battle/config.json';
const SCORE_API_PATH = '/api/l-singer-tower-scores';
const PLAY_API_PATH = '/api/l-singer-tower-plays';
const CANVAS_WIDTH = 420;
const CANVAS_HEIGHT = 720;
const SETTLE_SPEED_LIMIT = 0.2;
const SETTLE_ANGULAR_LIMIT = 0.02;
const SETTLE_FRAMES_REQUIRED = 16;
const COLLIDER_QA_RULES_DEFAULT = {
  minEdgeWorld: 1.0,
  maxReflexRatio: 0.55,
  maxVertices: 96,
  maxConsecutiveSharp: 6
};

const refs = {
  canvas: document.getElementById('game-canvas'),
  overlayScreen: document.getElementById('overlay-screen'),
  overlayMessage: document.getElementById('overlay-message'),
  startButton: document.getElementById('start-button'),
  scoreValue: document.getElementById('score-value'),
  currentShapeCanvas: document.getElementById('current-shape-canvas'),
  currentShapeName: document.getElementById('current-shape-name'),
  lifeValue: document.getElementById('life-value'),
  resultModal: document.getElementById('result-modal'),
  finalScore: document.getElementById('final-score'),
  resultStats: document.getElementById('result-stats'),
  scoreForm: document.getElementById('score-form'),
  playerName: document.getElementById('player-name'),
  submitScore: document.getElementById('submit-score'),
  submitMessage: document.getElementById('submit-message'),
  captureButton: document.getElementById('capture-button'),
  captureMessage: document.getElementById('capture-message'),
  shareXButton: document.getElementById('share-x-button'),
  shareMessage: document.getElementById('share-message'),
  retryButton: document.getElementById('retry-button'),
  rotateButton: document.getElementById('rotate-button'),
  rankingStatus: document.getElementById('ranking-status'),
  rankingList: document.getElementById('ranking-list')
};

const ctx = refs.canvas.getContext('2d');
const currentShapeCtx = refs.currentShapeCanvas ? refs.currentShapeCanvas.getContext('2d') : null;

const state = {
  config: null,
  engine: null,
  staticBodies: [],
  groundBody: null,
  dynamicBodies: [],
  characterAssets: {},
  running: false,
  dropGateBodyId: null,
  nextDropAllowedAtMs: 0,
  currentShape: null,
  currentSpawnY: CANVAS_HEIGHT * 0.13,
  pendingRotationStep: 0,
  spawnerX: CANVAS_WIDTH / 2,
  pointerActive: false,
  fallenCount: 0,
  droppedCount: 0,
  placedCount: 0,
  maxHeightPx: 0,
  totalScore: 0,
  cameraOffsetY: 0,
  cameraZoom: 1,
  submitted: false,
  playReported: false,
  runId: '',
  lastDroppedShapeId: null,
  recentDroppedShapeIds: [],
  frameReq: 0,
  lastFrameMs: 0,
  pendingRankingFetch: false,
  rankingTop: [],
  qaRejectedShapeIds: []
};

function metaContent(name) {
  const node = document.querySelector(`meta[name="${name}"]`);
  return node ? String(node.getAttribute('content') || '').trim() : '';
}

function resolveConfigPath() {
  return metaContent('vt:game-config') || CONFIG_PATH_DEFAULT;
}

function clamp(min, value, max) {
  return Math.min(max, Math.max(min, value));
}

function randomIn(min, max) {
  return Math.random() * (max - min) + min;
}

function weightedPick(list) {
  const total = list.reduce((sum, item) => sum + Math.max(0.0001, Number(item?.weight || 1)), 0);
  let cursor = randomIn(0, total);
  for (const item of list) {
    cursor -= Math.max(0.0001, Number(item?.weight || 1));
    if (cursor <= 0) return item;
  }
  return list[list.length - 1] || null;
}

function toSafeInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(parsed);
}

function toSafeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createRunId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `run_${Date.now()}_${Math.floor(Math.random() * 1e8)}`;
}

function resetSubmitMessage() {
  refs.submitMessage.textContent = '';
  refs.submitMessage.classList.remove('error', 'success');
  if (refs.resultStats) refs.resultStats.textContent = '';
}

function setSubmitMessage(text, tone = '') {
  refs.submitMessage.textContent = text;
  refs.submitMessage.classList.remove('error', 'success');
  if (tone) refs.submitMessage.classList.add(tone);
}

function canRegisterRanking(score) {
  const top = Array.isArray(state.rankingTop) ? state.rankingTop : [];
  if (top.length < 10) return true;
  const border = Number(top[top.length - 1]?.score || 0);
  return Number(score || 0) >= border;
}

function updateRankingRegisterUI() {
  if (!refs.submitScore) return;
  const canRegister = canRegisterRanking(state.totalScore);
  refs.submitScore.hidden = !canRegister;
  refs.submitScore.disabled = !canRegister || state.submitted;
}

function formatTopPercent(rank, totalCount) {
  const total = Math.max(1, toSafeInt(totalCount, 1));
  const r = clamp(1, toSafeInt(rank, 1), total);
  const pct = Math.max(0.1, (r / total) * 100);
  if (pct < 1) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

function renderResultStats(stats) {
  if (!refs.resultStats) return;
  if (!stats || !Number.isFinite(Number(stats.totalCount)) || !Number.isFinite(Number(stats.rank))) {
    refs.resultStats.textContent = '';
    return;
  }
  const rank = toSafeInt(stats.rank, 1);
  const totalCount = Math.max(1, toSafeInt(stats.totalCount, 1));
  refs.resultStats.textContent = `上位${formatTopPercent(rank, totalCount)}`;
}

async function fetchAndRenderResultStats(score) {
  if (!refs.resultStats) return;
  refs.resultStats.textContent = '上位%を計算中...';
  try {
    const queryScore = Math.max(0, toSafeInt(score, 0));
    const response = await fetch(`${PLAY_API_PATH}?score=${encodeURIComponent(String(queryScore))}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`stats fetch failed: ${response.status}`);
    const payload = await response.json();
    renderResultStats(payload?.stats);
  } catch (error) {
    console.error(error);
    refs.resultStats.textContent = '上位%の取得に失敗しました';
  }
}

async function reportPlayResult() {
  if (state.playReported || !state.runId) return null;
  state.playReported = true;
  const payload = {
    runId: state.runId,
    score: state.totalScore,
    placedCount: state.droppedCount,
    fallenCount: state.fallenCount
  };
  const response = await fetch(PLAY_API_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`play report failed: ${response.status}`);
  }
  return response.json().catch(() => ({}));
}

function resetCaptureMessage() {
  if (!refs.captureMessage) return;
  refs.captureMessage.textContent = '';
  refs.captureMessage.classList.remove('error', 'success');
}

function setCaptureMessage(text, tone = '') {
  if (!refs.captureMessage) return;
  refs.captureMessage.textContent = text;
  refs.captureMessage.classList.remove('error', 'success');
  if (tone) refs.captureMessage.classList.add(tone);
}

function resetShareMessage() {
  if (!refs.shareMessage) return;
  refs.shareMessage.textContent = '';
  refs.shareMessage.classList.remove('error', 'success');
}

function setShareMessage(text, tone = '') {
  if (!refs.shareMessage) return;
  refs.shareMessage.textContent = text;
  refs.shareMessage.classList.remove('error', 'success');
  if (tone) refs.shareMessage.classList.add(tone);
}

function normalizeRotationStep(step) {
  return ((step % 8) + 8) % 8;
}

function getPendingRotationRad() {
  return normalizeRotationStep(state.pendingRotationStep) * (Math.PI / 4);
}

function setPendingRotationStep(step) {
  state.pendingRotationStep = normalizeRotationStep(step);
}

function isStoppedBody(body) {
  if (!body) return false;
  return body.speed < SETTLE_SPEED_LIMIT && Math.abs(body.angularSpeed) < SETTLE_ANGULAR_LIMIT;
}

function getMeasuredBodies() {
  return state.dynamicBodies.filter((body) => body?.plugin?.game?.countedPlaced && isStoppedBody(body));
}

function getDynamicSpawnY() {
  const baseSpawnY = Number(state.config?.drop?.spawnY || 92);
  const spawnClearancePx = Number(state.config?.drop?.spawnClearancePx || 192);

  if (!Number.isFinite(state.currentSpawnY)) {
    state.currentSpawnY = baseSpawnY;
  }

  let highestBodyTopY = Infinity;
  // Use only settled/placed bodies as the spawn reference.
  // Including a just-dropped body makes spawnY jump upward and causes camera jerk.
  for (const body of getMeasuredBodies()) {
    if (!body?.bounds) continue;
    if (body.bounds.min.y < highestBodyTopY) {
      highestBodyTopY = body.bounds.min.y;
    }
  }

  if (!Number.isFinite(highestBodyTopY)) {
    return state.currentSpawnY;
  }
  const adaptedSpawnY = highestBodyTopY - spawnClearancePx;
  const targetSpawnY = Math.min(baseSpawnY, adaptedSpawnY);
  // Keep previous spawn reference to avoid snap-back to the initial position.
  state.currentSpawnY = Math.min(state.currentSpawnY, targetSpawnY);
  return state.currentSpawnY;
}

function getShapeDisplayName(shape) {
  const label = String(shape?.label || '').trim();
  if (label) return label;
  const id = String(shape?.id || '').toLowerCase();
  if (id === 'square') return '四角';
  if (id === 'circle') return '丸';
  if (id === 'triangle') return '三角';
  if (id === 'capsule') return 'カプセル';
  if (id === 'star') return '星';
  return '-';
}

function isGameOverHudMode() {
  return !state.running && Boolean(refs.resultModal && refs.resultModal.hidden === false);
}

function updateCurrentShapeHud() {
  const gameOverHudMode = isGameOverHudMode();
  const currentWrap = refs.currentShapeCanvas?.parentElement || null;
  const rawName = String(refs.playerName?.value || '').trim();
  const gameOverName = rawName.length >= 2 ? rawName.slice(0, 10) : '';

  if (refs.currentShapeName) {
    refs.currentShapeName.textContent = gameOverHudMode ? gameOverName : getShapeDisplayName(state.currentShape);
  }
  if (refs.currentShapeCanvas) {
    refs.currentShapeCanvas.hidden = gameOverHudMode;
  }
  if (currentWrap) {
    currentWrap.classList.toggle('is-name-only', gameOverHudMode);
  }

  if (!currentShapeCtx || !refs.currentShapeCanvas) return;
  currentShapeCtx.clearRect(0, 0, refs.currentShapeCanvas.width, refs.currentShapeCanvas.height);
  if (gameOverHudMode) return;
  if (!state.currentShape) return;

  currentShapeCtx.save();
  currentShapeCtx.translate(refs.currentShapeCanvas.width * 0.5, refs.currentShapeCanvas.height * 0.5);
  if (state.currentShape.kind === 'character') {
    const asset = state.characterAssets?.[state.currentShape.id];
    if (asset?.image) {
      const fitScale = Math.min(
        refs.currentShapeCanvas.width / Math.max(1, asset.renderWidth),
        refs.currentShapeCanvas.height / Math.max(1, asset.renderHeight)
      );
      currentShapeCtx.scale(fitScale, fitScale);
      currentShapeCtx.drawImage(asset.image, -asset.renderWidth * 0.5, -asset.renderHeight * 0.5, asset.renderWidth, asset.renderHeight);
    }
  } else {
    currentShapeCtx.scale(0.4, 0.4);
    currentShapeCtx.beginPath();
    drawShapePath(currentShapeCtx, state.currentShape);
    currentShapeCtx.fillStyle = String(state.currentShape.fill || '#ffffff');
    currentShapeCtx.strokeStyle = String(state.currentShape.stroke || '#1e1324');
    currentShapeCtx.lineWidth = 2.2;
    currentShapeCtx.fill();
    currentShapeCtx.stroke();
  }
  currentShapeCtx.restore();
}

function getCameraWorldBounds() {
  let boundsTopY = Infinity;
  let boundsBottomY = -Infinity;
  const groundBottomY = state.groundBody?.bounds?.max.y;

  const includeBounds = (topY, bottomY) => {
    if (!Number.isFinite(topY) || !Number.isFinite(bottomY)) return;
    if (topY < boundsTopY) boundsTopY = topY;
    if (bottomY > boundsBottomY) boundsBottomY = bottomY;
  };

  if (state.groundBody?.bounds) {
    includeBounds(state.groundBody.bounds.min.y, state.groundBody.bounds.max.y);
  }

  for (const body of state.dynamicBodies) {
    if (!body?.bounds) continue;
    if (Number.isFinite(groundBottomY) && body.bounds.min.y > groundBottomY) continue;
    includeBounds(body.bounds.min.y, body.bounds.max.y);
  }

  if (state.running && state.currentShape) {
    const spawnY = getDynamicSpawnY();
    const { halfHeight } = getShapeBounds(state.currentShape);
    includeBounds(spawnY - halfHeight - 6, spawnY + halfHeight + 6);
  }

  if (!Number.isFinite(boundsTopY) || !Number.isFinite(boundsBottomY)) return null;
  return { topY: boundsTopY, bottomY: boundsBottomY };
}

function renderLives() {
  const totalLives = Number(state.config?.rules?.fallenLimit || 3);
  const remainingLives = clamp(0, totalLives - state.fallenCount, totalLives);
  return `${'❤'.repeat(remainingLives)}${'♡'.repeat(Math.max(0, totalLives - remainingLives))}`;
}

function getDropTouchDelayMs() {
  const configured = Number(state.config?.drop?.touchUnlockDelayMs || 1000);
  if (!Number.isFinite(configured)) return 1000;
  return Math.max(0, configured);
}

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeColliderVertices(vertices, sourceWidth, sourceHeight, scale) {
  if (!Array.isArray(vertices)) return [];
  const halfW = sourceWidth * 0.5;
  const halfH = sourceHeight * 0.5;
  const normalized = [];
  for (const item of vertices) {
    const rawX = Array.isArray(item) ? item[0] : item?.x;
    const rawY = Array.isArray(item) ? item[1] : item?.y;
    const x = toFiniteNumber(rawX, NaN);
    const y = toFiniteNumber(rawY, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    normalized.push({
      x: (x - halfW) * scale,
      y: (y - halfH) * scale
    });
  }
  return normalized;
}

function computePolygonCentroid(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) return { x: 0, y: 0 };
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i += 1) {
    const p = vertices[i];
    const q = vertices[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    twiceArea += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) return { x: 0, y: 0 };
  const factor = 1 / (3 * twiceArea);
  return { x: cx * factor, y: cy * factor };
}

function validateColliderQa(shape, qa) {
  const rules = state.config?.colliderQa || COLLIDER_QA_RULES_DEFAULT;
  const failures = [];
  if (!qa || typeof qa !== 'object') {
    return {
      valid: false,
      failures: ['qa metadata is missing']
    };
  }
  const vertexCount = Number(qa.vertexCount);
  const minEdgeWorld = Number(qa.minEdgeWorld);
  const reflexRatio = Number(qa.reflexRatio);
  const selfIntersection = Number(qa.selfIntersection);
  const maxConsecutiveSharp = Number(qa.maxConsecutiveSharp);
  const valid =
    Number.isFinite(vertexCount) &&
    vertexCount > 0 &&
    Number.isFinite(minEdgeWorld) &&
    Number.isFinite(reflexRatio) &&
    Number.isFinite(selfIntersection) &&
    Number.isFinite(maxConsecutiveSharp);
  if (!valid) {
    return {
      valid: false,
      failures: ['qa fields are invalid']
    };
  }

  if (selfIntersection !== 0) failures.push(`selfIntersection=${selfIntersection}`);
  if (vertexCount > Number(rules.maxVertices || COLLIDER_QA_RULES_DEFAULT.maxVertices)) failures.push(`vertexCount=${vertexCount}`);
  if (minEdgeWorld < Number(rules.minEdgeWorld || COLLIDER_QA_RULES_DEFAULT.minEdgeWorld)) failures.push(`minEdgeWorld=${minEdgeWorld.toFixed(3)}`);
  if (reflexRatio > Number(rules.maxReflexRatio || COLLIDER_QA_RULES_DEFAULT.maxReflexRatio)) failures.push(`reflexRatio=${reflexRatio.toFixed(4)}`);
  if (maxConsecutiveSharp > Number(rules.maxConsecutiveSharp || COLLIDER_QA_RULES_DEFAULT.maxConsecutiveSharp)) {
    failures.push(`maxConsecutiveSharp=${maxConsecutiveSharp}`);
  }

  return {
    valid: failures.length === 0,
    failures
  };
}

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load image: ${path}`));
    image.src = path;
  });
}

async function loadCharacterAssets(shapes) {
  const targets = Array.isArray(shapes) ? shapes.filter((shape) => shape?.kind === 'character') : [];
  const cache = {};
  const qaRejectedShapeIds = [];
  if (!targets.length) {
    state.characterAssets = cache;
    state.qaRejectedShapeIds = qaRejectedShapeIds;
    return;
  }

  await Promise.all(
    targets.map(async (shape) => {
      const id = String(shape.id || '').trim();
      if (!id) throw new Error('character shape id is required');
      const imagePath = String(shape.imagePath || '').trim();
      const colliderPath = String(shape.colliderPath || '').trim();
      if (!imagePath || !colliderPath) throw new Error(`character asset paths are missing for ${id}`);

      const [image, colliderRes] = await Promise.all([loadImage(imagePath), fetch(colliderPath, { cache: 'no-store' })]);
      if (!colliderRes.ok) throw new Error(`failed to load collider for ${id}`);
      const collider = await colliderRes.json();

      const sourceWidth = toFiniteNumber(collider?.sourceWidth, toFiniteNumber(shape.sourceWidth, image.naturalWidth || 1));
      const sourceHeight = toFiniteNumber(collider?.sourceHeight, toFiniteNumber(shape.sourceHeight, image.naturalHeight || 1));
      const scale = Math.max(0.01, toFiniteNumber(shape.scale, 1));
      const qaCheck = validateColliderQa(shape, collider?.qa);
      if (!qaCheck.valid) {
        qaRejectedShapeIds.push(id);
        console.warn(`character skipped by collider QA: ${id} (${qaCheck.failures.join(', ')})`);
        return;
      }
      const vertices = normalizeColliderVertices(collider?.vertices, sourceWidth, sourceHeight, scale);
      if (vertices.length < 3) {
        qaRejectedShapeIds.push(id);
        console.warn(`character skipped by collider vertices: ${id}`);
        return;
      }
      const centroid = computePolygonCentroid(vertices);

      cache[id] = {
        image,
        sourceWidth,
        sourceHeight,
        scale,
        vertices,
        rawVertexCount: vertices.length,
        imageOffsetX: -centroid.x,
        imageOffsetY: -centroid.y,
        renderWidth: sourceWidth * scale,
        renderHeight: sourceHeight * scale
      };
    })
  );

  state.characterAssets = cache;
  state.qaRejectedShapeIds = qaRejectedShapeIds;
}

function updateHud() {
  refs.scoreValue.textContent = String(state.totalScore);
  refs.lifeValue.textContent = renderLives();
  if (refs.rotateButton) {
    const showRotateButton = Boolean(state.running);
    refs.rotateButton.hidden = !showRotateButton;
    refs.rotateButton.disabled = !showRotateButton;
  }
  updateCurrentShapeHud();
}

function buildStarVertices(outerRadius, innerRadius, points = 5) {
  const vertices = [];
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + i * step;
    vertices.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return vertices;
}

function getShapeBounds(shape) {
  if (!shape) return { halfWidth: 24, halfHeight: 24 };
  switch (shape.kind) {
    case 'circle':
      return { halfWidth: Number(shape.radius || 24), halfHeight: Number(shape.radius || 24) };
    case 'rectangle':
      return { halfWidth: Number(shape.width || 48) * 0.5, halfHeight: Number(shape.height || 48) * 0.5 };
    case 'capsule':
      return { halfWidth: Number(shape.width || 64) * 0.5, halfHeight: Number(shape.height || 32) * 0.5 };
    case 'polygon': {
      const radius = Number(shape.radius || 28);
      return { halfWidth: radius, halfHeight: radius };
    }
    case 'star':
      return { halfWidth: Number(shape.outerRadius || 30), halfHeight: Number(shape.outerRadius || 30) };
    case 'character': {
      const asset = state.characterAssets?.[shape.id];
      if (asset) {
        const offsetX = Math.abs(Number(asset.imageOffsetX || 0));
        const offsetY = Math.abs(Number(asset.imageOffsetY || 0));
        return {
          halfWidth: asset.renderWidth * 0.5 + offsetX,
          halfHeight: asset.renderHeight * 0.5 + offsetY
        };
      }
      const sourceW = Number(shape.sourceWidth || 96);
      const sourceH = Number(shape.sourceHeight || 96);
      const scale = Number(shape.scale || 1);
      return { halfWidth: sourceW * scale * 0.5, halfHeight: sourceH * scale * 0.5 };
    }
    default:
      return { halfWidth: 28, halfHeight: 28 };
  }
}

function createBodyFromShape(shape, x, y) {
  const { Bodies, Body } = window.Matter;
  const colliderBuild = state.config?.physics?.colliderBuild || {};
  const removeCollinear = Math.max(0.0001, toSafeNumber(colliderBuild.removeCollinear, 0.02));
  const minimumArea = Math.max(0.1, toSafeNumber(colliderBuild.minimumArea, 4));
  const removeDuplicatePoints = Math.max(0.0001, toSafeNumber(colliderBuild.removeDuplicatePoints, 0.02));
  const options = {
    restitution: toSafeNumber(state.config.physics?.restitution, 0.1),
    friction: toSafeNumber(state.config.physics?.friction, 0.7),
    frictionStatic: toSafeNumber(state.config.physics?.frictionStatic, 2.2),
    frictionAir: toSafeNumber(state.config.physics?.frictionAir, 0.016),
    density: toSafeNumber(state.config.physics?.density, 0.0012),
    slop: Math.max(0.001, toSafeNumber(state.config.physics?.slop, 0.01))
  };

  const shapeId = String(shape?.id || '');

  let body;
  switch (shape.kind) {
    case 'character': {
      const asset = state.characterAssets?.[shape.id];
      if (asset?.vertices?.length >= 3) {
        body = Bodies.fromVertices(
          x,
          y,
          [asset.vertices],
          options,
          true,
          removeCollinear,
          minimumArea,
          removeDuplicatePoints
        );
        if (Array.isArray(body)) {
          body = Body.create({ ...options, parts: body });
        }
      }
      if (!body) {
        throw new Error(`failed to create character body: ${shape.id}`);
      }
      break;
    }
    case 'circle':
      body = Bodies.circle(x, y, Number(shape.radius || 24), options);
      break;
    case 'rectangle':
      body = Bodies.rectangle(x, y, Number(shape.width || 48), Number(shape.height || 48), options);
      break;
    case 'capsule':
      body = Bodies.rectangle(x, y, Number(shape.width || 68), Number(shape.height || 32), {
        ...options,
        chamfer: { radius: Math.floor(Number(shape.height || 32) * 0.5) }
      });
      break;
    case 'polygon':
      body = Bodies.polygon(x, y, Math.max(3, Number(shape.sides || 3)), Number(shape.radius || 32), options);
      break;
    case 'star': {
      const vertices = buildStarVertices(Number(shape.outerRadius || 32), Number(shape.innerRadius || 14), Number(shape.points || 5));
      body = Bodies.fromVertices(
        x,
        y,
        [vertices],
        options,
        true,
        removeCollinear,
        minimumArea,
        removeDuplicatePoints
      );
      break;
    }
    default:
      body = Bodies.circle(x, y, 24, options);
      break;
  }

  Body.setAngle(body, 0);
  const imageAsset = shape.kind === 'character' ? state.characterAssets?.[shape.id] : null;
  const fallbackWidth = Number(shape.sourceWidth || 80) * Number(shape.scale || 1);
  const fallbackHeight = Number(shape.sourceHeight || 80) * Number(shape.scale || 1);
  body.plugin.game = {
    shapeId: shapeId,
    kind: shape.kind,
    label: String(shape.label || shape.id || ''),
    fill: String(shape.fill || '#ffffff'),
    stroke: String(shape.stroke || '#1e1324'),
    image: imageAsset?.image || null,
    renderWidth: imageAsset?.renderWidth || (shape.kind === 'character' ? fallbackWidth : null),
    renderHeight: imageAsset?.renderHeight || (shape.kind === 'character' ? fallbackHeight : null),
    imageOffsetX: imageAsset?.imageOffsetX || 0,
    imageOffsetY: imageAsset?.imageOffsetY || 0,
    stableFrames: 0,
    countedPlaced: false
  };

  return body;
}

function drawShapePath(targetCtx, shape) {
  if (shape.kind === 'circle') {
    targetCtx.arc(0, 0, Number(shape.radius || 20), 0, Math.PI * 2);
    return;
  }

  if (shape.kind === 'rectangle' || shape.kind === 'capsule') {
    const width = Number(shape.width || 52);
    const height = Number(shape.height || 38);
    const radius = shape.kind === 'capsule' ? Math.min(width, height) * 0.5 : 8;
    targetCtx.roundRect(-width * 0.5, -height * 0.5, width, height, radius);
    return;
  }

  if (shape.kind === 'polygon') {
    const sides = Math.max(3, Number(shape.sides || 3));
    const radius = Number(shape.radius || 26);
    const offset = Math.PI / sides;
    for (let i = 0; i < sides; i += 1) {
      const angle = offset + (i * Math.PI * 2) / sides;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) targetCtx.moveTo(x, y);
      else targetCtx.lineTo(x, y);
    }
    targetCtx.closePath();
    return;
  }

  if (shape.kind === 'star') {
    const vertices = buildStarVertices(Number(shape.outerRadius || 26), Number(shape.innerRadius || 12), Number(shape.points || 5));
    targetCtx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i += 1) targetCtx.lineTo(vertices[i].x, vertices[i].y);
    targetCtx.closePath();
  }
}

function drawBody(body) {
  const style = body.plugin?.game || {};
  if (style.kind === 'character' && style.image && style.renderWidth && style.renderHeight) {
    const offsetX = Number(style.imageOffsetX || 0);
    const offsetY = Number(style.imageOffsetY || 0);
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    ctx.shadowColor = '#0000004d';
    ctx.shadowBlur = 6;
    ctx.drawImage(
      style.image,
      -style.renderWidth * 0.5 + offsetX,
      -style.renderHeight * 0.5 + offsetY,
      style.renderWidth,
      style.renderHeight
    );
    ctx.shadowBlur = 0;
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.beginPath();

  if (body.circleRadius) {
    ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, Math.PI * 2);
  } else {
    const vertices = body.vertices;
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i += 1) {
      ctx.lineTo(vertices[i].x, vertices[i].y);
    }
    ctx.closePath();
  }

  ctx.fillStyle = style.fill || '#ffffff';
  ctx.strokeStyle = style.stroke || '#1e1324';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#00000066';
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  ctx.restore();
}

function drawSpawner() {
  if (isGameOverHudMode()) return;
  const shape = state.currentShape;
  if (!shape) return;

  const y = getDynamicSpawnY();

  ctx.save();
  ctx.globalAlpha = 0.84;
  ctx.translate(state.spawnerX, y);
  ctx.rotate(getPendingRotationRad());
  if (shape.kind === 'character') {
    const asset = state.characterAssets?.[shape.id];
    if (asset?.image) {
      ctx.drawImage(
        asset.image,
        -asset.renderWidth * 0.5 + Number(asset.imageOffsetX || 0),
        -asset.renderHeight * 0.5 + Number(asset.imageOffsetY || 0),
        asset.renderWidth,
        asset.renderHeight
      );
    }
  } else {
    ctx.beginPath();
    drawShapePath(ctx, shape);
    ctx.fillStyle = String(shape.fill || '#ffffff66');
    ctx.strokeStyle = '#f7ebff';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawStageBackground() {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  gradient.addColorStop(0, '#26204b');
  gradient.addColorStop(0.58, '#1a1c39');
  gradient.addColorStop(1, '#14172f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

function drawWorld() {
  drawStageBackground();
  ctx.save();
  ctx.translate(0, state.cameraOffsetY);
  ctx.translate(CANVAS_WIDTH * 0.5, 0);
  ctx.scale(state.cameraZoom, state.cameraZoom);
  ctx.translate(-CANVAS_WIDTH * 0.5, 0);

  drawSpawner();
  for (const body of state.staticBodies) drawBody(body);
  for (const body of state.dynamicBodies) drawBody(body);
  ctx.restore();
}

function pickNextShape(excludedShapeIds = []) {
  const shapes = Array.isArray(state.config?.shapes) ? state.config.shapes : [];
  if (!shapes.length) return null;

  const excludedSet = new Set(
    (Array.isArray(excludedShapeIds) ? excludedShapeIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
  if (!excludedSet.size) {
    return weightedPick(shapes);
  }

  const candidates = shapes.filter((shape) => !excludedSet.has(String(shape?.id || '').trim()));
  if (!candidates.length) {
    return weightedPick(shapes);
  }
  return weightedPick(candidates);
}

function prepareQueue() {
  state.currentShape = pickNextShape(state.recentDroppedShapeIds);
}

function buildWorld() {
  const { Engine, Bodies, Body, World } = window.Matter;
  const physics = state.config?.physics || {};

  state.engine = Engine.create({
    enableSleeping: true,
    gravity: {
      x: 0,
      y: Number(physics.gravityY || 1)
    }
  });

  state.engine.positionIterations = toSafeInt(physics.iterations?.position, 8);
  state.engine.velocityIterations = toSafeInt(physics.iterations?.velocity, 6);
  state.engine.constraintIterations = toSafeInt(physics.iterations?.constraint, 2);

  const groundScale = Math.max(0.5, Number(physics.groundScale || 1));
  const pedestalWidth = Math.round(CANVAS_WIDTH * 0.6 * groundScale);
  const pedestalHeight = Math.round(20 * groundScale);
  const pedestalChamfer = 0;
  const defaultGroundTopY = CANVAS_HEIGHT - 100;
  const pedestalTopY = clamp(80, Number(physics.groundTopY || defaultGroundTopY), CANVAS_HEIGHT - pedestalHeight - 10);
  const pedestalCenterY = pedestalTopY + pedestalHeight * 0.5;
  const sharedRestitution = toSafeNumber(physics.restitution, 0.1);
  const sharedFriction = toSafeNumber(physics.friction, 0.7);
  const sharedFrictionStatic = toSafeNumber(physics.frictionStatic, 2.2);
  const sharedSlop = Math.max(0.001, toSafeNumber(physics.slop, 0.01));

  const pedestal = Bodies.rectangle(CANVAS_WIDTH / 2, pedestalCenterY, pedestalWidth, pedestalHeight, {
    isStatic: true,
    chamfer: pedestalChamfer > 0 ? { radius: pedestalChamfer } : undefined,
    restitution: sharedRestitution,
    friction: sharedFriction,
    frictionStatic: sharedFrictionStatic,
    slop: sharedSlop
  });
  Body.setAngle(pedestal, 0);

  pedestal.plugin.game = {
    fill: '#ffe0af',
    stroke: '#28152f'
  };

  state.groundBody = pedestal;
  state.staticBodies = [pedestal];
  state.dynamicBodies = [];

  World.add(state.engine.world, state.staticBodies);
}

function resetRunState() {
  state.running = false;
  state.dropGateBodyId = null;
  state.nextDropAllowedAtMs = 0;
  state.fallenCount = 0;
  state.droppedCount = 0;
  state.placedCount = 0;
  state.maxHeightPx = 0;
  state.totalScore = 0;
  state.currentSpawnY = Number(state.config?.drop?.spawnY || 92);
  setPendingRotationStep(0);
  state.cameraOffsetY = 0;
  state.cameraZoom = 1;
  state.submitted = false;
  state.playReported = false;
  state.runId = createRunId();
  state.lastDroppedShapeId = null;
  state.recentDroppedShapeIds = [];
  state.lastFrameMs = 0;

  resetSubmitMessage();
  resetCaptureMessage();
  resetShareMessage();
  refs.scoreForm.reset();
  refs.submitScore.disabled = false;
  refs.submitScore.hidden = false;
  if (refs.captureButton) refs.captureButton.disabled = false;
  if (refs.shareXButton) refs.shareXButton.disabled = false;
  refs.resultModal.hidden = true;
  refs.overlayScreen.hidden = false;
  refs.startButton.disabled = false;
  updateHud();
}

function clearDynamicBodies() {
  const { World } = window.Matter;
  if (!state.engine) return;
  if (state.dynamicBodies.length) {
    World.remove(state.engine.world, state.dynamicBodies);
  }
  state.dynamicBodies = [];
}

function startGame() {
  clearDynamicBodies();
  resetRunState();

  state.running = true;
  refs.overlayScreen.hidden = true;
  refs.resultModal.hidden = true;

  prepareQueue();
  updateHud();
}

function finishGame() {
  if (!state.running) return;
  state.running = false;
  state.totalScore = state.droppedCount;
  resetCaptureMessage();
  resetShareMessage();

  refs.finalScore.textContent = `スコア: ${state.totalScore}`;
  if (refs.resultStats) refs.resultStats.textContent = '';
  refs.resultModal.hidden = false;
  updateRankingRegisterUI();
  reportPlayResult()
    .then((payload) => {
      if (payload?.stats) {
        renderResultStats(payload.stats);
      } else {
        fetchAndRenderResultStats(state.totalScore);
      }
    })
    .catch((error) => {
      console.error(error);
      fetchAndRenderResultStats(state.totalScore);
    });
  updateHud();
  refs.playerName.focus();
}

function updateSpawnerPosition(clientX) {
  const rect = refs.canvas.getBoundingClientRect();
  const ratio = CANVAS_WIDTH / rect.width;
  const minX = Number(state.config.drop.minX || 50);
  const maxX = Number(state.config.drop.maxX || CANVAS_WIDTH - 50);
  const screenX = (clientX - rect.left) * ratio;
  const centerX = CANVAS_WIDTH * 0.5;
  const zoom = state.cameraZoom || 1;
  const x = centerX + (screenX - centerX) / zoom;
  state.spawnerX = clamp(minX, x, maxX);
}

function dropCurrentShape() {
  const { Body, World } = window.Matter;
  if (!state.running || !state.currentShape) return;

  const now = performance.now();
  if (state.dropGateBodyId !== null) return;
  if (now < state.nextDropAllowedAtMs) return;

  const spawnY = getDynamicSpawnY();
  let body;
  try {
    body = createBodyFromShape(state.currentShape, state.spawnerX, spawnY);
  } catch (error) {
    console.error(error);
    state.running = false;
    refs.overlayMessage.textContent = '当たり判定データ不正のためプレイを停止しました。Collider QA を確認してください。';
    refs.overlayScreen.hidden = false;
    return;
  }
  Body.setAngle(body, getPendingRotationRad());
  Body.setAngularVelocity(body, 0);
  World.add(state.engine.world, body);
  state.dynamicBodies.push(body);
  state.dropGateBodyId = body.id;
  state.droppedCount += 1;
  state.totalScore = state.droppedCount;

  state.lastDroppedShapeId = String(state.currentShape.id || '').trim() || null;
  if (state.lastDroppedShapeId) {
    state.recentDroppedShapeIds.push(state.lastDroppedShapeId);
    if (state.recentDroppedShapeIds.length > 3) {
      state.recentDroppedShapeIds = state.recentDroppedShapeIds.slice(-3);
    }
  }
  state.currentShape = pickNextShape(state.recentDroppedShapeIds);
  setPendingRotationStep(0);
}

function collectPlacement(body) {
  if (!body.plugin?.game || body.plugin.game.countedPlaced) return;

  const speed = body.speed;
  const angular = Math.abs(body.angularSpeed);
  if (speed < SETTLE_SPEED_LIMIT && angular < SETTLE_ANGULAR_LIMIT) {
    body.plugin.game.stableFrames += 1;
  } else {
    body.plugin.game.stableFrames = 0;
  }

  if (body.plugin.game.stableFrames < SETTLE_FRAMES_REQUIRED) return;
  body.plugin.game.countedPlaced = true;
  state.placedCount += 1;
}

function collectFallenBodies() {
  const { World } = window.Matter;
  const margin = Number(state.config.rules.outOfBoundsMargin || 120);

  const survivors = [];
  for (const body of state.dynamicBodies) {
    const out =
      body.position.y > CANVAS_HEIGHT + margin ||
      body.position.x < -margin ||
      body.position.x > CANVAS_WIDTH + margin;

    if (out) {
      World.remove(state.engine.world, body);
      state.fallenCount += 1;
      if (state.dropGateBodyId === body.id) {
        state.dropGateBodyId = null;
        state.nextDropAllowedAtMs = Math.max(state.nextDropAllowedAtMs, performance.now() + getDropTouchDelayMs());
      }
      continue;
    }

    collectPlacement(body);
    survivors.push(body);
  }

  state.dynamicBodies = survivors;
}

function applyGlobalStability() {
  const { Body } = window.Matter;
  const stability = state.config?.physics?.stability || {};
  const angularDamping = clamp(0.85, toSafeNumber(stability.angularDamping, 0.94), 0.999);
  const maxAngularSpeed = Math.max(0.4, toSafeNumber(stability.maxAngularSpeed, 2.2));
  const maxLinearSpeed = Math.max(4, toSafeNumber(stability.maxLinearSpeed, 22));

  for (const body of state.dynamicBodies) {
    if (!body || body.isSleeping) continue;

    const nextAngular = clamp(-maxAngularSpeed, body.angularVelocity * angularDamping, maxAngularSpeed);
    if (Math.abs(nextAngular - body.angularVelocity) > 0.0001) {
      Body.setAngularVelocity(body, nextAngular);
    }

    const speed = body.speed;
    if (speed > maxLinearSpeed) {
      const ratio = maxLinearSpeed / Math.max(0.0001, speed);
      Body.setVelocity(body, {
        x: body.velocity.x * ratio,
        y: body.velocity.y * ratio
      });
    }
  }
}

function updateDropGate(nowMs) {
  const { Query } = window.Matter;
  if (!Number.isFinite(nowMs)) return;
  if (state.dropGateBodyId === null) return;

  const tracked = state.dynamicBodies.find((body) => body.id === state.dropGateBodyId);
  if (!tracked) return;

  const others = [...state.staticBodies, ...state.dynamicBodies.filter((body) => body.id !== tracked.id)];
  if (!others.length) return;

  const touched = Query.collides(tracked, others).length > 0;
  if (!touched) return;

  state.dropGateBodyId = null;
  state.nextDropAllowedAtMs = Math.max(state.nextDropAllowedAtMs, nowMs + getDropTouchDelayMs());
}

function updateMaxHeight() {
  let currentHeight = 0;
  for (const body of getMeasuredBodies()) {
    const towerHeight = Math.max(0, CANVAS_HEIGHT - body.bounds.min.y - 8);
    if (towerHeight > currentHeight) currentHeight = towerHeight;
  }
  state.maxHeightPx = Math.max(state.maxHeightPx, currentHeight);
}

function updateCamera() {
  if (!state.running) return;
  const cameraConfig = state.config.camera || {};
  const lerp = clamp(0.04, Number(cameraConfig.lerp || 0.12), 0.35);
  const focusTopPx = clamp(0, Number(cameraConfig.focusTopPx || 104), CANVAS_HEIGHT - 80);
  const focusBottomPx = clamp(focusTopPx + 80, Number(cameraConfig.focusBottomPx || 630), CANVAS_HEIGHT);
  const preDropTopPx = clamp(0, Number(cameraConfig.preDropTopPx || (focusTopPx + 24)), CANVAS_HEIGHT - 120);
  const preDropBottomPx = clamp(preDropTopPx + 100, Number(cameraConfig.preDropBottomPx || (focusBottomPx - 20)), CANVAS_HEIGHT);
  const maxOffsetPx = Math.max(120, Number(cameraConfig.maxOffsetPx || 760));

  let targetZoom = 1;
  let targetOffset = 0;

  const isPreDropView = state.running && state.dynamicBodies.length === 0 && Boolean(state.currentShape);
  const activeTopPx = isPreDropView ? preDropTopPx : focusTopPx;
  const activeBottomPx = isPreDropView ? preDropBottomPx : focusBottomPx;
  const shouldFitCamera = state.dynamicBodies.length > 0 || (state.running && state.currentShape);
  if (shouldFitCamera) {
    const worldBounds = getCameraWorldBounds();
    if (worldBounds) {
      const contentHeight = Math.max(1, worldBounds.bottomY - worldBounds.topY);
      const fitHeight = Math.max(80, activeBottomPx - activeTopPx);
      targetZoom = Math.min(1, fitHeight / contentHeight);
      if (!Number.isFinite(targetZoom) || targetZoom <= 0) targetZoom = 0.00001;

      const offsetForBottomFit = activeBottomPx - worldBounds.bottomY * targetZoom;
      const offsetForTopFit = activeTopPx - worldBounds.topY * targetZoom;
      targetOffset = offsetForBottomFit <= offsetForTopFit ? offsetForBottomFit : (offsetForBottomFit + offsetForTopFit) * 0.5;
      targetOffset = clamp(-maxOffsetPx, targetOffset, maxOffsetPx);
    }
  }

  state.cameraZoom += (targetZoom - state.cameraZoom) * lerp;
  state.cameraOffsetY += (targetOffset - state.cameraOffsetY) * lerp;
}

function createCaptureFileName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `l-singer-tower-battle_${stamp}.png`;
}

function getGameShareUrl() {
  try {
    return new URL('/games/l-singer-tower-battle/', window.location.origin).toString();
  } catch (_) {
    return '/games/l-singer-tower-battle/';
  }
}

function buildShareText() {
  const score = toSafeInt(state.totalScore, 0);
  const link = getGameShareUrl();
  return `スコア${score}点達成！\n次はあなたの番。どこまで積めるか挑戦してみて👇\n${link}\n\n#PICKUPLIVER #LSINGERTOWERBATTLE`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function drawRoundedRect(targetCtx, x, y, w, h, radius) {
  targetCtx.beginPath();
  targetCtx.roundRect(x, y, w, h, radius);
  targetCtx.closePath();
}

function drawHudOnCapture(targetCtx) {
  if (!targetCtx || !refs.scoreValue || !refs.currentShapeName || !refs.lifeValue) return;

  const hudX = 10;
  const hudY = 10;
  const hudW = CANVAS_WIDTH - 20;
  const hudH = 50;
  const leftW = Math.round(hudW * 0.25);
  const centerW = Math.round(hudW * 0.5);
  const rightW = hudW - leftW - centerW;
  const lineColor = '#190f22';

  const drawSegment = (x, y, w, h, fill, roundLeft = false, roundRight = false) => {
    const r = 12;
    const radii = [roundLeft ? r : 0, roundRight ? r : 0, roundRight ? r : 0, roundLeft ? r : 0];
    drawRoundedRect(targetCtx, x, y, w, h, radii);
    targetCtx.fillStyle = fill;
    targetCtx.fill();
    targetCtx.lineWidth = 2;
    targetCtx.strokeStyle = lineColor;
    targetCtx.stroke();
  };

  drawSegment(hudX, hudY, leftW, hudH, '#ffffffeb', true, false);
  drawSegment(hudX + leftW - 2, hudY, centerW + 4, hudH, '#ffffffeb', false, false);
  drawSegment(hudX + leftW + centerW, hudY, rightW, hudH, '#ffeef2', false, true);

  targetCtx.fillStyle = '#241621';
  targetCtx.textAlign = 'center';
  targetCtx.textBaseline = 'middle';

  targetCtx.font = '900 9px "M PLUS Rounded 1c", sans-serif';
  targetCtx.fillText('スコア', hudX + leftW * 0.5, hudY + 15);
  targetCtx.font = '900 18px "M PLUS Rounded 1c", sans-serif';
  targetCtx.fillText(String(refs.scoreValue.textContent || '0'), hudX + leftW * 0.5, hudY + 33);

  targetCtx.font = '900 9px "M PLUS Rounded 1c", sans-serif';
  targetCtx.fillText('ライフ', hudX + leftW + centerW + rightW * 0.5, hudY + 15);
  targetCtx.font = '900 16px "M PLUS Rounded 1c", sans-serif';
  targetCtx.fillStyle = '#d93a52';
  targetCtx.fillText(String(refs.lifeValue.textContent || ''), hudX + leftW + centerW + rightW * 0.5, hudY + 33);

  targetCtx.fillStyle = '#241621';
  targetCtx.font = '900 16px "M PLUS Rounded 1c", sans-serif';
  targetCtx.textAlign = 'left';
  targetCtx.textBaseline = 'middle';
  const iconW = refs.currentShapeCanvas ? refs.currentShapeCanvas.width : 0;
  const iconH = refs.currentShapeCanvas ? refs.currentShapeCanvas.height : 0;
  const iconDrawW = 56;
  const iconDrawH = 40;
  const centerX = hudX + leftW;
  const iconX = centerX + 8;
  const iconY = hudY + (hudH - iconDrawH) * 0.5;
  if (refs.currentShapeCanvas && iconW > 0 && iconH > 0) {
    targetCtx.drawImage(refs.currentShapeCanvas, 0, 0, iconW, iconH, iconX, iconY, iconDrawW, iconDrawH);
  }
  const nameText = String(refs.currentShapeName.textContent || '-');
  targetCtx.fillText(nameText, iconX + iconDrawW + 8, hudY + hudH * 0.56);
}

function buildCaptureCanvas() {
  if (!refs.canvas) return null;
  const exportScale = Math.max(2, Number(window.devicePixelRatio || 1));
  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = Math.round(refs.canvas.width * exportScale);
  captureCanvas.height = Math.round(refs.canvas.height * exportScale);
  const captureCtx = captureCanvas.getContext('2d');
  if (!captureCtx) return null;
  captureCtx.setTransform(exportScale, 0, 0, exportScale, 0, 0);
  captureCtx.imageSmoothingEnabled = true;
  captureCtx.imageSmoothingQuality = 'high';
  captureCtx.drawImage(refs.canvas, 0, 0);
  drawHudOnCapture(captureCtx);
  return captureCanvas;
}

async function saveCurrentScreen() {
  if (!refs.canvas || !refs.captureButton) return;
  refs.captureButton.disabled = true;
  resetCaptureMessage();
  try {
    const fileName = createCaptureFileName();
    const captureCanvas = buildCaptureCanvas();
    if (!captureCanvas) throw new Error('failed to create capture canvas');
    if (typeof captureCanvas.toBlob === 'function') {
      const blob = await new Promise((resolve) => captureCanvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('failed to generate screenshot blob');
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Lシンガータワーバトル 結果画像',
          files: [file]
        });
        setCaptureMessage('共有メニューを開きました。「画像を保存」でカメラロールに保存できます。', 'success');
      } else {
        downloadBlob(blob, fileName);
        setCaptureMessage('端末仕様によりダウンロード保存しました。', 'success');
      }
    } else {
      const dataUrl = captureCanvas.toDataURL('image/png');
      const anchor = document.createElement('a');
      anchor.href = dataUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setCaptureMessage('端末仕様によりダウンロード保存しました。', 'success');
    }
  } catch (error) {
    console.error(error);
    setCaptureMessage('スクショ保存に失敗しました。', 'error');
  } finally {
    refs.captureButton.disabled = false;
  }
}

async function shareOnX() {
  if (!refs.shareXButton) return;
  refs.shareXButton.disabled = true;
  resetShareMessage();
  try {
    const text = buildShareText();
    const captureCanvas = buildCaptureCanvas();
    if (!captureCanvas) throw new Error('failed to create capture canvas');
    const fileName = createCaptureFileName();
    let shared = false;

    if (typeof captureCanvas.toBlob === 'function') {
      const blob = await new Promise((resolve) => captureCanvas.toBlob(resolve, 'image/png'));
      if (blob) {
        const file = new File([blob], fileName, { type: 'image/png' });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            text,
            files: [file]
          });
          shared = true;
        } else if (navigator.share) {
          await navigator.share({ text });
          downloadBlob(blob, fileName);
          shared = true;
        } else {
          downloadBlob(blob, fileName);
        }
      }
    } else {
      const dataUrl = captureCanvas.toDataURL('image/png');
      const anchor = document.createElement('a');
      anchor.href = dataUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
    if (shared) {
      setShareMessage('共有メニューを開きました。投稿先を選んでシェアしてください。', 'success');
    } else {
      setShareMessage('画像を保存しました。共有先アプリから投稿してください。', 'success');
    }
  } catch (error) {
    console.error(error);
    setShareMessage('シェアに失敗しました。時間をおいて再試行してください。', 'error');
  } finally {
    refs.shareXButton.disabled = false;
  }
}

function updateScore() {
  updateMaxHeight();
  state.totalScore = state.droppedCount;
}

function frame(timestamp) {
  if (!state.engine) return;

  if (!state.lastFrameMs) state.lastFrameMs = timestamp;
  const delta = clamp(8, timestamp - state.lastFrameMs, 32);
  state.lastFrameMs = timestamp;
  const substeps = clamp(1, toSafeInt(state.config.physics?.substeps, 3), 5);
  const substepDelta = delta / substeps;
  for (let i = 0; i < substeps; i += 1) {
    window.Matter.Engine.update(state.engine, substepDelta);
  }

  if (state.running) {
    applyGlobalStability();
    updateDropGate(timestamp);
    collectFallenBodies();
    updateScore();
    if (state.fallenCount >= Number(state.config.rules.fallenLimit || 3)) {
      finishGame();
    }
  }
  updateCamera();

  updateHud();
  drawWorld();
  state.frameReq = window.requestAnimationFrame(frame);
}

function renderRanking(topList) {
  refs.rankingList.innerHTML = '';
  state.rankingTop = Array.isArray(topList) ? topList : [];

  if (!Array.isArray(topList) || !topList.length) {
    refs.rankingStatus.textContent = 'まだスコアがありません。';
    if (isGameOverHudMode()) updateRankingRegisterUI();
    return;
  }

  refs.rankingStatus.textContent = '全期間トップ 10';

  topList.forEach((row, index) => {
    const li = document.createElement('li');
    const name = String(row?.name || '名無し').slice(0, 32);
    const score = toSafeInt(row?.score, 0);
    li.textContent = `${index + 1}. ${name} - ${score}点`;
    refs.rankingList.appendChild(li);
  });
  if (isGameOverHudMode()) updateRankingRegisterUI();
}

async function loadRanking() {
  if (state.pendingRankingFetch) return;
  state.pendingRankingFetch = true;

  try {
    refs.rankingStatus.textContent = '読み込み中...';
    const response = await fetch(SCORE_API_PATH, { cache: 'no-store' });
    if (!response.ok) throw new Error(`ranking fetch failed: ${response.status}`);
    const payload = await response.json();
    renderRanking(payload?.top || []);
  } catch (error) {
    console.error(error);
    refs.rankingStatus.textContent = 'ランキング読み込みに失敗しました。';
  } finally {
    state.pendingRankingFetch = false;
  }
}

function validateName(value) {
  const name = String(value || '').trim();
  if (name.length < 2 || name.length > 10) return '';
  return name;
}

async function submitScore(event) {
  event.preventDefault();
  if (!state.runId || state.submitted) return;

  const name = validateName(refs.playerName.value);
  if (!name) {
    setSubmitMessage('名前は2〜10文字で入力してください。', 'error');
    return;
  }

  refs.submitScore.disabled = true;
  setSubmitMessage('送信中...');

  try {
    const payload = {
      name,
      score: state.totalScore,
      survivalSec: 0,
      placedCount: state.droppedCount,
      runId: state.runId
    };

    const response = await fetch(SCORE_API_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 409) {
        setSubmitMessage('このプレイのスコアはすでに送信済みです。', 'error');
        state.submitted = true;
      } else {
        throw new Error(String(body?.error || `submit failed: ${response.status}`));
      }
      return;
    }

    state.submitted = true;
    renderResultStats(body?.stats);
    setSubmitMessage('ランキングに登録しました。', 'success');
    await loadRanking();
  } catch (error) {
    console.error(error);
    setSubmitMessage('送信に失敗しました。時間をおいて再試行してください。', 'error');
  } finally {
    refs.submitScore.disabled = state.submitted;
  }
}

function retryGame() {
  refs.resultModal.hidden = true;
  refs.overlayMessage.textContent = '準備OK。STARTを押して次のチャレンジ！';
  refs.overlayScreen.hidden = false;
  resetCaptureMessage();
  resetShareMessage();
}

function handleRotateButtonPress(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!state.running) return;
  setPendingRotationStep(state.pendingRotationStep + 1);
}

function bindInput() {
  refs.canvas.addEventListener('pointerdown', (event) => {
    refs.canvas.setPointerCapture(event.pointerId);
    state.pointerActive = true;
    updateSpawnerPosition(event.clientX);
  });

  refs.canvas.addEventListener('pointermove', (event) => {
    if (!state.pointerActive) return;
    updateSpawnerPosition(event.clientX);
  });

  refs.canvas.addEventListener('pointerup', (event) => {
    if (state.pointerActive) {
      updateSpawnerPosition(event.clientX);
      dropCurrentShape();
    }
    state.pointerActive = false;
  });

  refs.canvas.addEventListener('pointercancel', () => {
    state.pointerActive = false;
  });

  refs.startButton.addEventListener('click', () => {
    startGame();
  });

  refs.retryButton.addEventListener('click', () => {
    retryGame();
  });

  if (refs.rotateButton) {
    refs.rotateButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
    });
    refs.rotateButton.addEventListener('pointerup', handleRotateButtonPress);
  }

  window.addEventListener('keydown', (event) => {
    if (!state.running) return;
    const activeTag = String(document.activeElement?.tagName || '').toLowerCase();
    if (activeTag === 'input' || activeTag === 'textarea') return;

    const key = String(event.key || '').toLowerCase();
    if (key === 'r' || key === 'e') {
      event.preventDefault();
      setPendingRotationStep(state.pendingRotationStep + 1);
    } else if (key === 'q') {
      event.preventDefault();
      setPendingRotationStep(state.pendingRotationStep - 1);
    }
  });

  refs.scoreForm.addEventListener('submit', submitScore);
  refs.playerName.addEventListener('input', () => {
    if (!isGameOverHudMode()) return;
    updateHud();
  });
  if (refs.captureButton) {
    refs.captureButton.addEventListener('click', saveCurrentScreen);
  }
  if (refs.shareXButton) {
    refs.shareXButton.addEventListener('click', shareOnX);
  }
}

async function loadConfig() {
  const response = await fetch(resolveConfigPath(), { cache: 'no-store' });
  if (!response.ok) throw new Error('failed to load game config');
  const payload = await response.json();

  const shapes = Array.isArray(payload?.shapes) ? payload.shapes.filter((shape) => shape && shape.kind) : [];
  if (!shapes.length) throw new Error('shape config is empty');
  for (const shape of shapes) {
    if (shape.kind !== 'character') continue;
    const required = ['id', 'label', 'kind', 'imagePath', 'colliderPath', 'sourceWidth', 'sourceHeight', 'scale', 'weight'];
    const missing = required.filter((key) => shape[key] === undefined || shape[key] === null || shape[key] === '');
    if (missing.length) {
      throw new Error(`character config missing [${missing.join(', ')}]: ${shape.id || '(unknown)'}`);
    }
  }

  return {
    physics: payload.physics || {},
    drop: payload.drop || {},
    rules: payload.rules || { fallenLimit: 3 },
    colliderQa: payload.colliderQa || {},
    camera: payload.camera || {},
    shapes
  };
}

async function init() {
  if (!window.Matter) {
    refs.overlayMessage.textContent = 'ゲームライブラリの読み込みに失敗しました。ページを再読み込みしてください。';
    refs.startButton.disabled = true;
    return;
  }

  try {
    if (window.decomp && window.Matter?.Common?.setDecomp) {
      window.Matter.Common.setDecomp(window.decomp);
    }
    state.config = await loadConfig();
    await loadCharacterAssets(state.config.shapes);
    if (state.qaRejectedShapeIds.length) {
      console.warn(`collider QA rejected characters: ${state.qaRejectedShapeIds.join(', ')}`);
    }
    state.config.shapes = state.config.shapes.filter((shape) => {
      if (shape.kind !== 'character') return true;
      return Boolean(state.characterAssets?.[shape.id]);
    });
    if (!state.config.shapes.length) {
      throw new Error('no valid shapes available after collider QA');
    }
    buildWorld();
    resetRunState();
    prepareQueue();
    drawWorld();
    bindInput();
    loadRanking();
    state.frameReq = window.requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    refs.overlayMessage.textContent = '初期化に失敗しました。設定ファイルを確認してください。';
    refs.startButton.disabled = true;
  }
}

window.addEventListener('beforeunload', () => {
  if (state.frameReq) window.cancelAnimationFrame(state.frameReq);
});

init();
