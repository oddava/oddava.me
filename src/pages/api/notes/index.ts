import type { APIRoute } from 'astro';
import { notesCollectionRoute } from '../../../lib/server/content';

export const prerender = false;

export const GET: APIRoute = notesCollectionRoute;
export const POST: APIRoute = notesCollectionRoute;
// Exported so a client gets a JSON 405 instead of Astro's empty one.
export const PUT: APIRoute = notesCollectionRoute;
export const PATCH: APIRoute = notesCollectionRoute;
export const DELETE: APIRoute = notesCollectionRoute;
