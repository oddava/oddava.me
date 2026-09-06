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

async function readLimitedBody(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyError(
      'Request body is too large.',
      413,
      'payload_too_large',
    );
  }

  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';

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

      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  return text + decoder.decode();
}

/** All JSON endpoints accept an object; domain handlers validate its fields. */
export async function readJsonBody<T extends object>(
  request: Request,
  maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES,
): Promise<T> {
  const text = await readLimitedBody(request, maxBytes);
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
  return new URLSearchParams(await readLimitedBody(request, maxBytes));
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
