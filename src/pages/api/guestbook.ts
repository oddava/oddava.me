/// <reference types="astro/client" />
import type { APIRoute } from 'astro';

declare global {
    var __guestbookEntries: GuestbookEntry[] | undefined;
}

interface GuestbookEntry {
    id: string;
    name: string;
    message: string;
    createdAt: string;
}

const REDIS_API_URL =
    import.meta.env.UPSTASH_REDIS_REST_URL ??
    import.meta.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
const REDIS_API_TOKEN =
    import.meta.env.UPSTASH_REDIS_REST_TOKEN ??
    import.meta.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;

const ENTRIES_KEY = 'community:guestbook:entries';
const ENCODED_ENTRIES_KEY = encodeURIComponent(ENTRIES_KEY);
const ENTRY_LIMIT = 50;

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

function getMemoryEntries(): GuestbookEntry[] {
    if (!Array.isArray(globalThis.__guestbookEntries)) {
        globalThis.__guestbookEntries = [];
    }
    return globalThis.__guestbookEntries;
}

function addMemoryEntry(entry: GuestbookEntry): GuestbookEntry[] {
    const entries = getMemoryEntries();
    entries.unshift(entry);
    globalThis.__guestbookEntries = entries.slice(0, ENTRY_LIMIT);
    return globalThis.__guestbookEntries;
}

async function getEntries(): Promise<GuestbookEntry[]> {
    if (!hasRedisConfig()) {
        return getMemoryEntries();
    }

    const response = await redisRequest(`lrange/${ENCODED_ENTRIES_KEY}/0/${ENTRY_LIMIT - 1}`);
    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Failed to read guestbook: ${response.status} ${details}`);
    }

    const data = (await response.json()) as { result: string[] | null };
    if (!data.result) return [];

    return data.result
        .map((raw) => {
            try {
                return JSON.parse(raw) as GuestbookEntry;
            } catch {
                return null;
            }
        })
        .filter((entry): entry is GuestbookEntry => Boolean(entry));
}

async function addEntry(entry: GuestbookEntry): Promise<GuestbookEntry[]> {
    if (!hasRedisConfig()) {
        return addMemoryEntry(entry);
    }

    const payload = encodeURIComponent(JSON.stringify(entry));
    const pushResponse = await redisRequest(`lpush/${ENCODED_ENTRIES_KEY}/${payload}`);
    if (!pushResponse.ok) {
        const details = await pushResponse.text();
        throw new Error(`Failed to write guestbook: ${pushResponse.status} ${details}`);
    }

    const trimResponse = await redisRequest(`ltrim/${ENCODED_ENTRIES_KEY}/0/${ENTRY_LIMIT - 1}`);
    if (!trimResponse.ok) {
        const details = await trimResponse.text();
        throw new Error(`Failed to trim guestbook: ${trimResponse.status} ${details}`);
    }

    return getEntries();
}

function sanitizeText(value: string, limit: number): string {
    return value.trim().slice(0, limit);
}

export const GET: APIRoute = async () => {
    try {
        const entries = await getEntries();
        return new Response(JSON.stringify({ entries }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('[guestbook] GET failed, using memory fallback', error);
        const entries = getMemoryEntries();
        return new Response(JSON.stringify({ entries, fallback: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    }
};

export const POST: APIRoute = async ({ request }) => {
    let body: { name?: string; message?: string };

    try {
        body = (await request.json()) as { name?: string; message?: string };
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid request.' }), {
            status: 400,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    const name = sanitizeText(body.name ?? '', 32) || 'anon';
    const message = sanitizeText(body.message ?? '', 280);

    if (!message) {
        return new Response(JSON.stringify({ error: 'Message required.' }), {
            status: 400,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    const entry: GuestbookEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name,
        message,
        createdAt: new Date().toISOString(),
    };

    try {
        const entries = await addEntry(entry);
        return new Response(JSON.stringify({ entries }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('[guestbook] POST failed, using memory fallback', error);
        const entries = addMemoryEntry(entry);
        return new Response(JSON.stringify({ entries, fallback: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    }
};
