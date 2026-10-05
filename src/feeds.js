// Feed fetching / parsing / caching (ported from server/feeds.js). Differences from the Express version:
//  * state lives in Workers KV (binding CACHE) instead of data/cache/*.json
//  * per-host politeness spacing (robots Crawl-delay) is enforced across isolates with a small KV record
//  * hashing uses WebCrypto SHA-1 (same ids as the Express app)
//  * reads never trigger network fetches except for sources that have never been fetched (see getFeedItems)
import { XMLParser } from 'fast-xml-parser';
import { userAgent, SOURCES, JP } from './config.js';
import { matchCountries, byName } from './geo.js';
import { rssItems } from './rss.js';
import * as sample from './sample.js';

const parser = new XMLParser({ ignoreAttributes: true, processEntities: true, htmlEntities: true, trimValues: true, parseTagValue: false });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX_GAP_WAIT_MS = 30000; // never hold a request longer than this waiting for a host slot

// ---------- per-invocation context: { env, ctx, gaps } ----------
export const makeX = (env, ctx) => ({ env, ctx, gaps: null, gapsDirty: false });

// ---------- polite HTTP: per-host spacing (honours robots Crawl-delay), timeout, size cap ----------
async function reserveSlot(x, host, minGapMs) {
  if (!x.gaps) x.gaps = (await x.env.CACHE.get('meta:gaps', 'json')) || {};
  const now = Date.now();
  const at = Math.max(now, x.gaps[host] || 0);
  if (at - now > MAX_GAP_WAIT_MS) throw new Error('host throttled (' + host + '), try again later');
  x.gaps[host] = at + minGapMs; // reserve slot (serialises concurrent callers in this invocation)
  if (minGapMs >= 10000) x.gapsDirty = true; // only crawl-delay hosts (IMB/NAMB/ICC) are persisted across isolates (saves KV writes)
  if (at > now) await sleep(at - now);
}
export async function flushGaps(x) {
  if (!x.gaps || !x.gapsDirty) return;
  const now = Date.now();
  for (const h of Object.keys(x.gaps)) if (x.gaps[h] < now - 60000) delete x.gaps[h];
  x.gapsDirty = false;
  await x.env.CACHE.put('meta:gaps', JSON.stringify(x.gaps), { expirationTtl: 3600 });
}
async function politeFetch(x, url, minGapMs = 3000, timeoutMs = 20000) {
  await reserveSlot(x, new URL(url).host, minGapMs);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow',
      headers: { 'User-Agent': userAgent(x.env), Accept: 'application/rss+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.5' } });
    const text = await res.text();
    if (text.length > 5_000_000) throw new Error('response too large');
    return { status: res.status, text, ctype: res.headers.get('content-type') || '' };
  } finally { clearTimeout(t); }
}

