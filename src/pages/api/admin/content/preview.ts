import type { APIRoute } from 'astro';
import { adminContentPreviewRoute } from '../../../../lib/server/content/route';

export const GET: APIRoute = adminContentPreviewRoute;
export const POST: APIRoute = adminContentPreviewRoute;
