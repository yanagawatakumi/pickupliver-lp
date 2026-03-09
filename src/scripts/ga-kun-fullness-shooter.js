const CONFIG_PATH_DEFAULT = '/content/games/ga-kun-fullness-shooter/config.json';
const FOOD_ASSET_BASE_PATH = '/public/assets/games/ga-kun-fullness-shooter/foods';
const UNLOCK_KEY = 'vt_ga_kun_shooter_unlock_v1';
const ALL_CLEAR_KEY = 'vt_ga_kun_shooter_all_clear_v1';
const PLAYER_HIT_AREA_RATIO = 0.8;
const POINTER_PLAYER_Y_OFFSET = 64;
const BANNER_SHOW_MS = 3000;
const CLEAR_FLASH_MS = 3000;
const CENTER_CALLOUT_MS = 1000;
const CENTER_IN_MS = 120;
const CENTER_OUT_MS = 120;
const ONI_CLEAR_API_PATH = '/api/oni-clear';
const STAGE_BGM_VOLUME = 0.34;
const STAGE_BG = ['#19142b', '#111e37', '#1d2f3a', '#2a1629'];
const SFX_MASTER_GAIN = 0.45;
const SFX_COOLDOWN_MS = {
  shot: 70,
  foodHit: 65,
  foodComplete: 95,
  playerHit: 220,
  skillDrop: 250,
  skillActivate: 180,
  bossAppear: 900,
  bossHit: 90,
  bossConsume: 700,
  clear: 1200,
  gameOver: 1000
};

const refs = {
  stageButtons: document.getElementById('stage-buttons'),
  stageNote: document.getElementById('stage-note'),
  skillDock: document.getElementById('skill-dock'),
  hpValue: document.getElementById('hp-value'),
  fullnessFill: document.getElementById('fullness-fill'),
  fullnessValue: document.getElementById('fullness-value'),
  scoreValue: document.getElementById('score-value'),
  overlayScreen: document.getElementById('overlay-screen'),
  overlayMessage: document.getElementById('overlay-message'),
  clearFlash: document.getElementById('clear-flash'),
  clearFlashMain: document.getElementById('clear-flash-main'),
  clearFlashSub: document.getElementById('clear-flash-sub'),
  clearFlashAction: document.getElementById('clear-flash-action'),
};

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

const state = {
  config: null,
  selectedStageIndex: 0,
  unlockedStageIndex: 0,
  allStagesCleared: false,
  stage: null,
  running: false,
  ended: false,
  nowMs: 0,
  elapsedSec: 0,
  lastFrameMs: 0,
  lastShotMs: 0,
  lastFoodSpawnMs: 0,
  lastHazardSpawnMs: 0,
  lastBossHazardMs: 0,
  dropRate: 0.1,
  pitySteps: 0,
  lastDropSuccessSec: 0,
  hp: 3,
  fullness: 0,
  score: 0,
  player: null,
  bullets: [],
  foods: [],
  hazards: [],
  boss: null,
  bossSpawned: false,
  invulnerableUntilMs: 0,
  skillQueue: [],
  skillProcessing: false,
  activeEffects: {
    timeStopUntilMs: 0,
    barrierUntilMs: 0,
    speedBoostUntilMs: 0,
    speedMultiplier: 1
  },
  centerSkillCallout: null,
  skillSlotTimer: null,
  clearFlashTimer: null,
  images: new Map(),
  skillDockCanvasHeight: 68,
  stageBgmAudio: null,
  stageBgmUrl: '',
  audio: {
    ctx: null,
    master: null,
    unlocked: false,
    warmupDone: false,
    unlockHooksInstalled: false,
    lastPlayedAtMs: new Map()
  }
};

const input = {
  left: false,
  right: false,
  up: false,
  down: false,
  pointerActive: false,
  pointerX: canvas.width / 2,
  pointerY: canvas.height - 80
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

function randomPick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function distanceSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function easeOutCubic(value) {
  const t = clamp(0, value, 1);
  return 1 - (1 - t) ** 3;
}

function easeInCubic(value) {
  const t = clamp(0, value, 1);
  return t ** 3;
}

function roundedRectPath(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width * 0.5, height * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function cutCornerPanelPath(x, y, width, height, cut) {
  const c = Math.max(2, Math.min(cut, width * 0.2, height * 0.4));
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + width - c, y);
  ctx.lineTo(x + width, y + c);
  ctx.lineTo(x + width, y + height - c);
  ctx.lineTo(x + width - c, y + height);
  ctx.lineTo(x + c, y + height);
  ctx.lineTo(x, y + height - c);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

function skillCalloutPalette(skillType) {
  switch (String(skillType || '')) {
    case 'screen_clear':
      return { core: '#2f1111', accent: '#ff7b52', glow: '#ffd0a3' };
    case 'time_stop':
      return { core: '#161736', accent: '#6da5ff', glow: '#c4d6ff' };
    case 'barrier':
      return { core: '#0e2a23', accent: '#59f0c7', glow: '#befbec' };
    case 'speed_boost':
      return { core: '#2d162f', accent: '#f46bff', glow: '#ffd5ff' };
    case 'heal':
      return { core: '#2f2310', accent: '#ffd866', glow: '#fff4c7' };
    default:
      return { core: '#211727', accent: '#d7b56d', glow: '#f3e2b5' };
  }
}

function readUnlockedStageIndex(stageCount) {
  const raw = window.localStorage.getItem(UNLOCK_KEY);
  const value = Number.parseInt(raw || '0', 10);
  if (!Number.isFinite(value)) return 0;
  return clamp(0, value, Math.max(stageCount - 1, 0));
}

function persistUnlockedStageIndex(index) {
  window.localStorage.setItem(UNLOCK_KEY, String(index));
}

function readAllStagesCleared() {
  try {
    return window.localStorage.getItem(ALL_CLEAR_KEY) === '1';
  } catch {
    return false;
  }
}

function persistAllStagesCleared(value) {
  try {
    window.localStorage.setItem(ALL_CLEAR_KEY, value ? '1' : '0');
  } catch {
    // ignore storage failures
  }
}

async function announceOniClearRank() {
  try {
    const response = await fetch(ONI_CLEAR_API_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stageId: 'oni', clearedAt: new Date().toISOString() })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `oni-clear api status ${response.status}`);
    const rank = Number(payload?.rank || 0);
    if (!Number.isFinite(rank) || rank <= 0) throw new Error('invalid oni-clear rank');

    const message = `鬼ステージクリアおめでとう！
あなたは、${rank}人目のクリア者です！
ブラボ〜〜！！！`;
    setStageNote(message);
    setClearFlashContent('満腹', message);
  } catch (error) {
    console.warn('oni clear rank unavailable', error);
    const message = '鬼ステージクリアおめでとう！クリア人数の取得に失敗しました。';
    setStageNote(message);
    setClearFlashContent('満腹', message);
  }
}

function stageByIndex(index) {
  if (!state.config?.stages?.[index]) return null;
  return state.config.stages[index];
}

