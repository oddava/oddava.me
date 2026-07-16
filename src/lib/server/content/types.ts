import type { z } from 'astro/zod';
import type { ContentWriteResult } from '../../contracts';

export type {
  ContentEntryDetail,
  ContentEntryListItem,
  ContentFolder,
  ContentWriteResult,
} from '../../contracts';

export class ContentConflictError extends Error {
  readonly code: 'path_exists' | 'revision_conflict';

  constructor(
    code: 'path_exists' | 'revision_conflict',
    message = code === 'revision_conflict'
      ? 'This content changed since you opened it. Refresh and try again.'
      : 'Content already exists at that path.',
  ) {
    super(message);
    this.name = 'ContentConflictError';
    this.code = code;
  }
}

export class ContentFolderNotEmptyError extends Error {
  readonly code = 'folder_not_empty';

  constructor() {
    super('Move the notes out of this folder before deleting it.');
    this.name = 'ContentFolderNotEmptyError';
  }
}

type ContentCollectionId = 'notes';

export interface ContentCollectionDefinition {
  id: ContentCollectionId;
  label: string;
  singularLabel: string;
  sourceDir: string;
  extension: 'mdx';
  mediaDir: string;
  mediaPublicPath: string;
  routePrefix: string;
  orderField: 'order';
  schema: z.ZodType<Record<string, unknown>>;
}

export type ContentEncoding = 'utf8' | 'base64';

export interface ContentSourceFile {
  path: string;
  content: string;
  encoding: ContentEncoding;
  byteLength: number;
  updatedAt: string;
  revision: string;
}

export interface LinkedFileMove {
  from: string;
  to: string;
  revision: string;
}

export interface LinkedFileDelete {
  path: string;
  revision: string;
}

/**
 * Path-addressed persistence used by the notes domain.
 *
 * The interface is deliberately smaller than a filesystem. Writes without an
 * expected revision are creates; updates are compare-and-set operations. That
 * distinction prevents concurrent requests from silently overwriting content.
 */
export interface ContentProvider {
  listFiles(
    directory: string,
    extension?: string,
  ): Promise<ContentSourceFile[]>;
  readFile(path: string): Promise<ContentSourceFile | null>;
  listDirectories(directory: string): Promise<string[]>;
  createDirectory(path: string, message: string): Promise<ContentWriteResult>;
  moveFile(
    from: string,
    to: string,
    message: string,
    revision: string,
  ): Promise<ContentWriteResult>;
  moveDirectory(
    from: string,
    to: string,
    message: string,
    linkedFile?: LinkedFileMove,
  ): Promise<ContentWriteResult>;
  deleteDirectory(
    path: string,
    message: string,
    linkedFile?: LinkedFileDelete,
  ): Promise<ContentWriteResult>;
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
  ): Promise<ContentWriteResult>;
  deleteFile(
    path: string,
    message: string,
    revision: string,
  ): Promise<ContentWriteResult>;
}
