// Source registry. Public RSS/Atom feeds; items shown as headline (+ optional short excerpt) + link.
export const UA_BASE = 'SBCPrayerConsole/0.1 (church prayer tool; headline+link syndication; CONTACT_URL unset)';
export const userAgent = env => (env && env.CONTACT_URL
  ? `SBCPrayerConsole/0.1 (church prayer tool; headline+link syndication; contact: ${env.CONTACT_URL})`
  : UA_BASE);

export const SOURCES = [
  { id: 'imbprayer', name: "IMB Today's Prayer Requests", org: 'IMB', category: 'missions', featured: true,
    url: 'https://www.imb.org/feed/?post_type=prayer', home: 'https://www.imb.org/pray/',
    ttlMin: 360, minGapMs: 10000, maxAgeDays: 14, dateOnly: true, stripEmails: true, excerpt: true,
    terms: 'Public WordPress RSS (post_type=prayer). CC BY-NC 4.0 — © International Mission Board; excerpts abridged. Crawl-delay: 10 honored. Date-only pubDates treated as calendar dates (no TZ shift).' },
  { id: 'imb', name: 'IMB (International Mission Board)', org: 'IMB', category: 'missions',
    url: 'https://www.imb.org/feed/', home: 'https://www.imb.org/', ttlMin: 60, minGapMs: 10000, maxAgeDays: 400, excerpt: true,
    terms: 'Public WordPress RSS. © International Mission Board — CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/) — excerpts abridged. Crawl-delay: 10 honored.' },
  { id: 'namb', name: 'NAMB (North American Mission Board)', org: 'NAMB', category: 'missions',
    url: 'https://www.namb.net/feed/?post_type=news', home: 'https://www.namb.net/', ttlMin: 60, minGapMs: 10000, maxAgeDays: 400, excerpt: false,
    terms: 'Public WordPress RSS (?post_type=news). Headline+link only (NAMB IP licence is personal non-commercial display). Crawl-delay: 10 honored.' },
  { id: 'nambguide', name: 'NAMB Prayer Guides', org: 'NAMB', category: 'missions',
    url: 'https://www.namb.net/feed/?post_type=guide', home: 'https://www.namb.net/resources/pray/', ttlMin: 180, minGapMs: 10000, maxAgeDays: 800, excerpt: false,
    terms: 'Public WordPress RSS (?post_type=guide). Headline+link only. Includes Annie Armstrong / chaplaincy prayer guides.' },
  { id: 'bp', name: 'Baptist Press (SBC news)', org: 'Baptist Press', category: 'sbc',
    url: 'https://www.baptistpress.com/resource-library/feed/', home: 'https://www.baptistpress.com/',
    ttlMin: 30, minGapMs: 5000, maxAgeDays: 400, excerpt: false, include: '/resource-library/news/',
    terms: 'Public resource-library RSS; filtered to /resource-library/news/. Headline+link only.' },
  { id: 'sbcnet', name: 'SBC.net (Cooperative Program stories)', org: 'Southern Baptist Convention', category: 'sbc',
    url: 'https://www.sbc.net/resource-library/feed/', home: 'https://www.sbc.net/', ttlMin: 120, minGapMs: 4000, maxAgeDays: 400, excerpt: true,
    terms: 'Public resource-library RSS (52 Sundays / CP missionary stories). Headline+excerpt+link.' },
  { id: 'icc', name: 'ICC (International Christian Concern)', org: 'ICC', category: 'persecution',
    url: 'https://persecution.org/feed/', home: 'https://www.persecution.org/', ttlMin: 30, minGapMs: 10000, maxAgeDays: 120, excerpt: true,
    terms: 'Public WordPress RSS; Crawl-delay: 10. Free to disseminate with credit: ICC (International Christian Concern) · www.persecution.org.' },
  { id: 'morningstar', name: 'Morning Star News', org: 'Morning Star News', category: 'persecution',
    url: 'https://morningstarnews.org/feed/', home: 'https://morningstarnews.org/', ttlMin: 30, minGapMs: 5000, maxAgeDays: 120, excerpt: true,
    terms: 'Public WordPress RSS. Licensed CC BY 3.0 US (https://creativecommons.org/licenses/by/3.0/us/) — credit Morning Star News.' },
  { id: 'release', name: 'Voice of Persecuted Christians (formerly Release International)', org: 'Voice of Persecuted Christians', category: 'persecution',
    url: 'https://voiceofpersecutedchristians.org/feed/', home: 'https://voiceofpersecutedchristians.org/',
    ttlMin: 120, minGapMs: 5000, maxAgeDays: 400, excerpt: false,
    terms: 'Public RSS. Headline+link only (terms permit church magazine/bulletin reproduction with acknowledgement). Formerly Release International.' },
];

export const JP = { id: 'jp', name: 'Joshua Project (Unreached of the Day)', org: 'Joshua Project', category: 'prayer',
  url: 'https://joshuaproject.net/rss', home: 'https://joshuaproject.net/', ttlMin: 180, minGapMs: 5000,
  terms: 'Public RSS. Required attribution: "Data provided by Joshua Project" with hyperlink. Non-commercial; do not replicate their site. Optional JP_API_KEY enables richer fields.' };
