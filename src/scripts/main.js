let lastConfettiAt = 0;
let welcomeBurstPlayed = false;
let burstTimer = null;
let marqueeResizeRaf = null;
let countdownTimer = null;
let copyToastTimer = null;
const MARQUEE_SPEED_PX_PER_SEC = 72;
const SHARE_PAGE_URL = 'https://pickupliver-lp.pages.dev/';

const effectConfig = {
  mode: 'normal',
  perf: {
    particleScale: 1,
    confettiScale: 1,
    maxConfettiNodes: 520
  },
  speedLimit: {
    ambient: { min: 72, max: 105 },
    burst_soft: { min: 78, max: 120 },
    burst_hard: { min: 86, max: 132 },
    burst_launch: { min: 92, max: 148 }
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

function getDevicePerfTier() {
  const memory = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  const reducedMotion = prefersReducedMotion();

  if (reducedMotion || (memory && memory <= 4) || (cores && cores <= 4)) {
    return 'low';
  }
  return 'normal';
}

function initPerfProfile() {
  const tier = getDevicePerfTier();
  if (tier === 'low') {
    effectConfig.perf.particleScale = 0.62;
    effectConfig.perf.confettiScale = 0.55;
    effectConfig.perf.maxConfettiNodes = 320;
    return;
  }

  effectConfig.perf.particleScale = 0.8;
  effectConfig.perf.confettiScale = 0.75;
  effectConfig.perf.maxConfettiNodes = 460;
}

function scaledCount(base) {
  return Math.max(8, Math.round(base * effectConfig.perf.particleScale));
}

function scaledConfettiCount(base) {
  return Math.max(16, Math.round(base * effectConfig.perf.confettiScale));
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

function initCountdown(startAt, endAt) {
  const countdownText = document.getElementById('countdown-text');
  if (!countdownText || !startAt) return;

  if (countdownTimer) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }

  const setPlainText = (text) => {
    countdownText.classList.remove('countdown-text--ended');
    countdownText.textContent = text;
  };

  const setEndedText = () => {
    countdownText.classList.add('countdown-text--ended');
    countdownText.innerHTML = '<span class="countdown-ended-main">THANK YOU FOR WATCHING!!</span><span class="countdown-ended-sub">次回の開催をお待ちください！</span>';
  };

  const render = () => {
    const now = Date.now();
    const startAtMs = startAt.getTime();
    const endAtMs = endAt ? endAt.getTime() : null;

    if (now < startAtMs) {
      setPlainText(formatCountdown(startAtMs - now));
      return;
    }

    if (!endAtMs || now < endAtMs) {
      setPlainText('NOW ON AIR');
      return;
    }

    setEndedText();
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

  const shareUrl = SHARE_PAGE_URL;
  const shareText = ctx.shareText || '';
  const sharePayload = shareText ? `${shareText}\n${shareUrl}` : shareUrl;
  const xParams = new URLSearchParams({ text: ctx.shareText, url: shareUrl });
  const linePayload = encodeURIComponent(sharePayload);

  if (shareX) shareX.href = `https://twitter.com/intent/tweet?${xParams.toString()}`;
  if (shareLine) shareLine.href = `https://line.me/R/msg/text/?${linePayload}`;

  if (shareCopy) {
    shareCopy.onclick = async () => {
      const copied = await copyToClipboard(sharePayload);
      showCopyToast(copied ? '共有文をコピーしました' : 'コピーに失敗しました');
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

function createTalentCard(person, roleLabel) {
  const li = document.createElement('li');
  li.className = 'talent-card reveal card-pop';
  const isGuest = typeof roleLabel === 'string' && roleLabel.includes('ゲスト');
  li.classList.add(isGuest ? 'role-guest' : 'role-mc');

  const avatarWrap = document.createElement('span');
  avatarWrap.className = 'talent-avatar-wrap';

  const avatarImg = document.createElement('img');
  avatarImg.className = 'talent-avatar';
  avatarImg.alt = `${person.name}のアイコン`;
  avatarImg.loading = 'lazy';
  avatarImg.decoding = 'async';

  const avatarFallback = document.createElement('span');
  avatarFallback.className = 'talent-avatar-fallback';
  avatarFallback.textContent = String(person.name || '?').trim().slice(0, 1) || '?';

  avatarWrap.appendChild(avatarImg);
  avatarWrap.appendChild(avatarFallback);

  if (person.avatarUrl) {
    avatarImg.src = person.avatarUrl;
    avatarImg.addEventListener('load', () => {
      avatarWrap.classList.add('loaded');
    });
    avatarImg.addEventListener('error', () => {
      avatarWrap.classList.remove('loaded');
    });
  }

  const meta = document.createElement('div');
  meta.className = 'talent-meta';

  const name = document.createElement('p');
  name.className = 'talent-name';
  name.textContent = person.name || '出演者';
  meta.appendChild(name);

  if (roleLabel) {
    const role = document.createElement('p');
    role.className = 'talent-role';
    role.textContent = roleLabel;
    meta.appendChild(role);
  }

  if (person.profileUrl) {
    const link = document.createElement('a');
    link.className = 'talent-link';
    link.href = person.profileUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'プロフィールを見る';
    meta.appendChild(link);
  }

  li.appendChild(avatarWrap);
  li.appendChild(meta);
  return li;
}

function initTalentCardEffects() {
  const cards = document.querySelectorAll('.talent-card.card-pop');
  if (!cards.length) return;

  function launchCardSparkle(card) {
    if (!card || prefersReducedMotion()) return;
    if (card.dataset.sparked === '1') return;

    const rect = card.getBoundingClientRect();
    const isMobile = window.innerWidth <= 640;
    const baseCount = isMobile
      ? Math.round(randomIn(16, 22))
      : Math.round(randomIn(24, 32));
    const tries = Number(card.dataset.sparkTries || 0);
    const emitted = launchConfetti('burst_soft', {
      originX: rect.left + rect.width * 0.7,
      originY: rect.top + rect.height * 0.42,
      count: baseCount
    });

    if (emitted > 0) {
      card.dataset.sparked = '1';
      return;
    }

    if (tries >= 4) {
      card.dataset.sparked = '1';
      return;
    }

    card.dataset.sparkTries = String(tries + 1);
    window.setTimeout(() => {
      if (!card.isConnected) return;
      launchCardSparkle(card);
    }, 220);
  }

  cards.forEach((card, index) => {
    card.style.transitionDelay = `${Math.min(index * 50, 250)}ms`;

    card.onpointerup = () => {
      if (prefersReducedMotion()) return;
      card.classList.add('is-tapped');
      window.setTimeout(() => card.classList.remove('is-tapped'), 170);
    };
  });

  if (prefersReducedMotion()) {
    cards.forEach((card) => card.classList.add('in'));
    return;
  }

  let revealRaf = null;

  const revealVisibleCards = () => {
    revealRaf = null;
    const vh = window.innerHeight;
    cards.forEach((card) => {
      if (card.classList.contains('in')) return;
      const rect = card.getBoundingClientRect();
      const entered = rect.top < vh * 0.92 && rect.bottom > vh * 0.08;
      if (!entered) return;
      card.classList.add('in');
      launchCardSparkle(card);
    });

    const remaining = Array.from(cards).some((card) => !card.classList.contains('in'));
    if (!remaining) {
      window.removeEventListener('scroll', queueReveal, { passive: true });
      window.removeEventListener('resize', queueReveal, { passive: true });
    }
  };

  function queueReveal() {
    if (revealRaf) return;
    revealRaf = window.requestAnimationFrame(revealVisibleCards);
  }

  queueReveal();
  window.addEventListener('scroll', queueReveal, { passive: true });
  window.addEventListener('resize', queueReveal, { passive: true });
}

function applyEvent(event) {
  const title = document.getElementById('event-title');
  const summary = document.getElementById('event-summary');
  const date = document.getElementById('event-date');
  const time = document.getElementById('event-time');
  const venue = document.getElementById('event-venue');
  const ctaPrimary = document.getElementById('cta-primary');
  const mainFlyer = document.getElementById('main-flyer');
  const hostList = document.getElementById('host-list');
  const guestList = document.getElementById('guest-list');
  const marqueeTrackB = document.querySelector('.marquee-track.track-b');
  const eventHighlights = document.getElementById('event-highlights');
  const noArchiveNote = document.getElementById('no-archive-note');
  const nextPickupTeaser = document.getElementById('next-pickup-teaser');
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

  if (mainFlyer && event.assets?.mainFlyer) {
    mainFlyer.src = event.assets.mainFlyer;
  }

  if (hostList) {
    hostList.innerHTML = '';
    for (const host of event.hosts || []) {
      hostList.appendChild(createTalentCard(host, host.role));
    }
  }

  if (guestList) {
    guestList.innerHTML = '';
    for (const guest of event.guestLivers || []) {
      guestList.appendChild(createTalentCard(guest, 'ゲスト'));
    }
  }

  if (eventHighlights) {
    eventHighlights.innerHTML = '';
    const highlights = (event.highlights && event.highlights.length)
      ? event.highlights
      : ['参加型企画あり', 'MC×ゲストのコラボ', 'ここだけのトーク'];

    for (const item of highlights.slice(0, 3)) {
      const li = document.createElement('li');
      li.textContent = item;
      eventHighlights.appendChild(li);
    }
  }

  if (noArchiveNote) {
    noArchiveNote.textContent = event.eventNotice?.noArchiveText || 'アーカイブ無し。お見逃しなく！';
  }

  if (nextPickupTeaser) {
    nextPickupTeaser.textContent = event.eventNotice?.nextPickupTeaser || '次のPICK UP LIVERに呼ばれるのはあなたかも…？';
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

  initCountdown(ctx.startAt, ctx.endAt);
  initShareActions(ctx);
  initReminderActions(event, ctx);
  refreshMarqueeMotion();
  initTalentCardEffects();
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

        if (entry.target.classList.contains('card') && entry.target.id !== 'hosts' && entry.target.id !== 'guests') {
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

  let scrollRaf = null;
  let latestY = window.scrollY;

  const applyParallax = () => {
    scrollRaf = null;
    orbs.forEach((orb) => {
      const depth = Number(orb.dataset.depth || 0.02);
      orb.style.transform = `translate3d(0, ${latestY * depth}px, 0)`;
    });
  };

  window.addEventListener(
    'scroll',
    () => {
      latestY = window.scrollY;
      if (scrollRaf) return;
      scrollRaf = window.requestAnimationFrame(applyParallax);
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
  if (prefersReducedMotion() || particleState.running) return;

  const isMobile = window.innerWidth <= 640;
  const config = isMobile
    ? { spark: scaledCount(62), shard: 0, ring: scaledCount(18) }
    : { spark: scaledCount(136), shard: 0, ring: scaledCount(48) };

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
  if (fxLayer.childElementCount >= effectConfig.perf.maxConfettiNodes) return null;

  const palette = ['#ff4fab', '#00c2ff', '#ffd62e', '#ff9b2f', '#8a5dff', '#57ff9f', '#ffffff'];
  const color = palette[Math.floor(Math.random() * palette.length)];

  const spread = options.spread;
  const x1 = options.originX + (Math.random() - 0.5) * spread;
  const yTravel = options.rise
    ? -(options.riseBase + Math.random() * options.riseRandom)
    : options.dropBase + Math.random() * options.dropRandom;
  const y1 = options.originY + yTravel;
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
  const baseCount = options.count || (isMobile ? 120 : 240);
  const count = scaledConfettiCount(baseCount);
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

  if (type === 'burst_launch') {
    burstOptions.spread = isMobile ? 220 : 420;
    burstOptions.rise = true;
    burstOptions.riseBase = isMobile ? 220 : 360;
    burstOptions.riseRandom = isMobile ? 220 : 360;
    burstOptions.dropBase = 0;
    burstOptions.dropRandom = 0;
  }

  let emitted = 0;
  for (let i = 0; i < count; i += 1) {
    const piece = createConfettiPiece(type, burstOptions);
    if (piece) emitted += 1;
  }
  return emitted;
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
      count: window.innerWidth <= 640 ? 96 : 180
    });
  });

  if (!prefersReducedMotion() && !welcomeBurstPlayed) {
    welcomeBurstPlayed = true;
    window.setTimeout(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isMobile = vw <= 640;
      const launchFromBottom = (xRatio, delay, count) => {
        window.setTimeout(() => {
          launchConfetti('burst_launch', {
            originX: vw * xRatio,
            originY: vh - 24,
            count
          });
        }, delay);
      };

      launchFromBottom(0.08, 0, isMobile ? 150 : 300);
      launchFromBottom(0.5, 90, isMobile ? 180 : 360);
      launchFromBottom(0.92, 180, isMobile ? 150 : 300);
      launchFromBottom(0.24, 300, isMobile ? 130 : 260);
      launchFromBottom(0.76, 390, isMobile ? 130 : 260);
    }, 220);
  }

  window.addEventListener('pagehide', cleanupEffects);
}

function initVisibilityOptimizations() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      destroyParticleEngine();
      return;
    }
    initParticleEngine();
  });
}

if (window.location.search.includes('fx=debug')) {
  setEffectsMode('debug');
}

initPerfProfile();
loadEvent();
initMarqueeMotion();
initRevealAnimation();
initParallaxOrbs();
initParticleEngine();
initConfetti();
initVisibilityOptimizations();
// initPeriodicConfetti();
