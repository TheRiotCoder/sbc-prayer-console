// Feed fetching / parsing / caching for Cloudflare Workers KV.
import { XMLParser } from 'fast-xml-parser';
import { userAgent, SOURCES, JP } from './config.js';
import { matchCountries, byName } from './geo.js';
import { rssItems } from './rss.js';
import * as sample from './sample.js';

const parser = new XMLParser({ ignoreAttributes: true, processEntities: true, htmlEntities: true, trimValues: true, parseTagValue: false });
const atomParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: true, htmlEntities: true, trimValues: true, parseTagValue: false });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX_GAP_WAIT_MS = 30000;
export const KV_WRITE_BUDGET = 700; // soft daily cap (free tier 1000)
export const KV_WRITES_PER_INVOCATION = 12; // hard per-invocation cap (a cron run normally does 1)

// opts.cron: scheduled run. Cron runs keep host spacing in memory only (the next run is 15 min away, far longer than any
// Crawl-delay), so they never spend a KV write on meta:gaps.
export const makeX = (env, ctx, opts = {}) => ({ env, ctx, gaps: null, gapsDirty: false, writes: 0, persistGaps: !opts.cron });

async function loadGaps(x) {
  if (!x.gaps) { try { x.gaps = (await x.env.CACHE.get('meta:gaps', 'json')) || {}; } catch { x.gaps = {}; } }
  return x.gaps;
}
async function reserveSlot(x, host, minGapMs) {
  await loadGaps(x);
  const now = Date.now();
  const at = Math.max(now, x.gaps[host] || 0);
  if (at - now > MAX_GAP_WAIT_MS) throw new Error('host throttled (' + host + '), try again later');
  x.gaps[host] = at + minGapMs;
  if (minGapMs >= 10000) x.gapsDirty = true;
  if (at > now) await sleep(at - now);
}
export async function flushGaps(x) {
  if (!x.gaps || !x.gapsDirty || !x.persistGaps) return;
  const now = Date.now();
  // keys starting with '#' are small counters riding along in this record (e.g. '#imb' = IMB tag fetches today)
  for (const h of Object.keys(x.gaps)) if (h[0] !== '#' && x.gaps[h] < now - 60000) delete x.gaps[h];
  x.gapsDirty = false;
  try { await kvPut(x, 'meta:gaps', JSON.stringify(x.gaps), 172800); } catch (e) { console.error('flushGaps', e.message); }
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

// KV write budget without a counter key. The old version read+wrote 'meta:writes:<day>' on every put, which doubled
// every write. Now the running daily count lives in memory (per isolate) and rides along inside each source record we
// save anyway (rec._w = { d: day, n }). Every cron run loads all source records, so it recovers the day's count from
// the newest _w at no extra cost. Writes made by page-view paths in other isolates are only folded in when that isolate
// next saves a source record, so the count is a close lower bound; those paths have their own caps (IMB tags 40/day,
// refresh token + 60 s throttle, background fill only for never-fetched sources). Plus a hard per-invocation cap.
const today = () => new Date().toISOString().slice(0, 10);
const wc = { d: '', n: 0 };
export function noteWrites(stamp) { // fold a persisted { d, n } into the in-memory daily count
  if (!stamp || typeof stamp.n !== 'number') return;
  const d = today();
  if (stamp.d !== d) return;
  if (wc.d !== d) { wc.d = d; wc.n = 0; }
  if (stamp.n > wc.n) wc.n = stamp.n;
}
export function writesToday() { return wc.d === today() ? wc.n : 0; }
export function _resetWriteCounter() { wc.d = ''; wc.n = 0; }
async function kvPut(x, key, value, ttlSec) {
  const d = today();
  if (wc.d !== d) { wc.d = d; wc.n = 0; }
  if (wc.n >= KV_WRITE_BUDGET) { console.error('KV write budget exhausted', wc.n); return false; }
  if ((x.writes || 0) >= KV_WRITES_PER_INVOCATION) { console.error('KV per-invocation write cap hit', key); return false; }
  const opts = ttlSec ? { expirationTtl: ttlSec } : undefined;
  if (typeof value === 'function') value = value(wc.n + 1); // lets saveRec embed the post-write count
  await x.env.CACHE.put(key, value, opts);
  wc.n++; x.writes = (x.writes || 0) + 1;
  return true;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
function decode(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
// Clip BEFORE the WordPress boilerplate regex to avoid ReDoS; use non-backtracking pattern
export function toText(html) {
  if (html == null) return '';
  let s = String(html).slice(0, 8000);
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|li|br)>/gi, ' ').replace(/<[^>]+>/g, ' ');
  s = decode(decode(s));
  s = s.replace(/<[^>]+>/g, ' ').slice(0, 2000);
  s = s.replace(/\s*The post[^]{0,300}?appeared first on[^]{0,300}$/i, '');
  s = s.replace(/\[…\]|\[&#8230;\]/g, '…').replace(/\s+/g, ' ').trim();
  return s;
}
function clip(s, n = 300) { if (s.length <= n) return s; const c = s.slice(0, n); return c.slice(0, c.lastIndexOf(' ') > 150 ? c.lastIndexOf(' ') : n) + '…'; }
function stripEmails(s) { return String(s || '').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]'); }
async function hash(s) {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);

function atomLink(it) {
  const links = arr(it.link);
  for (const L of links) {
    if (typeof L === 'string' && /^https?:/.test(L)) return L;
    if (L && typeof L === 'object') {
      const rel = L['@_rel'] || 'alternate';
      const href = L['@_href'] || '';
      if ((rel === 'alternate' || !L['@_rel']) && /^https?:/.test(href)) return href;
    }
  }
  return '';
}
function atomText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v['#text'] || v['@_'] || '';
  return String(v);
}

export async function parseRss(xml, src) {
  let entries = rssItems(xml);
  if (!entries) {
    // Atom / unusual: parse with attributes
    const doc = atomParser.parse(xml);
    const ch = doc.rss?.channel || doc.feed || doc['rdf:RDF'];
    if (!ch) throw new Error('not an RSS/Atom feed');
    entries = arr(ch.item || ch.entry).map(it => {
      const link = typeof it.link === 'string' ? it.link : atomLink(it);
      const guid = atomText(it.guid) || atomText(it.id) || link;
      const desc = atomText(it.description) || atomText(it.summary) || atomText(it.content) || atomText(it['content:encoded']);
      const cats = arr(it.category).map(c => typeof c === 'string' ? c : (c?.['@_term'] || atomText(c))).filter(Boolean);
      return { title: atomText(it.title), link, guid, pubDate: it.pubDate || it.updated || it.published || it['dc:date'], description: desc, category: cats, 'content:encoded': atomText(it['content:encoded']) };
    });
  }
  const out = [];
  const now = Date.now();
  for (const it of entries.slice(0, 40)) {
    let title = toText(it.title);
    let link = typeof it.link === 'string' ? it.link.trim() : (it.guid && String(it.guid).startsWith('http') ? String(it.guid).trim() : '');
    if (src.include && link && !link.includes(src.include)) continue;
    const date = it.pubDate || it.updated || it.published || it['dc:date'];
    let d = date ? new Date(date) : null;
    if (d && !isNaN(d) && d.getTime() > now + 86400000) d = null; // clamp future dates
    // date-only feeds (IMB prayer): stamp is 00:00 UTC — keep calendar date, avoid TZ shift
    let published = null;
    if (src.dateOnly && date) {
      const m = String(date).match(/(\d{4}-\d{2}-\d{2})/);
      published = m ? m[1] + 'T12:00:00.000Z' : (d && !isNaN(d) ? d.toISOString() : null);
    } else if (d && !isNaN(d)) published = d.toISOString();
    const tags = arr(it.category).map(toText).filter(Boolean);
    let excerpt = '';
    if (src.excerpt !== false) {
      excerpt = clip(toText(it.description || it['content:encoded'] || it.summary || ''));
      if (src.stripEmails) excerpt = stripEmails(excerpt);
    }
    if (src.stripEmails) title = stripEmails(title);
    if (!title || !/^https?:\/\//.test(link)) continue;
    const haystack = [title, tags.join(' | '), excerpt].join(' | ');
    out.push({ id: src.id + ':' + await hash(it.guid || link), source: src.id, sourceName: src.name, category: src.category,
      title, link, published, excerpt, tags: tags.slice(0, 12), countries: matchCountries(haystack), dateOnly: !!src.dateOnly });
  }
  return out;
}

const memRecs = new Map();
const MEM_TTL_MS = 30000;
const recKey = id => 'src:' + id.replace(/[^a-z0-9_-]/gi, '_');
async function loadRec(x, id, { fresh = false } = {}) {
  const m = memRecs.get(id);
  if (!fresh && m && Date.now() - m.at < MEM_TTL_MS) return m.rec;
  let rec = null;
  try { rec = await x.env.CACHE.get(recKey(id), 'json'); } catch (e) { console.error('kv read failed', id, e.message); }
  if (rec && rec._w) noteWrites(rec._w);
  memRecs.set(id, { at: Date.now(), rec });
  return rec;
}
async function saveRec(x, id, rec, ttlSec) {
  memRecs.set(id, { at: Date.now(), rec });
  try { await kvPut(x, recKey(id), n => { rec._w = { d: today(), n }; return JSON.stringify(rec); }, ttlSec); }
  catch (e) { console.error('kv write failed', id, e.message); }
}

const inflight = new Map();
export async function refreshSource(x, src, { force = false } = {}) {
  let rec = await loadRec(x, src.id, { fresh: force });
  const fresh = rec && rec.fetchedAt && Date.now() - rec.fetchedAt < src.ttlMin * 60000;
  const throttled = force && rec && rec.lastAttempt && Date.now() - rec.lastAttempt < 120000;
  const backingOff = rec && rec.nextTryAt && Date.now() < rec.nextTryAt;
  if ((fresh && !force) || throttled || (backingOff && !force)) return rec;
  if (inflight.has(src.id)) return inflight.get(src.id);
  const p = (async () => {
    const next = { ...(rec || {}), lastAttempt: Date.now() };
    try {
      const r = await politeFetch(x, src.url, src.minGapMs);
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const items = src.special === 'jp' ? await parseJpRss(r.text) : await parseRss(r.text, src);
      // Don't overwrite last good items with an empty successful fetch
      if (src.special !== 'jp' && Array.isArray(items) && items.length === 0 && rec?.items?.length) {
        next.emptyStreak = (rec.emptyStreak || 0) + 1;
        if (next.emptyStreak < 3 && Date.now() - (rec.fetchedAt || 0) < 86400000) {
          next.error = 'empty response (kept previous copy)';
          next.fetchedAt = Date.now();
          next.fails = 0; delete next.nextTryAt;
        } else {
          next.items = items; next.fetchedAt = Date.now(); next.error = null; next.emptyStreak = next.emptyStreak;
          next.fails = 0; delete next.nextTryAt;
        }
      } else {
        next.items = items; next.fetchedAt = Date.now(); next.error = null; next.emptyStreak = 0;
        next.fails = 0; delete next.nextTryAt;
      }
    } catch (e) {
      next.error = (e.name === 'AbortError' ? 'timeout' : e.message);
      next.fails = (rec?.fails || 0) + 1;
      // Normal cap = the source's TTL; a source that has failed 12+ times in a row (e.g. a site blocking us for days)
      // is retried at most every 6 h, which spares both the publisher and our KV write budget.
      const cap = next.fails >= 12 ? Math.max(src.ttlMin, 360) * 60000 : src.ttlMin * 60000;
      const backoff = next.fails >= 12 ? cap : Math.min(cap, 5 * 60000 * 2 ** Math.min(next.fails - 1, 6));
      next.nextTryAt = Date.now() + backoff;
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
  if (!rec) state = 'pending';
  else if (!rec.fetchedAt && rec.error) state = 'error';
  else if (rec.error && (!all.length || rec.error.startsWith('empty'))) state = rec.error.startsWith('empty') ? 'cached' : 'cached';
  else if (rec.error) state = 'cached';
  else if (all.length === 0) state = 'empty';
  else if (vis.length === 0) state = 'stale';
  else if (rec.fetchedAt && Date.now() - rec.fetchedAt > 3 * src.ttlMin * 60000) state = 'stale';
  else state = 'ok';
  return { id: src.id, name: src.name, org: src.org, category: src.category, url: src.url, home: src.home, terms: src.terms,
    state, lastOk: rec?.fetchedAt ? new Date(rec.fetchedAt).toISOString() : null, lastAttempt: rec?.lastAttempt ? new Date(rec.lastAttempt).toISOString() : null,
    error: rec?.error || null, itemsFetched: all.length, itemsShown: vis.length, newestItem: newest,
    fails: rec?.fails || 0, nextTryAt: rec?.nextTryAt ? new Date(rec.nextTryAt).toISOString() : null };
}

export async function parseJpRss(xml) {
  const out = { unreached: null, fact: null, scripture: null };
  let entries = rssItems(xml);
  if (!entries) entries = arr(parser.parse(xml).rss?.channel?.item);
  for (const it of entries) {
    const t = toText(it.title), desc = String(it.description || '');
    const link = String(it.link || '');
    if (!/^https?:\/\//.test(link) && link) continue;
    if (/^Unreached of the Day/i.test(t)) {
      const f = {};
      for (const line of desc.replace(/<!\[CDATA\[|\]\]>/g, '').split(/<br\s*\/?>/i)) {
        const m = line.match(/^\s*([^:]+):\s*(.*?)\s*$/); if (m) f[m[1].trim().toLowerCase()] = toText(m[2]);
      }
      const c = byName(f['country name']);
      out.unreached = { title: t.replace(/^Unreached of the Day:\s*/i, ''), link, peopleName: f['people name'], country: f['country name'], iso2: c?.iso2 || null,
        population: f['population'], language: f['primary language'], religion: f['primary religion'], evangelicalPct: f['% evangelical'], status: f['status'], photo: it['media:thumbnail'] || null, published: it.pubDate ? new Date(it.pubDate).toISOString() : null };
    } else if (/Mission Fact/i.test(t)) out.fact = { text: toText(desc), link };
    else if (/Mission Scripture/i.test(t)) out.scripture = { text: toText(desc), link, version: 'ESV' };
  }
  if (!out.unreached) throw new Error('no Unreached of the Day item in feed');
  return out;
}
export const JP_SRC = { ...JP, special: 'jp' };

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

// Cap on-demand IMB tag fetches: only WWL countries + daily counter
const IMB_TAG_DAILY_CAP = 40;
export async function imbCountryFeed(x, country) {
  const slug = country.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = 'imbtag-' + slug;
  const src = { id, name: 'IMB stories tagged "' + country.name + '"', org: 'IMB', category: 'missions', ttlMin: 360, minGapMs: 10000, maxAgeDays: 800,
    url: `https://www.imb.org/tag/${slug}/feed/`, home: `https://www.imb.org/tag/${slug}/`, terms: 'IMB tag feed (WordPress), on demand, cached 6 h, 10 s spacing.' };
  const rec = await loadRec(x, id);
  if (rec && rec.fetchedAt && Date.now() - rec.fetchedAt < src.ttlMin * 60000) return rec.items || [];
  if (rec && rec.lastAttempt && Date.now() - rec.lastAttempt < 600000) return rec.items || [];
  // Prefer serving cache; only fetch if WWL-listed or never fetched
  const { wwlByIso } = await import('./geo.js');
  if (!wwlByIso[country.iso2] && rec?.items) return rec.items;
  // Daily counter rides inside meta:gaps (written anyway after an imb.org fetch) instead of its own key.
  const day = today();
  const g = await loadGaps(x);
  const [cd, cn] = String(g['#imb'] || '').split('|');
  const n = cd === day ? (+cn || 0) : 0;
  if (n >= IMB_TAG_DAILY_CAP) return rec?.items || [];
  const next = { ...(rec || {}), lastAttempt: Date.now() };
  try {
    const r = await politeFetch(x, src.url, src.minGapMs);
    if (r.status === 404) { next.items = []; next.fetchedAt = Date.now(); await saveRec(x, id, next, 7 * 86400); }
    else if (r.status !== 200) throw new Error('HTTP ' + r.status);
    else { next.items = (await parseRss(r.text, { ...src, id: 'imb', excerpt: true })).slice(0, 8); next.fetchedAt = Date.now(); await saveRec(x, id, next, 14 * 86400); }
    x.gaps['#imb'] = day + '|' + (n + 1); x.gapsDirty = true;
  } catch (e) { next.error = e.message; await saveRec(x, id, next, 14 * 86400); }
  await flushGaps(x);
  return next.items || [];
}

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
  if (!items.length && !country) {
    items = sample.items(cat === 'all' ? 'persecution' : cat); example = true;
  }
  return { items, statuses, example };
}
function jpStatus(rec) {
  const base = statusOf({ ...JP_SRC }, null);
  if (!rec) { base.state = 'pending'; return base; }
  base.state = rec.items ? (rec.error ? 'cached' : (rec.fetchedAt && Date.now() - rec.fetchedAt > 3 * JP.ttlMin * 60000 ? 'stale' : 'ok')) : (rec.error ? 'error' : 'pending');
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

export async function refreshAll(x, { force = false, maxSources = Infinity } = {}) {
  const all = [...SOURCES, JP_SRC];
  const recs = await Promise.all(all.map(s => loadRec(x, s.id, { fresh: true })));
  const now = Date.now();
  const due = all.map((s, i) => {
    const r = recs[i];
    const age = r && r.fetchedAt ? now - r.fetchedAt : Infinity;
    const recentTry = r && r.lastAttempt && now - r.lastAttempt < 120000;
    const backingOff = r && r.nextTryAt && now < r.nextTryAt;
    const skip = recentTry || backingOff || (!force && age < s.ttlMin * 60000);
    // Prefer due sources that are not backing off; tiebreak by time since lastAttempt so recently-tried go to the back
    const lastTry = r?.lastAttempt || 0;
    return { s, overdue: age / (s.ttlMin * 60000), skip, lastTry };
  }).filter(d => !d.skip).sort((a, b) => b.overdue - a.overdue || a.lastTry - b.lastTry).slice(0, maxSources);
  const done = [];
  try {
    for (const d of due) { await refreshSource(x, d.s, { force }); done.push(d.s.id); }
  } finally { await flushGaps(x); }
  return done;
}
export { SOURCES };
