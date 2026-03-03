(async () => {
  const FALLBACK_PATH = '/events/';

  try {
    const response = await fetch('/content/events/index.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Failed to load episodes index');

    const payload = await response.json();
    const latest = String(payload?.latest || '').trim();
    if (!latest) {
      window.location.replace(FALLBACK_PATH);
      return;
    }

    window.location.replace(`/events/${latest}/`);
  } catch (error) {
    console.error(error);
    window.location.replace(FALLBACK_PATH);
  }
})();
