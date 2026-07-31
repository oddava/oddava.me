import { env as cloudflareEnv } from 'cloudflare:workers';

export interface RuntimeEnv {
  ADMIN_PANEL_TOKEN?: string;
  APP_ENV?: string;
  COMMUNITY_SIGNING_SECRET?: string;
  CSP_REPORT_ENDPOINT?: string;
  DISCORD_USER_ID?: string;
  GUESTBOOK_ADMIN_TOKEN?: string;
  LANYARD_DISCORD_USER_ID?: string;
  LOCAL_REDIS_PROXY_PORT?: string;
  LOCAL_REDIS_PROXY_TOKEN?: string;
  LOCAL_REDIS_PROXY_URL?: string;
  LOCAL_REDIS_URL?: string;
  REDIS_MODE?: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  SPOTIFY_DISCORD_USER_ID?: string;
  SPOTIFY_REFRESH_TOKEN?: string;
  UPSTASH_REDIS_REST_KV_REST_API_TOKEN?: string;
  UPSTASH_REDIS_REST_KV_REST_API_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  UPSTASH_REDIS_REST_URL?: string;
}

export type RuntimeEnvName = keyof RuntimeEnv;

export function getServerEnv<Name extends RuntimeEnvName>(
  name: Name,
): RuntimeEnv[Name] {
  return cloudflareEnv[name] ?? import.meta.env[name];
}
