import type { Token, Tokens } from 'marked';
import { CALLOUT_KINDS, readCallout, renderCalloutHtml } from './callouts';

// The marked half of callouts (the syntax itself lives in callouts.ts). It is a
// block extension rather than a blockquote renderer so the body is lexed as
// ordinary blocks — lists, code, nested quotes — exactly as the editor reads it.

export const calloutExtension = {
  name: 'noteCallout',
  level: 'block' as const,
  start: (src: string) => src.search(/^ {0,3}>[ \t]?\[!/m),
  tokenizer(
    this: { lexer: { blockTokens(src: string): Token[] } },
    src: string,
  ) {
    const callout = readCallout(src);
    if (!callout) return undefined;
    return {
      type: 'noteCallout',
      raw: callout.raw,
      kind: callout.kind,
      blocks: this.lexer.blockTokens(callout.body),
    };
  },
  childTokens: ['blocks'],
  renderer(
    this: { parser: { parse(tokens: Token[]): string } },
    token: Tokens.Generic,
  ) {
    const kind = CALLOUT_KINDS.find((candidate) => candidate === token.kind);
    return kind
      ? renderCalloutHtml(kind, this.parser.parse(token.blocks as Token[]))
      : false;
  },
};
