import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toText, parseRss, statusOf } from './bundle.mjs';

describe('toText ReDoS', () => {
  it('handles long repeated The post without hanging', () => {
    const poison = ('The post '.repeat(20000)) + 'x';
    const t0 = Date.now();
    const out = toText(poison);
    const ms = Date.now() - t0;
    assert.ok(ms < 500, 'took ' + ms + 'ms');
    assert.equal(typeof out, 'string');
  });
});

describe('parseRss', () => {
  it('parses RSS 2.0 item', async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
      <item><title>Pray for Nigeria</title><link>https://example.com/a</link><guid>https://example.com/a</guid>
      <pubDate>Mon, 05 Oct 2026 12:00:00 GMT</pubDate><description>Church in Lagos</description></item>
    </channel></rss>`;
    const items = await parseRss(xml, { id: 't', name: 'T', category: 'missions', excerpt: true });
    assert.equal(items.length, 1);
    assert.ok(items[0].countries.includes('NG'));
  });
  it('filters Baptist Press include path', async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>News</title><link>https://www.baptistpress.com/resource-library/news/foo/</link><guid>g1</guid><description>d</description></item>
      <item><title>Comic</title><link>https://www.baptistpress.com/resource-library/comics/bar/</link><guid>g2</guid><description>d</description></item>
    </channel></rss>`;
    const items = await parseRss(xml, { id: 'bp', name: 'BP', category: 'sbc', excerpt: false, include: '/resource-library/news/' });
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'News');
  });
});

describe('statusOf', () => {
  it('reports pending for null rec and stale when old', () => {
    const src = { id: 'x', name: 'X', org: 'X', category: 'm', url: 'https://x', home: 'https://x', terms: '', ttlMin: 60 };
    assert.equal(statusOf(src, null).state, 'pending');
    const old = { items: [{ published: '2026-01-01T00:00:00Z', title: 'a' }], fetchedAt: Date.now() - 4 * 60 * 60000, error: null };
    assert.equal(statusOf(src, old).state, 'stale');
  });
});
