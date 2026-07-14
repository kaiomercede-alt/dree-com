const DEFAULT_KEY = 'dree:funnel:events';
const DEFAULT_LIMIT = 5000;

function getRedisConfig() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.UPSTASH_REDIS_REST_REST_URL ||
    process.env.STORAGE_REST_URL ||
    process.env.STORAGE_URL ||
    process.env.REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.UPSTASH_REDIS_REST_REST_TOKEN ||
    process.env.STORAGE_REST_TOKEN ||
    process.env.STORAGE_TOKEN ||
    process.env.REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

function getMemoryStore() {
  if (!global.__dreeMetricsEvents) {
    global.__dreeMetricsEvents = [];
  }
  return global.__dreeMetricsEvents;
}

async function redisCommand(command) {
  const config = getRedisConfig();
  if (!config) return null;

  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || (data && data.error)) {
    const message = data && data.error ? data.error : `Redis request failed with ${response.status}`;
    throw new Error(message);
  }

  return data ? data.result : null;
}

async function appendEvent(event) {
  const key = process.env.DREE_METRICS_KEY || DEFAULT_KEY;
  const limit = Number(process.env.DREE_METRICS_LIMIT || DEFAULT_LIMIT);
  const serialized = JSON.stringify(event);

  if (getRedisConfig()) {
    await redisCommand(['LPUSH', key, serialized]);
    await redisCommand(['LTRIM', key, 0, Math.max(0, limit - 1)]);
    return { driver: 'redis' };
  }

  const store = getMemoryStore();
  store.unshift(event);
  if (store.length > limit) store.length = limit;
  return { driver: 'memory' };
}

async function readEvents(limit) {
  const key = process.env.DREE_METRICS_KEY || DEFAULT_KEY;
  const max = Math.max(1, Math.min(Number(limit || DEFAULT_LIMIT), 20000));

  if (getRedisConfig()) {
    const rows = await redisCommand(['LRANGE', key, 0, max - 1]);
    return (Array.isArray(rows) ? rows : [])
      .map((row) => {
        try {
          return typeof row === 'string' ? JSON.parse(row) : row;
        } catch (_error) {
          return null;
        }
      })
      .filter(Boolean);
  }

  return getMemoryStore().slice(0, max);
}

module.exports = {
  appendEvent,
  readEvents,
  hasPersistentStore: () => Boolean(getRedisConfig())
};
