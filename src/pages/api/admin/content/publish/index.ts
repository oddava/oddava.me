import type { APIRoute } from 'astro';
import { adminContentPublishRoute } from '../../../../../lib/server/content/route';

export const POST: APIRoute = adminContentPublishRoute;
