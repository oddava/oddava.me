import type { z } from 'astro/zod';

export type ContentCollectionId = 'blog' | 'projects' | 'books';

export type ContentFormat = 'mdx' | 'yaml';

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
  fields: ContentFieldDefinition[];
  schema: z.ZodType<Record<string, unknown>>;
}

export interface ContentSourceFile {
  path: string;
  content: string;
  revision?: string;
}

export interface ContentWriteResult {
  provider: 'github' | 'local';
  commitUrl?: string;
  revision?: string;
  message: string;
}

export interface ContentProvider {
  kind: 'github' | 'local';
  listFiles(directory: string, extension: string): Promise<ContentSourceFile[]>;
  readFile(path: string): Promise<ContentSourceFile | null>;
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
  path: string;
  revision?: string;
  meta: Record<string, unknown>;
}

export interface ContentEntryDetail extends ContentEntryListItem {
  fields: Record<string, unknown>;
  body: string;
}
