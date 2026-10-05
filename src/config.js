// Source registry (ported verbatim from the Express app). Every entry is a public RSS/Atom feed that the
// publisher exposes for syndication. Items are shown as headline + short excerpt + link back (never full text).
export const UA_BASE = 'SBCPrayerConsole/0.1 (church prayer tool; headline+link syndication; contact via CONTACT_URL env)';
// Descriptive User-Agent. If you set CONTACT_URL in wrangler.toml [vars] it is appended so publishers can reach you.
export const userAgent = env => (env && env.CONTACT_URL ? `SBCPrayerConsole/0.1 (church prayer tool; headline+link syndication; contact: ${env.CONTACT_URL})` : UA_BASE);

export const SOURCES = [
  { id: 'imb', name: 'IMB (International Mission Board)', org: 'IMB', category: 'missions',
    url: 'https://www.imb.org/feed/', home: 'https://www.imb.org/', ttlMin: 60, minGapMs: 10000, maxAgeDays: 400,
    terms: 'Public WordPress RSS. robots.txt sets Crawl-delay: 10 (honored: >=10 s between IMB requests, 60 min cache). Headline/excerpt/link only.' },
  { id: 'namb', name: 'NAMB (North American Mission Board)', org: 'NAMB', category: 'missions',
    url: 'https://www.namb.net/feed/', home: 'https://www.namb.net/', ttlMin: 60, minGapMs: 10000, maxAgeDays: 400,
    terms: 'Public WordPress RSS; robots.txt Crawl-delay: 10 (honored). NOTE: on 2026-10-04 the feed returned a valid channel with zero items.' },
  { id: 'bp', name: 'Baptist Press (SBC news)', org: 'Baptist Press', category: 'sbc',
    url: 'https://www.baptistpress.com/feed/', home: 'https://www.baptistpress.com/', ttlMin: 30, minGapMs: 5000, maxAgeDays: 400,
    terms: 'Public WordPress RSS. NOTE: on 2026-10-04 the feed returned a valid channel with zero items, and the WP-JSON API sits behind a Cloudflare challenge (not bypassed).' },
  { id: 'sbcnet', name: 'SBC.net (Convention news/statements)', org: 'Southern Baptist Convention', category: 'sbc',
    url: 'https://www.sbc.net/feed/', home: 'https://www.sbc.net/', ttlMin: 120, minGapMs: 4000, maxAgeDays: 400,
    terms: 'Public WordPress RSS. The feed currently only exposes items dated 2022, which are treated as stale and hidden.' },
  { id: 'icc', name: 'International Christian Concern', org: 'ICC', category: 'persecution',
    url: 'https://persecution.org/feed/', home: 'https://persecution.org/', ttlMin: 30, minGapMs: 10000, maxAgeDays: 120,
    terms: 'Public WordPress RSS; robots.txt Crawl-delay: 10 (honored). Headline/excerpt/link only.' },
  { id: 'morningstar', name: 'Morning Star News', org: 'Morning Star News', category: 'persecution',
    url: 'https://morningstarnews.org/feed/', home: 'https://morningstarnews.org/', ttlMin: 30, minGapMs: 5000, maxAgeDays: 120,
    terms: 'Public WordPress RSS; robots.txt allows. Headline/excerpt/link only.' },
  { id: 'release', name: 'Release International', org: 'Release International', category: 'persecution',
    url: 'https://releaseinternational.org/feed/', home: 'https://releaseinternational.org/', ttlMin: 120, minGapMs: 5000, maxAgeDays: 400,
    terms: 'Public WordPress RSS. Low posting frequency (newest item June 2026 when tested).' },
];

export const JP = { id: 'jp', name: 'Joshua Project (Unreached of the Day)', org: 'Joshua Project', category: 'prayer',
  url: 'https://joshuaproject.net/rss', home: 'https://joshuaproject.net/', ttlMin: 180, minGapMs: 5000,
  terms: 'Public RSS (no key). Terms: show "Data provided by Joshua Project" with a link; non-commercial; do not replicate their site. Optional JP_API_KEY enables richer fields.' };