function isEffectActive(effectKey) {
  const until = state.activeEffects[effectKey] || 0;
  return state.nowMs < until;
}

function moveSpeedMultiplier() {
  if (!isEffectActive('speedBoostUntilMs')) return 1;
  return state.activeEffects.speedMultiplier || 1;
}

function setStageNote(message) {
  if (refs.stageNote) refs.stageNote.textContent = message;
}

function stopStageBgm({ reset = true } = {}) {
  const audio = state.stageBgmAudio;
  if (!audio) return;
  audio.pause();
  if (reset) audio.currentTime = 0;
}

function ensureStageBgm(stage) {
  const bgmUrl = String(stage?.bgmUrl || '').trim();
  if (!bgmUrl) {
    stopStageBgm();
    state.stageBgmAudio = null;
    state.stageBgmUrl = '';
    return null;
  }

  if (!state.stageBgmAudio || state.stageBgmUrl !== bgmUrl) {
    stopStageBgm();
    const audio = new Audio(bgmUrl);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = STAGE_BGM_VOLUME;
    state.stageBgmAudio = audio;
    state.stageBgmUrl = bgmUrl;
  }
  return state.stageBgmAudio;
}

function playStageBgm(stage) {
  const audio = ensureStageBgm(stage);
  if (!audio) return;
  audio.currentTime = 0;
  const promise = audio.play();
  if (promise && typeof promise.catch === 'function') {
    promise.catch((error) => {
      console.warn('stage bgm playback blocked', error);
    });
  }
}

function setOverlay(message, options = {}) {
  const {
    visible = true,
    showStageButtons = true
  } = options;

  if (refs.overlayMessage) refs.overlayMessage.textContent = message;
  if (refs.overlayScreen) refs.overlayScreen.classList.toggle('is-hidden', !visible);
  if (refs.stageButtons) refs.stageButtons.hidden = !showStageButtons;
}

function setClearFlash(visible) {
  if (!refs.clearFlash) return;
  refs.clearFlash.hidden = !visible;
}

function setClearFlashContent(mainText = '満腹', subText = '') {
  if (refs.clearFlashMain) refs.clearFlashMain.textContent = String(mainText || '満腹');
  if (refs.clearFlashSub) {
    const value = String(subText || '').trim();
    refs.clearFlashSub.textContent = value;
    refs.clearFlashSub.hidden = value.length === 0;
  }
}

function setClearFlashAction(visible, label = 'ステージセレクトに戻る') {
  if (!refs.clearFlashAction) return;
  refs.clearFlashAction.textContent = String(label || 'ステージセレクトに戻る');
  refs.clearFlashAction.hidden = !visible;
}

function returnToStageSelect() {
  stopStageBgm();
  setClearFlash(false);
  setClearFlashContent('満腹', '');
  setClearFlashAction(false);
  setOverlay('難易度を選んでスタート', {
    visible: true,
    showStageButtons: true
  });
}

function syncHud() {
  if (refs.hpValue) {
    const maxHp = Math.max(1, Math.round(Number(state.config?.player?.maxHp || 3)));
    const currentHp = Math.round(clamp(0, Number(state.hp || 0), maxHp));
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < maxHp; i += 1) {
      const heart = document.createElement('span');
      heart.className = `hp-heart ${i < currentHp ? 'is-full' : 'is-empty'}`;
      heart.setAttribute('aria-hidden', 'true');
      heart.textContent = '❤';
      fragment.appendChild(heart);
    }
    refs.hpValue.classList.add('hp-hearts');
    refs.hpValue.setAttribute('aria-label', `HP ${currentHp}/${maxHp}`);
    refs.hpValue.replaceChildren(fragment);
  }
  if (refs.fullnessValue) refs.fullnessValue.textContent = `${Math.round(state.fullness)}%`;
  if (refs.fullnessFill) refs.fullnessFill.style.width = `${clamp(0, state.fullness, 100)}%`;
  if (refs.scoreValue) refs.scoreValue.textContent = `${Math.round(state.score)}`;
}

function playfieldBottomY() {
  return canvas.height - Math.max(0, state.skillDockCanvasHeight || 0);
}

function syncLayoutMetrics() {
  if (!refs.skillDock) return;
  const canvasRect = canvas.getBoundingClientRect();
  const dockRect = refs.skillDock.getBoundingClientRect();
  if (!canvasRect.height || !dockRect.height) return;
  const scale = canvas.height / canvasRect.height;
  const dockHeightCanvas = dockRect.height * scale;
  state.skillDockCanvasHeight = clamp(46, dockHeightCanvas, 180);
}

function audioContextCtor() {
  return window.AudioContext || window.webkitAudioContext || null;
}

function playWarmupSignal() {
  const audioCtx = state.audio.ctx;
  const master = state.audio.master;
  if (!audioCtx || !master || state.audio.warmupDone) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.0002, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
  osc.connect(gain);
  gain.connect(master);
  osc.start(now);
  osc.stop(now + 0.04);
  state.audio.warmupDone = true;
}

function unlockAudio() {
  const Ctor = audioContextCtor();
  if (!Ctor) return false;
  if (!state.audio.ctx) {
    const audioCtx = new Ctor();
    const master = audioCtx.createGain();
    master.gain.value = SFX_MASTER_GAIN;
    master.connect(audioCtx.destination);
    state.audio.ctx = audioCtx;
    state.audio.master = master;
  }
  if (state.audio.ctx.state !== 'running') {
    state.audio.ctx.resume()
      .then(() => {
        state.audio.unlocked = true;
        playWarmupSignal();
      })
      .catch(() => {});
  }
  if (state.audio.ctx.state === 'running') {
    state.audio.unlocked = true;
    playWarmupSignal();
    return true;
  }
  return false;
}

function installAudioUnlockHooks() {
  if (state.audio.unlockHooksInstalled) return;
  const unlockOnce = () => {
    unlockAudio();
  };
  window.addEventListener('pointerdown', unlockOnce, { passive: true });
  window.addEventListener('touchstart', unlockOnce, { passive: true });
  window.addEventListener('click', unlockOnce, { passive: true });
  window.addEventListener('keydown', unlockOnce);
  state.audio.unlockHooksInstalled = true;
}

function canPlaySfx(kind) {
  if (!state.audio.unlocked || !state.audio.ctx || !state.audio.master || state.audio.ctx.state !== 'running') {
    unlockAudio();
    return false;
  }
  const now = Number(state.nowMs || window.performance.now());
  const cooldown = Number(SFX_COOLDOWN_MS[kind] || 0);
  const lastAt = Number(state.audio.lastPlayedAtMs.get(kind) || -Infinity);
  if (now - lastAt < cooldown) return false;
  state.audio.lastPlayedAtMs.set(kind, now);
  return true;
}

