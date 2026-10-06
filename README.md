# SBC Prayer Console - Cloudflare Worker edition

**Live app:** [https://sbc-prayer-console.sbc-prayer-061d970b.workers.dev](https://sbc-prayer-console.sbc-prayer-061d970b.workers.dev) (installable: Android/Chrome "Install app", iPhone Safari Share > Add to Home Screen)

Port of `sbc-prayer-console` (Express + Leaflet) to a Cloudflare Worker that fits the **Workers Free** plan.
Deploy steps are in **[DEPLOY.md](DEPLOY.md)**.

```
public/              static front end (unchanged from the Express app) + public/data/countries.geojson + _headers
src/index.js         Worker: /api/* routes + scheduled() (Cron Trigger)
src/feeds.js         polite fetcher, RSS parsing, KV cache/status, Joshua Project, IMB tag feeds
src/rss.js           lean regex RSS 2.0 item extractor (fast-xml-parser is the fallback for Atom)
src/geo.js           country table + keyword->country matching (same rules as server/geo.js)
src/config.js        source registry (add a feed = add one object)
src/sample.js        EXAMPLE placeholders (identical)
src/data/            wwl2026.json (identical), countries.json (slim table generated from the geojson)
scripts/             build-countries.mjs (npm run build:data), build_wwl.py (unchanged)
wrangler.toml        assets + KV binding (placeholder id) + cron + vars
```

Endpoints (same as Express): `GET /api/health, /countries, /geojson, /wwl, /feeds, /map, /today, /country/:iso2, /country/:iso2/imb, /sources` and `POST /api/refresh`.
Visitor data (church missionaries, prayer list, settings) stays in the browser's `localStorage`, exactly as before.

## How caching / politeness works
* State is in Workers KV (`CACHE`): one key per source (`src:<id>`), plus `meta:gaps` (per-host next-allowed-request times) and `meta:lastRefresh`.
* **Descriptive User-Agent** on every fetch (`SBCPrayerConsole/0.1 (church prayer tool; ...)`; set `CONTACT_URL` to append your contact).
* **TTLs** as before (IMB/NAMB 60 min, BP/ICC/Morning Star 30, SBC.net/Release 120/120, JP 180, IMB tag feeds 6 h). `Crawl-delay: 10` hosts (IMB, NAMB, ICC) are never requested twice within 10 s - across Worker isolates, via the KV `meta:gaps` record.
* `POST /api/refresh`: >= 60 s between refreshes (KV), >= 2 min per source.
* A **Cron Trigger** (every 5 min) refreshes the single most-overdue source that is past its TTL. Page views never fetch upstream, except a never-fetched source (empty KV) which is fetched once in the background.

## Local development
```bash
# Node >= 22 required by Wrangler 4
npm install
npx wrangler dev --test-scheduled        # http://localhost:8787 (local simulated KV; nothing is deployed, no login)
curl 'localhost:8787/__scheduled?cron=*/5+*+*+*+*'   # run the cron handler by hand
curl localhost:8787/api/sources
```
