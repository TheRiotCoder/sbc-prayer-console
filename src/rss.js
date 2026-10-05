// Lean, DOM-less RSS 2.0 item extractor (regex based). The Workers free plan only allows 10 ms CPU per invocation, and
// fast-xml-parser needs 10-25 ms to build a full tree for a 200 KB WordPress feed (most of it <content:encoded> that we
// never use). This extractor only touches the fields the app needs. Atom feeds / anything unusual fall back to
// fast-xml-parser in feeds.js (same output shape as the Express version).
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
function xmlDecode(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, d, h, n) => {
    try { if (d) return String.fromCodePoint(+d); if (h) return String.fromCodePoint(parseInt(h, 16)); } catch { return m; }
    return ENT[n.toLowerCase()] ?? m;
  });
}
function text(inner) {
  const t = inner.trim();
  if (t.indexOf('<![CDATA[') >= 0) return t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'); // like fast-xml-parser, CDATA content is NOT trimmed
  return xmlDecode(t);
}
const FIELDS = ['title', 'link', 'guid', 'pubDate', 'dc:date', 'description'];
const RX = Object.fromEntries([...FIELDS, 'category', 'content:encoded'].map(f => [f, new RegExp('<' + f + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + f + '>', 'g')]));
function all(block, f) { const rx = RX[f]; rx.lastIndex = 0; const out = []; let m; while ((m = rx.exec(block))) out.push(text(m[1])); return out; }
function first(block, f) { const rx = RX[f]; rx.lastIndex = 0; const m = rx.exec(block); return m ? text(m[1]) : undefined; }

// Returns an array of objects shaped like fast-xml-parser's (ignoreAttributes) output for RSS 2.0 items, or null if the
// document is not plain RSS 2.0.
export function rssItems(xml) {
  if (!/<rss[\s>]/.test(xml.slice(0, 2000)) || !/<channel[\s>]/.test(xml)) return null;
  const items = [];
  const rx = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = rx.exec(xml))) {
    const b = m[1];
    const it = { title: first(b, 'title'), link: first(b, 'link'), guid: first(b, 'guid'), pubDate: first(b, 'pubDate'), 'dc:date': first(b, 'dc:date'),
      description: first(b, 'description'), category: all(b, 'category') };
    if (!it.description) { const c = first(b, 'content:encoded'); if (c) it['content:encoded'] = c; }
    items.push(it);
  }
  return items;
}