function playTone({
  freq = 440,
  toFreq = null,
  duration = 0.08,
  volume = 0.1,
  type = 'sine',
  delaySec = 0,
  attackSec = 0.003,
  releaseSec = 0.06
} = {}) {
  const audioCtx = state.audio.ctx;
  const master = state.audio.master;
  if (!audioCtx || !master) return;

  const startAt = audioCtx.currentTime + Math.max(0, delaySec);
  const endAt = startAt + Math.max(0.02, duration);

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(30, freq), startAt);
  if (Number.isFinite(toFreq) && toFreq !== freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, toFreq), endAt);
  }

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), startAt + Math.max(0.001, attackSec));
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt + Math.max(0.01, releaseSec));

  osc.connect(gain);
  gain.connect(master);
  osc.start(startAt);
  osc.stop(endAt + Math.max(0.01, releaseSec) + 0.01);
}

function playNoise({
  duration = 0.07,
  volume = 0.08,
  delaySec = 0,
  highpass = 500
} = {}) {
  const audioCtx = state.audio.ctx;
  const master = state.audio.master;
  if (!audioCtx || !master) return;

  const frameCount = Math.max(1, Math.floor(audioCtx.sampleRate * Math.max(0.02, duration)));
  const buffer = audioCtx.createBuffer(1, frameCount, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frameCount);
  }

  const startAt = audioCtx.currentTime + Math.max(0, delaySec);
  const source = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = Math.max(100, highpass);

  source.buffer = buffer;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), startAt + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + Math.max(0.02, duration));

  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start(startAt);
  source.stop(startAt + Math.max(0.02, duration) + 0.01);
}

function playSfx(kind, options = {}) {
  if (!canPlaySfx(kind)) return;

  switch (kind) {
    case 'shot':
      playTone({ freq: 760, toFreq: 600, duration: 0.04, volume: 0.03, type: 'triangle' });
      break;
    case 'foodHit':
      playTone({ freq: 230, toFreq: 180, duration: 0.045, volume: 0.05, type: 'square' });
      break;
    case 'foodComplete':
      playTone({ freq: 360, toFreq: 520, duration: 0.09, volume: 0.085, type: 'sine' });
      playTone({ freq: 520, toFreq: 700, duration: 0.08, volume: 0.05, type: 'triangle', delaySec: 0.025 });
      break;
    case 'playerHit':
      playNoise({ duration: 0.07, volume: 0.09, highpass: 340 });
      playTone({ freq: 180, toFreq: 95, duration: 0.12, volume: 0.08, type: 'sawtooth' });
      break;
    case 'skillDrop':
      playTone({ freq: 620, toFreq: 820, duration: 0.1, volume: 0.09, type: 'triangle' });
      playTone({ freq: 820, toFreq: 1080, duration: 0.08, volume: 0.07, type: 'sine', delaySec: 0.06 });
      break;
    case 'skillActivate': {
      const skillType = String(options.skillType || '');
      if (skillType === 'heal') {
        playTone({ freq: 410, toFreq: 560, duration: 0.12, volume: 0.09, type: 'sine' });
      } else if (skillType === 'barrier') {
        playTone({ freq: 300, toFreq: 390, duration: 0.14, volume: 0.08, type: 'triangle' });
        playTone({ freq: 390, toFreq: 300, duration: 0.11, volume: 0.06, type: 'triangle', delaySec: 0.07 });
      } else if (skillType === 'time_stop') {
        playTone({ freq: 760, toFreq: 320, duration: 0.16, volume: 0.07, type: 'square' });
      } else if (skillType === 'speed_boost') {
        playTone({ freq: 260, toFreq: 560, duration: 0.12, volume: 0.085, type: 'sawtooth' });
      } else {
        playTone({ freq: 270, toFreq: 470, duration: 0.16, volume: 0.09, type: 'triangle' });
      }
      break;
    }
    case 'bossAppear':
      playTone({ freq: 120, toFreq: 260, duration: 0.35, volume: 0.11, type: 'sawtooth' });
      playNoise({ duration: 0.11, volume: 0.06, highpass: 220, delaySec: 0.04 });
      break;
    case 'bossHit':
      playTone({ freq: 150, toFreq: 120, duration: 0.05, volume: 0.06, type: 'square' });
      break;
    case 'bossConsume':
      playTone({ freq: 280, toFreq: 520, duration: 0.2, volume: 0.1, type: 'triangle' });
      playTone({ freq: 520, toFreq: 880, duration: 0.22, volume: 0.08, type: 'sine', delaySec: 0.08 });
      break;
    case 'clear':
      playTone({ freq: 420, toFreq: 560, duration: 0.12, volume: 0.09, type: 'triangle' });
      playTone({ freq: 560, toFreq: 740, duration: 0.14, volume: 0.09, type: 'triangle', delaySec: 0.12 });
      playTone({ freq: 740, toFreq: 980, duration: 0.16, volume: 0.09, type: 'sine', delaySec: 0.24 });
      break;
    case 'gameOver':
      playTone({ freq: 280, toFreq: 180, duration: 0.16, volume: 0.08, type: 'square' });
      playTone({ freq: 180, toFreq: 110, duration: 0.22, volume: 0.08, type: 'square', delaySec: 0.15 });
      break;
    default:
      break;
  }
}

function preloadImage(url) {
  if (!url) return null;
  if (state.images.has(url)) return state.images.get(url);
  const image = new Image();
  image.src = url;
  state.images.set(url, image);
  return image;
}

function resolveFoodImageUrl(id, explicitUrl) {
  if (typeof explicitUrl === 'string' && explicitUrl.trim()) return explicitUrl.trim();
  if (!id) return '';
  return `${FOOD_ASSET_BASE_PATH}/${id}.png`;
}

function loadAssetsFromConfig() {
  preloadImage(state.config?.player?.avatarUrl);
  (state.config?.skills || []).forEach((skill) => preloadImage(skill.avatarUrl));
  (state.config?.stages || []).forEach((stage) => {
    (stage.foods || []).forEach((food) => {
      preloadImage(resolveFoodImageUrl(food.id, food.imageUrl));
    });
    if (stage?.boss?.id) {
      preloadImage(resolveFoodImageUrl(stage.boss.id, stage.boss.imageUrl));
    }
  });
}

