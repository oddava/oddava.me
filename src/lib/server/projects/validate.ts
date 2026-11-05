import type { Project, ProjectImage, ProjectYear } from '../../contracts';
import { isRecord } from '../../records';
import { FOCUS_DEFAULT, ZOOM_MIN, storedDisplay } from '../../project-image';

export const MAX_PROJECTS = 50;
const MAX_NAME = 60;
const MAX_DESCRIPTION = 240;
const MAX_STACK_ITEMS = 8;
const MAX_STACK_ITEM = 24;
const MAX_URL = 300;
const MAX_ALT = 160;
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/**
 * The public prefix of the content media store, which the admin upload writes
 * under (`/api/admin/content/media`, served by `/images/notes/[...path]`).
 * Spelled out rather than imported: projects does not depend on content.
 */
const MEDIA_PREFIX = '/images/notes/';
const MEDIA_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const IMAGE_EXTENSION = /\.(gif|jpe?g|png|webp)$/i;

export interface ProjectIssue {
  path: (string | number)[];
  message: string;
}

export type ProjectsParseResult =
  { ok: true; projects: Project[] } | { ok: false; issues: ProjectIssue[] };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseYear(value: unknown): ProjectYear | null {
  if (value === 'now') return 'now';
  const year = typeof value === 'string' ? Number(value.trim()) : value;
  return typeof year === 'number' &&
    Number.isInteger(year) &&
    year >= MIN_YEAR &&
    year <= MAX_YEAR
    ? year
    : null;
}

/** Empty means "no link". Anything else must be an absolute http(s) URL. */
function parseUrl(value: unknown): string | undefined | null {
  const raw = text(value);
  if (!raw) return undefined;
  if (raw.length > MAX_URL) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? raw : null;
  } catch {
    return null;
  }
}

/** A media-store path the image route would serve, with no way out of it. */
function isMediaPath(src: string): boolean {
  if (!src.startsWith(MEDIA_PREFIX) || !IMAGE_EXTENSION.test(src)) return false;
  return src
    .slice(MEDIA_PREFIX.length)
    .split('/')
    .every((segment) => MEDIA_SEGMENT.test(segment));
}

/**
 * Empty `src` means "no image", like an empty link, so the form can always
 * send the fields. Otherwise `src` is a media-store path or an https URL, and
 * `alt` is required: the image stands for the project, it is not decoration.
 */
function parseImage(
  value: unknown,
  at: (field: string, message: string) => void,
): ProjectImage | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) {
    at('image', 'Image must be an object with src and alt.');
    return undefined;
  }
  const src = text(value.src);
  if (!src) return undefined;
  const alt = text(value.alt);

  let srcOk = false;
  if (src.length <= MAX_URL) {
    if (src.startsWith('/')) srcOk = isMediaPath(src);
    else {
      try {
        srcOk = new URL(src).protocol === 'https:';
      } catch {
        srcOk = false;
      }
    }
  }
  if (!srcOk)
    at(
      'image',
      `Image must be an uploaded image (${MEDIA_PREFIX}…) or an https URL.`,
    );
  if (!alt) at('image', 'Image alt text is required.');
  else if (alt.length > MAX_ALT)
    at('image', `Image alt text must be ${MAX_ALT} characters or fewer.`);

  return { src, alt, ...parseDisplay(value, at) };
}

/**
 * Fit, focus, and zoom. Numbers are snapped to their steps rather than
 * refused — a focus of 37 is a reasonable thing to send — but a value of the
 * wrong kind is an error, not silently the default.
 */
function parseDisplay(
  value: Record<string, unknown>,
  at: (field: string, message: string) => void,
): Pick<ProjectImage, 'fit' | 'x' | 'y' | 'zoom'> {
  const fit = value.fit ?? 'cover';
  if (fit !== 'cover' && fit !== 'contain') {
    at('image', 'Image fit must be cover or contain.');
    return {};
  }
  const numberOr = (raw: unknown, fallback: number, label: string) => {
    if (raw == null) return fallback;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    at('image', `Image ${label} must be a number.`);
    return fallback;
  };
  return storedDisplay({
    fit,
    x: numberOr(value.x, FOCUS_DEFAULT, 'focus'),
    y: numberOr(value.y, FOCUS_DEFAULT, 'focus'),
    zoom: numberOr(value.zoom, ZOOM_MIN, 'zoom'),
  });
}

/** Validates one project; `issues` collects every problem, not just the first. */
export function parseProject(
  value: unknown,
  index: number,
  issues: ProjectIssue[],
): Project | null {
  const at = (field: string, message: string) =>
    issues.push({ path: [index, field], message });
  const before = issues.length;

  if (!isRecord(value)) {
    issues.push({ path: [index], message: 'Each project must be an object.' });
    return null;
  }

  const id = text(value.id);
  if (!ID_PATTERN.test(id)) at('id', 'Project id is invalid.');

  const name = text(value.name);
  if (!name) at('name', 'Name is required.');
  else if (name.length > MAX_NAME)
    at('name', `Name must be ${MAX_NAME} characters or fewer.`);

  const description = text(value.description);
  if (!description) at('description', 'Description is required.');
  else if (description.length > MAX_DESCRIPTION)
    at(
      'description',
      `Description must be ${MAX_DESCRIPTION} characters or fewer.`,
    );

  const year = parseYear(value.year);
  if (year === null)
    at('year', `Year must be "now" or a year from ${MIN_YEAR} to ${MAX_YEAR}.`);

  const rawStack = value.stack ?? [];
  const stack = Array.isArray(rawStack)
    ? rawStack.map(text).filter(Boolean)
    : [];
  if (!Array.isArray(rawStack)) at('stack', 'Stack must be a list.');
  else if (stack.length > MAX_STACK_ITEMS)
    at('stack', `Stack lists at most ${MAX_STACK_ITEMS} tools.`);
  else if (stack.some((tool) => tool.length > MAX_STACK_ITEM))
    at('stack', `Each tool must be ${MAX_STACK_ITEM} characters or fewer.`);

  const site = parseUrl(value.site);
  if (site === null) at('site', 'Site must be an http(s) URL.');
  const source = parseUrl(value.source);
  if (source === null) at('source', 'Source must be an http(s) URL.');

  const image = parseImage(value.image, at);

  if (issues.length > before) return null;

  return {
    id,
    name,
    description,
    year: year as ProjectYear,
    stack,
    ...(site ? { site } : {}),
    ...(source ? { source } : {}),
    ...(image ? { image } : {}),
    // Written only when set, so an unfeatured project stores what it always did.
    ...(value.featured === true ? { featured: true } : {}),
    hidden: value.hidden === true,
  };
}

/** The whole list, as an admin save submits it. All-or-nothing. */
export function parseProjects(value: unknown): ProjectsParseResult {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      issues: [{ path: [], message: 'Projects must be a list.' }],
    };
  }
  if (value.length > MAX_PROJECTS) {
    return {
      ok: false,
      issues: [
        { path: [], message: `Keep the list to ${MAX_PROJECTS} projects.` },
      ],
    };
  }

  const issues: ProjectIssue[] = [];
  const projects: Project[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const project = parseProject(item, index, issues);
    if (!project) return;
    if (seen.has(project.id)) {
      issues.push({
        path: [index, 'id'],
        message: 'Project ids must be unique.',
      });
      return;
    }
    seen.add(project.id);
    projects.push(project);
  });

  return issues.length ? { ok: false, issues } : { ok: true, projects };
}
