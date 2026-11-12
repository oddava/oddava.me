/// <reference types="astro/client" />
import type { APIRoute } from 'astro';
import {
  ensureSameOrigin,
  getClientFingerprint,
  isStorageUnavailableError,
  json,
  readJsonBody,
  rejectIfSigningUnavailable,
  rejectIfStorageUnavailable,
  getVisitorKey,
} from '../../lib/server/core';
import { recordPulse } from '../../lib/server/visitors';

/** A browser's anonymous id, as the page keeps it: a UUID, nothing more. */
const VISITOR_ID = /^[0-9a-f-]{16,64}$/;

/** Crawlers and link previews are not people looking at the sky. */
const NOT_A_PERSON =
  /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor/i;

/**
 * One pulse from an open page: marks the visitor here and counted, and
 * answers with the counts. A POST, same-origin only, so another site cannot
 * pad the numbers from its visitors' browsers. Repeats from one visitor
 * change nothing (the visitor is the member, not the request), and each
 * network may only bring a few new ids a day (visitors/pulse.ts), so no
 * rate limit is needed to keep the counts honest.
 */
export const POST: APIRoute = async ({ request }) => {
  const sameOriginError = ensureSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const storageUnavailable = rejectIfStorageUnavailable();
  if (storageUnavailable) return storageUnavailable;

  const signingUnavailable = rejectIfSigningUnavailable();
  if (signingUnavailable) return signingUnavailable;

  if (NOT_A_PERSON.test(request.headers.get('user-agent') ?? '')) {
    return json(
      { error: 'Not counted.', code: 'not_counted' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // The body is optional and small; a missing or odd one counts the network.
  const body = await readJsonBody<{ visitor?: unknown }>(request).catch(
    () => null,
  );
  const id =
    body && typeof body.visitor === 'string' && VISITOR_ID.test(body.visitor)
      ? body.visitor
      : null;

  try {
    const network = await getClientFingerprint(request);
    const visitor = id ? await getVisitorKey(id) : null;
    const pulse = await recordPulse(network, visitor);
    return json(pulse, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (!isStorageUnavailableError(error)) {
      console.error('[pulse] POST failed', error);
    }
    return json(
      { error: 'Visitor counts are unavailable.', code: 'pulse_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
};
