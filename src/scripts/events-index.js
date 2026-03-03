function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function chunkBy(items, size) {
  const rows = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

function normalizeEpisodes(payload) {
  const list = Array.isArray(payload?.episodes) ? payload.episodes : [];

  return list
    .map((item) => ({
      slug: String(item?.slug || '').trim(),
      title: String(item?.title || '').trim() || 'PICK UP LIVER',
      date: String(item?.date || '').trim() || '-',
      path: String(item?.path || '').trim() || '#',
      status: String(item?.status || '').trim() || 'published'
    }))
    .filter((item) => item.slug && item.path);
}

async function fetchEpisodeGuests(slug) {
  if (!slug) return [];

  try {
    const response = await fetch(`/content/events/${slug}/event.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load event data for ${slug}`);
    const payload = await response.json();
    const list = Array.isArray(payload?.guestLivers) ? payload.guestLivers : [];

    return list
      .map((guest) => ({
        name: String(guest?.name || '').trim(),
        avatarUrl: String(guest?.avatarUrl || '').trim()
      }))
      .filter((guest) => guest.name || guest.avatarUrl);
  } catch (error) {
    console.warn(error);
    return [];
  }
}

function renderEpisodes(target, episodes) {
  if (!target) return;

  if (!episodes.length) {
    target.innerHTML = '<li class="archive-item"><p style="margin:12px;">過去回はまだありません。</p></li>';
    return;
  }

  target.innerHTML = episodes
    .map((episode) => {
      const guests = Array.isArray(episode.guests) ? episode.guests : [];
      const guestRows = chunkBy(guests, 3);
      const guestPreview = guestRows.length
        ? `
          <div class="guest-preview">
            <div class="guest-rows">
              ${guestRows
                .map((row) => `
                  <div class="guest-row${row.length <= 2 ? ' is-centered' : ''}">
                    ${row
                      .map((guest) => `
                        <div class="guest-item">
                          ${guest.avatarUrl
                            ? `<img class="guest-avatar" src="${escapeHtml(guest.avatarUrl)}" alt="${escapeHtml(guest.name || 'ゲスト')}のアイコン" loading="lazy" decoding="async" />`
                            : '<div class="guest-avatar guest-avatar-fallback" aria-hidden="true"></div>'}
                          <p class="guest-name">${escapeHtml(guest.name || 'ゲスト')}</p>
                        </div>
                      `)
                      .join('')}
                  </div>
                `)
                .join('')}
            </div>
          </div>
        `
        : '';

      return `
      <li class="archive-item">
        <a class="archive-link" href="${escapeHtml(episode.path)}">
          <div class="archive-head">
            <h2>${escapeHtml(episode.title)}</h2>
          </div>
          <p class="archive-meta">${escapeHtml(episode.date)}</p>
          ${guestPreview}
        </a>
      </li>`;
    })
    .join('');
}

(async function bootEventsIndex() {
  const list = document.getElementById('events-list');
  const error = document.getElementById('events-error');

  try {
    const response = await fetch('/content/events/index.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Failed to load events index data');
    const payload = await response.json();
    const episodes = normalizeEpisodes(payload);
    const pastEpisodes = episodes.filter((episode) => episode.status === 'ended');
    const enrichedEpisodes = await Promise.all(
      pastEpisodes.map(async (episode) => ({
        ...episode,
        guests: await fetchEpisodeGuests(episode.slug)
      }))
    );
    renderEpisodes(list, enrichedEpisodes);
  } catch (err) {
    console.error(err);
    if (error) {
      error.hidden = false;
      error.textContent = '一覧データの読み込みに失敗しました。時間をおいて再度お試しください。';
    }
  }
})();
