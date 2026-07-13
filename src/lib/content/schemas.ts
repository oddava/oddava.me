import { z } from 'astro/zod';

// A page is a blank canvas: its body is the source of truth. Ordering is the
// only authored metadata. `title` remains optional so committed legacy notes
// can still be used by redirect routes and migration tooling.
export const noteDataSchema = z.object({
  title: z.string().optional(),
  order: z.number().int().optional(),
  updated: z.coerce
    .date()
    .transform((value) => value.toISOString())
    .optional(),
});