function drawCircle(x, y, radius, fill, stroke = '#1c141f') {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function drawImageCircle(url, x, y, radius, fallbackColor, zoom = 1) {
  const image = url ? state.images.get(url) : null;
  if (image && image.complete && image.naturalWidth > 0) {
    const zoomRatio = Number.isFinite(zoom) ? Math.max(1, zoom) : 1;
    const drawRadius = radius * zoomRatio;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(image, x - drawRadius, y - drawRadius, drawRadius * 2, drawRadius * 2);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1f1521';
    ctx.stroke();
    return;
  }
  drawCircle(x, y, radius, fallbackColor);
}

function drawImageByLongEdge(url, x, y, longEdge, fallbackColor) {
  const image = url ? state.images.get(url) : null;
  if (image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
    const edge = Math.max(8, Number(longEdge) || 8);
    let drawW = edge;
    let drawH = edge;
    if (image.naturalWidth >= image.naturalHeight) {
      drawH = edge * (image.naturalHeight / image.naturalWidth);
    } else {
      drawW = edge * (image.naturalWidth / image.naturalHeight);
    }
    ctx.drawImage(image, x - drawW / 2, y - drawH / 2, drawW, drawH);
    return;
  }
  drawCircle(x, y, Math.max(6, (Number(longEdge) || 12) * 0.5), fallbackColor);
}

function foodRenderScale(food) {
  const scale = Number(food?.renderScale || 1);
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return scale;
}

function foodHitRadius(food) {
  const baseRadius = Number(food?.radius || 0);
  if (!Number.isFinite(baseRadius) || baseRadius <= 0) return 0;
  return baseRadius * foodRenderScale(food);
}

function buildStageButtons() {
  if (!refs.stageButtons) return;
  refs.stageButtons.innerHTML = '';
  const stages = state.config?.stages || [];

  stages.forEach((stage, index) => {
    const isHiddenStage = String(stage?.id || '') === 'oni';
    const isHiddenStageVisible = !isHiddenStage || index <= state.unlockedStageIndex;
    if (!isHiddenStageVisible) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stage-btn';

    const locked = index > state.unlockedStageIndex;
    if (locked) {
      button.classList.add('is-locked');
      button.disabled = true;
    }
    if (index === state.selectedStageIndex) {
      button.classList.add('is-selected');
    }

    const title = document.createElement('strong');
    title.textContent = `${stage.label} / ${stage.theme}`;

    button.appendChild(title);
    button.addEventListener('click', () => {
      if (index > state.unlockedStageIndex) return;
      unlockAudio();
      startStage(index);
    });
    refs.stageButtons.appendChild(button);

    if (String(stage?.id || '') === 'oni' && state.allStagesCleared) {
      const allClear = document.createElement('p');
      allClear.className = 'overlay-all-clear';
      allClear.textContent = '全ステージクリア！';
      refs.stageButtons.appendChild(allClear);
    }
  });
}

function clearSkillSlotHighlight() {
  if (!refs.skillDock) return;
  refs.skillDock.querySelectorAll('.skill-slot.is-active').forEach((slot) => {
    slot.classList.remove('is-active');
  });
}

function renderSkillDock() {
  if (!refs.skillDock) return;
  refs.skillDock.innerHTML = '';

  const skills = Array.isArray(state.config?.skills) ? state.config.skills : [];
  skills.forEach((skill) => {
    const slot = document.createElement('div');
    slot.className = 'skill-slot';
    slot.dataset.skillId = String(skill.guestId || '');

    const avatarFrame = document.createElement('div');
    avatarFrame.className = 'skill-slot-avatar-frame';

    const avatar = document.createElement('img');
    avatar.className = 'skill-slot-avatar';
    avatar.src = skill.avatarUrl || '';
    avatar.alt = `${skill.guestName || 'ゲスト'}のアイコン`;
    avatar.loading = 'lazy';
    avatar.decoding = 'async';

    const meta = document.createElement('div');
    meta.className = 'skill-slot-meta';

    const name = document.createElement('p');
    name.className = 'skill-slot-name';
    name.textContent = skill.guestName || skill.guestId || 'guest';

    const label = document.createElement('p');
    label.className = 'skill-slot-label';
    label.textContent = skill.label || '必殺技';

    avatarFrame.appendChild(avatar);
    meta.appendChild(name);
    meta.appendChild(label);
    slot.appendChild(avatarFrame);
    slot.appendChild(meta);

    refs.skillDock.appendChild(slot);
  });
}

function setupControls() {
  window.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') input.left = true;
    if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') input.right = true;
    if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') input.up = true;
    if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') input.down = true;
  });

  window.addEventListener('keyup', (event) => {
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') input.left = false;
    if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') input.right = false;
    if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') input.up = false;
    if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') input.down = false;
  });

  const onPointer = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    input.pointerX = (clientX - rect.left) * scaleX;
    input.pointerY = (clientY - rect.top) * scaleY;
  };

  canvas.addEventListener('pointerdown', (event) => {
    unlockAudio();
    input.pointerActive = true;
    onPointer(event.clientX, event.clientY);
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!input.pointerActive) return;
    onPointer(event.clientX, event.clientY);
  });
  canvas.addEventListener('pointerup', () => {
    input.pointerActive = false;
  });
  canvas.addEventListener('pointercancel', () => {
    input.pointerActive = false;
  });

  window.addEventListener('resize', syncLayoutMetrics);
}

function resetDropRate() {
  state.dropRate = Number(state.config?.dropSystem?.baseRate || 0.1);
  state.pitySteps = 0;
  state.lastDropSuccessSec = state.elapsedSec;
}

function computeDropRate() {
  const baseRate = Number(state.config?.dropSystem?.baseRate || 0.1);
  const pity = state.config?.dropSystem?.pity || {};
  const everySec = Number(pity.everySec || 20);
  const plusRate = Number(pity.plusRate || 0.01);
  const maxRate = Number(pity.maxRate || 0.15);
  if (everySec <= 0 || plusRate <= 0) {
    state.dropRate = clamp(baseRate, baseRate, maxRate);
    return;
  }
  const noDropSec = Math.max(0, state.elapsedSec - state.lastDropSuccessSec);
  const steps = Math.floor(noDropSec / everySec);
  state.pitySteps = steps;
  state.dropRate = clamp(baseRate, baseRate + steps * plusRate, maxRate);
}

function enqueueSkill(skill) {
  if (!skill) return;
  state.skillQueue.push(skill);
  processSkillQueue();
}

function showSkillBanner(skill) {
  if (!refs.skillDock) return;
  clearSkillSlotHighlight();

  let targetSlot = null;
  refs.skillDock.querySelectorAll('.skill-slot').forEach((slot) => {
    if (slot.dataset.skillId === String(skill.guestId || '')) {
      targetSlot = slot;
    }
  });
  if (targetSlot) targetSlot.classList.add('is-active');

  if (state.skillSlotTimer) window.clearTimeout(state.skillSlotTimer);
  state.skillSlotTimer = window.setTimeout(() => {
    clearSkillSlotHighlight();
    state.skillSlotTimer = null;
  }, BANNER_SHOW_MS);
}

function setCenterSkillCallout(skill) {
  if (!skill) return;
  const now = Number(state.nowMs || window.performance.now());
  state.centerSkillCallout = {
    guestName: String(skill.guestName || skill.guestId || 'GUEST'),
    skillLabel: String(skill.label || '必殺技'),
    skillType: String(skill.type || ''),
    avatarUrl: String(skill.avatarUrl || ''),
    startedAtMs: now,
    untilMs: now + CENTER_CALLOUT_MS
  };
}

function clearCenterSkillCallout() {
  state.centerSkillCallout = null;
}

