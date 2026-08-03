/// <reference types="astro/client" />
import type { APIRoute } from 'astro';

import { getGardenIndexOrUnavailable, searchNotes } from '@lib/garden';
import { json } from '@lib/server/core';

export const prerender = false;

const RESULT_LIMIT = 8;
const QUERY_MAX_LENGTH = 128;
const CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=300';

// HTTP route, not an index. Empty search is a UX state ("start anywhere"), not
// a query the corpus can satisfy, so we return nothing rather than every note
// ranked arbitrarily — the client shows the hint instead of a result list.
function readQuery(url: URL): string {
  return (url.searchParams.get('q') ?? '').trim().slice(0, QUERY_MAX_LENGTH);
}

// The slimmed projection a result row needs — never the whole document body.
// Mirrors the fields the landscape island renders, so the two search surfaces
// present the same note the same way.
type SearchResult = {
  id: string;
  title: string;
  summary: string;
  href: string;
  tags: string[];
  updated: string;
};

function projectResult(note: SearchResult): SearchResult {
  return {
    id: note.id,
    title: note.title,
    summary: note.summary,
    href: note.href,
    tags: note.tags,
    updated: note.updated,
  };
}

export const GET: APIRoute = async ({ url }) => {
  const query = readQuery(url);
  if (!query) {
    return json({ results: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const guard = await getGardenIndexOrUnavailable();
  if (!guard.ok) return guard.response;

  const results = searchNotes(guard.index.documents, query, RESULT_LIMIT).map(
    projectResult,
  );

  return json({ results }, { headers: { 'Cache-Control': CACHE_CONTROL } });
};
