import { z } from 'astro/zod';
import rawChangelog from '../data/changelog.json';

/**
 * Hand-authored site changelog. Edit `src/data/changelog.json` when something
 * meaningful lands; the list is rendered at `/changelog`.
 *
 * `body` accepts either a string or an array of strings. Blank lines (or array
 * items) become separate paragraphs; single newlines become soft line breaks.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const changelogBodyInputSchema = z.union([
  z.string(),
  z.array(z.string()).min(1),
]);

/** Normalize authored body input to a single multi-line string. */
export function normalizeChangelogBody(body: string | string[]): string {
  if (Array.isArray(body)) {
    return body
      .map((part) => part.replace(/\r\n/g, '\n').trim())
      .filter((part) => part.length > 0)
      .join('\n\n');
  }
  return body.replace(/\r\n/g, '\n').trim();
}

/**
 * Split a body into paragraphs, then each paragraph into soft-break lines.
 * Empty input yields an empty list (callers should not pass blank bodies).
 */
export function changelogBodyParagraphs(body: string): string[][] {
  const normalized = body.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  return normalized
    .split(/\n\s*\n+/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .filter((lines) => lines.length > 0);
}

export const changelogEntrySchema = z.object({
  date: z
    .string()
    .regex(DATE_ONLY, 'date must be YYYY-MM-DD')
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
      message: 'date must be a real calendar day',
    }),
  title: z.string().trim().min(1),
  body: changelogBodyInputSchema
    .transform(normalizeChangelogBody)
    .refine((value) => value.length > 0, {
      message: 'body must not be empty',
    }),
});

export const changelogSchema = z.array(changelogEntrySchema);

export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;

export function parseChangelogEntries(raw: unknown): ChangelogEntry[] {
  const entries = changelogSchema.parse(raw);
  return [...entries].sort((a, b) => b.date.localeCompare(a.date));
}

export function getChangelogEntries(): ChangelogEntry[] {
  return parseChangelogEntries(rawChangelog);
}
