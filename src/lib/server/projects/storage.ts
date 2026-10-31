import type { Project, ProjectsResponse } from '../../contracts';
import { hasRedisConfig, redisCommand } from '../core';
import { DEFAULT_PROJECTS } from './defaults';
import { parseProject, type ProjectIssue } from './validate';

/**
 * One hash: `revision` and `projects` (the whole ordered list as JSON). The
 * list is small and always edited as a whole, so storing it as one value keeps
 * order, hide, and edit a single atomic write with a single revision.
 */
const PROJECTS_KEY = 'projects:list';

export type ProjectsWriteResult =
  { ok: true; revision: number } | { ok: false; revision: number };

function defaults(): ProjectsResponse {
  return { projects: structuredClone([...DEFAULT_PROJECTS]), revision: 0 };
}

/**
 * Stored values went through validation on the way in; this re-checks each one
 * on the way out anyway, and drops a malformed entry rather than failing the
 * page over it.
 */
function decodeProjects(raw: string): Project[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[projects] stored list is not valid JSON');
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const issues: ProjectIssue[] = [];
  const projects = parsed.flatMap((item, index) => {
    const project = parseProject(item, index, issues);
    return project ? [project] : [];
  });
  if (issues.length) {
    console.error('[projects] dropped malformed stored entries', issues);
  }
  return projects;
}

export async function readProjects(): Promise<ProjectsResponse> {
  if (!hasRedisConfig()) return defaults();

  const result = await redisCommand<(string | null)[] | null>([
    'HMGET',
    PROJECTS_KEY,
    'revision',
    'projects',
  ]);
  const [revision, projects] = result ?? [];
  if (!revision || projects == null) return defaults();

  return { projects: decodeProjects(projects), revision: Number(revision) };
}

export async function readPublicProjects(): Promise<Project[]> {
  const { projects } = await readProjects();
  return projects.filter((project) => !project.hidden);
}

// Writes only when the stored revision still matches the one the editor loaded,
// so two open admin tabs cannot silently overwrite each other. A missing hash
// is revision 0 — the defaults the editor was shown.
const WRITE_PROJECTS_SCRIPT = `
  local current = tonumber(redis.call('HGET', KEYS[1], 'revision') or '0')
  if current ~= tonumber(ARGV[1]) then return 'conflict:' .. current end
  local nextRevision = current + 1
  redis.call('HSET', KEYS[1], 'revision', nextRevision, 'projects', ARGV[2])
  return 'ok:' .. nextRevision
`;

export async function writeProjects(
  projects: Project[],
  expectedRevision: number,
): Promise<ProjectsWriteResult> {
  const result = await redisCommand<string>([
    'EVAL',
    WRITE_PROJECTS_SCRIPT,
    1,
    PROJECTS_KEY,
    expectedRevision,
    JSON.stringify(projects),
  ]);
  const [status, revision] = String(result).split(':');
  return { ok: status === 'ok', revision: Number(revision) };
}
