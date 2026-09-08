import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { noteSocialCard } from '../src/lib/garden/og-card';

const state = vi.hoisted(() => ({
  authError: null as Response | null,
  write: vi.fn(),
}));
vi.mock('../src/lib/server/admin', () => ({
  adminJson: (data: unknown, init?: ResponseInit) => Response.json(data, init),
  requireSecuredAdminApi: async () => state.authError,
  withAdminSecurityHeaders: (response: Response) => response,
}));
vi.mock('../src/lib/server/content', () => ({
  hasContentStore: () => true,
  writeSocialCard: state.write,
  withRedisContentMutationLock: async (operation: () => Promise<unknown>) =>
    operation(),
  ContentMutationBusyError: class extends Error {},
}));
vi.mock('../src/lib/garden', () => ({
  getGardenIndexOrUnavailable: async () => ({
    ok: true,
    index: {
      documents: [
        { path: 'reading/books', title: 'Books', updated: '2026-09-08' },
      ],
    },
  }),
}));
import { POST } from '../src/pages/api/admin/social-cards';
const context = (request: Request) => ({ request, cookies: {} }) as APIContext;

describe('social-card upload boundary', () => {
  beforeEach(() => {
    state.authError = null;
    state.write.mockReset();
  });

  it('rejects oversized multipart streams without a Content-Length', async () => {
    const data = new FormData();
    data.set(
      'file',
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'card.png'),
    );
    // Model an incoming network stream, rather than Undici's outbound
    // FormData encoder (which can enqueue after cancellation in Node 24).
    const encoded = new Response(data);
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    const request = new Request('https://oddava.me/api/admin/social-cards', {
      method: 'POST',
      headers: {
        Origin: 'https://oddava.me',
        'Content-Type': encoded.headers.get('Content-Type')!,
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 1024));
          controller.enqueue(bytes.subarray(1024));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(request.headers.has('Content-Length')).toBe(false);
    const response = await POST(context(request));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: 'Social cards are limited to 2 MB.',
      code: 'payload_too_large',
    });
    expect(state.write).not.toHaveBeenCalled();
  });

  it('preserves valid PNG uploads and fingerprint checks', async () => {
    const card = noteSocialCard({
      path: 'reading/books',
      title: 'Books',
      updated: '2026-09-08',
    });
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const data = new FormData();
    data.set('file', new File([bytes], 'card.png'));
    data.set('path', card.path);
    data.set('fingerprint', card.fingerprint);
    const response = await POST(
      context(
        new Request('https://oddava.me/api/admin/social-cards', {
          method: 'POST',
          headers: { Origin: 'https://oddava.me' },
          body: data,
        }),
      ),
    );
    expect(response.status).toBe(201);
    expect(state.write).toHaveBeenCalledWith(
      card.path,
      card.fingerprint,
      bytes,
    );
  });

  it('authenticates before reading the request body', async () => {
    state.authError = new Response(null, { status: 401 });
    const request = new Request('https://oddava.me/api/admin/social-cards', {
      method: 'POST',
      body: 'invalid',
    });
    expect((await POST(context(request))).status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });
});
