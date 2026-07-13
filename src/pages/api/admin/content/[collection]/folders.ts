import type { APIRoute } from 'astro';
import { adminContentFoldersRoute } from '../../../../../lib/server/content';

export const GET: APIRoute = adminContentFoldersRoute;
export const POST: APIRoute = adminContentFoldersRoute;
export const PATCH: APIRoute = adminContentFoldersRoute;
export const DELETE: APIRoute = adminContentFoldersRoute;
