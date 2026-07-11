import type { z } from 'astro/zod';

export class ContentRevisionConflictError extends Error {
  readonly code = 'revision_conflict';

  constructor() {
    super('This content changed since you opened it. Refresh and try again.');
    this.name = 'ContentRevisionConflictError';
  }
}

export class ContentFolderNotEmptyError extends Error {
  readonly code = 'folder_not_empty';

  constructor() {
    super('Move the notes out of this folder before deleting it.');
    this.name = 'ContentFolderNotEmptyError';
  }
}

export type ContentCollectionId = 'notes';

export type ContentFormat = 'mdx' | 'yaml';

export type ContentFieldType =
  | 'text'
  | 'select'
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
  options?: { label: string; value: string }[];
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

export interface ContentSurface {
  id: string;
  collection: ContentCollectionId;
  entryId: string;
  routePath: string;
  label: string;
  regions: {
    id: string;
    label: string;
    kind: 'field' | 'blocks';
    fieldName?: string;
  }[];
}

export interface ContentDocument {
  fields: Record<string, unknown>;
  body: string;
  blocks: ContentBlock[];
}

export interface ContentDraft extends ContentDocument {
  collection: ContentCollectionId;
  id: string;
  title: string;
  folder: string;
  sourcePath: string;
  sourceRevision?: string;
  isNew: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MediaAsset {
  path: string;
  url: string;
  name: string;
  collection?: ContentCollectionId;
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
  collection: ContentCollectionId;
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

export interface ContentCollectionDefinition {
  id: ContentCollectionId;
  label: string;
  singularLabel: string;
  sourceDir: string;
  extension: 'mdx' | 'yaml';
  format: ContentFormat;
  body: boolean;
  mediaDir: string;
  mediaPublicPath: string;
  groupMediaByEntry: boolean;
  reorderable?: boolean;
  orderField?: string;
  routePattern: string;
  indexRoute: string;
  supportsDrafts: boolean;
  supportsBlocks: boolean;
  supportsFolders?: boolean;
  templates: ContentTemplate[];
  surfaces: {
    id: string;
    label: string;
    kind: 'field' | 'blocks';
    fieldName?: string;
  }[];
  fields: ContentFieldDefinition[];
  schema: z.ZodType<Record<string, unknown>>;
}

export interface ContentSourceFile {
  path: string;
  content: string;
  revision?: string;
}

export interface ContentWriteResult {
  provider: 'local';
  revision?: string;
  message: string;
}

export interface ContentProvider {
  kind: 'local';
  listFiles(directory: string, extension: string): Promise<ContentSourceFile[]>;
  readFile(path: string): Promise<ContentSourceFile | null>;
  listDirectories(directory: string): Promise<string[]>;
  createDirectory(path: string, message: string): Promise<ContentWriteResult>;
  movePath(
    from: string,
    to: string,
    message: string,
    revision?: string,
  ): Promise<ContentWriteResult>;
  deleteDirectory(path: string, message: string): Promise<ContentWriteResult>;
  writeTextFile(
    path: string,
    content: string,
    message: string,
    revision?: string,
  ): Promise<ContentWriteResult>;
  writeBinaryFile(
    path: string,
    content: Uint8Array,
    message: string,
    revision?: string,
  ): Promise<ContentWriteResult>;
  deleteFile(
    path: string,
    message: string,
    revision?: string,
  ): Promise<ContentWriteResult>;
}

export interface ContentEntryListItem {
  id: string;
  title: string;
  folder: string;
  path: string;
  revision?: string;
  meta: Record<string, unknown>;
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

export interface ContentEntryDetail extends ContentEntryListItem {
  fields: Record<string, unknown>;
  body: string;
}
