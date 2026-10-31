import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROJECTS,
  MAX_PROJECTS,
  parseProjects,
} from '../src/lib/server/projects';

const valid = {
  id: 'oddava-me',
  name: '  oddava.me ',
  description: 'this site.',
  year: 2026,
  stack: ['astro', ' ', 'redis'],
  site: '',
  source: 'https://github.com/oddava/oddava.me',
};

describe('parseProjects', () => {
  it('trims fields, drops blank tools and empty links, defaults hidden', () => {
    expect(parseProjects([valid])).toEqual({
      ok: true,
      projects: [
        {
          id: 'oddava-me',
          name: 'oddava.me',
          description: 'this site.',
          year: 2026,
          stack: ['astro', 'redis'],
          source: 'https://github.com/oddava/oddava.me',
          hidden: false,
        },
      ],
    });
  });

  it('accepts "now" and numeric-string years', () => {
    const result = parseProjects([
      { ...valid, id: 'a', year: 'now' },
      { ...valid, id: 'b', year: '2024' },
    ]);
    expect(result.ok && result.projects.map((p) => p.year)).toEqual([
      'now',
      2024,
    ]);
  });

  it('reports every problem with its path', () => {
    const result = parseProjects([
      valid,
      {
        id: 'bad id!',
        name: '',
        description: 'x'.repeat(241),
        year: 1800,
        stack: 'astro',
        site: 'javascript:alert(1)',
        source: 'ftp://example.com',
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual([
      [1, 'id'],
      [1, 'name'],
      [1, 'description'],
      [1, 'year'],
      [1, 'stack'],
      [1, 'site'],
      [1, 'source'],
    ]);
  });

  it('rejects duplicate ids, non-lists, and oversized lists', () => {
    const duplicate = parseProjects([valid, valid]);
    expect(!duplicate.ok && duplicate.issues[0]).toEqual({
      path: [1, 'id'],
      message: 'Project ids must be unique.',
    });
    expect(parseProjects({}).ok).toBe(false);
    const many = Array.from({ length: MAX_PROJECTS + 1 }, (_, index) => ({
      ...valid,
      id: `p${index}`,
    }));
    expect(parseProjects(many).ok).toBe(false);
  });

  it('accepts its own defaults', () => {
    expect(parseProjects(structuredClone([...DEFAULT_PROJECTS]))).toEqual({
      ok: true,
      projects: DEFAULT_PROJECTS,
    });
  });
});

describe('projects storage', () => {
  const redisCommand = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    redisCommand.mockReset();
    vi.doMock('../src/lib/server/core', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/lib/server/core')>()),
      hasRedisConfig: () => true,
      redisCommand,
    }));
  });

  afterEach(() => {
    vi.doUnmock('../src/lib/server/core');
  });

  it('serves the defaults at revision 0 until the first save', async () => {
    redisCommand.mockResolvedValue([null, null]);
    const { readProjects } = await import('../src/lib/server/projects');
    expect(await readProjects()).toEqual({
      projects: DEFAULT_PROJECTS,
      revision: 0,
    });
  });

  it('reads the stored list, dropping malformed entries', async () => {
    redisCommand.mockResolvedValue([
      '4',
      JSON.stringify([valid, { id: 'broken' }]),
    ]);
    const { readProjects } = await import('../src/lib/server/projects');
    const { projects, revision } = await readProjects();
    expect(revision).toBe(4);
    expect(projects.map((project) => project.id)).toEqual(['oddava-me']);
  });

  it('leaves hidden projects off the public list', async () => {
    redisCommand.mockResolvedValue([
      '1',
      JSON.stringify([valid, { ...valid, id: 'secret', hidden: true }]),
    ]);
    const { readPublicProjects } = await import('../src/lib/server/projects');
    expect((await readPublicProjects()).map((project) => project.id)).toEqual([
      'oddava-me',
    ]);
  });

  it('writes through the compare-and-set script and reports conflicts', async () => {
    const { writeProjects } = await import('../src/lib/server/projects');

    redisCommand.mockResolvedValueOnce('ok:3');
    expect(await writeProjects([], 2)).toEqual({ ok: true, revision: 3 });
    const [command] = redisCommand.mock.calls[0];
    expect(command.slice(0, 1)).toEqual(['EVAL']);
    expect(command.slice(2)).toEqual([1, 'projects:list', 2, '[]']);

    redisCommand.mockResolvedValueOnce('conflict:5');
    expect(await writeProjects([], 2)).toEqual({ ok: false, revision: 5 });
  });
});

describe('PUT /api/admin/projects', () => {
  const ORIGIN = 'https://oddava.me';
  const ADMIN_TOKEN = 'super-secret-admin-token';
  const writeProjects = vi.fn();
  let cookie: string;

  beforeEach(async () => {
    vi.resetModules();
    writeProjects.mockReset();
    process.env.ADMIN_PANEL_TOKEN = ADMIN_TOKEN;
    process.env.COMMUNITY_SIGNING_SECRET =
      'test-signing-secret-with-enough-entropy';
    vi.doMock('../src/lib/server/core', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/lib/server/core')>()),
      rejectIfStorageUnavailable: () => null,
    }));
    vi.doMock('../src/lib/server/projects', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/lib/server/projects')>()),
      writeProjects,
    }));
    const { createAdminSessionValue } =
      await import('../src/lib/server/admin/auth');
    cookie = await createAdminSessionValue(ADMIN_TOKEN);
  });

  afterEach(() => {
    vi.doUnmock('../src/lib/server/core');
    vi.doUnmock('../src/lib/server/projects');
    delete process.env.ADMIN_PANEL_TOKEN;
    delete process.env.COMMUNITY_SIGNING_SECRET;
  });

  async function put(body: unknown) {
    const { PUT } = await import('../src/pages/api/admin/projects');
    const request = new Request(`${ORIGIN}/api/admin/projects`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(body),
    });
    const cookies = {
      get: (name: string) =>
        name === 'oddava-admin-session' ? { value: cookie } : undefined,
    };
    const response = await (PUT as (context: unknown) => Promise<Response>)({
      request,
      cookies,
      params: {},
      url: new URL(request.url),
    });
    return { status: response.status, body: await response.json() };
  }

  it('saves a valid list and returns the new revision', async () => {
    writeProjects.mockResolvedValue({ ok: true, revision: 1 });
    const result = await put({ revision: 0, projects: [valid] });
    expect(result.status).toBe(200);
    expect(result.body.revision).toBe(1);
    expect(result.body.projects[0].name).toBe('oddava.me');
    expect(writeProjects).toHaveBeenCalledWith(result.body.projects, 0);
  });

  it('answers 409 when the revision is stale', async () => {
    writeProjects.mockResolvedValue({ ok: false, revision: 3 });
    const result = await put({ revision: 1, projects: [valid] });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('conflict');
  });

  it('rejects invalid projects before touching storage', async () => {
    const result = await put({
      revision: 0,
      projects: [{ ...valid, name: '' }],
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Name is required.');
    expect(result.body.issues[0].path).toEqual([0, 'name']);
    expect(writeProjects).not.toHaveBeenCalled();
  });

  it('requires a numeric revision', async () => {
    const result = await put({ projects: [valid] });
    expect(result.status).toBe(400);
    expect(writeProjects).not.toHaveBeenCalled();
  });
});