function extendTimedEffect(effectKey, durationSec, extra = {}) {
  const base = Math.max(state.activeEffects[effectKey] || 0, state.nowMs);
  state.activeEffects[effectKey] = base + durationSec * 1000;
  if (effectKey === 'speedBoostUntilMs' && Number.isFinite(extra.speedMultiplier)) {
    state.activeEffects.speedMultiplier = Math.max(1, extra.speedMultiplier);
  }
}

function resolveSkill(skillType) {
  return (state.config?.skills || []).find((item) => item.type === skillType);
}

function processSkillQueue() {
  if (state.skillProcessing) return;
  if (!state.skillQueue.length) return;
  state.skillProcessing = true;
  const skill = state.skillQueue.shift();

  activateSkill(skill);

  window.setTimeout(() => {
    state.skillProcessing = false;
    processSkillQueue();
  }, 140);
}

function applyFoodReward(food, shouldRollDrop = true) {
  const gain = Number(food?.fullness || 0);
  const scoreGain = Number(food?.score || 100);

  if (!state.bossSpawned) {
    state.fullness = Math.min(Number(state.stage?.bossAtFullness || 80), state.fullness + gain);
  }
  state.score += scoreGain;
  playSfx('foodComplete');

  if (!state.bossSpawned && state.fullness >= Number(state.stage?.bossAtFullness || 80)) {
    spawnBoss();
  }

  if (shouldRollDrop) rollGuestDrop();
}

function activateSkill(skill) {
  if (!skill) return;
  showSkillBanner(skill);
  setCenterSkillCallout(skill);
  playSfx('skillActivate', { skillType: skill.type });

  switch (skill.type) {
    case 'screen_clear': {
      const existingFoods = state.foods.slice();
      state.foods.length = 0;
      existingFoods.forEach((food) => applyFoodReward(food, false));
      state.hazards.length = 0;
      break;
    }
    case 'time_stop': {
      const durationSec = Number(skill.params?.durationSec || 2.5);
      extendTimedEffect('timeStopUntilMs', durationSec);
      break;
    }
    case 'barrier': {
      const durationSec = Number(skill.params?.durationSec || 4.0);
      extendTimedEffect('barrierUntilMs', durationSec);
      break;
    }
    case 'speed_boost': {
      const durationSec = Number(skill.params?.durationSec || 20.0);
      const speedMultiplier = Number(skill.params?.speedMultiplier || 2.0);
      extendTimedEffect('speedBoostUntilMs', durationSec, { speedMultiplier });
      break;
    }
    case 'heal': {
      const maxHp = Number(state.config?.player?.maxHp || 3);
      const isFullHeal = Boolean(skill.params?.fullHeal);
      if (isFullHeal) {
        state.hp = maxHp;
        break;
      }
      const heal = Number(skill.params?.hp || 1);
      state.hp = Math.min(maxHp, state.hp + heal);
      break;
    }
    default:
      break;
  }
}

function rollGuestDrop() {
  if (!Array.isArray(state.config?.skills) || !state.config.skills.length) return;
  if (Math.random() > state.dropRate) return;
  const skill = randomPick(state.config.skills);
  playSfx('skillDrop');
  resetDropRate();
  enqueueSkill(skill);
}

function spawnFood() {
  const foods = state.stage?.foods || [];
  if (!foods.length) return;
  const base = randomPick(foods);
  const radius = Number(base.radius || 24);
  const renderScale = foodRenderScale(base);
  const hitRadius = radius * renderScale;
  state.foods.push({
    id: base.id,
    name: base.name,
    x: randomIn(hitRadius + 4, canvas.width - hitRadius - 4),
    y: -hitRadius - 6,
    vx: randomIn(-18, 18),
    vy: randomIn(Number(base.speedMin || 40), Number(base.speedMax || 60)),
    hp: Number(base.hp || 1),
    fullness: Number(base.fullness || 5),
    score: Number(base.score || 100),
    radius,
    hitRadius,
    color: base.color || '#f2b777',
    imageUrl: resolveFoodImageUrl(base.id, base.imageUrl),
    renderScale
  });
}

function spawnHazardBurst() {
  const burst = Number(state.stage?.hazardBurst || 2);
  const burstCount = Math.max(1, Math.round(burst * 0.5));
  const stageIndex = state.selectedStageIndex;
  const speedMin = 118 + stageIndex * 18;
  const speedMax = 168 + stageIndex * 24;

  for (let i = 0; i < burstCount; i += 1) {
    state.hazards.push({
      x: randomIn(12, canvas.width - 12),
      y: -16,
      vx: randomIn(-22, 22),
      vy: randomIn(speedMin, speedMax),
      radius: randomIn(6, 11),
      color: i % 2 === 0 ? '#ff784f' : '#ffe07d',
      damage: 1
    });
  }
}

function spawnBoss() {
  if (state.bossSpawned) return;
  const boss = state.stage?.boss;
  if (!boss) return;

  state.bossSpawned = true;
  playSfx('bossAppear');
  state.boss = {
    id: boss.id,
    name: boss.name,
    x: canvas.width / 2,
    y: 108,
    radius: Number(boss.size || 90),
    hp: Number(boss.hp || 70),
    maxHp: Number(boss.hp || 70),
    drift: Number(boss.drift || 80),
    driftPhase: 0,
    imageUrl: resolveFoodImageUrl(boss.id, boss.imageUrl),
    renderScale: Number(boss.renderScale || 1)
  };
}

function spawnBossHazardPattern() {
  if (!state.boss) return;
  const baseRing = 8 + state.selectedStageIndex;
  const ring = Math.max(4, Math.round(baseRing * 0.5));
  for (let i = 0; i < ring; i += 1) {
    const angle = (Math.PI * 2 * i) / ring;
    const speed = 135 + state.selectedStageIndex * 18;
    state.hazards.push({
      x: state.boss.x + Math.cos(angle) * (state.boss.radius * 0.38),
      y: state.boss.y + Math.sin(angle) * (state.boss.radius * 0.38),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed + 30,
      radius: 6 + (i % 2),
      color: '#ff6f7f',
      damage: 1
    });
  }
}

