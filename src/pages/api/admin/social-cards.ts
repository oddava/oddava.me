import type { APIContext, APIRoute } from 'astro';
import type { SocialCardsResponse } from '../../../lib/contracts';
import { getGardenIndexOrUnavailable } from '../../../lib/garden';
import { noteSocialCard, socialCardKey } from '../../../lib/garden/og-card';
import {
  adminJson,
  requireSecuredAdminApi,
  withAdminSecurityHeaders,
} from '../../../lib/server/admin';
import {
  ContentMutationBusyError,
  hasContentStore,
  listSocialCardKeys,
  withRedisContentMutationLock,
  writeSocialCard,
} from '../../../lib/server/content';
import {
  ensureSameOrigin,
  isStorageUnavailableError,
} from '../../../lib/server/core';

// A 1200x630 PNG of flat colour and text; the cap is generous for that and
// still an order of magnitude under the Studio upload limit.
const CARD_MAX_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function contentStoreUnavailable(): Response {
  return adminJson(
    {
      error: 'Studio storage is not configured.',
      code: 'content_store_unavailable',
    },
    { status: 503 },
  );
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

async function loadCards() {
  const garden = await getGardenIndexOrUnavailable();
  return garden.ok ? garden.index.documents.map(noteSocialCard) : null;
}

/**
 * Which notes still need a card, and the exact text each one shows. Studio has
 * the note bodies but not the index's derivation of them, and a title it
 * derived slightly differently would fingerprint differently — producing cards
 * `/og/*` would never look for. So the server owns the text.
 */
async function listCards(): Promise<Response> {
  if (!hasContentStore()) return contentStoreUnavailable();

  const cards = await loadCards();
  if (!cards) return contentStoreUnavailable();
  const stored = await listSocialCardKeys();

  return adminJson({
    cards: cards.map((card) => ({
      path: card.path,
      title: card.title,
      folder: card.folder,
      date: card.date,
      fingerprint: card.fingerprint,
      stored: stored.has(`${card.path}.${card.fingerprint}`),
    })),
  } satisfies SocialCardsResponse);
}

async function storeCard(request: Request): Promise<Response> {
  if (!hasContentStore()) return contentStoreUnavailable();

  if (Number(request.headers.get('content-length') ?? 0) > CARD_MAX_BYTES) {
    return adminJson(
      { error: 'Social cards are limited to 2 MB.', code: 'payload_too_large' },
      { status: 413 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return adminJson(
      { error: 'Invalid multipart request.', code: 'invalid_body' },
      { status: 400 },
    );
  }

  const path = socialCardKey(String(formData.get('path') ?? ''));
  const fingerprint = String(formData.get('fingerprint') ?? '');
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return adminJson(
      { error: 'Missing card image.', code: 'missing_file' },
      { status: 400 },
    );
  }
  if (file.size > CARD_MAX_BYTES) {
    return adminJson(
      { error: 'Social cards are limited to 2 MB.', code: 'payload_too_large' },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPng(bytes)) {
    return adminJson(
      { error: 'Social cards must be PNG.', code: 'invalid_media' },
      { status: 400 },
    );
  }

  const cards = await loadCards();
  if (!cards) return contentStoreUnavailable();
  const card = cards.find((candidate) => candidate.path === path);
  if (!card) {
    return adminJson(
      { error: 'That note no longer exists.', code: 'not_found' },
      { status: 404 },
    );
  }
  // The note changed between the draw and the upload, so these pixels show
  // text the note no longer has. Refusing is what keeps a stored card's
  // fingerprint an honest claim about its contents; the next sync redraws it.
  if (card.fingerprint !== fingerprint) {
    return adminJson(
      {
        error: 'This note changed while its card was being drawn.',
        code: 'stale_card',
      },
      { status: 409 },
    );
  }

  await withRedisContentMutationLock(
    () => writeSocialCard(card.path, card.fingerprint, bytes),
    { signal: request.signal },
  );

  return adminJson(
    { card: { path: card.path, fingerprint: card.fingerprint } },
    { status: 201 },
  );
}

/**
 * Social cards are note media, drawn by Studio and stored beside every other
 * Studio upload — the browser already has the site's fonts, so the card uses
 * the real typefaces and the Worker never rasterizes anything.
 */
async function dispatch(context: APIContext): Promise<Response> {
  const authError = await requireSecuredAdminApi(context.cookies);
  if (authError) return authError;

  const { request } = context;
  try {
    if (request.method === 'GET') return await listCards();
    const originError = ensureSameOrigin(request);
    if (originError) return withAdminSecurityHeaders(originError);
    return await storeCard(request);
  } catch (error) {
    if (error instanceof ContentMutationBusyError) {
      return adminJson(
        { error: error.message, code: error.code },
        { status: 503, headers: { 'Retry-After': '1' } },
      );
    }
    if (isStorageUnavailableError(error)) return contentStoreUnavailable();
    throw error;
  }
}

export const GET: APIRoute = dispatch;
export const POST: APIRoute = dispatch;
