function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusLabel(status) {
  switch (status) {
    case 'upcoming':
      return '開催予定';
    case 'live':
      return '配信中';
    case 'ended':
      return '終了';
    default:
      return '公開中';
  }
}

function normalizeEpisodes(payload) {
  const latest = String(payload?.latest || '').trim();
  const list = Array.isArray(payload?.episodes) ? payload.episodes : [];

  return list
    .map((item) => ({
      slug: String(item?.slug || '').trim(),
      title: String(item?.title || '').trim() || 'PICK UP LIVER',
      date: String(item?.date || '').trim() || '-',
      path: String(item?.path || '').trim() || '#',
      status: String(item?.status || '').trim() || 'published',
      isLatest: String(item?.slug || '').trim() === latest
    }))
    .filter((item) => item.slug && item.path);
}

function renderEpisodes(target, episodes) {
  if (!target) return;

  if (!episodes.length) {
    target.innerHTML = '<li class="archive-item"><p>公開中の回はまだありません。</p></li>';
    return;
  }

  target.innerHTML = episodes
    .map((episode) => {
      const latestBadge = episode.isLatest ? '<span class="badge latest">LATEST</span>' : '';
      const stateBadge = `<span class="badge state">${escapeHtml(statusLabel(episode.status))}</span>`;
      return `
      <li class="archive-item">
        <a class="archive-link" href="${escapeHtml(episode.path)}">
          <div class="archive-head">
            <h2>${escapeHtml(episode.title)}</h2>
            <div class="badge-row">${latestBadge}${stateBadge}</div>
          </div>
          <p class="archive-meta">slug: ${escapeHtml(episode.slug)} / date: ${escapeHtml(episode.date)}</p>
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
    renderEpisodes(list, episodes);
  } catch (err) {
    console.error(err);
    if (error) {
      error.hidden = false;
      error.textContent = '一覧データの読み込みに失敗しました。時間をおいて再度お試しください。';
    }
  }
})();