function startStage(index) {
  const stage = stageByIndex(index);
  if (!stage) return;
  if (index > state.unlockedStageIndex) {
    setStageNote('この難易度はまだ解放されていません。');
    return;
  }

  state.stage = stage;
  unlockAudio();
  playStageBgm(stage);
  state.selectedStageIndex = index;
  state.running = true;
  state.ended = false;
  state.elapsedSec = 0;
  state.nowMs = 0;
  state.lastFrameMs = 0;
  state.lastShotMs = 0;
  state.lastFoodSpawnMs = 0;
  state.lastHazardSpawnMs = 0;
  state.lastBossHazardMs = 0;
  state.hp = Number(state.config?.player?.maxHp || 3);
  state.fullness = 0;
  state.score = 0;
  state.boss = null;
  state.bossSpawned = false;
  state.invulnerableUntilMs = 0;
  state.bullets = [];
  state.foods = [];
  state.hazards = [];
  state.skillQueue = [];
  state.skillProcessing = false;
  state.activeEffects.timeStopUntilMs = 0;
  state.activeEffects.barrierUntilMs = 0;
  state.activeEffects.speedBoostUntilMs = 0;
  state.activeEffects.speedMultiplier = 1;
  const renderScale = 2;
  const hitAreaScale = 2;
  const baseRadius = 24;
  const renderRadius = baseRadius * renderScale;
  const hitRadius = baseRadius * Math.sqrt(PLAYER_HIT_AREA_RATIO * hitAreaScale);
  state.player = {
    x: canvas.width / 2,
    y: playfieldBottomY() - (renderRadius + 22),
    radius: baseRadius,
    renderRadius,
    hitRadius,
    speed: 250 * Number(state.config?.player?.moveSpeed || 1)
  };
  if (state.clearFlashTimer) {
    window.clearTimeout(state.clearFlashTimer);
    state.clearFlashTimer = null;
  }
  if (state.skillSlotTimer) {
    window.clearTimeout(state.skillSlotTimer);
    state.skillSlotTimer = null;
  }
  clearCenterSkillCallout();
  setClearFlashContent('満腹', '');
  setClearFlashAction(false);
  setClearFlash(false);
  clearSkillSlotHighlight();
  resetDropRate();
  setOverlay('', {
    visible: false,
    showStageButtons: false
  });
  setStageNote(`${stage.label} ステージを開始しました。`);
  syncHud();
}

function endStage(win) {
  state.running = false;
  state.ended = true;
  stopStageBgm();
  clearCenterSkillCallout();

  if (win) {
    playSfx('clear');
    const clearedIndex = state.selectedStageIndex;
    const previousUnlockedIndex = state.unlockedStageIndex;
    let hiddenStageUnlocked = false;
    if (clearedIndex + 1 > state.unlockedStageIndex) {
      state.unlockedStageIndex = Math.min(clearedIndex + 1, (state.config?.stages?.length || 1) - 1);
      persistUnlockedStageIndex(state.unlockedStageIndex);
      const hiddenIndex = (state.config?.stages || []).findIndex((stage) => String(stage?.id || '') === 'oni');
      if (hiddenIndex >= 0 && previousUnlockedIndex < hiddenIndex && state.unlockedStageIndex >= hiddenIndex) {
        hiddenStageUnlocked = true;
      }
    }
    setOverlay('', {
      visible: false,
      showStageButtons: false
    });
    setClearFlashContent('満腹', '');
    setClearFlashAction(false);
    setClearFlash(true);
    const isOniClear = String(state.stage?.id || '') === 'oni';
    if (isOniClear) {
      state.allStagesCleared = true;
      persistAllStagesCleared(true);
      setStageNote('鬼ステージクリア！ 集計中...');
      setClearFlashContent('満腹', '鬼ステージクリアおめでとう！クリア人数を集計中...');
      setClearFlashAction(true);
      void announceOniClearRank();
    } else if (hiddenStageUnlocked) {
      setStageNote('隠しステージ出現！');
    } else {
      setStageNote(`${state.stage.label} クリア！ 次の難易度が解放されました。`);
    }
    buildStageButtons();
    if (state.clearFlashTimer) {
      window.clearTimeout(state.clearFlashTimer);
      state.clearFlashTimer = null;
    }
    if (isOniClear) return;
    const clearFlashDurationMs = CLEAR_FLASH_MS;
    state.clearFlashTimer = window.setTimeout(() => {
      returnToStageSelect();
      state.clearFlashTimer = null;
    }, clearFlashDurationMs);
    return;
  }

  playSfx('gameOver');
  setOverlay('ゲームオーバー！', {
    visible: true,
    showStageButtons: true
  });
  setStageNote('HPが0になりました。');
}

function onBossConsumed() {
  playSfx('bossConsume');
  state.boss = null;
  state.fullness = 100;
  state.score += 1200;
  syncHud();
  endStage(true);
}

function handleShooting(nowMs) {
  const interval = Number(state.config?.player?.shotIntervalMs || 180);
  if (nowMs - state.lastShotMs < interval) return;
  state.lastShotMs = nowMs;
  playSfx('shot');
  const launchRadius = Number(state.player.renderRadius || state.player.radius || 24);
  state.bullets.push({
    x: state.player.x,
    y: state.player.y - launchRadius - 10,
    vy: -420,
    radius: 8,
    renderRadius: 14
  });
}

function updatePlayer(dtSec) {
  if (!state.player) return;
  const speed = state.player.speed * moveSpeedMultiplier();
  let mx = 0;
  let my = 0;
  if (input.left) mx -= 1;
  if (input.right) mx += 1;
  if (input.up) my -= 1;
  if (input.down) my += 1;

  if (mx !== 0 || my !== 0) {
    const len = Math.hypot(mx, my) || 1;
    state.player.x += (mx / len) * speed * dtSec;
    state.player.y += (my / len) * speed * dtSec;
  } else if (input.pointerActive) {
    const targetX = input.pointerX;
    const targetY = input.pointerY - POINTER_PLAYER_Y_OFFSET;
    const dx = targetX - state.player.x;
    const dy = targetY - state.player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      const step = Math.min(dist, speed * dtSec);
      state.player.x += (dx / dist) * step;
      state.player.y += (dy / dist) * step;
    }
  }

  const radius = Math.max(
    Number(state.player.radius || 0),
    Number(state.player.renderRadius || 0)
  );
  const playBottom = playfieldBottomY();
  state.player.x = clamp(radius + 6, state.player.x, canvas.width - radius - 6);
  state.player.y = clamp(radius + 10, state.player.y, playBottom - radius - 8);
}

function updateEntities(dtSec, nowMs) {
  const timeStop = isEffectActive('timeStopUntilMs');

  if (!timeStop && nowMs - state.lastFoodSpawnMs >= Number(state.stage?.foodSpawnMs || 800)) {
    state.lastFoodSpawnMs = nowMs;
    spawnFood();
  }
  if (!timeStop && nowMs - state.lastHazardSpawnMs >= Number(state.stage?.hazardSpawnMs || 1000)) {
    state.lastHazardSpawnMs = nowMs;
    spawnHazardBurst();
  }

  if (state.boss && !timeStop) {
    state.boss.driftPhase += dtSec * 1.3;
    state.boss.x = canvas.width / 2 + Math.sin(state.boss.driftPhase) * state.boss.drift;
    const cadence = Number(state.stage?.boss?.hazardCadenceMs || 880);
    if (nowMs - state.lastBossHazardMs >= cadence) {
      state.lastBossHazardMs = nowMs;
      spawnBossHazardPattern();
    }
  }

  state.bullets.forEach((bullet) => {
    bullet.y += bullet.vy * dtSec;
  });
  state.bullets = state.bullets.filter((bullet) => bullet.y > -20);

  if (!timeStop) {
    state.foods.forEach((food) => {
      const limitRadius = foodHitRadius(food);
      food.x += food.vx * dtSec;
      food.y += food.vy * dtSec;
      if (food.x < limitRadius || food.x > canvas.width - limitRadius) {
        food.vx *= -1;
      }
    });
    state.hazards.forEach((hazard) => {
      hazard.x += hazard.vx * dtSec;
      hazard.y += hazard.vy * dtSec;
    });
  }

  const playBottom = playfieldBottomY();
  state.foods = state.foods.filter((food) => food.y < playBottom + foodHitRadius(food) + 10);
  state.hazards = state.hazards.filter(
    (hazard) => hazard.y < playBottom + 30 && hazard.x > -30 && hazard.x < canvas.width + 30
  );
}

