import type { APIRoute } from 'astro';
import { notesMediaRoute } from '../../../lib/server/content';

export const prerender = false;

// Image upload for the notes API. A note file named media.md is still fetched
// at /api/notes/media.md, the same way move.md and restore.md are.
export const POST: APIRoute = notesMediaRoute;
export const GET: APIRoute = notesMediaRoute;
export const PUT: APIRoute = notesMediaRoute;
export const PATCH: APIRoute = notesMediaRoute;
export const DELETE: APIRoute = notesMediaRoute;
