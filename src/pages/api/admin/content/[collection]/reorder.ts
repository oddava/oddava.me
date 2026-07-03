import type { APIRoute } from 'astro';
import { adminContentReorderRoute } from '../../../../../lib/server/content/route';

export const POST: APIRoute = adminContentReorderRoute;