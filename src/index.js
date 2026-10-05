// Cloudflare Worker entry: /api/* + Cron Trigger.
import * as feeds from './feeds.js';
import { makeX, flushGaps } from './feeds.js';
import { countries, wwlByIso, wwlFile } from './geo.js';

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex',
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; worker-src 'self'; manifest-src 'self'; img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};
const CACHE_HDR = { 'Cache-Control': 'public, s-maxage=60, max-age=30' };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SEC_HEADERS, ...extra } });

const dayIndex = s => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  try { return new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s; } catch { return false; }
}
function localDate(env) {
  try { return new Date().toLocaleDateString('en-CA', { timeZone: env.TZ || 'America/Chicago' }); }
  catch { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); }
}
const slugify = n => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const ba = enc.encode(a), bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < ba.length; i++) out |= ba[i] ^ bb[i];
  return out === 0;
}

const PERSECUTION_PROMPTS = [
  { text: 'Pray for boldness and endurance for believers who face pressure, violence or imprisonment because of their faith.', ref: 'Ephesians 6:19-20' },
  { text: 'Pray for those imprisoned for their faith, and for their families left behind.', ref: 'Hebrews 13:3' },
  { text: 'Pray for the salvation of persecutors, and for kings and all in authority over the church.', ref: '1 Timothy 2:1-4' },
  { text: 'Pray that the word of the Lord would spread rapidly and be honored, and that pastors and leaders would be protected.', ref: '2 Thessalonians 3:1-2' },
  { text: 'Pray for provision, healing and comfort for families who have lost homes, jobs or loved ones.', ref: '2 Corinthians 1:3-4' },
  { text: 'Give thanks that Christ is building His church and the gates of hell will not prevail against it.', ref: 'Matthew 16:18' },
  { text: 'Give thanks for the perseverance of believers who endure, and pray that their witness would draw many to Christ.', ref: 'James 1:2-4' },
];
const MISSIONS_PROMPTS = [
  { text: 'Pray that the Lord of the harvest would send out more workers.', ref: 'Matthew 9:37-38' },
  { text: 'Pray that God would open a door for the message, and that workers would speak it clearly.', ref: 'Colossians 4:3-4' },
  { text: 'Pray for local believers and church planters to be strengthened and to multiply.', ref: '2 Timothy 2:2' },
  { text: 'Pray for safety, health, family unity and endurance for missionary families serving in or near this country.', ref: 'Psalm 121; 2 Thessalonians 3:3' },
];

function clampLimit(q) {
  const n = Math.floor(+q.get('limit') || 40);
  if (!Number.isFinite(n)) return 40;
  return Math.max(1, Math.min(n, 100));
}