function resolveCollisions() {
  for (let bi = state.bullets.length - 1; bi >= 0; bi -= 1) {
    const bullet = state.bullets[bi];

    let consumed = false;
    for (let fi = state.foods.length - 1; fi >= 0; fi -= 1) {
      const food = state.foods[fi];
      const rr = (bullet.radius + foodHitRadius(food)) ** 2;
      if (distanceSq(bullet.x, bullet.y, food.x, food.y) > rr) continue;

      playSfx('foodHit');
      food.hp -= 1;
      state.bullets.splice(bi, 1);
      consumed = true;

      if (food.hp <= 0) {
        state.foods.splice(fi, 1);
        applyFoodReward(food, true);
      }
      break;
    }

    if (consumed) continue;

    if (state.boss) {
      const rr = (bullet.radius + state.boss.radius) ** 2;
      if (distanceSq(bullet.x, bullet.y, state.boss.x, state.boss.y) <= rr) {
        state.bullets.splice(bi, 1);
        playSfx('bossHit');
        state.boss.hp -= 1;
        if (state.boss.hp <= 0) onBossConsumed();
      }
    }
  }

  const playerFoodRadius = Number(state.player?.renderRadius || state.player?.radius || 0);
  if (playerFoodRadius > 0) {
    for (let fi = state.foods.length - 1; fi >= 0; fi -= 1) {
      const food = state.foods[fi];
      const rr = (playerFoodRadius + foodHitRadius(food)) ** 2;
      if (distanceSq(state.player.x, state.player.y, food.x, food.y) > rr) continue;
      state.foods.splice(fi, 1);
      applyFoodReward(food, true);
    }
  }

  const barrierActive = isEffectActive('barrierUntilMs');
  for (let hi = state.hazards.length - 1; hi >= 0; hi -= 1) {
    const hazard = state.hazards[hi];
    const rr = (hazard.radius + Number(state.player.hitRadius || state.player.radius || 0)) ** 2;
    if (distanceSq(hazard.x, hazard.y, state.player.x, state.player.y) > rr) continue;
    state.hazards.splice(hi, 1);
    if (barrierActive) continue;
    if (state.nowMs < state.invulnerableUntilMs) continue;

    playSfx('playerHit');
    state.hp -= Number(hazard.damage || 1);
    state.invulnerableUntilMs = state.nowMs + 820;
    if (state.hp <= 0) {
      state.hp = 0;
      endStage(false);
      return;
    }
  }
}

function updateGame(dtSec, nowMs) {
  state.nowMs = nowMs;
  state.elapsedSec += dtSec;
  computeDropRate();

  if (!state.player) return;
  updatePlayer(dtSec);
  handleShooting(nowMs);
  updateEntities(dtSec, nowMs);
  resolveCollisions();

  if (!state.bossSpawned && state.fullness >= Number(state.stage?.bossAtFullness || 80)) {
    spawnBoss();
  }

  if (!isEffectActive('speedBoostUntilMs')) {
    state.activeEffects.speedMultiplier = 1;
  }
  syncHud();
}

function drawBackground() {
  const color = STAGE_BG[state.selectedStageIndex] || STAGE_BG[0];
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, '#09080e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const stripe = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  stripe.addColorStop(0, '#ffffff0f');
  stripe.addColorStop(1, '#ffffff00');
  ctx.fillStyle = stripe;
  for (let i = 0; i < 14; i += 1) {
    const y = (i * 62 + (state.elapsedSec * 70) % 62) % canvas.height;
    ctx.fillRect(0, y, canvas.width, 1);
  }
}

function drawCenterSkillCallout() {
  if (!state.running) return;
  const callout = state.centerSkillCallout;
  if (!callout) return;

  const now = Number(state.nowMs || window.performance.now());
  if (now >= callout.untilMs) {
    clearCenterSkillCallout();
    return;
  }

  const elapsed = Math.max(0, now - callout.startedAtMs);
  const total = CENTER_CALLOUT_MS;
  const inMs = CENTER_IN_MS;
  const outMs = CENTER_OUT_MS;

  let offsetX = 0;
  let alphaScale = 1;
  if (elapsed < inMs) {
    const eased = easeOutCubic(elapsed / inMs);
    offsetX = -42 * (1 - eased);
    alphaScale = eased;
  } else if (elapsed > total - outMs) {
    const eased = easeInCubic((elapsed - (total - outMs)) / outMs);
    offsetX = 24 * eased;
    alphaScale = 1 - eased;
  }

  if (alphaScale <= 0.001) return;

  const palette = skillCalloutPalette(callout.skillType);
  const panelWidth = canvas.width * 0.68;
  const panelHeight = canvas.height * 0.128;
  const panelX = (canvas.width - panelWidth) * 0.5 + offsetX;
  const panelY = canvas.height * 0.5 - panelHeight * 0.5 - canvas.height * 0.06;
  const cut = Math.min(18, panelHeight * 0.24);
  const stripePhase = ((elapsed * 0.55) % 56) - 56;

  ctx.save();

  cutCornerPanelPath(panelX, panelY, panelWidth, panelHeight, cut);
  const bgGradient = ctx.createLinearGradient(panelX, panelY, panelX + panelWidth, panelY + panelHeight);
  bgGradient.addColorStop(0, `${palette.core}dd`);
  bgGradient.addColorStop(0.55, `${palette.core}bb`);
  bgGradient.addColorStop(1, '#0b0f17dd');
  ctx.fillStyle = bgGradient;
  ctx.globalAlpha = 0.34 * alphaScale;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.shadowBlur = 14;
  ctx.shadowColor = `${palette.accent}aa`;
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = `${palette.accent}${Math.floor(190 * alphaScale).toString(16).padStart(2, '0')}`;
  ctx.stroke();
  ctx.shadowBlur = 0;

  const innerX = panelX + 5;
  const innerY = panelY + 5;
  const innerW = panelWidth - 10;
  const innerH = panelHeight - 10;
  cutCornerPanelPath(innerX, innerY, innerW, innerH, Math.max(6, cut - 5));
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = `rgba(255,255,255,${0.24 * alphaScale})`;
  ctx.stroke();

  ctx.globalAlpha = 0.26 * alphaScale;
  ctx.strokeStyle = palette.glow;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let sx = stripePhase; sx < panelWidth + 56; sx += 24) {
    ctx.moveTo(panelX + sx, panelY + panelHeight * 0.1);
    ctx.lineTo(panelX + sx + 14, panelY + panelHeight * 0.9);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  const badgeW = 108;
  const badgeH = 18;
  const badgeX = panelX + panelWidth - badgeW - 14;
  const badgeY = panelY - 8;
  cutCornerPanelPath(badgeX, badgeY, badgeW, badgeH, 6);
  ctx.fillStyle = `rgba(8,12,18,${0.62 * alphaScale})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(255,255,255,${0.34 * alphaScale})`;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.font = '800 10px "M PLUS Rounded 1c", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(240,248,255,${0.68 * alphaScale})`;
  ctx.fillText('SPECIAL SKILL', badgeX + badgeW * 0.5, badgeY + badgeH * 0.52);

  const avatarRadius = 24;
  const avatarX = panelX + 42;
  const avatarY = panelY + panelHeight * 0.5;
  const ringPhase = (elapsed / total) * Math.PI * 2;

  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,255,255,${0.14 * alphaScale})`;
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = `rgba(255,255,255,${0.52 * alphaScale})`;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius + 4, ringPhase, ringPhase + Math.PI * 1.2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(215,181,109,${0.62 * alphaScale})`;
  ctx.stroke();

  const avatarImage = callout.avatarUrl ? state.images.get(callout.avatarUrl) : null;
  if (avatarImage && avatarImage.complete && avatarImage.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarRadius - 1, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImage, avatarX - (avatarRadius - 1), avatarY - (avatarRadius - 1), (avatarRadius - 1) * 2, (avatarRadius - 1) * 2);
    ctx.restore();
  }

  const textX = avatarX + avatarRadius + 16;
  const nameY = panelY + panelHeight * 0.36;
  const skillY = panelY + panelHeight * 0.69;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '900 20px "Yusei Magic", "Yuji Syuku", sans-serif';
  ctx.strokeStyle = `rgba(0,0,0,${0.42 * alphaScale})`;
  ctx.lineWidth = 3;
  ctx.strokeText(callout.guestName, textX, nameY, panelWidth - 146);
  ctx.fillStyle = `rgba(242,239,255,${0.78 * alphaScale})`;
  ctx.fillText(callout.guestName, textX, nameY, panelWidth - 146);

  ctx.font = '900 16px "M PLUS Rounded 1c", sans-serif';
  ctx.strokeStyle = `rgba(0,0,0,${0.48 * alphaScale})`;
  ctx.lineWidth = 3.2;
  ctx.strokeText(callout.skillLabel, textX, skillY, panelWidth - 146);
  ctx.fillStyle = `rgba(255,231,174,${0.8 * alphaScale})`;
  ctx.fillText(callout.skillLabel, textX, skillY, panelWidth - 146);

  ctx.restore();
}

