import type { Extensions } from '@tiptap/core';
import { Callout } from './studioCallout';
import { RichCodeBlock } from './studioCodeBlock';
import {
  FootnoteBehavior,
  FootnoteDefinition,
  FootnoteRef,
} from './studioFootnotes';

/**
 * The richer blocks: code with a language, callouts and footnotes. StarterKit's
 * own code block must be switched off wherever this list is used.
 */
export const studioBlockExtensions: Extensions = [
  RichCodeBlock,
  Callout,
  FootnoteRef,
  FootnoteDefinition,
  FootnoteBehavior,
];
