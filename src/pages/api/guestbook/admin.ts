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

async function readEntries(): Promise<GuestbookEntry[]> {
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

async function writeEntries(entries: GuestbookEntry[]): Promise<void> {
    const nextEntries = entries.slice(0, ENTRY_LIMIT);

    if (!hasRedisConfig()) {
        globalThis.__guestbookEntries = nextEntries;
        return;
    }

    if (nextEntries.length === 0) {
        const delResponse = await redisRequest(`del/${ENCODED_ENTRIES_KEY}`);
        if (!delResponse.ok) {
            const details = await delResponse.text();
            throw new Error(`Failed to clear guestbook: ${delResponse.status} ${details}`);
        }
        return;
    }

    const delResponse = await redisRequest(`del/${ENCODED_ENTRIES_KEY}`);
    if (!delResponse.ok) {
        const details = await delResponse.text();
        throw new Error(`Failed to reset guestbook: ${delResponse.status} ${details}`);
    }

    const payloads = nextEntries
        .slice()
        .reverse()
        .map((entry) => encodeURIComponent(JSON.stringify(entry)));
    const pushResponse = await redisRequest(`lpush/${ENCODED_ENTRIES_KEY}/${payloads.join('/')}`);
    if (!pushResponse.ok) {
        const details = await pushResponse.text();
        throw new Error(`Failed to write guestbook: ${pushResponse.status} ${details}`);
    }
}

function isAuthorized(request: Request): boolean {
    const token = import.meta.env.GUESTBOOK_ADMIN_TOKEN;
    if (!token) return false;
    return request.headers.get('X-Guestbook-Admin') === token;
}

function unauthorizedResponse(): Response {
    return new Response(JSON.stringify({ error: 'Unauthorized.' }), {
        status: 401,
        headers: {
            'Content-Type': 'application/json',
        },
    });
}

export const GET: APIRoute = async ({ request }) => {
    if (!isAuthorized(request)) return unauthorizedResponse();

    try {
        const entries = await readEntries();
        return new Response(JSON.stringify({ entries }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('[guestbook-admin] GET failed', error);
        return new Response(JSON.stringify({ error: 'Failed to load entries.' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
};

export const DELETE: APIRoute = async ({ request, url }) => {
    if (!isAuthorized(request)) return unauthorizedResponse();

    const id = url.searchParams.get('id');
    const clearAll = url.searchParams.get('all') === 'true';

    if (!id && !clearAll) {
        return new Response(JSON.stringify({ error: 'Missing id or all=true.' }), {
            status: 400,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    try {
        if (clearAll) {
            await writeEntries([]);
            return new Response(JSON.stringify({ entries: [] }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store',
                },
            });
        }

        const entries = await readEntries();
        const next = entries.filter((entry) => entry.id !== id);
        await writeEntries(next);
        return new Response(JSON.stringify({ entries: next }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('[guestbook-admin] DELETE failed', error);
        return new Response(JSON.stringify({ error: 'Failed to delete entries.' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
};
