export function formatDate(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "just now", "5m ago", "3h ago", "4d ago", then the date itself. */
export function formatRelative(value: string, now = Date.now()): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(new Date(value).getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: 'numeric' }),
  });
}

/**
 * A user agent as a moderator reads it: "safari · macos", "chrome · android".
 * Anything that is not a recognisable browser — a script, a crawler — is
 * shown as it is, since that is the tell.
 */
export function describeAgent(userAgent: string): string {
  const ua = userAgent.trim();
  const browser = /edg\//i.test(ua)
    ? 'edge'
    : /firefox\//i.test(ua)
      ? 'firefox'
      : /(chrome|crios)\//i.test(ua)
        ? 'chrome'
        : /version\/[\d.]+.*safari\//i.test(ua)
          ? 'safari'
          : null;
  if (!browser || !/^mozilla\//i.test(ua)) return ua;
  const os = /iphone|ipad/i.test(ua)
    ? 'ios'
    : /android/i.test(ua)
      ? 'android'
      : /mac os x/i.test(ua)
        ? 'macos'
        : /windows/i.test(ua)
          ? 'windows'
          : /linux|cros/i.test(ua)
            ? 'linux'
            : null;
  return os ? `${browser} · ${os}` : browser;
}
