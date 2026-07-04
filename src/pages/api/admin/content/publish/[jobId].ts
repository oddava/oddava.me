import type { APIRoute } from 'astro';
import { adminContentPublishJobRoute } from '../../../../../lib/server/content/route';

export const GET: APIRoute = adminContentPublishJobRoute;
