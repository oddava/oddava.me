import type { Project, ProjectYear } from '../../contracts';
import { isRecord } from '../../records';

export const MAX_PROJECTS = 50;
const MAX_NAME = 60;
const MAX_DESCRIPTION = 240;
const MAX_STACK_ITEMS = 8;
const MAX_STACK_ITEM = 24;
const MAX_URL = 300;
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

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

  if (issues.length > before) return null;

  return {
    id,
    name,
    description,
    year: year as ProjectYear,
    stack,
    ...(site ? { site } : {}),
    ...(source ? { source } : {}),
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
