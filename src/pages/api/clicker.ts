import type { APIRoute } from 'astro';
import {
    ensureSameOrigin,
    enforceRedisRateLimit,
    hasRedisConfig,
    json,
    redisRequest,
    rejectIfStorageUnavailable,
} from '../../lib/server/community';

const COUNTER_KEY = 'community:clicker:count';
const ENCODED_COUNTER_KEY = encodeURIComponent(COUNTER_KEY);
const CLICKER_RATE_LIMIT = { limit: 8, windowMs: 10_000 };

async function getCount(): Promise<number> {
    if (!hasRedisConfig()) return 0;

    const response = await redisRequest(`get/${ENCODED_COUNTER_KEY}`);
    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Failed to read Redis count: ${response.status} ${details}`);
    }

    const data = (await response.json()) as { result: string | null };
    if (data.result === null) return 0;

    const parsed = Number(data.result);
    return Number.isFinite(parsed) ? parsed : 0;
}

async function incrementCount(): Promise<number> {
    if (!hasRedisConfig()) throw new Error('Persistent storage is not configured.');

    const response = await redisRequest(`incr/${ENCODED_COUNTER_KEY}`);
    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Failed to increment Redis count: ${response.status} ${details}`);
    }

    const data = (await response.json()) as { result: number };
    return typeof data.result === 'number' ? data.result : 0;
}

export const GET: APIRoute = async () => {
    try {
        const count = await getCount();
        return json({ count, writable: hasRedisConfig() }, { status: 200 });
    } catch (error) {
        console.error('[clicker] GET failed', error);
        return json({ error: 'Could not load click count.' }, { status: 503 });
    }
};

export const POST: APIRoute = async ({ request }) => {
    const sameOriginError = ensureSameOrigin(request);
    if (sameOriginError) return sameOriginError;

    const storageUnavailable = rejectIfStorageUnavailable();
    if (storageUnavailable) return storageUnavailable;

    const rateLimitError = await enforceRedisRateLimit(
        request,
        'clicker-post',
        CLICKER_RATE_LIMIT.limit,
        CLICKER_RATE_LIMIT.windowMs,
    );
    if (rateLimitError) return rateLimitError;

    try {
        const count = await incrementCount();
        return json({ count, writable: true }, { status: 200 });
    } catch (error) {
        console.error('[clicker] POST failed', error);
        return json({ error: 'Could not update click count.' }, { status: 503 });
    }
};
