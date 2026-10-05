// Country table + keyword->country matching (ported from server/geo.js).
// Differences from the Express version: the slim country table is pre-generated (src/data/countries.json, from
// public/data/countries.geojson) so no 200 KB GeoJSON parse is needed per request, and the ~400 matcher regexes are
// compiled lazily (only when a feed is being ingested). A cheap substring pre-check avoids running most regexes.
import wwlFile from './data/wwl2026.json';
import countryRows from './data/countries.json';

export { wwlFile };

const EXTRA = [
  { iso2: 'MV', name: 'Maldives', lat: 3.2, lng: 73.22 },
  { iso2: 'KM', name: 'Comoros', lat: -11.65, lng: 43.33 },
  { iso2: 'BH', name: 'Bahrain', lat: 26.07, lng: 50.55 },
  { iso2: 'SG', name: 'Singapore', lat: 1.35, lng: 103.82 },
  { iso2: 'MU', name: 'Mauritius', lat: -20.2, lng: 57.5 },
  { iso2: 'SC', name: 'Seychelles', lat: -4.68, lng: 55.49 },
  { iso2: 'MT', name: 'Malta', lat: 35.9, lng: 14.45 },
  { iso2: 'CV', name: 'Cape Verde', lat: 16.0, lng: -24.0 },
  { iso2: 'ST', name: 'São Tomé and Príncipe', lat: 0.19, lng: 6.61 },
  { iso2: 'HK', name: 'Hong Kong', lat: 22.32, lng: 114.17 },
];

export const wwlByIso = {};
for (const c of wwlFile.countries) wwlByIso[c.iso2] = c;

export const countries = {}; // iso2 -> {iso2,name,lat,lng,fips,continent,subregion,hasPolygon}
for (const c of countryRows) countries[c.iso2] = { ...c };
for (const e of EXTRA) if (!countries[e.iso2]) countries[e.iso2] = { iso2: e.iso2, name: e.name, lat: e.lat, lng: e.lng, fips: null, hasPolygon: false };
const DISPLAY = { CD: 'DR Congo', CF: 'Central African Republic', SS: 'South Sudan', TR: 'Turkey', CZ: 'Czechia', DO: 'Dominican Republic', BA: 'Bosnia and Herzegovina', GQ: 'Equatorial Guinea', SB: 'Solomon Islands', SZ: 'Eswatini', CI: "Côte d'Ivoire", TL: 'Timor-Leste', CG: 'Republic of the Congo', FK: 'Falkland Islands' };
for (const [k, v] of Object.entries(DISPLAY)) if (countries[k]) countries[k].name = v;

// ---- keyword -> country matching (heuristic; labelled as such in the UI) ----
const ALIASES = {
  US: [], // too noisy ("America", "United States" everywhere); US items are not auto-tagged
  CD: ['Democratic Republic of the Congo', 'Democratic Republic of Congo', 'D.R. Congo', 'DR Congo', 'DRC', 'Congolese'],
  CG: ['Republic of the Congo', 'Congo-Brazzaville'],
  CF: ['Central African Republic'], MM: ['Burma', 'Burmese'], TR: ['Türkiye', 'Turkiye', 'Turkish'], CI: ["Côte d'Ivoire", 'Ivory Coast'],
  PS: ['Palestinian', 'West Bank', 'Gaza'], KP: ['North Korea', 'North Korean'], KR: ['South Korea', 'South Korean', 'Seoul'],
  VN: ['Viet Nam', 'Vietnamese'], GB: ['United Kingdom', 'Britain', 'British'], AE: ['United Arab Emirates', 'UAE'],
  TL: ['East Timor'], SZ: ['Swaziland'], CZ: ['Czech Republic'], LA: ['Laotian'], PK: ['Pakistani'], CN: ['Chinese'], NG: ['Nigerian'],
  IN: ['Indian'], IR: ['Iranian'], IQ: ['Iraqi'], SY: ['Syrian'], AF: ['Afghan'], EG: ['Egyptian'], ET: ['Ethiopian'], ER: ['Eritrean'],
  SO: ['Somali', 'Somalia'], SD: ['Sudanese'], SS: ['South Sudanese'], DZ: ['Algerian'], MA: ['Moroccan'], LY: ['Libyan'], YE: ['Yemeni'],
  SA: ['Saudi'], CU: ['Cuban'], CO: ['Colombian'], MX: ['Mexican'], NP: ['Nepali'], BD: ['Bangladeshi'], ID: ['Indonesian'], PH: ['Filipino', 'Philippine'],
  BR: ['Brazilian'], RU: ['Russian'], UA: ['Ukrainian'], BF: ['Burkinabe'], ML: ['Malian'], NE: ['Nigerien'], TD: [], JO: [],
};
const AMBIGUOUS = new Set(['TD', 'JO', 'GE']); // Chad, Jordan, Georgia -> only match with a locative preposition
const SKIP_NAMES = new Set(['US']);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let matchers = null;
function buildMatchers() {
  matchers = [];
  for (const c of Object.values(countries)) {
    if (SKIP_NAMES.has(c.iso2)) continue;
    const names = new Set([c.name, c.longName, c.admin, ...(ALIASES[c.iso2] || [])].filter(Boolean));
    if (c.iso2 === 'KR') { names.delete('South Korea'); names.add('South Korea'); }
    if (c.iso2 === 'CG') { names.delete('Congo'); }
    if (c.iso2 === 'IN') names.delete('India'); // handled below with boundary & case
    if (c.iso2 === 'IN') names.add('India');
    for (const n of names) {
      if (n.length < 3) continue;
      const amb = AMBIGUOUS.has(c.iso2);
      const ci = n !== n.toUpperCase();
      // regex source is built now but compiled lazily (only if the cheap substring pre-check hits) to save CPU
      const src = amb
        ? '\\b(?:in|of|from|to|across|inside|throughout|northern|southern|eastern|western|central)\\s+' + esc(n) + '\\b'
        : '(?<![\\w])' + esc(n) + '(?![\\w])';
      matchers.push({ iso2: c.iso2, src, flags: amb ? '' : (ci ? 'i' : ''), rx: null, needle: ci ? n.toLowerCase() : n, ci: ci && !amb });
    }
  }
}
export function matchCountries(text) {
  const out = new Set();
  if (!text) return [];
  if (!matchers) buildMatchers();
  const lower = text.toLowerCase();
  for (const m of matchers) {
    // substring pre-check (cheap) before the real regex; semantics unchanged
    if (!(m.ci ? lower : text).includes(m.needle)) continue;
    if ((m.rx ||= new RegExp(m.src, m.flags)).test(text)) out.add(m.iso2);
  }
  if (out.has('SS') && out.has('SD') && !/(?<!South )\bSudan\b/.test(text)) out.delete('SD');
  if (out.has('GN')) { // Guinea vs Papua New Guinea / Equatorial Guinea / Guinea-Bissau
    const t = text.replace(/Papua New Guinea|New Guinea|Equatorial Guinea|Guinea-Bissau/gi, '');
    if (!/\bGuinea\b/.test(t)) out.delete('GN');
  }
  return [...out];
}
export function byName(name) {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  for (const c of Object.values(countries)) {
    if ([c.name, c.longName, c.admin].filter(Boolean).some(x => x.toLowerCase() === n)) return c;
  }
  const hits = matchCountries(name);
  return hits.length ? countries[hits[0]] : null;
}
