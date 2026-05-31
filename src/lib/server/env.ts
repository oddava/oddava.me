import { env as cloudflareEnv } from 'cloudflare:workers';

type ServerEnv = Record<string, string | undefined>;

export function getServerEnv(name: string): string | undefined {
  return (cloudflareEnv as ServerEnv)[name] ?? import.meta.env[name];
}

