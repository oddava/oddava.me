import type { APIRoute } from 'astro';
import { notesMoveRoute } from '../../../lib/server/content';

export const prerender = false;

// A note file named move.md is fetched at /api/notes/move.md. This path is the
// rename action, the same way /api/notes/search is public search and not search.md.
export const POST: APIRoute = notesMoveRoute;
export const GET: APIRoute = notesMoveRoute;
export const PUT: APIRoute = notesMoveRoute;
export const PATCH: APIRoute = notesMoveRoute;
export const DELETE: APIRoute = notesMoveRoute;
