import type { APIRoute } from 'astro';
import { adminContentDraftRoute } from '../../../../../../lib/server/content/route';

export const GET: APIRoute = adminContentDraftRoute;
export const PUT: APIRoute = adminContentDraftRoute;
export const DELETE: APIRoute = adminContentDraftRoute;
