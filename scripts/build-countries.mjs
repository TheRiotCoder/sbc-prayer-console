// Regenerates src/data/countries.json (slim country table, no geometry) from public/data/countries.geojson.
// Run:  npm run build:data      (only needed if you replace the geojson)
import fs from 'node:fs';
const geo = JSON.parse(fs.readFileSync(new URL('../public/data/countries.geojson', import.meta.url), 'utf8'));
const out = [];
for (const f of geo.features) {
  const p = f.properties;
  if (!p.iso2) continue;
  out.push({ iso2: p.iso2, name: p.NAME, longName: p.NAME_LONG, admin: p.ADMIN, lat: p.LABEL_Y, lng: p.LABEL_X,
    fips: p.FIPS_10 && p.FIPS_10 !== '-99' ? p.FIPS_10 : null, continent: p.CONTINENT, subregion: p.SUBREGION, hasPolygon: true });
}
fs.writeFileSync(new URL('../src/data/countries.json', import.meta.url), JSON.stringify(out));
console.log('wrote', out.length, 'countries');
