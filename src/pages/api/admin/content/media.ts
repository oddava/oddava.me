import type { APIRoute } from 'astro';
import { adminContentMediaRoute } from '../../../../lib/server/content/route';

export const POST: APIRoute = adminContentMediaRoute;
