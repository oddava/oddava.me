import type { APIRoute } from 'astro';
import { notesEntryRoute } from '../../../lib/server/content';

export const prerender = false;

export const GET: APIRoute = notesEntryRoute;
export const PUT: APIRoute = notesEntryRoute;
// Exported so a client gets a JSON 405 instead of Astro's empty one.
// Creating stays on POST /api/notes; this path only reads and updates.
export const POST: APIRoute = notesEntryRoute;
export const PATCH: APIRoute = notesEntryRoute;
export const DELETE: APIRoute = notesEntryRoute;
