const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function sourcePath(
  directory: string,
  slug: string,
  extension: string,
): string {
  return `${directory}/${slug}.${extension}`;
}

export function entryIdFromPath(path: string, extension: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(new RegExp(`\\.${extension}$`), '')
    .split('/')
    .pop()!;
}

export function sanitizeFilename(originalName: string): string {
  const sanitized =
    originalName.trim().replace(/\\/g, '/').split('/').pop()?.toLowerCase() ??
    'upload';

  const extensionMatch = sanitized.match(/(\.[a-z0-9]+)$/);
  const extension = extensionMatch?.[1] ?? '';
  const basename =
    (extension ? sanitized.slice(0, -extension.length) : sanitized)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56) || 'upload';

  const suffix = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  return `${basename}-${suffix}${extension}`;
}

export function assertSafeRepositoryPath(path: string): void {
  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (
    normalized.startsWith('/') ||
    segments.includes('..') ||
    segments.some((segment) => segment.trim() === '')
  ) {
    throw new Error('Unsafe content path.');
  }
}
