import type { APIRoute } from 'astro';
import { adminContentSurfacesRoute } from '../../../../lib/server/content/route';

export const GET: APIRoute = adminContentSurfacesRoute;
