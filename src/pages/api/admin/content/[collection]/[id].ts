import type { APIRoute } from 'astro';
import { adminContentEntryRoute } from '../../../../../lib/server/content';

export const GET: APIRoute = adminContentEntryRoute;
export const PUT: APIRoute = adminContentEntryRoute;
export const DELETE: APIRoute = adminContentEntryRoute;
