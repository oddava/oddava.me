import type { APIRoute } from 'astro';
import { notesEntryRoute } from '../../../lib/server/content';

export const prerender = false;

export const GET: APIRoute = notesEntryRoute;
export const PUT: APIRoute = notesEntryRoute;
// Exported so a client gets a JSON 405 instead of Astro's empty one.
// Creating stays on POST /api/notes. Renames and restores are
// POST /api/notes/move and POST /api/notes/restore.
export const POST: APIRoute = notesEntryRoute;
export const PATCH: APIRoute = notesEntryRoute;
export const DELETE: APIRoute = notesEntryRoute;
