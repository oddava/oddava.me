export type GuestbookStatus = 'pending' | 'approved' | 'rejected';

export interface IntegrationStatus {
  name: string;
  key?: string;
  healthy: boolean;
  detail: string;
  manageable?: boolean;
  enabled?: boolean;
}

export interface OverviewResponse {
  metrics: {
    posts: number;
    drafts: number;
    projects: number;
    featuredProjects: number;
    books: number;
    pendingGuestbook: number;
    approvedGuestbook: number;
  };
  integrations: IntegrationStatus[];
}

export interface GuestbookEntry {
  id: string;
  name: string;
  message: string;
  createdAt: string;
  status: GuestbookStatus;
  ipFingerprint?: string;
  userAgent?: string;
}

export interface GuestbookResponse {
  entries: GuestbookEntry[];
}

export type CredentialSource = 'override' | 'env' | 'default' | 'none';

export interface CredentialFieldStatus {
  set: boolean;
  source: CredentialSource;
}

export interface SpotifyCredentialsStatus {
  spotify: {
    clientId: CredentialFieldStatus;
    clientSecret: CredentialFieldStatus;
    refreshToken: CredentialFieldStatus;
  };
  lanyard: {
    discordUserId: CredentialFieldStatus;
  };
}

export interface SpotifyCredentialsResponse {
  credentials: SpotifyCredentialsStatus;
}

export type ContentFieldType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'boolean'
  | 'url'
  | 'integer'
  | 'string-list'
  | 'image';

export interface ContentFieldDefinition {
  name: string;
  label: string;
  type: ContentFieldType;
  required?: boolean;
  description?: string;
  hidden?: boolean;
}

export interface ContentCollectionMeta {
  id: string;
  label: string;
  singularLabel: string;
  format: 'mdx' | 'yaml';
  body: boolean;
  count: number;
  reorderable: boolean;
  fields: ContentFieldDefinition[];
  media: {
    publicPath: string;
    groupByEntry: boolean;
  };
}

export interface ContentWriteResult {
  provider: 'github' | 'local';
  commitUrl?: string;
  revision?: string;
  message: string;
}

export interface ContentEntryListItem {
  id: string;
  title: string;
  path: string;
  revision?: string;
  meta: Record<string, unknown>;
}

export interface ContentEntryDetail extends ContentEntryListItem {
  fields: Record<string, unknown>;
  body: string;
}

export interface ContentCollectionsResponse {
  collections: ContentCollectionMeta[];
  provider: 'github' | 'local';
}

export interface ContentEntriesResponse {
  collection: Omit<ContentCollectionMeta, 'count'>;
  entries: ContentEntryListItem[];
  provider: 'github' | 'local';
}

export interface ContentEntryResponse {
  collection: Omit<ContentCollectionMeta, 'count'>;
  entry: ContentEntryDetail;
  provider: 'github' | 'local';
}

export interface ContentSaveResponse {
  entry: ContentEntryDetail | null;
  result: ContentWriteResult;
}

export interface ContentDeleteResponse {
  result: ContentWriteResult;
}

export interface ContentMediaResponse {
  media: {
    url: string;
    path: string;
  };
  result: ContentWriteResult;
}
