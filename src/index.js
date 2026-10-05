// Cloudflare Worker entry: same /api/* surface as the Express server (server/index.js).
// Static front end (public/) is served by Workers static assets; this script only runs for /api/* (run_worker_first)
// and for the Cron Trigger.
import * as feeds from './feeds.js';
import { makeX, flushGaps } from './feeds.js';
import { countries, wwlByIso, wwlFile } from './geo.js';

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'",
};
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SEC_HEADERS, ...extra } });

const dayIndex = s => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s));
const localDate = env => new Date().toLocaleDateString('en-CA', { timeZone: env.TZ || 'America/Chicago' });
const slugify = n => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const PERSECUTION_PROMPTS = [
  { text: 'Pray for boldness and endurance for believers who face pressure, violence or imprisonment because of their faith.', ref: 'Ephesians 6:19-20' },
  { text: 'Pray for those imprisoned for their faith, and for their families left behind.', ref: 'Hebrews 13:3' },
  { text: 'Pray for the salvation of persecutors and for officials with power over the church.', ref: 'Matthew 5:44' },
  { text: 'Pray that the word of the Lord would spread rapidly and be honored, and that pastors and leaders would be protected.', ref: '2 Thessalonians 3:1-2' },
  { text: 'Pray for provision, healing and comfort for families who have lost homes, jobs or loved ones.', ref: '2 Corinthians 1:3-4' },
];
const MISSIONS_PROMPTS = [
  { text: 'Pray that the Lord of the harvest would send out more workers.', ref: 'Matthew 9:37-38' },
  { text: 'Pray that God would open a door for the message, and that workers would speak it clearly.', ref: 'Colossians 4:3-4' },
  { text: 'Pray for local believers and church planters to be strengthened and to multiply.', ref: '2 Timothy 2:2' },
  { text: 'Pray for safety, health, family unity and endurance for missionary families serving here.', ref: 'Philippians 4:6-7' },
];

// ---------- route handlers (x = { env, ctx, gaps }) ----------
async function apiFeeds(x, q) {
  const cat = ['all', 'persecution', 'missions', 'sbc'].includes(q.get('cat')) ? q.get('cat') : 'all';
  const country = /^[A-Z]{2}$/.test(q.get('country') || '') ? q.get('country') : null;
  const limit = Math.min(+q.get('limit') || 40, 100);
  const r = await feeds.getFeedItems(x, { cat, country });
  return json({ cat, country, count: r.items.length, example: r.example, items: r.items.slice(0, limit), statuses: r.statuses, fetchedAt: new Date().toISOString(),
    note: 'Country tags are keyword matches on title/tags/excerpt (heuristic).' });
}

async function apiMap(x) {
  const [p, m, s, jp] = await Promise.all([feeds.getFeedItems(x, { cat: 'persecution' }), feeds.getFeedItems(x, { cat: 'missions' }), feeds.getFeedItems(x, { cat: 'sbc' }), feeds.getJp(x)]);
  const tally = {};
  for (const [key, r] of [['persecution', p], ['missions', m], ['sbc', s]]) {
    if (r.example) continue;
    for (const it of r.items) for (const c of it.countries) { (tally[c] ||= { persecution: 0, missions: 0, sbc: 0 })[key]++; }
  }
  return json({ tally, unreached: jp.data?.unreached || null });
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
  return json({ date, rotation: 'Deterministic by date: World Watch List country = rank ((dayNumber mod 50)+1); stories = index (dayNumber mod itemCount).',
    persecutedCountry: { ...wc, name: countries[wc.iso2]?.name || wc.country, lat: countries[wc.iso2]?.lat, lng: countries[wc.iso2]?.lng, news: wcNews, prompts: [PERSECUTION_PROMPTS[di % PERSECUTION_PROMPTS.length]] },
    persecutionStory: p.example ? null : pick(p.items), missionsStory: m.example ? null : pick(m.items),
    unreached: jp.data?.unreached ? { ...jp.data.unreached, apiExtras: extras } : null, scripture: jp.data?.scripture || null, fact: jp.data?.fact || null,
    jpStatus: jp.status, examples: { persecution: p.example, missions: m.example } });
}

async function apiCountry(x, iso) {
  const iso2 = (iso || '').toUpperCase();
  const c = countries[iso2];
  if (!c) return json({ error: 'unknown country code' }, 404);
  const [all, jp] = await Promise.all([feeds.getFeedItems(x, { cat: 'all', country: iso2 }), feeds.getJp(x)]);
  const w = wwlByIso[iso2] || null;
  return json({
    country: { iso2, name: c.name, lat: c.lat, lng: c.lng, continent: c.continent || null, subregion: c.subregion || null },
    wwl: w ? { ...w, listName: wwlFile.list, source: 'https://www.opendoors.org/persecution/countries/' } : { listed: false, note: 'Not in the Open Doors WWL 2026 top 50 (this app only carries ranks 1-50).' },
    news: all.items.slice(0, 12),
    unreachedToday: jp.data?.unreached?.iso2 === iso2 ? jp.data.unreached : null,
    prompts: (w ? PERSECUTION_PROMPTS : []).concat(MISSIONS_PROMPTS).slice(0, 6), promptsNote: 'Generic prayer prompts with Scripture references; not country-specific facts.',
    links: [
      { label: 'Joshua Project — country page', url: c.fips ? `https://joshuaproject.net/countries/${c.fips}` : 'https://joshuaproject.net/countries' },
      { label: 'Prayercast — country prayer videos', url: `https://prayercast.com/prayer-topic/${slugify(c.name)}/` },
      { label: 'Open Doors — World Watch List countries', url: 'https://www.opendoors.org/persecution/countries/' },
      { label: 'Operation World', url: 'https://operationworld.org/' },
      { label: 'IMB — pray', url: 'https://www.imb.org/pray/' },
    ],
  });
}

