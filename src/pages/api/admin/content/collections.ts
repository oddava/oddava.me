import type { APIRoute } from 'astro';
import { adminContentCollectionsRoute } from '../../../../lib/server/content/route';

export const GET: APIRoute = adminContentCollectionsRoute;
