import type { APIRoute } from 'astro';
import { adminContentReorderRoute } from '../../../../../lib/server/content';

export const POST: APIRoute = adminContentReorderRoute;
