// Country table + keyword->country matching.
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

export const wwlByIso = Object.create(null);
for (const c of wwlFile.countries) wwlByIso[c.iso2] = c;

export const countries = Object.create(null);
for (const c of countryRows) countries[c.iso2] = { ...c };
for (const e of EXTRA) if (!countries[e.iso2]) countries[e.iso2] = { iso2: e.iso2, name: e.name, lat: e.lat, lng: e.lng, fips: null, hasPolygon: false };
const DISPLAY = { CD: 'DR Congo', CF: 'Central African Republic', SS: 'South Sudan', TR: 'Turkey', CZ: 'Czechia', DO: 'Dominican Republic', BA: 'Bosnia and Herzegovina', GQ: 'Equatorial Guinea', SB: 'Solomon Islands', SZ: 'Eswatini', CI: "Côte d'Ivoire", TL: 'Timor-Leste', CG: 'Republic of the Congo', FK: 'Falkland Islands' };
for (const [k, v] of Object.entries(DISPLAY)) if (countries[k]) countries[k].name = v;

const ALIASES = {
  US: [],
  CD: ['Democratic Republic of the Congo', 'Democratic Republic of Congo', 'D.R. Congo', 'DR Congo', 'DRC', 'Congolese', 'Congo-Kinshasa'],
  CG: ['Republic of the Congo', 'Congo-Brazzaville'],
  CF: ['Central African Republic'], MM: ['Burma', 'Burmese'], TR: ['Türkiye', 'Turkiye'], CI: ["Côte d'Ivoire", 'Ivory Coast'],
  PS: ['Palestinian', 'West Bank', 'Gaza'], KP: ['North Korea', 'North Korean'], KR: ['South Korea', 'South Korean', 'Seoul'],
  VN: ['Viet Nam', 'Vietnamese'], GB: ['United Kingdom', 'Britain', 'British'], AE: ['United Arab Emirates', 'UAE'],
  TL: ['East Timor'], SZ: ['Swaziland'], CZ: ['Czech Republic'], LA: ['Laotian'], PK: ['Pakistani'], CN: ['Chinese'], NG: ['Nigerian', 'Niger Delta', 'Niger State', 'Niger River'],
  IR: ['Iranian'], IQ: ['Iraqi'], SY: ['Syrian'], AF: ['Afghan'], EG: ['Egyptian'], ET: ['Ethiopian'], ER: ['Eritrean'],
  SO: ['Somali', 'Somalia'], SD: ['Sudanese'], SS: ['South Sudanese'], DZ: ['Algerian'], MA: ['Moroccan'], LY: ['Libyan'], YE: ['Yemeni'],
  SA: ['Saudi'], CU: ['Cuban'], CO: ['Colombian'], NP: ['Nepali'], BD: ['Bangladeshi'], ID: ['Indonesian'], PH: ['Filipino', 'Philippine'],
  BR: ['Brazilian'], RU: ['Russian'], UA: ['Ukrainian'], BF: ['Burkinabe'], ML: ['Malian'], NE: ['Nigerien'], TD: [], JO: [],
  KE: ['Kenyan'], UG: ['Ugandan'], HT: ['Haitian'], IL: ['Israeli'], TH: ['Thai'], CM: ['Cameroonian'], BY: ['Belarusian'], RO: ['Romanian'], HU: ['Hungarian'], DE: ['German'], FR: ['French'],
};
const AMBIGUOUS = new Set(['TD', 'JO']); // Chad, Jordan — case-sensitive + locative preposition. GE requires country context only.
const SKIP_NAMES = new Set(['US', 'GE']); // Georgia handled as a special context matcher
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PREP = '\\b(?:[Ii]n|[Oo]f|[Ff]rom|[Tt]o|[Aa]cross|[Ii]nside|[Tt]hroughout|[Nn]orthern|[Ss]outhern|[Ee]astern|[Ww]estern|[Cc]entral)\\s+';

