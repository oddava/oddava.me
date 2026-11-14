import { describe, expect, it } from 'vitest';
import { screenText } from '../src/lib/server/core/screening';

describe('screening visitor text', () => {
  it.each([
    'hello! love the site',
    'node.js and e.g. astro',
    'see you at 14.11.2026',
    'the class was a spice',
    'thanks from tashkent ☀️',
    'привет из ташкента',
    'hi.there',
    '',
  ])('publishes %j', (text) => {
    expect(screenText(text)).toBeNull();
  });

  it.each([
    ['https://spam.example', 'link'],
    ['visit www.shop', 'link'],
    ['go to casino.com now', 'link'],
    ['t.me/somechannel', 'link'],
    ['cheap pills dot ru: pills(dot)ru', 'link'],
    ['write me at someone@mail.example', 'contact'],
    ['call +998 90 123 45 67', 'contact'],
    ['best c4s1n0 bonus', 'word'],
    ['caaasino', 'word'],
    ['CRYPTO airdrop', 'word'],
    ['ты пиздец', 'word'],
  ] as const)('holds %j for %s', (text, reason) => {
    expect(screenText(text)).toBe(reason);
  });
});
