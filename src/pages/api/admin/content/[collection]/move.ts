import type { APIRoute } from 'astro';
import { adminContentMoveRoute } from '../../../../../lib/server/content';

export const POST: APIRoute = adminContentMoveRoute;
