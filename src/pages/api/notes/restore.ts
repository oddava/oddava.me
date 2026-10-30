import type { APIRoute } from 'astro';
import { notesRestoreRoute } from '../../../lib/server/content';

export const prerender = false;

// A note file named restore.md is fetched at /api/notes/restore.md.
export const POST: APIRoute = notesRestoreRoute;
export const GET: APIRoute = notesRestoreRoute;
export const PUT: APIRoute = notesRestoreRoute;
export const PATCH: APIRoute = notesRestoreRoute;
export const DELETE: APIRoute = notesRestoreRoute;
