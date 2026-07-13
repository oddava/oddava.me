import { adminJson } from '../admin/response';
import { readJsonBody, requestBodyErrorResponse } from '../community/body';
import type { ContentMediaListResponse } from '../../contracts';
import {
  contentConflictResponse,
  methodNotAllowed,
  missingCollection,
} from './http';
import { isValidSlug, sanitizeFilename } from './paths';
import { getContentCollection, NOTES_COLLECTION } from './registry';
import type { ContentProvider, MediaAsset } from './types';

const MEDIA_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_EXTENSIONS = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
} as const;

type SupportedImageType = keyof typeof IMAGE_EXTENSIONS;

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function detectImageType(bytes: Uint8Array): SupportedImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  const ascii = new TextDecoder('ascii').decode(bytes.slice(0, 12));
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) {
    return 'image/gif';
  }
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function mediaUrl(path: string): string {
  return `${NOTES_COLLECTION.mediaPublicPath}${path.slice(
    NOTES_COLLECTION.mediaDir.length,
  )}`;
}

function mediaPath(url: string): string | null {
  if (!url.startsWith(`${NOTES_COLLECTION.mediaPublicPath}/`)) return null;
  const relative = url.slice(NOTES_COLLECTION.mediaPublicPath.length + 1);
  if (
    !relative ||
    relative.includes('\\') ||
    relative.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    return null;
  }
  return `${NOTES_COLLECTION.mediaDir}/${relative}`;
}

async function listMedia(store: ContentProvider): Promise<MediaAsset[]> {
  return (await store.listFiles(NOTES_COLLECTION.mediaDir))
    .filter((file) => file.encoding === 'base64')
    .map((file) => ({
      path: file.path,
      url: mediaUrl(file.path),
      name: file.path.split('/').at(-1) ?? file.path,
      size: file.byteLength,
      modifiedAt: file.updatedAt,
    }))
    .toSorted((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

export async function handleContentMedia(
  store: ContentProvider,
  request: Request,
): Promise<Response> {
  if (request.method === 'GET') {
    return adminJson({
      media: await listMedia(store),
    } satisfies ContentMediaListResponse);
  }

  if (request.method === 'DELETE') {
    let body: { url?: unknown };
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return requestBodyErrorResponse(error);
    }

    const url = String(body.url ?? '');
    const path = mediaPath(url);
    if (!path) {
      return adminJson(
        { error: 'Invalid media URL.', code: 'invalid_media_url' },
        { status: 400 },
      );
    }
    const file = await store.readFile(path);
    if (!file || file.encoding !== 'base64') {
      return adminJson(
        { error: 'Media was not found.', code: 'not_found' },
        { status: 404 },
      );
    }

    try {
      await store.deleteFile(
        path,
        `content: delete media ${url}`,
        file.revision,
      );
      return adminJson({ deleted: url });
    } catch (error) {
      return contentConflictResponse(error);
    }
  }

  if (request.method !== 'POST') {
    return methodNotAllowed(['GET', 'POST', 'DELETE']);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return adminJson(
      { error: 'Invalid multipart request.', code: 'invalid_body' },
      { status: 400 },
    );
  }

  const collection = getContentCollection(
    String(formData.get('collection') ?? ''),
  );
  if (!collection) return missingCollection();

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return adminJson(
      { error: 'Missing upload file.', code: 'missing_file' },
      { status: 400 },
    );
  }
  if (file.size > MEDIA_MAX_BYTES) {
    return adminJson(
      { error: 'Image upload is too large.', code: 'payload_too_large' },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageType = detectImageType(bytes);
  if (!imageType) {
    return adminJson(
      { error: 'Unsupported or invalid image.', code: 'invalid_media' },
      { status: 400 },
    );
  }

  const entryId = String(formData.get('entryId') ?? '').trim();
  const folder = isValidSlug(entryId) ? entryId : 'uploads';
  const filename = sanitizeFilename(file.name, IMAGE_EXTENSIONS[imageType]);
  const path = `${collection.mediaDir}/${folder}/${filename}`;
  const url = `${collection.mediaPublicPath}/${folder}/${filename}`;

  try {
    const result = await store.writeBinaryFile(
      path,
      bytes,
      `content: upload media ${url}`,
    );
    return adminJson({ media: { url, path }, result }, { status: 201 });
  } catch (error) {
    return contentConflictResponse(error);
  }
}
