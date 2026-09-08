import { DEFAULT_JSON_BODY_LIMIT_BYTES } from './config';
import { json } from './http';

export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function readRequestBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyError(
      'Request body is too large.',
      413,
      'payload_too_large',
    );
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError(
          'Request body is too large.',
          413,
          'payload_too_large',
        );
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** All JSON endpoints accept an object; domain handlers validate its fields. */
export async function readJsonBody<T extends object>(
  request: Request,
  maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES,
): Promise<T> {
  const text = new TextDecoder().decode(
    await readRequestBody(request, maxBytes),
  );
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected a JSON object.');
    }
    return parsed as T;
  } catch {
    throw new RequestBodyError('Invalid request.', 400, 'invalid_request');
  }
}

export async function readUrlEncodedBody(
  request: Request,
  maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES,
): Promise<URLSearchParams> {
  return new URLSearchParams(
    new TextDecoder().decode(await readRequestBody(request, maxBytes)),
  );
}

export function requestBodyErrorResponse(error: unknown): Response {
  if (error instanceof RequestBodyError) {
    return json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return json(
    { error: 'Invalid request.', code: 'invalid_request' },
    { status: 400 },
  );
}

/** Buffer a bounded body before a parser (such as formData) can allocate without limit. */
export async function boundedRequest(
  request: Request,
  maxBytes: number,
): Promise<Request> {
  if (request.method === 'GET' || request.method === 'HEAD') return request;
  const body = await readRequestBody(request, maxBytes);
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    redirect: request.redirect,
    signal: request.signal,
  });
}
