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
  captchaRequired?: boolean;
  turnstileSiteKey?: string;
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
  };
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

export interface ContentEntryListItem {
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
