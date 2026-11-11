/**
 * How the portfolio pages present the stored project list. These are
 * display-only overrides, keyed by project id: nothing here writes to the
 * store, changes the schema, or touches the admin's list, revisions,
 * `hidden` or `featured`. A project not named here passes through as stored,
 * so entries added from the admin later show up unchanged.
 *
 * The ids are the ones in `server/projects/defaults.ts`. The live store's ids
 * are not public; if one differs, change it here, never in the store.
 */
import type { Project, ProjectImage } from './contracts';

/** Shown in a list of projects, but this site is not one of them. */
export const EXCLUDED_PROJECT_IDS: ReadonlySet<string> = new Set(['oddava-me']);

/**
 * No picture for now: the card says so plainly. The stored image stays in
 * the data, untouched, for when this is lifted.
 */
export const PREVIEW_UNAVAILABLE_IDS: ReadonlySet<string> = new Set([
  'anishows',
]);

/**
 * Local, same-origin copies used in place of the stored image. Ishbay's
 * public cover shows people's names in its demo table and payslip; this copy
 * has them covered. Provenance is recorded in docs/portfolio.md.
 */
export const IMAGE_OVERRIDES: Readonly<Record<string, ProjectImage>> = {
  ishbay: {
    src: '/images/projects/ishbay-cover-redacted.jpg',
    alt: 'Ishbay: the landing page, with a review table of knitting and packing work and a payslip.',
    // The headline and the review table, as in the approved mock.
    y: 0,
  },
};

export interface PresentedProject extends Project {
  /** True when the card shows "preview unavailable" instead of a picture. */
  previewUnavailable: boolean;
}

/**
 * The public list as the portfolio shows it, in the stored order: the self
 * entry dropped, picture overrides applied. Run this before any selection
 * (home's top three), so a dropped entry never takes a slot.
 */
export function presentProjects(
  projects: readonly Project[],
): PresentedProject[] {
  return projects
    .filter((project) => !EXCLUDED_PROJECT_IDS.has(project.id))
    .map((project) => {
      const previewUnavailable = PREVIEW_UNAVAILABLE_IDS.has(project.id);
      const override = IMAGE_OVERRIDES[project.id];
      const image = previewUnavailable
        ? undefined
        : override
          ? { ...override }
          : project.image;
      return {
        ...project,
        ...(image ? { image } : { image: undefined }),
        previewUnavailable: previewUnavailable || !image,
      };
    });
}

/** Where a project's name links: its site, else its source, else nowhere. */
export function projectHref(project: Project): string | undefined {
  return project.site ?? project.source;
}
