import type { APIRoute } from 'astro';
import { getGardenIndexOrUnavailable } from '@lib/garden';
import { noteSocialCard, socialCardKey } from '@lib/garden/og-card';
import { readSocialCard } from '@lib/server/content';
import { isStorageUnavailableError } from '@lib/server/core';

const DEFAULT_CARD_PATH = '/og-default.png';

/**
 * Every failure lands here rather than on a status a crawler renders as "no
 * image": an unknown note, an unavailable store, or a note whose card Studio
 * has not drawn yet all still preview as the site's default card. The short
 * lifetime is what lets a card appear without a purge once it is drawn.
 */
function defaultCard(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: DEFAULT_CARD_PATH,
      'Cache-Control': 'public, max-age=300',
    },
  });
}

/**
 * Per-note social cards. The bytes are drawn in Studio and stored beside the
 * notes; this route only resolves which card is current — it derives the
 * fingerprint from the live index instead of trusting `?v=`, so a card that no
 * longer matches its note's title, folder or date can never be served.
 */
export const GET: APIRoute = async ({ params }) => {
  const key = socialCardKey(params.path ?? '');

  const garden = await getGardenIndexOrUnavailable();
  if (!garden.ok) return defaultCard();

  const document = garden.index.documents.find(
    (entry) => socialCardKey(entry.path) === key,
  );
  if (!document) return defaultCard();

  const card = noteSocialCard(document);
  try {
    const bytes = await readSocialCard(card.path, card.fingerprint);
    if (!bytes) return defaultCard();
    return new Response(bytes as BodyInit, {
      headers: {
        // A day, not a year: the URL is fingerprinted, but a change to the card
        // artwork retires every fingerprint at once, and an immutable card
        // would outlive the deploy that redrew it.
        'Cache-Control': 'public, max-age=86400',
        'Content-Length': String(bytes.byteLength),
        'Content-Type': 'image/png',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (!isStorageUnavailableError(error)) {
      console.error('[og] Social card read failed.', error);
    }
    return defaultCard();
  }
};
