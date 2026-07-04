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
  drafts?: number;
  reorderable: boolean;
  routePattern: string;
  indexRoute: string;
  supportsDrafts: boolean;
  supportsBlocks: boolean;
  templates: ContentTemplate[];
  surfaces: ContentSurfaceRegion[];
  fields: ContentFieldDefinition[];
  media: {
    publicPath: string;
    groupByEntry: boolean;
  };
}

export type ContentBlockType =
  'paragraph' | 'heading' | 'image' | 'code' | 'callout' | 'raw-mdx';

export interface ContentBlock {
  id: string;
  type: ContentBlockType;
  value?: string;
  level?: 1 | 2 | 3;
  src?: string;
  alt?: string;
  language?: string;
  title?: string;
}

export interface ContentTemplate {
  id: string;
  label: string;
  description: string;
  fields: Record<string, unknown>;
  blocks: ContentBlock[];
}

export interface ContentSurfaceRegion {
  id: string;
  label: string;
  kind: 'field' | 'blocks';
  fieldName?: string;
}

export interface ContentSurface {
  id: string;
  collection: string;
  entryId: string;
  routePath: string;
  label: string;
  regions: ContentSurfaceRegion[];
}

export interface ContentWriteResult {
  provider: 'local';
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

export interface ContentDraft {
  collection: string;
  id: string;
  title: string;
  sourcePath: string;
  sourceRevision?: string;
  fields: Record<string, unknown>;
  body: string;
  blocks: ContentBlock[];
  isNew: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MediaAsset {
  path: string;
  url: string;
  name: string;
  collection?: string;
  entryId?: string;
  size: number;
  modifiedAt: string;
  referenced: boolean;
}

export interface ContentRevision {
  hash: string;
  shortHash: string;
  author: string;
  authoredAt: string;
  subject: string;
}

export interface PublishJob {
  id: string;
  collection: string;
  entryId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: string;
  updatedAt: string;
  steps: {
    label: string;
    status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
    detail?: string;
  }[];
  error?: string;
}

export interface ContentCollectionsResponse {
  collections: ContentCollectionMeta[];
  provider: 'local';
}

export interface ContentEntriesResponse {
  collection: Omit<ContentCollectionMeta, 'count'>;
  entries: ContentEntryListItem[];
  drafts: ContentDraft[];
  provider: 'local';
}

export interface ContentEntryResponse {
  collection: Omit<ContentCollectionMeta, 'count'>;
  entry: ContentEntryDetail;
  provider: 'local';
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

export interface ContentMediaListResponse {
  media: MediaAsset[];
}
