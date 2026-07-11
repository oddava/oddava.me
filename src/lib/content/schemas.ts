import { z } from 'astro/zod';

// A page is a blank canvas: the body is the single source of truth. The only
// things worth keeping out of the content are whether it should be published
// and its position among sibling pages. Everything else (title, dates, links,
// tags) is inferred from the body or written inline. `title` stays optional so
// legacy frontmatter still parses; unknown keys are stripped by Zod rather
// than erroring.
export const noteDataSchema = z.object({
  title: z.string().optional(),
  draft: z.boolean().optional().default(false),
  order: z.number().int().optional(),
});
