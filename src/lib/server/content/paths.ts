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

function extensionList(
  extension: string | readonly string[],
): readonly string[] {
  return typeof extension === 'string' ? [extension] : extension;
}

/** True when `path` ends in any of `extension`. No extension matches anything. */
export function matchesExtension(
  path: string,
  extension?: string | readonly string[],
): boolean {
  if (!extension) return true;
  const lower = path.toLowerCase();
  return extensionList(extension).some((candidate) =>
    lower.endsWith(`.${candidate.toLowerCase()}`),
  );
}

export function entryIdFromPath(
  path: string,
  extension: string | readonly string[],
): string {
  const name = path.replace(/\\/g, '/').split('/').pop()!;
  for (const candidate of extensionList(extension)) {
    const suffix = `.${candidate.toLowerCase()}`;
    if (name.toLowerCase().endsWith(suffix)) {
      return name.slice(0, -suffix.length);
    }
  }
  return name;
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

export function sanitizeFilename(
  originalName: string,
  forcedExtension?: string,
): string {
  const sanitized =
    originalName.trim().replace(/\\/g, '/').split('/').pop()?.toLowerCase() ??
    'upload';

  const extensionMatch = sanitized.match(/(\.[a-z0-9]+)$/);
  const originalExtension = extensionMatch?.[1] ?? '';
  const extension = forcedExtension ?? originalExtension;
  const basename =
    (originalExtension
      ? sanitized.slice(0, -originalExtension.length)
      : sanitized
    )
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56) || 'upload';

  const suffix = crypto.randomUUID();
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
