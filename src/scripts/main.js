let lastConfettiAt = 0;
let welcomeBurstPlayed = false;
let burstTimer = null;
let marqueeResizeRaf = null;
let countdownTimer = null;
let copyToastTimer = null;
const MARQUEE_SPEED_PX_PER_SEC = 72;

const effectConfig = {
  mode: 'normal',
  speedLimit: {
    ambient: { min: 72, max: 105 },
    burst_soft: { min: 78, max: 120 },
    burst_hard: { min: 86, max: 132 }
  }
};

const particleState = {
  running: false,
  nodes: [],
  timers: new Map()
};

function setEffectsMode(mode = 'normal') {
  effectConfig.mode = mode;
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function randomIn(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(min, value, max) {
  return Math.min(max, Math.max(min, value));
}

function computeTravelAndDuration(startX, startY, endX, endY, minSpeed, maxSpeed) {
  const dx = endX - startX;
  const dy = endY - startY;
  const travel = Math.max(160, Math.hypot(dx, dy));
  const selectedSpeed = randomIn(minSpeed, maxSpeed);
  const durationSec = travel / selectedSpeed;
  return { travel, speed: selectedSpeed, durationSec };
}

function clampEffectSpeed(travel, durationSec, minSpeed, maxSpeed) {
  const rawSpeed = travel / durationSec;
  const clampedSpeed = clamp(minSpeed, rawSpeed, maxSpeed);
  const fixedDurationSec = travel / clampedSpeed;
  return { speed: clampedSpeed, durationSec: fixedDurationSec, exceeded: rawSpeed > maxSpeed };
}

function debugSpeed(tag, value) {
  if (effectConfig.mode !== 'debug') return;
  console.debug(`[effects:${tag}] speed=${value.toFixed(1)} px/s`);
}

function refreshMarqueeMotion() {
  const tracks = document.querySelectorAll('.marquee-track');
  const minHalfWidth = window.innerWidth * 1.2;

  tracks.forEach((track) => {
    const base = track.dataset.marqueeBase || track.innerHTML;
    if (!base.trim()) return;

    track.dataset.marqueeBase = base;
    track.innerHTML = base;

    let repeats = 0;
    while (track.scrollWidth < minHalfWidth && repeats < 12) {
      track.insertAdjacentHTML('beforeend', base);
      repeats += 1;
    }

    const half = track.innerHTML;
    track.innerHTML = `${half}${half}`;

    const travel = track.scrollWidth / 2;
    const durationSec = Math.max(8, travel / MARQUEE_SPEED_PX_PER_SEC);
    track.style.animationDuration = `${durationSec}s`;
  });
}

function initMarqueeMotion() {
  refreshMarqueeMotion();

  window.addEventListener(
    'resize',
    () => {
      if (marqueeResizeRaf) window.cancelAnimationFrame(marqueeResizeRaf);
      marqueeResizeRaf = window.requestAnimationFrame(() => {
        refreshMarqueeMotion();
        marqueeResizeRaf = null;
      });
    },
    { passive: true }
  );
}

async function loadEvent() {
  try {
    const response = await fetch('/src/data/event.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Failed to load event data');
    const event = await response.json();
    applyEvent(event);
  } catch (error) {
    console.error(error);
  }
}

function formatDateJP(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}(${weekdays[date.getDay()]})`;
}

function toIsoDateTime(dateText, timeText, timezone) {
  if (!dateText) return null;
  const hasTime = typeof timeText === 'string' && /^\d{1,2}:\d{2}$/.test(timeText);
  const timePart = hasTime ? timeText : '00:00';
  if (timezone === 'Asia/Tokyo') {
    return `${dateText}T${timePart}:00+09:00`;
  }
  return `${dateText}T${timePart}:00`;
}

function parseDateSafe(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getEventContext(event) {
  const fallbackStartIso = toIsoDateTime(event.date, event.startTime, event.timezone);
  const startAt = parseDateSafe(event.reminder?.startAtIso || fallbackStartIso);
  const endFallback = startAt ? new Date(startAt.getTime() + 2 * 60 * 60 * 1000) : null;
  const endAt = parseDateSafe(event.reminder?.endAtIso) || endFallback;
  const detailsUrl = event.reminder?.detailsUrl || event.cta?.primaryUrl || window.location.href;
  const shareText = event.share?.messageTemplate || `${event.title}\n${formatDateJP(event.date)} ${event.startTime} START\n${event.venue}`;
  return {
    startAt,
    endAt,
    detailsUrl,
    shareText,
    reminderTitle: event.reminder?.title || event.title,
    reminderDescription: event.reminder?.description || event.description,
    reminderLocation: event.reminder?.location || event.venue
  };
}

function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${String(days).padStart(2, '0')}日 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function initCountdown(startAt) {
  const countdownText = document.getElementById('countdown-text');
  if (!countdownText || !startAt) return;

  if (countdownTimer) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }

  const render = () => {
    const diff = startAt.getTime() - Date.now();
    countdownText.textContent = diff > 0 ? formatCountdown(diff) : '配信中';
  };

  render();
  countdownTimer = window.setInterval(render, 1000);
}

function toUtcCompact(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}T${h}${min}${s}Z`;
}

function createGoogleCalendarUrl(ctx) {
  if (!ctx.startAt || !ctx.endAt) return '#';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ctx.reminderTitle,
    details: `${ctx.reminderDescription}\n${ctx.detailsUrl}`,
    location: ctx.reminderLocation,
    dates: `${toUtcCompact(ctx.startAt)}/${toUtcCompact(ctx.endAt)}`
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function escapeIcsText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function downloadIcs(ctx, eventId = 'event') {
  if (!ctx.startAt || !ctx.endAt) return;
  const uid = `${eventId}-${ctx.startAt.getTime()}@pickupliver`;
  const dtstamp = toUtcCompact(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PICK UP LIVER//LP Reminder//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${toUtcCompact(ctx.startAt)}`,
    `DTEND:${toUtcCompact(ctx.endAt)}`,
    `SUMMARY:${escapeIcsText(ctx.reminderTitle)}`,
    `DESCRIPTION:${escapeIcsText(`${ctx.reminderDescription}\n${ctx.detailsUrl}`)}`,
    `LOCATION:${escapeIcsText(ctx.reminderLocation)}`,
    `URL:${escapeIcsText(ctx.detailsUrl)}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  const content = `${lines.join('\r\n')}\r\n`;
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${eventId || 'event'}-reminder.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.warn('Clipboard API failed, fallback to textarea copy', error);
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  return ok;
}

function showCopyToast(message) {
  const copyToast = document.getElementById('copy-toast');
  if (!copyToast) return;
  copyToast.textContent = message;
  copyToast.classList.add('show');
  if (copyToastTimer) window.clearTimeout(copyToastTimer);
  copyToastTimer = window.setTimeout(() => {
    copyToast.classList.remove('show');
  }, 1500);
}

function initShareActions(ctx) {
  const shareX = document.getElementById('share-x');
  const shareLine = document.getElementById('share-line');
  const shareCopy = document.getElementById('share-copy');

  const shareUrl = ctx.detailsUrl || window.location.href;
  const xParams = new URLSearchParams({ text: ctx.shareText, url: shareUrl });
  const lineParams = new URLSearchParams({ url: shareUrl });

  if (shareX) shareX.href = `https://twitter.com/intent/tweet?${xParams.toString()}`;
  if (shareLine) shareLine.href = `https://social-plugins.line.me/lineit/share?${lineParams.toString()}`;

  if (shareCopy) {
    shareCopy.onclick = async () => {
      const copied = await copyToClipboard(shareUrl);
      showCopyToast(copied ? 'URLをコピーしました' : 'コピーに失敗しました');
    };
  }
}

function initReminderActions(event, ctx) {
  const remindGoogle = document.getElementById('remind-google');
  const remindIcs = document.getElementById('remind-ics');
  if (remindGoogle) remindGoogle.href = createGoogleCalendarUrl(ctx);
  if (remindIcs) {
    remindIcs.onclick = () => {
      downloadIcs(ctx, event.eventId);
    };
  }
}

function applyEvent(event) {
  const title = document.getElementById('event-title');
  const summary = document.getElementById('event-summary');
  const date = document.getElementById('event-date');
  const time = document.getElementById('event-time');
  const venue = document.getElementById('event-venue');
  const ctaPrimary = document.getElementById('cta-primary');
  const ctaSecondary = document.getElementById('cta-secondary');
  const mainFlyer = document.getElementById('main-flyer');
  const hostList = document.getElementById('host-list');
  const guestList = document.getElementById('guest-list');
  const snsList = document.getElementById('sns-list');
  const marqueeTrackB = document.querySelector('.marquee-track.track-b');
  const ctx = getEventContext(event);

  if (title) title.textContent = event.title;
  if (summary) summary.textContent = event.description;
  if (date) date.textContent = formatDateJP(event.date);
  if (time) time.textContent = `${event.startTime} START`;
  if (venue) venue.textContent = event.venue;

  if (ctaPrimary) {
    ctaPrimary.textContent = event.cta.primaryLabel;
    ctaPrimary.href = event.cta.primaryUrl || '#';
  }

  if (ctaSecondary) {
    ctaSecondary.textContent = event.cta.secondaryLabel;
    ctaSecondary.href = event.cta.secondaryUrl || '#guests';
  }

  if (mainFlyer && event.assets?.mainFlyer) {
    mainFlyer.src = event.assets.mainFlyer;
  }

  if (hostList) {
    hostList.innerHTML = '';
    for (const host of event.hosts || []) {
      const li = document.createElement('li');
      li.textContent = `${host.role}: ${host.name}`;
      hostList.appendChild(li);
    }
  }

  if (guestList) {
    guestList.innerHTML = '';
    for (const guest of event.guestLivers || []) {
      const li = document.createElement('li');
      li.textContent = guest.name;
      guestList.appendChild(li);
    }
  }

  if (snsList) {
    snsList.innerHTML = '';
    const entries = [
      ...(event.hosts || []).map((v) => ({ label: `${v.name}（${v.role}）`, url: v.profileUrl })),
      ...(event.guestLivers || []).map((v) => ({ label: `${v.name}（ゲスト）`, url: v.profileUrl }))
    ];

    for (const item of entries) {
      if (!item.url) continue;
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = item.label;
      li.appendChild(a);
      snsList.appendChild(li);
    }
  }

  if (marqueeTrackB) {
    const labels = [
      ...(event.hosts || []).map((host) => `MC: ${host.name}`),
      ...(event.guestLivers || []).map((guest) => `ゲスト: ${guest.name}`)
    ];

    if (labels.length) {
      marqueeTrackB.textContent = '';

      for (const label of labels) {
        const span = document.createElement('span');
        span.textContent = label;
        marqueeTrackB.appendChild(span);
      }
    }

    marqueeTrackB.dataset.marqueeBase = marqueeTrackB.innerHTML;
  }

  initCountdown(ctx.startAt);
  initShareActions(ctx);
  initReminderActions(event, ctx);
  refreshMarqueeMotion();
}

function initRevealAnimation() {
  const targets = document.querySelectorAll('.reveal');

  if (prefersReducedMotion()) {
    targets.forEach((target) => target.classList.add('in'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');

        if (entry.target.classList.contains('card')) {
          const rect = entry.target.getBoundingClientRect();
          launchConfetti('burst_soft', {
            originX: rect.left + rect.width * 0.35,
            originY: rect.top + 24,
            count: window.innerWidth <= 640 ? 18 : 36
          });
        }

        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.16 }
  );

  targets.forEach((target, index) => {
    target.style.transitionDelay = `${Math.min(index * 70, 280)}ms`;
    observer.observe(target);
  });
}

function initParallaxOrbs() {
  if (prefersReducedMotion()) return;

  const orbs = document.querySelectorAll('.orb');
  if (!orbs.length) return;

  window.addEventListener(
    'scroll',
    () => {
      const y = window.scrollY;
      orbs.forEach((orb) => {
        const depth = Number(orb.dataset.depth || 0.02);
        orb.style.transform = `translate3d(0, ${y * depth}px, 0)`;
      });
    },
    { passive: true }
  );
}

function recycleParticle(node) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isMobile = vw <= 640;

  const kind = node.dataset.kind;
  const x0 = randomIn(-vw * 0.08, vw * 1.08);
  const y0 = randomIn(-vh * 0.12, vh * 0.06);
  const x1 = x0 + randomIn(-90, 90);
  const y1 = vh + randomIn(80, 200);
  const xm = x0 + randomIn(-140, 140);
  const ym = randomIn(vh * 0.25, vh * 0.7);

  const palette = ['#ff4fab', '#00c2ff', '#ffd62e', '#ff9b2f', '#8a5dff', '#57ff9f', '#ffffff'];
  const color = palette[Math.floor(Math.random() * palette.length)];

  let minSpeed = effectConfig.speedLimit.ambient.min;
  let maxSpeed = effectConfig.speedLimit.ambient.max;
  let opa = randomIn(0.36, 0.62);
  let rot = `${randomIn(120, 520)}deg`;

  if (kind === 'particle-ring') {
    minSpeed = 68;
    maxSpeed = 96;
    opa = randomIn(0.30, 0.50);
  }

  if (kind === 'particle-shard') {
    minSpeed = 74;
    maxSpeed = 104;
    opa = randomIn(0.40, 0.62);
  }

  if (isMobile) {
    minSpeed *= 0.98;
    maxSpeed *= 1.02;
  }

  const computed = computeTravelAndDuration(x0, y0, x1, y1, minSpeed, maxSpeed);
  const fixed = clampEffectSpeed(computed.travel, computed.durationSec, minSpeed, maxSpeed);
  debugSpeed(kind, fixed.speed);

  node.style.left = '0px';
  node.style.top = '0px';
  node.style.color = color;
  node.style.background = kind === 'particle-ring' ? 'transparent' : color;
  node.style.setProperty('--x0', `${x0}px`);
  node.style.setProperty('--y0', `${y0}px`);
  node.style.setProperty('--xm', `${xm}px`);
  node.style.setProperty('--ym', `${ym}px`);
  node.style.setProperty('--x1', `${x1}px`);
  node.style.setProperty('--y1', `${y1}px`);
  node.style.setProperty('--dur', `${fixed.durationSec}s`);
  node.style.setProperty('--opa', String(opa));
  node.style.setProperty('--rot', rot);
  node.style.animationDelay = `${-Math.random() * fixed.durationSec}s`;
  return fixed.durationSec;
}

function spawnPersistentParticles(config) {
  const layer = document.getElementById('spark-layer');
  if (!layer || prefersReducedMotion()) return;

  const scheduleRecycle = (node, durationSec) => {
    const prevTimer = particleState.timers.get(node);
    if (prevTimer) clearTimeout(prevTimer);

    const delayMs = Math.max(16, Math.round(durationSec * 1000));
    const timer = window.setTimeout(() => {
      if (!particleState.running || !node.isConnected) {
        particleState.timers.delete(node);
        return;
      }

      const nextDurationSec = recycleParticle(node);
      scheduleRecycle(node, nextDurationSec);
    }, delayMs);

    particleState.timers.set(node, timer);
  };

  const make = (kind, count) => {
    for (let i = 0; i < count; i += 1) {
      const node = document.createElement('span');
      node.className = `particle ${kind}`;
      node.dataset.kind = kind;
      const durationSec = recycleParticle(node);
      scheduleRecycle(node, durationSec);
      layer.appendChild(node);
      particleState.nodes.push(node);
    }
  };

  make('particle-spark', config.spark);
  make('particle-shard', config.shard);
  make('particle-ring', config.ring);
}

function initParticleEngine() {
  if (prefersReducedMotion()) return;

  const isMobile = window.innerWidth <= 640;
  const config = isMobile
    ? { spark: 62, shard: 0, ring: 18 }
    : { spark: 136, shard: 0, ring: 48 };

  particleState.running = true;
  spawnPersistentParticles(config);
}

function destroyParticleEngine() {
  const layer = document.getElementById('spark-layer');
  particleState.timers.forEach((timer) => clearTimeout(timer));
  particleState.timers.clear();
  if (layer) {
    particleState.nodes.forEach((n) => n.remove());
  }
  particleState.nodes = [];
  particleState.running = false;
}

function createConfettiPiece(type, options) {
  const fxLayer = document.getElementById('fx-layer');
  if (!fxLayer) return null;

  const palette = ['#ff4fab', '#00c2ff', '#ffd62e', '#ff9b2f', '#8a5dff', '#57ff9f', '#ffffff'];
  const color = palette[Math.floor(Math.random() * palette.length)];

  const spread = options.spread;
  const x1 = options.originX + (Math.random() - 0.5) * spread;
  const y1 = options.originY + options.dropBase + Math.random() * options.dropRandom;
  const rot = `${420 + Math.random() * 820}deg`;

  const limits = effectConfig.speedLimit[type];
  const computed = computeTravelAndDuration(options.originX, options.originY, x1, y1, limits.min, limits.max);
  const fixed = clampEffectSpeed(computed.travel, computed.durationSec, limits.min, limits.max);
  debugSpeed(type, fixed.speed);

  const piece = document.createElement('span');
  piece.className = 'confetti-piece';
  piece.style.background = color;
  piece.style.setProperty('--x0', `${options.originX}px`);
  piece.style.setProperty('--y0', `${options.originY}px`);
  piece.style.setProperty('--x1', `${x1}px`);
  piece.style.setProperty('--y1', `${y1}px`);
  piece.style.setProperty('--rot', rot);
  piece.style.setProperty('--dur', `${fixed.durationSec * 1000}ms`);

  fxLayer.appendChild(piece);
  window.setTimeout(() => piece.remove(), fixed.durationSec * 1000 + 80);
  return piece;
}

function launchConfetti(type = 'burst_soft', options = {}) {
  if (prefersReducedMotion()) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const isMobile = viewportWidth <= 640;
  const count = options.count || (isMobile ? 120 : 240);
  const originX = options.originX ?? viewportWidth * 0.5;
  const originY = options.originY ?? Math.min(240, viewportHeight * 0.34);

  const burstOptions = {
    originX,
    originY,
    spread: isMobile ? 180 : 320,
    dropBase: 160,
    dropRandom: 180
  };

  if (type === 'burst_hard') {
    burstOptions.spread = isMobile ? 460 : 980;
    burstOptions.dropBase = 220;
    burstOptions.dropRandom = 320;
  }

  for (let i = 0; i < count; i += 1) {
    createConfettiPiece(type, burstOptions);
  }
}

function launchAngledConfetti(pattern = 'top-center') {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isMobile = vw <= 640;

  const patterns = {
    'top-center': { x: vw * 0.5, y: 90, count: isMobile ? 110 : 220 },
    'top-left': { x: vw * 0.12, y: 100, count: isMobile ? 90 : 180 },
    'top-right': { x: vw * 0.88, y: 100, count: isMobile ? 90 : 180 },
    'bottom-left-diagonal': { x: vw * 0.08, y: vh - 40, count: isMobile ? 120 : 240 },
    'bottom-right-diagonal': { x: vw * 0.92, y: vh - 40, count: isMobile ? 120 : 240 },
    'mid-left': { x: vw * 0.08, y: vh * 0.45, count: isMobile ? 90 : 180 },
    'mid-right': { x: vw * 0.92, y: vh * 0.45, count: isMobile ? 90 : 180 }
  };

  const sel = patterns[pattern] || patterns['top-center'];
  launchConfetti('burst_soft', { originX: sel.x, originY: sel.y, count: sel.count });
}

function initPeriodicConfetti() {
  if (prefersReducedMotion()) return;

  const sequence = [
    'top-center',
    'bottom-left-diagonal',
    'top-right',
    'mid-left',
    'bottom-right-diagonal',
    'top-left',
    'mid-right'
  ];
  let index = 0;

  burstTimer = window.setInterval(() => {
    launchAngledConfetti(sequence[index % sequence.length]);
    index += 1;
  }, 4200);
}

function cleanupEffects() {
  if (burstTimer) {
    window.clearInterval(burstTimer);
    burstTimer = null;
  }

  const fxLayer = document.getElementById('fx-layer');
  if (fxLayer) {
    fxLayer.querySelectorAll('.confetti-piece').forEach((piece) => piece.remove());
  }

  destroyParticleEngine();

  if (countdownTimer) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function initConfetti() {
  const ctaPrimary = document.getElementById('cta-primary');
  if (!ctaPrimary) return;

  ctaPrimary.addEventListener('click', () => {
    const now = Date.now();
    if (now - lastConfettiAt < 700) return;
    lastConfettiAt = now;

    const rect = ctaPrimary.getBoundingClientRect();
    launchConfetti('burst_hard', {
      originX: rect.left + rect.width / 2,
      originY: rect.top + rect.height / 2,
      count: window.innerWidth <= 640 ? 120 : 240
    });
  });

  if (!prefersReducedMotion() && !welcomeBurstPlayed) {
    welcomeBurstPlayed = true;
    window.setTimeout(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isMobile = vw <= 640;
      launchConfetti('burst_hard', {
        originX: vw * 0.5,
        originY: 110,
        count: isMobile ? 220 : 520
      });
      window.setTimeout(() => {
        launchConfetti('burst_hard', {
          originX: vw * 0.08,
          originY: vh - 40,
          count: isMobile ? 180 : 420
        });
      }, 220);
      window.setTimeout(() => {
        launchConfetti('burst_hard', {
          originX: vw * 0.92,
          originY: vh - 40,
          count: isMobile ? 180 : 420
        });
      }, 440);
    }, 220);
  }

  window.addEventListener('pagehide', cleanupEffects);
}

if (window.location.search.includes('fx=debug')) {
  setEffectsMode('debug');
}

loadEvent();
initMarqueeMotion();
initRevealAnimation();
initParallaxOrbs();
initParticleEngine();
initConfetti();
// initPeriodicConfetti();