function drawFoods() {
  state.foods.forEach((food) => {
    const longEdge = Math.max(10, foodHitRadius(food) * 2);
    drawImageByLongEdge(food.imageUrl, food.x, food.y, longEdge, food.color);
  });
}

function drawHazards() {
  state.hazards.forEach((hazard) => {
    drawCircle(hazard.x, hazard.y, hazard.radius, hazard.color);
  });
}

function drawBoss() {
  if (!state.boss) return;
  const longEdge = Math.max(20, state.boss.radius * 2 * Number(state.boss.renderScale || 1));
  drawImageByLongEdge(state.boss.imageUrl, state.boss.x, state.boss.y, longEdge, '#ff9f8a');

  const w = Math.min(200, canvas.width - 120);
  const h = 14;
  const x = canvas.width / 2 - w / 2;
  const y = 46;
  const ratio = clamp(0, state.boss.hp / state.boss.maxHp, 1);

  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#1d131f';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#ff4c70';
  ctx.fillRect(x + 2, y + 2, (w - 4) * ratio, h - 4);
}

function drawBullets() {
  state.bullets.forEach((bullet) => {
    drawImageCircle(
      state.config?.player?.avatarUrl,
      bullet.x,
      bullet.y,
      Number(bullet.renderRadius || bullet.radius || 4),
      '#7edfff',
      1.2
    );
  });
}

function drawPlayer() {
  if (!state.player) return;
  const color = state.nowMs < state.invulnerableUntilMs ? '#f0a4c4' : '#9ad8ff';
  const renderRadius = Number(state.player.renderRadius || state.player.radius || 24);
  drawImageCircle(state.config?.player?.avatarUrl, state.player.x, state.player.y, renderRadius, color, 1.2);

  if (isEffectActive('barrierUntilMs')) {
    ctx.beginPath();
    ctx.arc(state.player.x, state.player.y, renderRadius + 8, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#86ffe3';
    ctx.stroke();
  }
}

function drawStageText() {
  if (!state.stage) return;
  ctx.fillStyle = '#ffffffc7';
  ctx.font = '900 14px "M PLUS Rounded 1c"';
  ctx.textAlign = 'left';
  ctx.fillText(`${state.stage.label} / ${state.stage.theme}`, 14, Math.max(84, playfieldBottomY() - 10));
}

function render() {
  drawBackground();
  drawCenterSkillCallout();
  drawFoods();
  drawBoss();
  drawBullets();
  drawPlayer();
  drawStageText();
  drawHazards();
}

function frameLoop(timestamp) {
  if (!state.lastFrameMs) state.lastFrameMs = timestamp;
  const dtSec = Math.min((timestamp - state.lastFrameMs) / 1000, 0.05);
  state.lastFrameMs = timestamp;

  if (state.running) updateGame(dtSec, timestamp);
  render();
  window.requestAnimationFrame(frameLoop);
}

async function loadConfig() {
  const path = resolveConfigPath();
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error('ゲーム設定ファイルの読み込みに失敗しました');
  return response.json();
}

async function bootstrap() {
  try {
    state.config = await loadConfig();
    state.unlockedStageIndex = readUnlockedStageIndex(state.config.stages.length);
    state.allStagesCleared = readAllStagesCleared();
    state.selectedStageIndex = clamp(0, state.unlockedStageIndex, state.config.stages.length - 1);
    state.dropRate = Number(state.config.dropSystem.baseRate || 0.1);
    loadAssetsFromConfig();
    installAudioUnlockHooks();
    setupControls();
    renderSkillDock();
    if (refs.clearFlashAction) {
      refs.clearFlashAction.addEventListener('click', (event) => {
        event.preventDefault();
        returnToStageSelect();
      });
    }
    syncLayoutMetrics();
    buildStageButtons();
    syncHud();
    setOverlay('難易度を選んでスタート', {
      visible: true,
      showStageButtons: true
    });
    setStageNote('まずは「簡単」から始めよう。');
    window.addEventListener('pagehide', () => {
      stopStageBgm();
    });
    window.requestAnimationFrame(frameLoop);
  } catch (error) {
    console.error(error);
    setOverlay('ゲームの初期化に失敗しました', {
      visible: true,
      showStageButtons: false
    });
    setStageNote('設定読み込みでエラーが発生しました。');
  }
}

bootstrap();
