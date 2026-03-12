/// <reference types="astro/client" />
import type { APIRoute } from 'astro';

declare global {
    var __minesweeperLeaderboard: Record<string, LeaderboardEntry[]> | undefined;
}

interface LeaderboardEntry {
    time: number;
    createdAt: string;
}

const REDIS_API_URL =
    import.meta.env.UPSTASH_REDIS_REST_URL ??
    import.meta.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
const REDIS_API_TOKEN =
    import.meta.env.UPSTASH_REDIS_REST_TOKEN ??
    import.meta.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;

const LEADERBOARD_LIMIT = 10;

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

function getMemoryStore(): Record<string, LeaderboardEntry[]> {
    if (!globalThis.__minesweeperLeaderboard) {
        globalThis.__minesweeperLeaderboard = {};
    }
    return globalThis.__minesweeperLeaderboard;
}

function getKey(difficulty: string): string {
    return `minesweeper:leaderboard:${difficulty}`;
}

async function readLeaderboard(difficulty: string): Promise<LeaderboardEntry[]> {
    if (!hasRedisConfig()) {
        return getMemoryStore()[difficulty] ?? [];
    }

    const key = encodeURIComponent(getKey(difficulty));
    const response = await redisRequest(`get/${key}`);
    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Failed to read leaderboard: ${response.status} ${details}`);
    }

    const data = (await response.json()) as { result: string | null };
    if (!data.result) return [];

    try {
        return JSON.parse(data.result) as LeaderboardEntry[];
    } catch {
        return [];
    }
}

async function writeLeaderboard(difficulty: string, entries: LeaderboardEntry[]): Promise<void> {
    if (!hasRedisConfig()) {
        getMemoryStore()[difficulty] = entries;
        return;
    }

    const key = encodeURIComponent(getKey(difficulty));
    const value = encodeURIComponent(JSON.stringify(entries));
    const response = await redisRequest(`set/${key}/${value}`);
    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Failed to write leaderboard: ${response.status} ${details}`);
    }
}

function normalizeEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
    return entries
        .filter((entry) => Number.isFinite(entry.time) && entry.time > 0)
        .sort((a, b) => a.time - b.time)
        .slice(0, LEADERBOARD_LIMIT);
}

export const GET: APIRoute = async ({ url }) => {
    const difficulty = url.searchParams.get('difficulty') ?? 'easy';

    try {
        const entries = await readLeaderboard(difficulty);
        return new Response(JSON.stringify({ entries: normalizeEntries(entries) }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('[minesweeper] GET failed, using memory fallback', error);
        const entries = getMemoryStore()[difficulty] ?? [];
        return new Response(JSON.stringify({ entries: normalizeEntries(entries), fallback: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    }
};

export const POST: APIRoute = async ({ request }) => {
    let body: { difficulty?: string; time?: number };

    try {
        body = (await request.json()) as { difficulty?: string; time?: number };
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid request.' }), {
            status: 400,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    const difficulty = body.difficulty ?? 'easy';
    const time = Number(body.time);

    if (!Number.isFinite(time) || time <= 0) {
        return new Response(JSON.stringify({ error: 'Invalid time.' }), {
            status: 400,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    try {
        const existing = await readLeaderboard(difficulty);
        const next = normalizeEntries([
            ...existing,
            {
                time,
                createdAt: new Date().toISOString(),
            },
        ]);

        await writeLeaderboard(difficulty, next);

        return new Response(JSON.stringify({ entries: next }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('[minesweeper] POST failed, using memory fallback', error);
        const store = getMemoryStore();
        const existing = store[difficulty] ?? [];
        const next = normalizeEntries([
            ...existing,
            {
                time,
                createdAt: new Date().toISOString(),
            },
        ]);
        store[difficulty] = next;

        return new Response(JSON.stringify({ entries: next, fallback: true }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    }
};