async function cachedJson(request, build, sMaxAge = 60) {
  const cache = caches.default;
  const key = new Request(request.url, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const body = await build();
  const res = json(body, 200, { 'Cache-Control': `public, s-maxage=${sMaxAge}, max-age=${Math.min(30, sMaxAge)}` });
  try { await cache.put(key, res.clone()); } catch {}
  return res;
}

async function apiFeeds(x, q) {
  const cat = ['all', 'persecution', 'missions', 'sbc'].includes(q.get('cat')) ? q.get('cat') : 'all';
  const country = /^[A-Z]{2}$/.test(q.get('country') || '') ? q.get('country') : null;
  const limit = clampLimit(q);
  const r = await feeds.getFeedItems(x, { cat, country });
  return { cat, country, count: r.items.length, example: r.example, items: r.items.slice(0, limit), statuses: r.statuses, fetchedAt: new Date().toISOString(),
    note: 'Country tags are keyword matches on title/tags/excerpt (heuristic).' };
}

async function apiMap(x) {
  const [p, m, s, jp] = await Promise.all([feeds.getFeedItems(x, { cat: 'persecution' }), feeds.getFeedItems(x, { cat: 'missions' }), feeds.getFeedItems(x, { cat: 'sbc' }), feeds.getJp(x)]);
  const tally = {};
  for (const [key, r] of [['persecution', p], ['missions', m], ['sbc', s]]) {
    if (r.example) continue;
    for (const it of r.items) for (const c of it.countries) { (tally[c] ||= { persecution: 0, missions: 0, sbc: 0 })[key]++; }
  }
  return { tally, unreached: jp.data?.unreached || null };
}

async function apiToday(x, q) {
  const date = validDate(q.get('date')) ? q.get('date') : localDate(x.env);
  const di = dayIndex(date);
  const [p, m, jp] = await Promise.all([feeds.getFeedItems(x, { cat: 'persecution' }), feeds.getFeedItems(x, { cat: 'missions' }), feeds.getJp(x)]);
  const wl = wwlFile.countries;
  const wc = wl[((di % wl.length) + wl.length) % wl.length];
  const pick = (a) => (a.length ? a[((di % a.length) + a.length) % a.length] : null);
  const wcNews = p.example ? [] : p.items.filter(i => i.countries.includes(wc.iso2)).slice(0, 3);
  const extras = jp.data?.unreached ? await feeds.jpApiExtras(x, date) : null;
  // Prefer today's IMB prayer request for missions slot
  const prayerItems = m.example ? [] : m.items.filter(i => i.source === 'imbprayer' && i.published && i.published.slice(0, 10) === date);
  const missionsStory = prayerItems.length ? prayerItems[di % prayerItems.length] : (m.example ? null : pick(m.items.filter(i => i.source !== 'imbprayer').concat(m.items.filter(i => i.source === 'imbprayer'))));
  return { date, serverDate: localDate(x.env), timezone: x.env.TZ || 'America/Chicago',
    rotation: `Deterministic by date: WWL country = rank ((dayNumber mod ${wl.length})+1); stories = index (dayNumber mod itemCount).`,
    persecutedCountry: { ...wc, name: countries[wc.iso2]?.name || wc.country, lat: countries[wc.iso2]?.lat, lng: countries[wc.iso2]?.lng, news: wcNews, prompts: [PERSECUTION_PROMPTS[di % PERSECUTION_PROMPTS.length]] },
    persecutionStory: p.example ? null : pick(p.items), missionsStory,
    unreached: jp.data?.unreached ? { ...jp.data.unreached, apiExtras: extras } : null, scripture: jp.data?.scripture || null, fact: jp.data?.fact || null,
    jpStatus: jp.status, examples: { persecution: p.example, missions: m.example } };
}

async function apiCountry(x, iso) {
  const iso2 = (iso || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso2)) return { __status: 400, error: 'invalid country code' };
  const c = countries[iso2];
  if (!c) return { __status: 404, error: 'unknown country code' };
  const [all, jp] = await Promise.all([feeds.getFeedItems(x, { cat: 'all', country: iso2 }), feeds.getJp(x)]);
  const w = wwlByIso[iso2] || null;
  return {
    country: { iso2, name: c.name, lat: c.lat, lng: c.lng, continent: c.continent || null, subregion: c.subregion || null },
    wwl: w ? { ...w, listName: wwlFile.list, source: 'https://www.opendoors.org/research-reports/wwl-documentation/', attribution: '© Open Doors International' } : { listed: false, note: 'Not in the Open Doors WWL 2026 list of countries scoring 50+ (ranks 1–75).' },
    news: all.items.slice(0, 12),
    unreachedToday: jp.data?.unreached?.iso2 === iso2 ? jp.data.unreached : null,
    prompts: (w ? PERSECUTION_PROMPTS : []).concat(MISSIONS_PROMPTS).slice(0, 6), promptsNote: 'Generic prayer prompts with Scripture references; not country-specific facts.',
    links: [
      { label: 'Joshua Project — country page', url: c.fips ? `https://joshuaproject.net/countries/${c.fips}` : 'https://joshuaproject.net/countries' },
      { label: 'Prayercast — country prayer videos', url: `https://prayercast.com/prayer-topic/${slugify(c.name)}/` },
      { label: 'Open Doors — World Watch List', url: 'https://www.opendoors.org/persecution/countries/' },
      { label: 'Operation World prayer calendar', url: 'https://operationworld.org/prayer-calendar/' },
      { label: 'IMB — pray', url: 'https://www.imb.org/pray/' },
      { label: 'NAMB — pray', url: 'https://www.namb.net/resources/pray/' },
    ],
  };
}

