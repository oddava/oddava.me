import type { APIRoute } from 'astro';
import { adminContentHistoryRoute } from '../../../../../../lib/server/content';

export const GET: APIRoute = adminContentHistoryRoute;
export const POST: APIRoute = adminContentHistoryRoute;
