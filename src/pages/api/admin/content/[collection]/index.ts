import type { APIRoute } from 'astro';
import { adminContentCollectionRoute } from '../../../../../lib/server/content/route';

export const GET: APIRoute = adminContentCollectionRoute;
export const POST: APIRoute = adminContentCollectionRoute;
