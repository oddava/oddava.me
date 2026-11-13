export interface PublicGuestbookEntry {
  id: string;
  name: string;
  message: string;
  createdAt: string;
}

export interface GuestbookApiResponse {
  entries?: PublicGuestbookEntry[];
  writable?: boolean;
  reviewRequired?: boolean;
  submitted?: boolean;
  status?: GuestbookStatus;
  message?: string;
  error?: string;
  code?: string;
  retryAfterSeconds?: number;
}

export interface SpotifyIntegrations {
  spotify: boolean;
  lanyard: boolean;
}

export interface SpotifyNowPlaying {
  isPlaying: boolean;
  title?: string;
  artist?: string;
  albumImageUrl?: string;
  songUrl?: string;
  durationMs?: number;
  progressMs?: number;
  fromFallback?: boolean;
  error?: string;
  source?: 'spotify' | 'lanyard';
  integrations?: SpotifyIntegrations;
}

export type GuestbookStatus = 'pending' | 'approved' | 'rejected';

export interface GuestbookEntry extends PublicGuestbookEntry {
  status: GuestbookStatus;
  ipFingerprint?: string;
  userAgent?: string;
}

export interface GuestbookResponse {
  entries: GuestbookEntry[];
}

export type IntegrationState =
  'disabled' | 'unconfigured' | 'ok' | 'degraded' | 'error';

export type IntegrationErrorCode =
  | 'not_configured'
  | 'invalid_credentials'
  | 'forbidden'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'network_error'
  | 'invalid_response'
  | 'unknown';

type CredentialSource = 'env' | 'none';
type CredentialFieldKind = 'text' | 'secret';

export interface CredentialField {
  key: string;
  label: string;
  kind: CredentialFieldKind;
  required: boolean;
  help?: string;
  envVars: string[];
}

export interface CredentialFieldStatus {
  key: string;
  set: boolean;
  source: CredentialSource;
}

export interface IntegrationStatus {
  id: string;
  name: string;
  description: string;
  docsUrl?: string;
  state: IntegrationState;
  detail: string;
  code?: IntegrationErrorCode;
  manageable: boolean;
  enabled: boolean;
  configured: boolean;
  fields: CredentialField[];
  credentials: CredentialFieldStatus[];
  checkedAt?: string;
}

export interface IntegrationResponse {
  integration: IntegrationStatus;
}

export interface IntegrationsResponse {
  integrations: IntegrationStatus[];
}

export interface OverviewResponse {
  metrics: {
    notes: number;
    pendingGuestbook: number;
    approvedGuestbook: number;
    /** Stars whose word is waiting to be read. */
    pendingStars?: number;
  };
}

/**
 * A star someone left in the sky. Position is a fraction of the sky's width
 * and height (0–1), so it lands in the same place on every screen. The word
 * is present only once a moderator has approved it.
 */
export interface PublicStar {
  id: string;
  x: number;
  y: number;
  word?: string;
  createdAt: string;
}

export interface StarRecord {
  id: string;
  x: number;
  y: number;
  /** The visitor's word, kept even while it waits to be read. */
  word?: string;
  createdAt: string;
  status: GuestbookStatus;
  ipFingerprint?: string;
  userAgent?: string;
}

export interface SkyApiResponse {
  stars?: PublicStar[];
  writable?: boolean;
  star?: PublicStar;
  /** Set on a placed star whose word waits for a moderator. */
  wordPending?: boolean;
  message?: string;
  error?: string;
  code?: string;
  retryAfterSeconds?: number;
}

/** The visitor pulse: who is here now, and how many have ever been. */
export interface VisitorPulse {
  /** Distinct visitors seen in the last minute or so, you included. */
  here: number;
  /** Distinct visitors ever (approximate, a HyperLogLog). */
  visitors: number;
  /** Distinct visitors today, UTC (approximate). */
  today: number;
}

export interface ContentCollectionMeta {
  id: string;
  label: string;
  singularLabel: string;
  body: boolean;
  count: number;
}

export interface ContentWriteResult {
  revision?: string;
  message: string;
}

export interface ContentEntryMove {
  previousId: string;
  previousRevision: string;
  entry: ContentEntryListItem;
}

export interface ContentEntryListItem {
  icon?: string;
  /** Unlisted: hidden from the public garden until published. */
  draft?: boolean;
  id: string;
  title: string;
  folder: string;
  path: string;
  href: string;
  revision: string;
  order?: number;
}

export interface ContentEntryDetail extends ContentEntryListItem {
  fields: Record<string, unknown>;
  body: string;
}

export interface ContentFolder {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  noteCount: number;
  totalNoteCount: number;
  documentId?: string;
}

export interface ContentCollectionsResponse {
  collections: ContentCollectionMeta[];
}

export interface ContentEntriesResponse {
  collection: Omit<ContentCollectionMeta, 'count'>;
  entries: ContentEntryListItem[];
  folders: ContentFolder[];
}

export interface ContentEntryResponse {
  collection: Omit<ContentCollectionMeta, 'count'>;
  entry: ContentEntryDetail;
}

export interface ContentSaveResponse {
  entry: ContentEntryDetail | null;
  result: ContentWriteResult;
}

export interface ContentDeleteResponse {
  result: ContentWriteResult;
}

export interface ContentMediaResponse {
  media: { url: string; path: string };
  result: ContentWriteResult;
}

/**
 * One note's social card: the text to draw, the fingerprint of exactly that
 * text, and whether the store already holds a card for it. Studio draws the
 * missing ones — it never derives the text itself, so a card and the route
 * that serves it can only ever agree.
 */
export interface SocialCardStatus {
  path: string;
  title: string;
  folder: string;
  date: string;
  fingerprint: string;
  stored: boolean;
}

export interface SocialCardsResponse {
  cards: SocialCardStatus[];
}

/** Year a project started, or `now` for ongoing work. */
export type ProjectYear = number | 'now';

export interface Project {
  id: string;
  name: string;
  description: string;
  year: ProjectYear;
  stack: string[];
  site?: string;
  source?: string;
  /**
   * A screenshot or cover. `src` is a site-relative media-store path
   * (`/images/notes/…`, uploaded from the admin) or an absolute https URL.
   */
  image?: ProjectImage;
  /** Marked for prominence. Absent means not featured; lists stored before this field load unchanged. */
  featured?: boolean;
  /** Kept in the admin list but left off the public page. */
  hidden: boolean;
}

export interface ProjectImage {
  src: string;
  alt: string;
  /**
   * How the image sits in its card (see `lib/project-image.ts`). Absent means
   * the default — fill the card, centred, unzoomed — so stored images from
   * before these fields read back unchanged. `contain` shows the whole image
   * and carries no focus or zoom.
   */
  fit?: 'contain';
  /** Focus point, percent from the left, in steps of 5. */
  x?: number;
  /** Focus point, percent from the top, in steps of 5. */
  y?: number;
  /** Fill zoom, 1–2 in steps of 0.1. */
  zoom?: number;
}

export interface ProjectsResponse {
  projects: Project[];
  /** Compare-and-set token: a save must name the revision it was based on. */
  revision: number;
}
