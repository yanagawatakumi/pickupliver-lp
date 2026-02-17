let lastConfettiAt = 0;
let welcomeBurstPlayed = false;
let burstTimer = null;

const particleState = {
  running: false,
  nodes: []
};

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

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
          launchConfetti({
            originX: rect.left + rect.width * 0.35,
            originY: rect.top + 24,
            count: window.innerWidth <= 640 ? 80 : 180
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

function randomIn(min, max) {
  return Math.random() * (max - min) + min;
}

function recycleParticle(node) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isMobile = vw <= 640;

  const kind = node.dataset.kind;
  const x0 = randomIn(-vw * 0.08, vw * 1.08);
  const y0 = randomIn(-vh * 0.12, vh * 0.06);
  const x1 = x0 + randomIn(-180, 180);
  const y1 = vh + randomIn(80, 200);
  const xm = x0 + randomIn(-220, 220);
  const ym = randomIn(vh * 0.25, vh * 0.7);

  const palette = ['#ff4fab', '#00c2ff', '#ffd62e', '#ff9b2f', '#8a5dff', '#57ff9f', '#ffffff'];
  const color = palette[Math.floor(Math.random() * palette.length)];

  const travelY = Math.max(180, y1 - y0);
  let speed = randomIn(95, 135);
  let opa = randomIn(0.36, 0.62);
  let rot = `${randomIn(120, 520)}deg`;

  if (kind === 'particle-ring') {
    speed = randomIn(80, 115);
    opa = randomIn(0.30, 0.50);
  }

  if (kind === 'particle-shard') {
    speed = randomIn(100, 145);
    opa = randomIn(0.40, 0.66);
  }

  if (isMobile) {
    speed *= 1.05;
  }

  const dur = travelY / speed;

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
  node.style.setProperty('--dur', `${dur}s`);
  node.style.setProperty('--opa', String(opa));
  node.style.setProperty('--rot', rot);
  node.style.animationDelay = `${-Math.random() * dur}s`;
}

function spawnPersistentParticles(config) {
  const layer = document.getElementById('spark-layer');
  if (!layer || prefersReducedMotion()) return;

  const make = (kind, count) => {
    for (let i = 0; i < count; i += 1) {
      const node = document.createElement('span');
      node.className = `particle ${kind}`;
      node.dataset.kind = kind;
      recycleParticle(node);
      node.addEventListener('animationiteration', () => recycleParticle(node));
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
    ? { spark: 54, shard: 30, ring: 15 }
    : { spark: 120, shard: 74, ring: 40 };

  particleState.running = true;
  spawnPersistentParticles(config);
}

function destroyParticleEngine() {
  const layer = document.getElementById('spark-layer');
  if (layer) {
    particleState.nodes.forEach((n) => n.remove());
  }
  particleState.nodes = [];
  particleState.running = false;
}

function launchConfetti(options = {}) {
  if (prefersReducedMotion()) return;

  const fxLayer = document.getElementById('fx-layer');
  if (!fxLayer) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const isMobile = viewportWidth <= 640;
  const count = options.count || (isMobile ? 240 : 520);
  const originX = options.originX ?? viewportWidth * 0.5;
  const originY = options.originY ?? Math.min(240, viewportHeight * 0.34);
  const palette = ['#ff4fab', '#00c2ff', '#ffd62e', '#ff9b2f', '#8a5dff', '#57ff9f', '#ffffff'];

  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    const color = palette[Math.floor(Math.random() * palette.length)];
    const spread = isMobile ? 520 : 980;
    const x1 = originX + (Math.random() - 0.5) * spread;
    const y1 = originY + 220 + Math.random() * 260;
    const rot = 420 + Math.random() * 820;
    const dur = 1650 + Math.random() * 1400;

    piece.style.background = color;
    piece.style.setProperty('--x0', `${originX}px`);
    piece.style.setProperty('--y0', `${originY}px`);
    piece.style.setProperty('--x1', `${x1}px`);
    piece.style.setProperty('--y1', `${y1}px`);
    piece.style.setProperty('--rot', `${rot}deg`);
    piece.style.setProperty('--dur', `${dur}ms`);

    fxLayer.appendChild(piece);
    window.setTimeout(() => piece.remove(), dur + 80);
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
  launchConfetti({ originX: sel.x, originY: sel.y, count: sel.count });
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

  // start after initial visual settle
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
      originY: rect.top + rect.height / 2,
      count: window.innerWidth <= 640 ? 320 : 700
    });
  });

  if (!prefersReducedMotion() && !welcomeBurstPlayed) {
    welcomeBurstPlayed = true;
    window.setTimeout(() => {
      launchAngledConfetti('top-center');
      window.setTimeout(() => launchAngledConfetti('bottom-left-diagonal'), 240);
      window.setTimeout(() => launchAngledConfetti('bottom-right-diagonal'), 480);
    }, 280);
  }

  window.addEventListener('pagehide', cleanupEffects);
}

loadEvent();
initRevealAnimation();
initParallaxOrbs();
initParticleEngine();
initConfetti();
// initPeriodicConfetti();
