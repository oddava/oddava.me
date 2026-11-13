import type { z } from 'astro/zod';
import type { noteDataSchema } from '../content/schemas';

export type NoteData = z.infer<typeof noteDataSchema>;

export type NoteSource = {
  id: string;
  data: NoteData;
  body: string;
  updatedAt: string;
};

export type GardenLink = {
  target: string;
  label?: string;
  href?: string;
  resolvedId?: string;
};

export type GardenDocument = {
  id: string;
  sourceId: string;
  path: string;
  parentId: string | null;
  childIds: string[];
  href: string;
  title: string;
  summary: string;
  updated: string;
  data: NoteData;
  body: string;
  outbound: GardenLink[];
  backlinks: string[];
  // Inline #tags, derived once at index build. Every consumer (tag pages,
  // related-note discovery) reads these instead of re-parsing note bodies
  // per request — the old graph page did so O(n²) times.
  tags: string[];
};

export type GardenIndex = {
  root: GardenDocument;
  documents: GardenDocument[];
  byId: Map<string, GardenDocument>;
  wikiLinkHrefs: Map<string, string>;
};
