import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { refreshAll, SOURCES } from './bundle.mjs';

function fakeKV() {
  const store = new Map();
  return {
    async get(k, type) {
      const v = store.get(k); if (v == null) return null;
      if (type === 'json') try { return JSON.parse(v); } catch { return null; }
      return v;
    },
    async put(k, v) { store.set(k, v); },
    _store: store,
  };
}

describe('refreshAll backoff', () => {
  it('skips backing-off sources so others can refresh', async () => {
    const CACHE = fakeKV();
    // Seed a permanently failing source as most overdue with nextTryAt in the future
    const failId = SOURCES[0].id;
    await CACHE.put('src:' + failId, JSON.stringify({
      items: [], fetchedAt: 0, lastAttempt: Date.now(), fails: 5,
      nextTryAt: Date.now() + 3600000, error: 'HTTP 503'
    }));
    const x = { env: { CACHE }, ctx: null, gaps: null, gapsDirty: false };
    // Monkey-patch fetch via global — refresh will try remaining sources
    const orig = globalThis.fetch;
    const hit = [];
    globalThis.fetch = async (url) => {
      hit.push(String(url));
      return { status: 200, text: async () => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title></channel></rss>`, headers: { get: () => 'application/rss+xml' } };
    };
    try {
      const done = await refreshAll(x, { force: false, maxSources: 1 });
      assert.ok(!done.includes(failId), 'should not pick backing-off source, got ' + done);
    } finally { globalThis.fetch = orig; }
  });
});
