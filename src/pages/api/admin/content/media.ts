import type { APIRoute } from 'astro';
import { adminContentMediaRoute } from '../../../../lib/server/content/route';

export const GET: APIRoute = adminContentMediaRoute;
export const POST: APIRoute = adminContentMediaRoute;
export const DELETE: APIRoute = adminContentMediaRoute;
