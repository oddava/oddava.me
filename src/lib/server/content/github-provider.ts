import { getServerEnv } from '../env';
import { fetchWithTimeout } from '../community';
import { assertSafeRepositoryPath } from './paths';
import type {
  ContentProvider,
  ContentSourceFile,
  ContentWriteResult,
} from './types';

interface GithubContentItem {
  type: 'file' | 'dir';
  path: string;
  name: string;
  sha: string;
  content?: string;
  encoding?: string;
}

const GITHUB_API_VERSION = '2022-11-28';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function stringToBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

function base64ToString(value: string): string {
  const normalized = value.replace(/\s/g, '');
  const binary = atob(normalized);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  );
}

function getGithubConfig() {
  return {
    token: getServerEnv('CONTENT_GITHUB_TOKEN'),
    repo: getServerEnv('CONTENT_GITHUB_REPO') ?? 'oddava/oddava.me',
    branch: getServerEnv('CONTENT_GITHUB_BRANCH') ?? 'main',
  };
}

export function createGithubContentProvider(): ContentProvider {
  const { token, repo, branch } = getGithubConfig();
  const baseUrl = `https://api.github.com/repos/${repo}/contents`;

  async function githubRequest(path: string, init: RequestInit = {}) {
    assertSafeRepositoryPath(path);

    const url = new URL(`${baseUrl}/${path}`);
    if (!['PUT', 'DELETE'].includes(init.method ?? 'GET')) {
      url.searchParams.set('ref', branch);
    }

    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('X-GitHub-Api-Version', GITHUB_API_VERSION);
    headers.set('User-Agent', 'oddava.me-content-admin');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetchWithTimeout(url, { ...init, headers }, 10_000);
    if (response.status === 404) return null;
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `GitHub content request failed (${response.status}): ${detail}`,
      );
    }
    return response;
  }

  async function readFile(path: string): Promise<ContentSourceFile | null> {
    const response = await githubRequest(path);
    if (!response) return null;

    const item = (await response.json()) as GithubContentItem;
    if (item.type !== 'file' || !item.content) return null;

    return {
      path: item.path,
      content: base64ToString(item.content),
      revision: item.sha,
    };
  }

  async function writeContent(
    path: string,
    content: string,
    message: string,
    revision?: string,
  ): Promise<ContentWriteResult> {
    if (!token) {
      throw new Error('CONTENT_GITHUB_TOKEN is required to save content.');
    }

    const payload: Record<string, unknown> = {
      branch,
      message,
      content,
    };
    if (revision) payload.sha = revision;

    const response = await githubRequest(path, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!response) throw new Error('GitHub content write failed.');

    const result = (await response.json()) as {
      content?: { sha?: string };
      commit?: { html_url?: string };
    };
    return {
      provider: 'github',
      commitUrl: result.commit?.html_url,
      revision: result.content?.sha,
      message,
    };
  }

  return {
    kind: 'github',
    async listFiles(directory, extension) {
      const response = await githubRequest(directory);
      if (!response) return [];

      const items = (await response.json()) as GithubContentItem[];
      const files = items.filter(
        (item) => item.type === 'file' && item.name.endsWith(`.${extension}`),
      );

      return Promise.all(files.map((item) => readFile(item.path))).then(
        (entries) =>
          entries.filter((entry): entry is ContentSourceFile => !!entry),
      );
    },
    readFile,
    writeTextFile(path, content, message, revision) {
      return writeContent(path, stringToBase64(content), message, revision);
    },
    writeBinaryFile(path, content, message, revision) {
      return writeContent(path, bytesToBase64(content), message, revision);
    },
    async deleteFile(path, message, revision) {
      if (!token) {
        throw new Error('CONTENT_GITHUB_TOKEN is required to delete content.');
      }

      const currentRevision = revision ?? (await readFile(path))?.revision;
      if (!currentRevision) throw new Error('Content entry was not found.');

      const response = await githubRequest(path, {
        method: 'DELETE',
        body: JSON.stringify({
          branch,
          message,
          sha: currentRevision,
        }),
      });
      if (!response) throw new Error('GitHub content delete failed.');

      const result = (await response.json()) as {
        commit?: { html_url?: string };
      };
      return {
        provider: 'github',
        commitUrl: result.commit?.html_url,
        message,
      };
    },
  };
}
