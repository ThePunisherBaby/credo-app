// fastCache.js — High-Concurrency Singleflight Coalescing + Bounded TTL Memory Cache
// Prevents PostgreSQL thundering-herd spikes under massive concurrent usage.

const DEFAULT_MAX_ENTRIES = 250;

class FastCache {
  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
    this.store = new Map();
    this.inflight = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.exp) {
      this.store.delete(key);
      return undefined;
    }
    return entry.val;
  }

  set(key, val, ttlMs = 15000) {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { val, exp: Date.now() + ttlMs });
  }

  /**
   * Returns cached value or deduplicates concurrent loader calls into a single PostgreSQL query.
   */
  async getOrLoad(key, ttlMs, loader) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;

    if (this.inflight.has(key)) {
      return this.inflight.get(key);
    }

    const p = (async () => {
      try {
        const val = await loader();
        this.set(key, val, ttlMs);
        return val;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, p);
    return p;
  }

  invalidate(prefix) {
    if (!prefix) {
      this.store.clear();
      return;
    }
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  invalidatePrefix(prefix) {
    return this.invalidate(prefix);
  }
}

const apiCache = new FastCache(300);

module.exports = { FastCache, apiCache };
