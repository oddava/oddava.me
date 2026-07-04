import type { APIRoute } from 'astro';
import { adminContentHistoryRoute } from '../../../../../../lib/server/content/route';

export const GET: APIRoute = adminContentHistoryRoute;
