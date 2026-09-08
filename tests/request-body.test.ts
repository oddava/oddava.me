import { describe, expect, it, vi } from 'vitest';
import {
  boundedRequest,
  readJsonBody,
  readRequestBody,
  readUrlEncodedBody,
} from '../src/lib/server/core/body';

function streamedRequest(chunks: Uint8Array[], headers?: HeadersInit) {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel,
  });
  const request = new Request('https://oddava.me/api/test', {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  } as RequestInit);
  return { request, cancel };
}

const encode = (value: string) => new TextEncoder().encode(value);

describe('bounded request bodies', () => {
  it('preserves binary bytes at the exact limit', async () => {
    const { request } = streamedRequest([
      new Uint8Array([0, 255]),
      new Uint8Array([128, 1]),
    ]);
    expect(await readRequestBody(request, 4)).toEqual(
      new Uint8Array([0, 255, 128, 1]),
    );
    expect(request.body?.locked).toBe(false);
  });

  it.each([undefined, { 'Content-Length': '1' }])(
    'cancels oversized streams even with missing or understated lengths (%j)',
    async (headers) => {
      const { request, cancel } = streamedRequest(
        [encode('123'), encode('456'), encode('789')],
        headers,
      );
      await expect(readRequestBody(request, 4)).rejects.toMatchObject({
        status: 413,
        code: 'payload_too_large',
      });
      expect(cancel).toHaveBeenCalledOnce();
      expect(request.body?.locked).toBe(false);
    },
  );

  it('rejects an oversized declared length before consuming the body', async () => {
    const { request } = streamedRequest([encode('123')], {
      'Content-Length': '100',
    });
    await expect(readRequestBody(request, 4)).rejects.toMatchObject({
      status: 413,
    });
    expect(request.bodyUsed).toBe(false);
  });

  it('decodes UTF-8 split across stream chunks', async () => {
    const bytes = encode('{"title":"🌱"}');
    const { request } = streamedRequest(
      [...bytes].map((byte) => new Uint8Array([byte])),
    );
    expect(await readJsonBody(request, bytes.length)).toEqual({ title: '🌱' });
  });

  it('preserves multipart files, fields, headers and cancellation', async () => {
    const data = new FormData();
    data.set('path', 'reading/books');
    data.set(
      'file',
      new File([new Uint8Array([0, 255, 128])], 'card.png', {
        type: 'image/png',
      }),
    );
    const controller = new AbortController();
    const original = new Request('https://oddava.me/api/test', {
      method: 'POST',
      body: data,
      signal: controller.signal,
      headers: { Origin: 'https://oddava.me' },
    });
    const request = await boundedRequest(original, 4096);
    expect(request.headers.get('Origin')).toBe('https://oddava.me');
    const form = await request.formData();
    expect(form.get('path')).toBe('reading/books');
    const file = form.get('file') as File;
    expect(file.name).toBe('card.png');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      new Uint8Array([0, 255, 128]),
    );
    controller.abort();
    expect(request.signal.aborted).toBe(true);
  });

  it('keeps form decoding and bodyless requests intact', async () => {
    const { request } = streamedRequest([
      encode('name=hello+world&tag=%23notes'),
    ]);
    expect(Object.fromEntries(await readUrlEncodedBody(request))).toEqual({
      name: 'hello world',
      tag: '#notes',
    });
    const get = new Request('https://oddava.me/api/test');
    expect(await boundedRequest(get, 1)).toBe(get);
    expect(await readRequestBody(get, 1)).toEqual(new Uint8Array());
  });
});