async function apiCountryImb(x, iso, request) {
  const iso2 = (iso || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso2)) return json({ error: 'invalid country code' }, 400);
  const c = countries[iso2];
  if (!c) return json({ error: 'unknown country code' }, 404);
  // Edge-cache per country for 10 min
  const cache = caches.default;
  const key = new Request(new URL(request.url).origin + '/api/country/' + iso2 + '/imb', { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const have = new Set((await feeds.getFeedItems(x, { cat: 'all', country: iso2 })).items.map(i => i.link));
  const imb = await feeds.imbCountryFeed(x, c);
  const body = { iso2, stories: imb.filter(i => !have.has(i.link)).slice(0, 6) };
  const res = json(body, 200, { 'Cache-Control': 'public, s-maxage=600, max-age=60' });
  try { await cache.put(key, res.clone()); } catch {}
  return res;
}

async function apiSources(x) {
  return {
    sources: await feeds.allStatuses(x),
    attribution: {
      openDoors: { text: '© Open Doors International', url: 'https://www.opendoors.org/research-reports/wwl-documentation/', note: 'World Watch List 2026; reporting period 1 Oct 2024 – 30 Sep 2025; non-commercial church use; not endorsed by Open Doors.' },
      joshuaProject: { text: 'Data provided by Joshua Project', url: 'https://joshuaproject.net/' },
      imb: { text: '© International Mission Board — CC BY-NC 4.0 — excerpts abridged', url: 'https://creativecommons.org/licenses/by-nc/4.0/' },
      morningStar: { text: 'Morning Star News — CC BY 3.0 US', url: 'https://creativecommons.org/licenses/by/3.0/us/' },
      icc: { text: 'ICC (International Christian Concern) · www.persecution.org', url: 'https://www.persecution.org/' },
      esv: { text: 'Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.', url: 'https://www.crossway.org/permissions/' },
      map: ['© OpenStreetMap contributors (tiles)', 'Natural Earth (public domain) boundaries', 'Leaflet (BSD-2)'],
    },
  };
}

async function apiRefresh(request, x) {
  const token = x.env.REFRESH_TOKEN;
  if (!token) return json({ error: 'refresh disabled (no REFRESH_TOKEN configured)' }, 503);
  const hdr = request.headers.get('Authorization') || '';
  const provided = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : (request.headers.get('X-Refresh-Token') || '');
  if (!timingSafeEqual(provided, token)) return json({ error: 'unauthorized' }, 401);
  // Reject obvious cross-site CSRF for browser callers
  const site = request.headers.get('Sec-Fetch-Site');
  if (site === 'cross-site') return json({ error: 'forbidden' }, 403);
  const last = +(await x.env.CACHE.get('meta:lastRefresh')) || 0;
  const wait = 60000 - (Date.now() - last);
  if (wait > 0) return json({ error: 'refresh throttled', retryAfterSec: Math.ceil(wait / 1000), statuses: await feeds.allStatuses(x) }, 429);
  try { await x.env.CACHE.put('meta:lastRefresh', String(Date.now()), { expirationTtl: 300 }); } catch {}
  const max = +x.env.REFRESH_MAX_SOURCES || 2;
  const refreshed = await feeds.refreshAll(x, { force: true, maxSources: max });
  return json({ ok: true, refreshedAt: new Date().toISOString(), refreshed, statuses: await feeds.allStatuses(x) });
}

function safeIsoFromPath(raw) {
  try {
    const d = decodeURIComponent(raw || '');
    if (!/^[A-Za-z]{2}$/.test(d)) return null;
    return d.toUpperCase();
  } catch { return null; }
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const q = url.searchParams;
  const m = request.method === 'HEAD' ? 'GET' : request.method;
  const x = makeX(env, ctx);
  let mm;
  if (m === 'GET') {
    if (path === '/api/health') return json({ ok: true, time: new Date().toISOString() });
    if (path === '/api/countries') {
      return cachedJson(request, async () => ({
        countries: Object.values(countries).map(c => ({ iso2: c.iso2, name: c.name, lat: c.lat, lng: c.lng, hasPolygon: c.hasPolygon, wwl: wwlByIso[c.iso2] || null })).sort((a, b) => a.name.localeCompare(b.name)),
      }), 3600);
    }
    if (path === '/api/geojson') {
      const r = await env.ASSETS.fetch(new Request(new URL('/data/countries.geojson', url).toString()));
      return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400', ...SEC_HEADERS } });
    }
    if (path === '/api/wwl') return json(wwlFile, 200, CACHE_HDR);
    if (path === '/api/feeds') return cachedJson(request, () => apiFeeds(x, q), 60);
    if (path === '/api/map') return cachedJson(request, () => apiMap(x), 60);
    if (path === '/api/today') return cachedJson(request, () => apiToday(x, q), 60);
    if ((mm = path.match(/^\/api\/country\/([^/]+)\/imb$/))) {
      const iso = safeIsoFromPath(mm[1]);
      if (!iso) return json({ error: 'invalid country code' }, 400);
      return apiCountryImb(x, iso, request);
    }
    if ((mm = path.match(/^\/api\/country\/([^/]+)$/))) {
      const iso = safeIsoFromPath(mm[1]);
      if (!iso) return json({ error: 'invalid country code' }, 400);
      const body = await apiCountry(x, iso);
      if (body.__status) return json({ error: body.error }, body.__status);
      return json(body, 200, CACHE_HDR);
    }
    if (path === '/api/sources') return cachedJson(request, () => apiSources(x), 60);
  }
  if (m === 'POST' && path === '/api/refresh') return apiRefresh(request, x);
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api')) {
        const res = await env.ASSETS.fetch(request);
        const headers = new Headers(res.headers);
        for (const [k, v] of Object.entries(SEC_HEADERS)) headers.set(k, v);
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      }
      return await handle(request, env, ctx);
    } catch (e) {
      console.error(e);
      return json({ error: 'internal error' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    const x = makeX(env, ctx);
    const max = +env.CRON_MAX_SOURCES || 1;
    try {
      const done = await feeds.refreshAll(x, { force: false, maxSources: max });
      console.log('cron refreshed:', done.join(',') || '(nothing due)');
    } catch (e) {
      console.error('cron failed', e.message);
      throw e;
    }
  },
};
