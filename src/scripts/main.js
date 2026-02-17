let lastConfettiAt = 0;

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
}

function initRevealAnimation() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targets = document.querySelectorAll('.reveal');

  if (reduceMotion) {
    targets.forEach((target) => target.classList.add('in'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15 }
  );

  targets.forEach((target, index) => {
    target.style.transitionDelay = `${Math.min(index * 70, 280)}ms`;
    observer.observe(target);
  });
}

function initParallaxOrbs() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  const orbs = document.querySelectorAll('.orb');
  if (!orbs.length) return;

  window.addEventListener(
    'scroll',
    () => {
      const y = window.scrollY;
      orbs.forEach((orb) => {
        const depth = Number(orb.dataset.depth || 0.02);
        const shift = y * depth;
        orb.style.transform = `translate3d(0, ${shift}px, 0)`;
      });
    },
    { passive: true }
  );
}

function launchConfetti(options = {}) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  const fxLayer = document.getElementById('fx-layer');
  if (!fxLayer) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const isMobile = viewportWidth <= 640;
  const count = options.count || (isMobile ? 44 : 72);
  const originX = options.originX ?? viewportWidth * 0.5;
  const originY = options.originY ?? Math.min(240, viewportHeight * 0.35);
  const palette = ['#ff4fab', '#00c2ff', '#ffd62e', '#ff9b2f', '#8a5dff'];

  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    const color = palette[Math.floor(Math.random() * palette.length)];
    const spread = isMobile ? 180 : 280;
    const x1 = originX + (Math.random() - 0.5) * spread;
    const y1 = originY + 260 + Math.random() * 240;
    const rot = 360 + Math.random() * 720;
    const dur = 900 + Math.random() * 700;

    piece.style.background = color;
    piece.style.setProperty('--x0', `${originX}px`);
    piece.style.setProperty('--y0', `${originY}px`);
    piece.style.setProperty('--x1', `${x1}px`);
    piece.style.setProperty('--y1', `${y1}px`);
    piece.style.setProperty('--rot', `${rot}deg`);
    piece.style.setProperty('--dur', `${dur}ms`);
    piece.style.transform = `translate3d(${originX}px, ${originY}px, 0)`;

    fxLayer.appendChild(piece);
    window.setTimeout(() => piece.remove(), dur + 80);
  }
}

function cleanupEffects() {
  const fxLayer = document.getElementById('fx-layer');
  if (!fxLayer) return;
  fxLayer.querySelectorAll('.confetti-piece').forEach((piece) => piece.remove());
}

function initConfetti() {
  const ctaPrimary = document.getElementById('cta-primary');
  if (!ctaPrimary) return;

  ctaPrimary.addEventListener('click', () => {
    const now = Date.now();
    if (now - lastConfettiAt < 700) return;
    lastConfettiAt = now;

    const rect = ctaPrimary.getBoundingClientRect();
    launchConfetti({
      originX: rect.left + rect.width / 2,
      originY: rect.top + rect.height / 2
    });
  });

  window.addEventListener('pagehide', cleanupEffects);
}

loadEvent();
initRevealAnimation();
initParallaxOrbs();
initConfetti();