// IMB per-country tag feed is fetched on demand (10 s politeness spacing makes it slow), so it has its own endpoint.
async function apiCountryImb(x, iso) {
  const iso2 = (iso || '').toUpperCase();
  const c = countries[iso2];
  if (!c) return json({ error: 'unknown country code' }, 404);
  const have = new Set((await feeds.getFeedItems(x, { cat: 'all', country: iso2 })).items.map(i => i.link));
  const imb = await feeds.imbCountryFeed(x, c);
  return json({ iso2, stories: imb.filter(i => !have.has(i.link)).slice(0, 6) });
}

async function apiSources(x) {
  return json({ sources: await feeds.allStatuses(x), attribution: { joshuaProject: { text: 'Data provided by Joshua Project', url: 'https://joshuaproject.net/' }, openDoors: { text: 'World Watch List 2026 © Open Doors International', url: 'https://www.opendoors.org/' }, map: ['© OpenStreetMap contributors (tiles)', 'Natural Earth (public domain) boundaries', 'Leaflet (BSD-2)'] } });
}

// Global refresh throttle (>=60 s) is kept in KV so it holds across isolates/colos.
async function apiRefresh(x) {
  const last = +(await x.env.CACHE.get('meta:lastRefresh')) || 0;
  const wait = 60000 - (Date.now() - last);
  if (wait > 0) return json({ error: 'refresh throttled', retryAfterSec: Math.ceil(wait / 1000), statuses: await feeds.allStatuses(x) }, 429);
  await x.env.CACHE.put('meta:lastRefresh', String(Date.now()), { expirationTtl: 300 });
  // Free tier allows 10 ms CPU per request, so a manual refresh handles the REFRESH_MAX_SOURCES most-overdue sources
  // (default 2; set higher on the Paid plan). The Cron Trigger does the routine work. Lower it if you see "exceeded CPU" errors.
  const max = +x.env.REFRESH_MAX_SOURCES || 2;
  const refreshed = await feeds.refreshAll(x, { force: true, maxSources: max });
  return json({ ok: true, refreshedAt: new Date().toISOString(), refreshed, statuses: await feeds.allStatuses(x) });
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const q = url.searchParams;
  const m = request.method === 'HEAD' ? 'GET' : request.method;
  const x = makeX(env, ctx);
  let mm;
  if (m === 'GET') {
    if (path === '/api/health') return json({ ok: true, time: new Date().toISOString(), jpApiKeyConfigured: !!env.JP_API_KEY });
    if (path === '/api/countries') return json({ countries: Object.values(countries).map(c => ({ iso2: c.iso2, name: c.name, lat: c.lat, lng: c.lng, hasPolygon: c.hasPolygon, wwl: wwlByIso[c.iso2] || null })).sort((a, b) => a.name.localeCompare(b.name)) });
    if (path === '/api/geojson') {
      // served from the static asset (public/data/countries.geojson) so the 200 KB file is never parsed in the Worker
      const r = await env.ASSETS.fetch(new Request(new URL('/data/countries.geojson', url).toString()));
      return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400', ...SEC_HEADERS } });
    }
    if (path === '/api/wwl') return json(wwlFile);
    if (path === '/api/feeds') return apiFeeds(x, q);
    if (path === '/api/map') return apiMap(x);
    if (path === '/api/today') return apiToday(x, q);
    if ((mm = path.match(/^\/api\/country\/([^/]+)\/imb$/))) return apiCountryImb(x, decodeURIComponent(mm[1]));
    if ((mm = path.match(/^\/api\/country\/([^/]+)$/))) return apiCountry(x, decodeURIComponent(mm[1]));
    if (path === '/api/sources') return apiSources(x);
  }
  if (m === 'POST' && path === '/api/refresh') return apiRefresh(x);
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api')) return env.ASSETS.fetch(request); // safety net; assets normally bypass the Worker
      return await handle(request, env, ctx);
    } catch (e) {
      console.error(e);
      return json({ error: 'internal error', detail: e.message }, 500);
    }
  },

  // Cron Trigger: refresh the most-overdue source(s) that are past their own TTL (30-180 min). CRON_MAX_SOURCES (default 1)
  // keeps each invocation inside the free plan's 10 ms CPU limit; the trigger runs often enough (every 5 min) that all
  // 8 sources stay within their TTLs. Running it more often than a TTL never causes extra upstream hits.
  async scheduled(event, env, ctx) {
    const x = makeX(env, ctx);
    const max = +env.CRON_MAX_SOURCES || 1;
    ctx.waitUntil((async () => {
      const done = await feeds.refreshAll(x, { force: false, maxSources: max });
      console.log('cron refreshed:', done.join(',') || '(nothing due)');
    })().catch(e => console.error('cron failed', e.message)));
  },
};
