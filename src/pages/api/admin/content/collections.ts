import type { APIRoute } from 'astro';
import { adminContentCollectionsRoute } from '../../../../lib/server/content';

export const GET: APIRoute = adminContentCollectionsRoute;
