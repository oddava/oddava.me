// Public surface for the content admin domain. Re-exports only the route
// dispatchers currently imported from outside `src/lib/server/content/`.
// Existing direct imports are left untouched; this barrel exists for future
// convenience.
export {
  adminContentCollectionsRoute,
  adminContentCollectionRoute,
  adminContentEntryRoute,
  adminContentMediaRoute,
  adminContentReorderRoute,
  adminContentSurfacesRoute,
  adminContentDraftRoute,
  adminContentPreviewRoute,
  adminContentPublishRoute,
  adminContentPublishJobRoute,
  adminContentHistoryRoute,
  adminContentRestoreRoute,
} from './content/route';
