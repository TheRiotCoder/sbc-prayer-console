import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { refreshAll, refreshSource, makeX, imbCountryFeed, writesToday, _resetWriteCounter, KV_WRITE_BUDGET, KV_WRITES_PER_INVOCATION, SOURCES, JP, countries } from './bundle.mjs';

function fakeKV() {
  const store = new Map(); const puts = [];
  return {
    async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
    async put(k, v, o) { puts.push(k); store.set(k, v); },
    store, puts,
  };
}
const RSS = n => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${Array.from({ length: n }, (_, i) =>
  `<item><title>Story ${i} Nigeria</title><link>https://www.imb.org/2026/10/0${i}/s${i}/</link><guid>g${i}</guid><pubDate>${new Date(Date.now() - i * 3600000).toUTCString()}</pubDate><description>d${i}</description></item>`).join('')}</channel></rss>`;
const JPRSS = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Unreached of the Day: X</title><link>https://joshuaproject.net/x</link><description>People Name: X<br>Country Name: Nigeria<br></description></item></channel></rss>`;
let origFetch, fetches;
beforeEach(() => {
  _resetWriteCounter(); fetches = [];
  origFetch = globalThis.fetch;
  globalThis.fetch = async url => { fetches.push(String(url)); return new Response(String(url).includes('joshuaproject') ? JPRSS : RSS(5), { status: 200 }); };
});
afterEach(() => { globalThis.fetch = origFetch; });
const ctx = { waitUntil() {} };

describe('KV write accounting', () => {
  it('a cron refresh costs exactly one KV write (no counter key, no meta:gaps)', async () => {
    const CACHE = fakeKV();
    const done = await refreshAll(makeX({ CACHE }, ctx, { cron: true }), { maxSources: 1 });
    assert.equal(done.length, 1);
    assert.deepEqual(CACHE.puts, ['src:' + done[0]]);
    const rec = JSON.parse(CACHE.store.get('src:' + done[0]));
    assert.equal(rec._w.n, 1, 'daily count rides inside the record');
    assert.equal(writesToday(), 1);
  });

  it('recovers the daily count from saved records and enforces the daily cap', async () => {
    const CACHE = fakeKV();
    const d = new Date().toISOString().slice(0, 10);
    // a fresh record (not due) carrying today's count at the cap
    await CACHE.put('src:' + SOURCES[0].id, JSON.stringify({ items: [], fetchedAt: Date.now(), lastAttempt: Date.now(), _w: { d, n: KV_WRITE_BUDGET } }));
    CACHE.puts.length = 0;
    const done = await refreshAll(makeX({ CACHE }, ctx, { cron: true }), { maxSources: 1 });
    assert.equal(done.length, 1, 'still checks a due source');
    assert.equal(writesToday(), KV_WRITE_BUDGET);
    assert.deepEqual(CACHE.puts, [], 'no KV write once the daily budget is used');
  });

  it('ignores a count stamped on a previous day', async () => {
    const CACHE = fakeKV();
    await CACHE.put('src:' + SOURCES[0].id, JSON.stringify({ items: [], fetchedAt: Date.now(), _w: { d: '2000-01-01', n: 999 } }));
    CACHE.puts.length = 0;
    await refreshAll(makeX({ CACHE }, ctx, { cron: true }), { maxSources: 1 });
    assert.equal(CACHE.puts.length, 1);
    assert.equal(writesToday(), 1);
  });

  it('caps writes per invocation', async () => {
    const CACHE = fakeKV();
    const x = makeX({ CACHE }, ctx, { cron: true });
    x.writes = KV_WRITES_PER_INVOCATION;
    await refreshAll(x, { maxSources: 1 });
    assert.equal(CACHE.puts.length, 0);
  });

  it('page-view IMB tag fetch: record + meta:gaps only, daily tag counter rides in meta:gaps', async () => {
    const CACHE = fakeKV();
    const ng = countries.NG;
    const items = await imbCountryFeed(makeX({ CACHE }, ctx), ng);
    assert.ok(items.length > 0);
    assert.deepEqual(CACHE.puts.sort(), ['meta:gaps', 'src:imbtag-nigeria']);
    const g = JSON.parse(CACHE.store.get('meta:gaps'));
    assert.match(g['#imb'], /^\d{4}-\d{2}-\d{2}\|1$/);
    assert.ok(g['www.imb.org'] > Date.now(), 'crawl-delay slot still persisted for page-view fetches');
  });

  it('IMB tag daily cap is read from meta:gaps', async () => {
    const CACHE = fakeKV();
    const d = new Date().toISOString().slice(0, 10);
    await CACHE.put('meta:gaps', JSON.stringify({ '#imb': d + '|40' }));
    CACHE.puts.length = 0;
    await imbCountryFeed(makeX({ CACHE }, ctx), countries.NG);
    assert.equal(fetches.length, 0, 'no upstream fetch past the cap');
    assert.equal(CACHE.puts.length, 0);
  });

  it('a source failing 12+ times backs off 6 h instead of its TTL', async () => {
    const CACHE = fakeKV();
    globalThis.fetch = async () => new Response('no', { status: 403 });
    const src = SOURCES.find(s => s.id === 'bp');
    await CACHE.put('src:bp', JSON.stringify({ items: [{ title: 'a', link: 'https://x' }], fetchedAt: 1, lastAttempt: 1, fails: 11, error: 'HTTP 403' }));
    const rec = await refreshSource(makeX({ CACHE }, ctx, { cron: true }), src, { force: true });
    assert.equal(rec.fails, 12);
    assert.ok(rec.nextTryAt - Date.now() >= 6 * 3600000 - 1000, 'backoff ' + (rec.nextTryAt - Date.now()));
    assert.equal(rec.error, 'HTTP 403');
  });
});

describe('24 h cron simulation (7,22,37,52 * * * *, 1 source per run)', () => {
  it('stays well under the free 1,000 writes/day and keeps every source within ~1.5x its TTL', async () => {
    const CACHE = fakeKV();
    const realNow = Date.now; let now = realNow();
    Date.now = () => now;
    try {
      const all = [...SOURCES, JP];
      const lastFetch = {}; const maxGap = {};
      const day = 86400000; const t0 = now;
      for (let t = t0; t < t0 + 2 * day; t += 15 * 60000) {
        now = t;
        if (t === t0 + day) CACHE.puts.length = 0; // count the second (steady-state) day only
        const done = await refreshAll(makeX({ CACHE }, ctx, { cron: true }), { maxSources: 1 });
        for (const id of done) { if (t >= t0 + day && lastFetch[id]) maxGap[id] = Math.max(maxGap[id] || 0, t - lastFetch[id]); lastFetch[id] = t; }
      }
      const writes = CACHE.puts.length;
      assert.ok(writes <= 100, 'writes/day ' + writes);
      assert.ok(CACHE.puts.every(k => k.startsWith('src:')), 'only source records are written');
      for (const s of all) assert.ok(maxGap[s.id] <= 1.5 * s.ttlMin * 60000 + 15 * 60000, s.id + ' max gap ' + maxGap[s.id] / 60000 + ' min vs ttl ' + s.ttlMin);
    } finally { Date.now = realNow; }
  });
});
