import { adminJson } from '../admin/response';
import {
  contentConflictResponse,
  methodNotAllowed,
  missingCollection,
} from './http';
import { isValidSlug, sanitizeFilename } from './paths';
import { readRedisBinaryFile } from './redis-store';
import { getContentCollection, NOTES_COLLECTION } from './registry';
import type {
  ContentCollectionDefinition,
  ContentProvider,
  ContentWriteResult,
} from './types';

export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;

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

/**
 * Reads one uploaded note image by its path under the collection's public media
 * URL (`/images/notes/<path>`). The caller has already rejected unsafe paths.
 */
export function readNoteMedia(path: string): Promise<Uint8Array | null> {
  return readRedisBinaryFile(`${NOTES_COLLECTION.mediaDir}/${path}`);
}

export type NoteImageUpload =
  | {
      ok: true;
      url: string;
      path: string;
      bytes: number;
      type: SupportedImageType;
      result: ContentWriteResult;
    }
  | {
      ok: false;
      status: 400 | 413;
      code: 'missing_file' | 'payload_too_large' | 'invalid_media';
      error: string;
    };

/**
 * Validates and stores one uploaded image. Shared by Studio's upload route and
 * the notes API so both write the same keys under the same rules: the type
 * comes from the file's magic bytes (PNG, JPEG, WebP, GIF; never SVG, which
 * can carry script), the size is capped at {@link MEDIA_MAX_BYTES}, and the
 * stored name gets a random UUID suffix so the public URL is immutable.
 *
 * `folderHint` is the note the image belongs to (its slug); anything that is
 * not a valid slug files the image under `uploads/`.
 */
export async function storeNoteImage(
  store: ContentProvider,
  collection: ContentCollectionDefinition,
  file: FormDataEntryValue | null,
  folderHint: string,
): Promise<NoteImageUpload> {
  if (!(file instanceof File)) {
    return {
      ok: false,
      status: 400,
      code: 'missing_file',
      error: 'Missing upload file.',
    };
  }
  if (file.size > MEDIA_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      code: 'payload_too_large',
      error: 'Image upload is too large.',
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageType = detectImageType(bytes);
  if (!imageType) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_media',
      error: 'Unsupported or invalid image.',
    };
  }

  const folder = isValidSlug(folderHint) ? folderHint : 'uploads';
  const filename = sanitizeFilename(file.name, IMAGE_EXTENSIONS[imageType]);
  const path = `${collection.mediaDir}/${folder}/${filename}`;
  const url = `${collection.mediaPublicPath}/${folder}/${filename}`;
  const result = await store.writeBinaryFile(
    path,
    bytes,
    `content: upload media ${url}`,
  );
  return {
    ok: true,
    url,
    path,
    bytes: bytes.byteLength,
    type: imageType,
    result,
  };
}

// Upload only. Studio has no media browser or delete affordance, and the
// public read path is `/images/notes/[...path]`, which reads Redis directly.
//
// Note deletion intentionally does NOT delete the note's uploaded media: an
// image URL is baked into a note's body and can outlive a rename or be
// referenced from more than one note, so cascading a delete here would risk
// breaking a live reference. Abandoned uploads are reclaimed out of band:
// `notes:migrate -- --prune` deletes any managed media key not present in the
// committed `public/images/notes` tree, so an orphan that was never exported to
// the repo is dropped by a prune run. This is the media garbage-collection path.
export async function handleContentMedia(
  store: ContentProvider,
  request: Request,
): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed(['POST']);
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

  try {
    const upload = await storeNoteImage(
      store,
      collection,
      formData.get('file'),
      String(formData.get('entryId') ?? '').trim(),
    );
    if (!upload.ok) {
      return adminJson(
        { error: upload.error, code: upload.code },
        { status: upload.status },
      );
    }
    return adminJson(
      {
        media: { url: upload.url, path: upload.path },
        result: upload.result,
      },
      { status: 201 },
    );
  } catch (error) {
    return contentConflictResponse(error);
  }
}
