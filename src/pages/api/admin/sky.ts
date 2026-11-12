/// <reference types="astro/client" />
import { createModerationRoutes } from '../../../lib/server/admin';
import { starModeration } from '../../../lib/server/sky';

/** The sky's inbox: the same moderation routes as the guestbook's. */
export const { GET, PATCH, POST } = createModerationRoutes(
  starModeration,
  'sky-admin',
);
