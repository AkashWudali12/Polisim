import { Redis } from '@upstash/redis';

declare global {
  var __polisimRedis__: Redis | undefined;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required Redis environment variable: ${name}`);
  }
  return value;
}

export function getRedisClient(): Redis {
  if (globalThis.__polisimRedis__) {
    return globalThis.__polisimRedis__;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.REDIS_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.REDIS_TOKEN;

  const client = new Redis({
    url: url ?? requireEnv('UPSTASH_REDIS_REST_URL'),
    token: token ?? requireEnv('UPSTASH_REDIS_REST_TOKEN'),
  });

  globalThis.__polisimRedis__ = client;
  return client;
}

