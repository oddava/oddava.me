/// <reference types="astro/client" />
import { createModerationRoutes } from '../../../lib/server/admin';
import { guestbookModeration } from '../../../lib/server/guestbook';

export const { GET, PATCH, POST } = createModerationRoutes(
  guestbookModeration,
  'guestbook-admin',
);