let matchers = null;
function push(iso2, src, flags, needle, ci) {
  matchers.push({ iso2, src, flags, rx: null, needle, ci: !!ci });
}
function buildMatchers() {
  matchers = [];
  for (const c of Object.values(countries)) {
    if (SKIP_NAMES.has(c.iso2)) continue;
    const names = new Set([c.name, c.longName, c.admin, ...(ALIASES[c.iso2] || [])].filter(Boolean));
    if (c.iso2 === 'CG') names.delete('Congo');
    if (c.iso2 === 'CD') names.add('Congo');
    if (c.iso2 === 'IN') { names.delete('Indian'); } // special below
    if (c.iso2 === 'MX') { names.delete('Mexico'); names.delete('Mexican'); }
    if (c.iso2 === 'NE') { names.delete('Niger'); }
    if (c.iso2 === 'TR') { names.delete('Turkey'); names.delete('Turkish'); }
    for (const n of names) {
      if (n.length < 3) continue;
      const amb = AMBIGUOUS.has(c.iso2);
      const ci = n !== n.toUpperCase();
      const src = amb ? PREP + esc(n) + '\\b' : '(?<![\\w])' + esc(n) + '(?![\\w])';
      push(c.iso2, src, amb ? '' : (ci ? 'i' : ''), ci && !amb ? n.toLowerCase() : n, ci && !amb);
    }
    if (c.iso2 === 'NE') push('NE', '(?<![\\w])Niger(?!\\s+(?:Delta|River|State))(?![\\w])', 'i', 'niger', true);
    if (c.iso2 === 'MX') {
      push('MX', '(?<!New )(?<![\\w])Mexico(?![\\w])', 'i', 'mexico', true);
      push('MX', '(?<![\\w])Mexican(?![\\w])', 'i', 'mexican', true);
    }
    if (c.iso2 === 'IN') push('IN', '(?<![\\w])Indian(?!\\s+(?:Ocean|Territory|apolis))(?![\\w])', 'i', 'indian', true);
    if (c.iso2 === 'TR') push('TR', '\\b(?:Turkish|Ankara|Istanbul|T[uü]rkiye|Turkiye|(?:[Ii]n|[Oo]f|[Ff]rom|[Tt]o)\\s+Turkey)\\b', '', 'turk', true);
  }
  // Georgia country only with strong context (avoids US state false positives)
  push('GE', '\\b(?:Tbilisi|Georgian|Republic of Georgia|country of Georgia|Caucasus)\\b', 'i', 'georg', true);
  for (const m of matchers) m.rx = new RegExp(m.src, m.flags);
}

export function matchCountries(text) {
  const out = new Set();
  if (!text) return [];
  if (!matchers) buildMatchers();
  const lower = text.toLowerCase();
  const spans = [];
  for (const m of matchers) {
    const hay = m.ci ? lower : text;
    const ned = m.ci ? String(m.needle).toLowerCase() : String(m.needle);
    if (!hay.includes(ned)) continue;
    m.rx.lastIndex = 0;
    const match = m.rx.exec(text);
    if (match) {
      out.add(m.iso2);
      spans.push({ iso2: m.iso2, start: match.index, end: match.index + match[0].length });
    }
  }
  if (out.has('CD') && out.has('CG')) {
    const cdSpans = spans.filter(s => s.iso2 === 'CD');
    const cgSpans = spans.filter(s => s.iso2 === 'CG');
    for (const cg of cgSpans) {
      if (cdSpans.some(cd => cg.start >= cd.start && cg.end <= cd.end)) out.delete('CG');
    }
    if (/Democratic Republic of (?:the )?Congo|DR Congo|D\.?R\.? Congo|\bDRC\b/i.test(text)) out.delete('CG');
  }
  if (out.has('SS') && out.has('SD') && !/(?<!South )\bSudan\b/.test(text)) out.delete('SD');
  if (out.has('GN')) {
    const t = text.replace(/Papua New Guinea|New Guinea|Equatorial Guinea|Guinea-Bissau/gi, '');
    if (!/\bGuinea\b/.test(t)) out.delete('GN');
  }
  return [...out];
}

buildMatchers(); // eager compile for cold-isolate CPU budget

export function byName(name) {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  for (const c of Object.values(countries)) {
    if ([c.name, c.longName, c.admin].filter(Boolean).some(x => x.toLowerCase() === n)) return c;
  }
  const hits = matchCountries(name);
  return hits.length ? countries[hits[0]] : null;
}
