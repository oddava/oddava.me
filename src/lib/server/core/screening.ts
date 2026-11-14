/**
 * The automatic first read of anything a visitor writes. Clean text
 * publishes at once; text that trips one of these checks waits in the
 * moderation inbox instead, so the moderator only ever looks at what might
 * be spam or abuse. It holds, it never rejects: a false positive costs one
 * approve click, a false negative is taken down after the fact.
 *
 * The other two hold reasons, a network with a rejected record and a
 * repeated message, depend on what is already stored, so the append script
 * decides those atomically (core/moderated-list.ts).
 */
export type TextHoldReason = 'link' | 'contact' | 'word';

/** Top-level domains spam actually uses, so "node.js" or "e.g." pass. */
const TLDS = [
  'com',
  'net',
  'org',
  'info',
  'biz',
  'io',
  'co',
  'me',
  'dev',
  'app',
  'xyz',
  'top',
  'site',
  'online',
  'shop',
  'store',
  'link',
  'click',
  'live',
  'win',
  'vip',
  'club',
  'pro',
  'fun',
  'icu',
  'buzz',
  'ru',
  'su',
  'uz',
  'cn',
  'tk',
  'ly',
  'gg',
  'to',
  'cc',
  'tv',
  'ai',
].join('|');

const LINK = new RegExp(
  `https?:\\/\\/|\\bwww\\.|\\b[a-z0-9-]+(?:\\.|\\s?[([]dot[)\\]]\\s?)(?:${TLDS})\\b`,
  'i',
);

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/** Ten digits or more, however they are spaced: a phone number, not a date. */
const PHONE = /(?:\+?\d[\s().-]{0,2}){10,}/;

/** Digits and symbols standing in for letters: "c4s1n0", "$lut". */
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
};

/** Lowercase, accents and marks stripped, look-alike digits turned back. */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0134578@$]/g, (character) => LEET[character] ?? character);
}

/**
 * Words that hold a message, folded the same way the message is. A trailing
 * `*` matches any word that starts with it; without one, the whole word must
 * match, so "class" and "spice" never trip on what they contain.
 */
const BLOCKED = [
  // Spam.
  'casino*',
  'viagra',
  'cialis',
  'porn*',
  'onlyfans',
  'escort*',
  'airdrop*',
  'forex',
  'bitcoin*',
  'crypto*',
  'betting',
  'xxx',
  // Slurs.
  'nigg*',
  'fag',
  'fags',
  'faggot*',
  'retard*',
  'kike*',
  'chink*',
  'spic',
  'spics',
  'tranny*',
  'cunt*',
  'whore*',
  'slut*',
  // Russian obscenities: the guestbook has Russian-speaking readers.
  'хуй*',
  'хуе*',
  'пизд*',
  'пидор*',
  'пидар*',
  'ебан*',
  'ебат*',
  'блядь*',
].map((entry) => ({
  stem: entry.endsWith('*'),
  word: fold(entry.replace(/\*$/, '')),
}));

/** "caaasino" reads as "casino": runs of one letter collapse to one. */
const squash = (word: string) => word.replace(/(\p{L})\1+/gu, '$1');

function hasBlockedWord(text: string): boolean {
  const words = fold(text)
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  return words.some((word) => {
    const forms = [word, squash(word)];
    return BLOCKED.some((blocked) =>
      forms.some((form) =>
        blocked.stem ? form.startsWith(blocked.word) : form === blocked.word,
      ),
    );
  });
}

/** Why `text` should wait for a moderator, or null when it can publish. */
export function screenText(text: string): TextHoldReason | null {
  if (!text) return null;
  if (LINK.test(text)) return 'link';
  if (EMAIL.test(text) || PHONE.test(text)) return 'contact';
  if (hasBlockedWord(text)) return 'word';
  return null;
}
