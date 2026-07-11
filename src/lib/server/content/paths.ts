const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

export function normalizeFolderPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
}

export function isValidFolderPath(value: string, allowRoot = true): boolean {
  const normalized = normalizeFolderPath(value);
  if (!normalized) return allowRoot;
  return normalized.split('/').every(isValidSlug);
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
  folder = '',
): string {
  const normalizedFolder = normalizeFolderPath(folder);
  return [directory, normalizedFolder, `${slug}.${extension}`]
    .filter(Boolean)
    .join('/');
}

export function entryIdFromPath(path: string, extension: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(new RegExp(`\\.${extension}$`), '')
    .split('/')
    .pop()!;
}

export function entryFolderFromPath(
  filePath: string,
  directory: string,
): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedDirectory = directory.replace(/\\/g, '/').replace(/\/$/, '');
  const relative = normalizedPath.startsWith(`${normalizedDirectory}/`)
    ? normalizedPath.slice(normalizedDirectory.length + 1)
    : normalizedPath;
  const segments = relative.split('/');
  segments.pop();
  return segments.join('/');
}

export function folderIdFromPath(path: string, directory: string): string {
  const normalizedPath = path.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedDirectory = directory.replace(/\\/g, '/').replace(/\/$/, '');
  return normalizedPath.startsWith(`${normalizedDirectory}/`)
    ? normalizedPath.slice(normalizedDirectory.length + 1)
    : '';
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