// ---------- text helpers (identical to Express version) ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
function decode(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
export function toText(html) {
  if (html == null) return '';
  let s = String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|li|br)>/gi, ' ').replace(/<[^>]+>/g, ' ');
  s = decode(decode(s)); // feeds sometimes double-escape
  s = s.replace(/<[^>]+>/g, ' ').replace(/The post .* appeared first on .*$/i, '').replace(/\[…\]|\[&#8230;\]/g, '…').replace(/\s+/g, ' ').trim();
  return s;
}
function clip(s, n = 300) { if (s.length <= n) return s; const c = s.slice(0, n); return c.slice(0, c.lastIndexOf(' ') > 150 ? c.lastIndexOf(' ') : n) + '…'; }
async function hash(s) {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);

export async function parseRss(xml, src) {
  let entries = rssItems(xml); // fast path: plain RSS 2.0
  if (!entries) { // Atom or anything unusual: full XML parse
    const doc = parser.parse(xml);
    const ch = doc.rss?.channel || doc.feed;
    if (!ch) throw new Error('not an RSS/Atom feed');
    entries = arr(ch.item || ch.entry);
  }
  const out = [];
  for (const it of entries) {
    const title = toText(it.title);
    const link = typeof it.link === 'string' ? it.link : (it.guid && String(it.guid).startsWith('http') ? String(it.guid) : '');
    const date = it.pubDate || it.updated || it.published || it['dc:date'];
    const d = date ? new Date(date) : null;
    const tags = arr(it.category).map(toText).filter(Boolean);
    const excerpt = clip(toText(it.description || it['content:encoded'] || it.summary || ''));
    if (!title || !/^https?:\/\//.test(link)) continue;
    const haystack = [title, tags.join(' | '), excerpt].join(' | ');
    out.push({ id: src.id + ':' + await hash(it.guid || link), source: src.id, sourceName: src.name, category: src.category,
      title, link, published: d && !isNaN(d) ? d.toISOString() : null, excerpt, tags: tags.slice(0, 12), countries: matchCountries(haystack) });
  }
  return out;
}

// ---------- KV-backed cache + status ----------
const memRecs = new Map(); // short-lived per-isolate read cache to save KV reads (free tier: 100k reads/day)
const MEM_TTL_MS = 30000;
const recKey = id => 'src:' + id.replace(/[^a-z0-9_-]/gi, '_');
async function loadRec(x, id, { fresh = false } = {}) {
  const m = memRecs.get(id);
  if (!fresh && m && Date.now() - m.at < MEM_TTL_MS) return m.rec;
  let rec = null;
  try { rec = await x.env.CACHE.get(recKey(id), 'json'); } catch (e) { console.error('kv read failed', id, e.message); }
  memRecs.set(id, { at: Date.now(), rec });
  return rec;
}
async function saveRec(x, id, rec, ttlSec) {
  memRecs.set(id, { at: Date.now(), rec });
  try { await x.env.CACHE.put(recKey(id), JSON.stringify(rec), ttlSec ? { expirationTtl: ttlSec } : undefined); }
  catch (e) { console.error('kv write failed', id, e.message); }
}

const inflight = new Map(); // per-isolate de-dupe
export async function refreshSource(x, src, { force = false } = {}) {
  let rec = await loadRec(x, src.id, { fresh: force });
  const fresh = rec && rec.fetchedAt && Date.now() - rec.fetchedAt < src.ttlMin * 60000;
  const throttled = force && rec && rec.lastAttempt && Date.now() - rec.lastAttempt < 120000; // never hammer: 2 min floor
  if ((fresh && !force) || throttled) return rec;
  if (inflight.has(src.id)) return inflight.get(src.id);
  const p = (async () => {
    const next = { ...(rec || {}), lastAttempt: Date.now() };
    try {
      const r = await politeFetch(x, src.url, src.minGapMs);
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const items = src.special === 'jp' ? await parseJpRss(r.text) : await parseRss(r.text, src);
      next.items = items; next.fetchedAt = Date.now(); next.error = null;
    } catch (e) {
      next.error = (e.name === 'AbortError' ? 'timeout' : e.message);
    }
    await saveRec(x, src.id, next);
    return next;
  })().finally(() => inflight.delete(src.id));
  inflight.set(src.id, p);
  return p;
}

export function visibleItems(src, rec) {
  const items = (rec && rec.items) || [];
  if (!src.maxAgeDays) return items;
  const cutoff = Date.now() - src.maxAgeDays * 86400000;
  return items.filter(i => !i.published || new Date(i.published).getTime() >= cutoff);
}
export function statusOf(src, rec) {
  const all = (rec && rec.items) || [];
  const vis = visibleItems(src, rec);
  const newest = all.map(i => i.published).filter(Boolean).sort().pop() || null;
  let state;
  if (!rec || (!rec.fetchedAt && rec.error)) state = 'error';
  else if (rec.error) state = 'cached';          // last refresh failed, serving previous good copy
  else if (all.length === 0) state = 'empty';    // reachable, publishes no items
  else if (vis.length === 0) state = 'stale';    // items exist but all older than maxAgeDays
  else state = 'ok';
  return { id: src.id, name: src.name, org: src.org, category: src.category, url: src.url, home: src.home, terms: src.terms,
    state, lastOk: rec?.fetchedAt ? new Date(rec.fetchedAt).toISOString() : null, lastAttempt: rec?.lastAttempt ? new Date(rec.lastAttempt).toISOString() : null,
    error: rec?.error || null, itemsFetched: all.length, itemsShown: vis.length, newestItem: newest };
}

// ---------- Joshua Project public RSS ----------
export async function parseJpRss(xml) {
  const out = { unreached: null, fact: null, scripture: null };
  let entries = rssItems(xml);
  if (!entries) entries = arr(parser.parse(xml).rss?.channel?.item);
  for (const it of entries) {
    const t = toText(it.title), desc = String(it.description || '');
    if (/^Unreached of the Day/i.test(t)) {
      const f = {};
      for (const line of desc.replace(/<!\[CDATA\[|\]\]>/g, '').split(/<br\s*\/?>/i)) {
        const m = line.match(/^\s*([^:]+):\s*(.*?)\s*$/); if (m) f[m[1].trim().toLowerCase()] = toText(m[2]);
      }
      const c = byName(f['country name']);
      out.unreached = { title: t.replace(/^Unreached of the Day:\s*/i, ''), link: String(it.link), peopleName: f['people name'], country: f['country name'], iso2: c?.iso2 || null,
        population: f['population'], language: f['primary language'], religion: f['primary religion'], evangelicalPct: f['% evangelical'], status: f['status'], photo: it['media:thumbnail'] || null, published: it.pubDate ? new Date(it.pubDate).toISOString() : null };
    } else if (/Mission Fact/i.test(t)) out.fact = { text: toText(desc), link: String(it.link) };
    else if (/Mission Scripture/i.test(t)) out.scripture = { text: toText(desc), link: String(it.link) };
  }
  if (!out.unreached) throw new Error('no Unreached of the Day item in feed');
  return out;
}
export const JP_SRC = { ...JP, special: 'jp' };

// Optional Joshua Project API (needs free key as the JP_API_KEY secret). Response shape handled defensively; UNTESTED without a key.
export async function jpApiExtras(x, dateStr) {
  const key = x.env.JP_API_KEY;
  if (!key) return null;
  const [, m, d] = dateStr.split('-');
  const url = `https://api.joshuaproject.net/v1/people_groups/daily_unreached.json?api_key=${encodeURIComponent(key)}&month=${m}&day=${d}`;
  const id = 'jpapi-' + m + d;
  let rec = await loadRec(x, id);
  if (rec && rec.fetchedAt && Date.now() - rec.fetchedAt < 86400000) return rec.data;
  try {
    const r = await politeFetch(x, url, 5000);
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const j = JSON.parse(r.text); const row = Array.isArray(j) ? j[0] : (j.data ? arr(j.data)[0] : j);
    const data = row ? { peopleName: row.PeopNameInCountry || row.PeopNameAcrossCountries, country: row.Ctry, prayForPeople: row.PrayForPG ? toText(row.PrayForPG) : null, prayForChurch: row.PrayForChurch ? toText(row.PrayForChurch) : null } : null;
    rec = { fetchedAt: Date.now(), data }; await saveRec(x, id, rec, 3 * 86400); await flushGaps(x); return data;
  } catch (e) { console.error('JP API failed:', e.message); return rec?.data || null; }
}

// ---------- on-demand IMB per-country tag feed (WordPress tag feed) ----------
export async function imbCountryFeed(x, country) {
  const slug = country.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = 'imbtag-' + slug;
  const src = { id, name: 'IMB stories tagged "' + country.name + '"', org: 'IMB', category: 'missions', ttlMin: 360, minGapMs: 10000, maxAgeDays: 800,
    url: `https://www.imb.org/tag/${slug}/feed/`, home: `https://www.imb.org/tag/${slug}/`, terms: 'IMB tag feed (WordPress), on demand, cached 6 h, 10 s spacing.' };
  const rec = await loadRec(x, id);
  if (rec && rec.fetchedAt && Date.now() - rec.fetchedAt < src.ttlMin * 60000) return rec.items || [];
  if (rec && rec.lastAttempt && Date.now() - rec.lastAttempt < 600000) return rec.items || [];
  const next = { ...(rec || {}), lastAttempt: Date.now() };
  try {
    const r = await politeFetch(x, src.url, src.minGapMs);
    if (r.status === 404) { next.items = []; next.fetchedAt = Date.now(); }
    else if (r.status !== 200) throw new Error('HTTP ' + r.status);
    else { next.items = (await parseRss(r.text, { ...src, id: 'imb' })).slice(0, 8); next.fetchedAt = Date.now(); }
  } catch (e) { next.error = e.message; }
  await saveRec(x, id, next, 14 * 86400);
  await flushGaps(x);
  return next.items || [];
}

// ---------- public API used by routes ----------
// Reads come from KV. A source that has NEVER been fetched (fresh deploy / empty KV) is fetched in the background
// via ctx.waitUntil (at most REVALIDATE_MAX per request, and only once per isolate-minute); everything else is kept
// fresh by the Cron Trigger (see cronRefresh) so page views stay cheap on the free tier (10 ms CPU / request).
const REVALIDATE_MAX = 2;
const attempted = new Map();
async function recsFor(x, list) {
  const recs = await Promise.all(list.map(s => loadRec(x, s.id)));
  if (x.ctx) {
    let n = 0;
    list.forEach((s, i) => {
      if (recs[i] || n >= REVALIDATE_MAX || Date.now() - (attempted.get(s.id) || 0) < 60000) return;
      attempted.set(s.id, Date.now()); n++;
      x.ctx.waitUntil(refreshSource(x, s).then(() => flushGaps(x)).catch(e => console.error('background refresh failed', s.id, e.message)));
    });
  }
  return recs;
}
export async function getFeedItems(x, { cat = 'all', country = null } = {}) {
  const list = SOURCES.filter(s => cat === 'all' || s.category === cat);
  const recs = await recsFor(x, list);
  const statuses = list.map((s, i) => statusOf(s, recs[i]));
  let items = [];
  list.forEach((s, i) => { items = items.concat(visibleItems(s, recs[i])); });
  if (country) items = items.filter(i => i.countries.includes(country));
  items.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
  let example = false;
  if (!items.length && !country) { // every source in this category is down/empty -> clearly labelled placeholders
    items = sample.items(cat === 'all' ? 'persecution' : cat); example = true;
  }
  return { items, statuses, example };
}
function jpStatus(rec) {
  const base = statusOf({ ...JP_SRC }, null);
  base.state = rec?.items ? (rec.error ? 'cached' : 'ok') : (rec?.error ? 'error' : 'pending');
  base.lastOk = rec?.fetchedAt ? new Date(rec.fetchedAt).toISOString() : null;
  base.lastAttempt = rec?.lastAttempt ? new Date(rec.lastAttempt).toISOString() : null;
  base.error = rec?.error || null; base.itemsFetched = base.itemsShown = rec?.items ? 3 : 0;
  base.newestItem = rec?.items?.unreached?.published || null;
  return base;
}
export async function getJp(x) {
  const [rec] = await recsFor(x, [JP_SRC]);
  return { data: rec?.items || null, status: jpStatus(rec) };
}
export async function allStatuses(x) {
  const recs = await Promise.all([...SOURCES, JP_SRC].map(s => loadRec(x, s.id)));
  const out = SOURCES.map((s, i) => statusOf(s, recs[i]));
  out.push(jpStatus(recs[SOURCES.length]));
  return out;
}

// Refresh sources one after another (CPU-friendly for the free tier). force=true bypasses the TTL (2 min per-source floor still applies).
// Returns ids of sources attempted. maxSources caps how many are fetched in one invocation.
export async function refreshAll(x, { force = false, maxSources = Infinity } = {}) {
  const all = [...SOURCES, JP_SRC];
  const recs = await Promise.all(all.map(s => loadRec(x, s.id, { fresh: true })));
  const now = Date.now();
  const due = all.map((s, i) => {
    const r = recs[i];
    const age = r && r.fetchedAt ? now - r.fetchedAt : Infinity;
    const recentTry = r && r.lastAttempt && now - r.lastAttempt < 120000;
    return { s, overdue: age / (s.ttlMin * 60000), skip: recentTry || (!force && age < s.ttlMin * 60000) };
  }).filter(d => !d.skip).sort((a, b) => b.overdue - a.overdue).slice(0, maxSources);
  const done = [];
  try {
    for (const d of due) { await refreshSource(x, d.s, { force }); done.push(d.s.id); }
  } finally { await flushGaps(x); }
  return done;
}
export { SOURCES };
