import type { APIRoute } from 'astro';
import { adminContentMediaRoute } from '../../../../lib/server/content';

export const POST: APIRoute = adminContentMediaRoute;
