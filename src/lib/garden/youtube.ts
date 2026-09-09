/** Accept video links only; never interpolate an arbitrary URL into an iframe. */
export function youtubeEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    let id: string | null = null;
    if (host === 'youtu.be' && parts.length === 1) id = parts[0]!;
    if (
      [
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'www.youtube-nocookie.com',
      ].includes(host)
    ) {
      if (url.pathname === '/watch' && host !== 'www.youtube-nocookie.com')
        id = url.searchParams.get('v');
      else if (
        parts.length === 2 &&
        ['embed', 'shorts', 'live'].includes(parts[0]!)
      )
        id = parts[1]!;
    }
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;
    const time =
      url.searchParams.get('start') ?? url.searchParams.get('t') ?? '';
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(time);
    const seconds = /^\d+$/.test(time)
      ? Number(time)
      : match
        ? Number(match[1] ?? 0) * 3600 +
          Number(match[2] ?? 0) * 60 +
          Number(match[3] ?? 0)
        : 0;
    return `https://www.youtube-nocookie.com/embed/${id}${Number.isSafeInteger(seconds) && seconds > 0 ? `?start=${seconds}` : ''}`;
  } catch {
    return null;
  }
}

export function youtubeMarkup(value: string): string {
  const src = youtubeEmbedUrl(value);
  if (!src) return '';
  return `<div class="note-youtube"><iframe src="${src}" title="YouTube video" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
}
