import type { APIRoute } from 'astro';
import { adminContentMoveRoute } from '../../../../../lib/server/content/route';

export const POST: APIRoute = adminContentMoveRoute;
