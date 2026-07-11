import type { APIRoute } from 'astro';
import { readBinaryFile } from '../../../lib/server/content/redis-store';

// Serve note images that were uploaded through Studio at runtime.
//
// Images committed to the repo are built into ./dist and served as static
// assets by Cloudflare before the Worker runs. Images uploaded live are stored
// in the Redis content store (under public/images/notes/...) and never touch
// the build, so requests for them fall through to this SSR route.

const CONTENT_TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
};

export const GET: APIRoute = async ({ params }) => {
  const path = params.path ?? '';
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) return new Response('Not found', { status: 404 });

  const repositoryPath = `public/images/notes/${path}`;
  let bytes: Uint8Array | null;
  try {
    bytes = await readBinaryFile(repositoryPath);
  } catch {
    bytes = null;
  }
  if (!bytes) return new Response('Not found', { status: 404 });

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
