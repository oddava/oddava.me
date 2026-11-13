import { z } from 'astro/zod';
import { parseDraftFlag } from './noteDraft';
import { isNoteIcon } from './noteIcon';

const MAX_IMAGE_ALT_LENGTH = 200;

/** An https:// URL or a site-relative path; never `//`, `data:` or `javascript:`. */
export function isNoteImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value !== value.trim() || /[\s\\\u0000-\u001f]/.test(value)) return false;
  if (value.startsWith('/')) return !value.startsWith('//');
  if (!value.startsWith('https://')) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

// Invalid cover metadata must never fail a save: it is dropped instead.
// `cover` is an alias of `image`; `image` wins when both are valid.
//
// `draft` is normalised the same way: only a true draft survives, so
// publishing removes the key rather than writing `draft: false`, and a
// malformed value can neither fail a save nor — worse — fail the garden's
// per-note validation, which would fall back to defaults and publish the note.
function sanitizeNoteFields(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const { cover, image, image_alt, draft, ...rest } = input as Record<
    string,
    unknown
  >;
  const url = [image, cover].find(isNoteImageUrl);
  return {
    ...rest,
    ...(parseDraftFlag(draft) ? { draft: true } : {}),
    ...(url ? { image: url } : {}),
    ...(typeof image_alt === 'string' &&
    image_alt.trim() &&
    image_alt.length <= MAX_IMAGE_ALT_LENGTH
      ? { image_alt }
      : {}),
  };
}

// The body is the source of truth; ordering and a file icon are optional metadata.
// Keep legacy titles available to redirect routes and migration tooling.
const noteFieldsSchema = z.object({
  image: z.string().optional(),
  image_alt: z.string().optional(),
  title: z.string().optional(),
  icon: z
    .string()
    .refine(isNoteIcon, 'Choose an emoji or upload an icon image.')
    .optional(),
  order: z.number().int().optional(),
  // Unlisted: reachable only by the signed-in owner. See `garden/visibility`.
  draft: z.boolean().optional(),
  updated: z.coerce
    .date()
    .transform((value) => value.toISOString())
    .optional(),
});

export const noteDataSchema = z.preprocess(
  sanitizeNoteFields,
  noteFieldsSchema,
);
