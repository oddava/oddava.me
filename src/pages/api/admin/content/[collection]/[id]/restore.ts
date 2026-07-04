import type { APIRoute } from 'astro';
import { adminContentRestoreRoute } from '../../../../../../lib/server/content/route';

export const POST: APIRoute = adminContentRestoreRoute;
