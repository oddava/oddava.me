import type { APIRoute } from 'astro';

declare global {
    var __communityClickerCount: number | undefined;
}

const REDIS_API_URL =
    import.meta.env.UPSTASH_REDIS_REST_URL ??
    import.meta.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
const REDIS_API_TOKEN =
    import.meta.env.UPSTASH_REDIS_REST_TOKEN ??
    import.meta.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;
const COUNTER_KEY = 'community:clicker:count';
const ENCODED_COUNTER_KEY = encodeURIComponent(COUNTER_KEY);

function hasRedisConfig(): boolean {
    return Boolean(REDIS_API_URL && REDIS_API_TOKEN);
}

async function redisRequest(command: string): Promise<Response> {
    return fetch(`${REDIS_API_URL}/${command}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${REDIS_API_TOKEN}`,
        },
    });
}

async function getCount(): Promise<number> {
    if (!hasRedisConfig()) {
        return getMemoryCount();
    }

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
    if (!hasRedisConfig()) {
        return incrementMemoryCount();
    }

    const response = await redisRequest(`incr/${ENCODED_COUNTER_KEY}`);
    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Failed to increment Redis count: ${response.status} ${details}`);
    }

    const data = (await response.json()) as { result: number };
    return typeof data.result === 'number' ? data.result : 0;
}

function getMemoryCount(): number {
    if (typeof globalThis.__communityClickerCount !== 'number') {
        globalThis.__communityClickerCount = 0;
    }
    return globalThis.__communityClickerCount;
}

function incrementMemoryCount(): number {
    const next = (globalThis.__communityClickerCount ?? 0) + 1;
    globalThis.__communityClickerCount = next;
    return next;
}

export const GET: APIRoute = async ({ url }) => {
    const op = url.searchParams.get('op');
    const shouldIncrement = op === 'hit';

    try {
        const count = shouldIncrement ? await incrementCount() : await getCount();
        return new Response(JSON.stringify({ count }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('[clicker] GET failed, using memory fallback', error);
        const count = shouldIncrement ? incrementMemoryCount() : getMemoryCount();
        return new Response(JSON.stringify({ count, fallback: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    }
};

export const POST: APIRoute = async () => {
    try {
        const count = await incrementCount();
        return new Response(JSON.stringify({ count }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('[clicker] POST failed, using memory fallback', error);
        const count = incrementMemoryCount();
        return new Response(JSON.stringify({ count, fallback: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    }
};
