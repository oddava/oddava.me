/// <reference types="astro/client" />
import type { APIRoute } from 'astro';
import {
    enforceSignedCooldown,
    ensureSameOrigin,
    hasRedisConfig,
    json,
    redisRequest,
    rejectIfStorageUnavailable,
} from '../../lib/server/community';

interface GuestbookEntry {
    id: string;
    name: string;
    message: string;
    createdAt: string;
}

const ENTRIES_KEY = 'community:guestbook:entries';
const ENCODED_ENTRIES_KEY = encodeURIComponent(ENTRIES_KEY);
const ENTRY_LIMIT = 50;
const GUESTBOOK_COOLDOWN_MS = 30_000;

async function getEntries(): Promise<GuestbookEntry[]> {
    if (!hasRedisConfig()) return [];

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
    if (!hasRedisConfig()) throw new Error('Persistent storage is not configured.');

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
        return json({ entries, writable: hasRedisConfig() }, { status: 200 });
    } catch (error) {
        console.error('[guestbook] GET failed', error);
        return json({ error: 'Could not load guestbook messages.' }, { status: 503 });
    }
};

export const POST: APIRoute = async ({ request, cookies }) => {
    const sameOriginError = ensureSameOrigin(request);
    if (sameOriginError) return sameOriginError;

    const storageUnavailable = rejectIfStorageUnavailable();
    if (storageUnavailable) return storageUnavailable;

    const cooldownError = await enforceSignedCooldown(cookies, request, 'guestbook-rate-limit', GUESTBOOK_COOLDOWN_MS);
    if (cooldownError) return cooldownError;

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
        return json({ error: 'Message required.' }, { status: 400 });
    }

    if (message.length < 3) {
        return json({ error: 'Message is too short.' }, { status: 400 });
    }

    const entry: GuestbookEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name,
        message,
        createdAt: new Date().toISOString(),
    };

    try {
        const entries = await addEntry(entry);
        return json({ entries, writable: true }, { status: 200 });
    } catch (error) {
        console.error('[guestbook] POST failed', error);
        return json({ error: 'Could not post message.' }, { status: 503 });
    }
};
