'use strict';
/* Missionary Status & Prayer Console — front end (vanilla JS + Leaflet). All user data stays in this browser (localStorage). */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');
const todayStr = () => new Date().toLocaleDateString('en-CA');
const fmtDate = iso => { if (!iso) return ''; const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };
const dayNum = s => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
const daysSince = s => s ? Math.floor((Date.parse(todayStr() + 'T00:00:00Z') - Date.parse(s.slice(0, 10) + 'T00:00:00Z')) / 86400000) : null;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ---------- local storage ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('spc.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('spc.' + k, JSON.stringify(v)); } catch (e) { toast('Could not save locally: ' + e.message); } },
};
const S = {
  countries: [], byIso: {}, geojson: null, tally: {}, unreached: null, today: null, sources: [], feeds: {}, countryData: {},
  missionaries: LS.get('missionaries', []), prayer: LS.get('prayer', []), tab: 'today', country: null, editing: null,
  settings: Object.assign({ projector: false, privacy: true, auto: false, layers: { wwl: true, news: true, church: true, jp: true } }, LS.get('settings', {})),
  items: {}, // id -> feed item (for pin buttons)
};
const saveM = () => LS.set('missionaries', S.missionaries);
const saveP = () => LS.set('prayer', S.prayer);
const saveSet = () => LS.set('settings', S.settings);

function toast(msg) {
  let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;left:50%;bottom:1.2rem;transform:translateX(-50%);background:#111827;color:#fff;padding:.5rem 1rem;border-radius:8px;z-index:9999;max-width:90vw'; document.body.appendChild(t); }
  t.textContent = msg; t.style.display = 'block'; clearTimeout(t._t); t._t = setTimeout(() => t.style.display = 'none', 4500);
}
async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 429) throw new Error(j.error || ('HTTP ' + r.status));
  j._status = r.status; return j;
}

/* ---------- map ---------- */
let map, wwlLayer, newsLayer, churchLayer, jpLayer, polyByIso = {}, selectedIso = null;
const WWL_COLORS = { extreme: '#7f1d1d', very_high: '#ea580c', none: '#dcd6c8' };
const STATUS_COLORS = { active: '#16a34a', furlough: '#2563eb', needs: '#dc2626', transition: '#9333ea', other: '#6b7280' };
function wwlOf(iso) { return S.byIso[iso]?.wwl || null; }
function polyStyle(iso) {
  const w = wwlOf(iso); const sel = iso === selectedIso;
  return { fillColor: w ? WWL_COLORS[w.category] : WWL_COLORS.none, fillOpacity: w ? 0.75 : 0.35, color: sel ? '#1d4ed8' : '#7c7466', weight: sel ? 3 : 0.6 };
}
function initMap() {
  map = L.map('map', { worldCopyJump: true, minZoom: 2, zoomSnap: 0.5 }).setView([22, 15], 2);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 7, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
  wwlLayer = L.layerGroup(); newsLayer = L.layerGroup(); churchLayer = L.layerGroup(); jpLayer = L.layerGroup();
  const gj = L.geoJSON(S.geojson, {
    style: f => polyStyle(f.properties.iso2),
    onEachFeature: (f, layer) => {
      const iso = f.properties.iso2; if (!iso) return; polyByIso[iso] = layer;
      const w = wwlOf(iso);
      layer.bindTooltip(esc(S.byIso[iso]?.name || f.properties.NAME) + (w ? ` — WWL #${w.rank} (${w.score})` : ''), { sticky: true });
      layer.on('click', () => selectCountry(iso));
    },
  });
  wwlLayer.addLayer(gj);
  for (const c of S.countries) if (!c.hasPolygon && c.wwl) { // small states without a polygon
    L.circleMarker([c.lat, c.lng], { radius: 7, color: '#fff', weight: 1, fillColor: WWL_COLORS[c.wwl.category], fillOpacity: .9 }).bindTooltip(`${esc(c.name)} — WWL #${c.wwl.rank} (${c.wwl.score})`).on('click', () => selectCountry(c.iso2)).addTo(wwlLayer);
  }
  syncLayers();
}
function syncLayers() {
  const L_ = S.settings.layers;
  [['wwl', wwlLayer], ['news', newsLayer], ['church', churchLayer], ['jp', jpLayer]].forEach(([k, lay]) => {
    if (!lay) return; const has = map.hasLayer(lay);
    try { if (L_[k] && !has) lay.addTo(map); else if (!L_[k] && has) map.removeLayer(lay); } catch (e) { console.warn('layer', k, e.message); }
  });
  document.querySelectorAll('#layers input').forEach(i => i.checked = !!L_[i.dataset.layer]);
  if (L_.wwl) wwlLayer.bringToBack?.();
}
function drawNewsMarkers() {
  newsLayer.clearLayers();
  for (const [iso, t] of Object.entries(S.tally)) {
    const c = S.byIso[iso]; if (!c) continue;
    const total = t.persecution + t.missions + t.sbc; if (!total) continue;
    const color = t.persecution >= t.missions ? '#dc2626' : '#2563eb';
    L.circleMarker([c.lat, c.lng], { radius: 6 + Math.min(total, 8) * 1.3, color: '#fff', weight: 2, fillColor: color, fillOpacity: .85 })
      .bindTooltip(`${esc(c.name)}: ${t.persecution} persecution, ${t.missions} missions, ${t.sbc} SBC item(s)`)
      .on('click', () => selectCountry(iso)).addTo(newsLayer);
  }
}
function drawJp() {
  jpLayer.clearLayers();
  const u = S.unreached; const c = u && S.byIso[u.iso2]; if (!c) return;
  L.circleMarker([c.lat, c.lng], { radius: 11, color: '#fff', weight: 3, fillColor: '#9333ea', fillOpacity: .95 })
    .bindTooltip(`Unreached of the day: ${esc(u.peopleName)} (${esc(u.country)})`).on('click', () => selectCountry(u.iso2)).addTo(jpLayer);
}
function mPos(m) {
  if (isFinite(m.lat) && isFinite(m.lng) && m.lat !== '' && m.lng !== '' && m.lat !== null) return [+m.lat, +m.lng];
  const c = S.byIso[m.iso2]; if (!c) return null;
  const same = S.missionaries.filter(x => x.iso2 === m.iso2 && !(isFinite(x.lat) && x.lat !== '' && x.lat !== null));
  const i = same.findIndex(x => x.id === m.id); const a = i * 2.4, r = i ? 0.9 + 0.35 * i : 0; // small spiral so same-country pins don't overlap
  return [c.lat + r * Math.sin(a), c.lng + r * Math.cos(a)];
}
function drawChurch() {
  churchLayer.clearLayers();
  for (const m of S.missionaries) {
    if (S.settings.privacy && m.sensitive) continue;
    const p = mPos(m); if (!p) continue;
    const color = STATUS_COLORS[m.status] || STATUS_COLORS.other;
    const icon = L.divIcon({ className: '', html: `<div class="divicon" style="background:${color}"></div>`, iconSize: [22, 22], iconAnchor: [11, 22] });
    L.marker(p, { icon, title: m.name }).bindPopup(`<strong>${esc(m.name)}</strong>${m.example ? ' <em>(EXAMPLE)</em>' : ''}<br>${esc(statusLabel(m.status))} · ${esc(S.byIso[m.iso2]?.name || '')}${m.place ? ' — ' + esc(m.place) : ''}<br>${m.needs ? '<em>' + esc(m.needs) + '</em><br>' : ''}<small>Updated ${esc(fmtDate(m.lastUpdate))}</small>`).addTo(churchLayer);
  }
}
function redrawStyles() { Object.entries(polyByIso).forEach(([iso, l]) => l.setStyle(polyStyle(iso))); }
function selectCountry(iso, fly = true) {
  if (!S.byIso[iso]) return;
  S.country = iso; selectedIso = iso; redrawStyles();
  if (fly && map) { const c = S.byIso[iso]; map.flyTo([c.lat, c.lng], Math.max(map.getZoom(), 3.5), { duration: .8 }); }
  $('#tab-country').hidden = false; setTab('country');
}

/* ---------- data loading ---------- */
async function loadAll(force) {
  const btn = $('#btn-refresh'); btn.disabled = true; btn.textContent = '⟳ Refreshing…';
  try {
    if (force) { const r = await api('/api/refresh', { method: 'POST' }); if (r._status === 429) toast(`Refreshed less than a minute ago — showing server cache (retry in ${r.retryAfterSec}s).`); }
    S.feeds = {}; S.countryData = {};
    const [m, t, s] = await Promise.all([api('/api/map'), api('/api/today?date=' + todayStr()), api('/api/sources')]);
    S.tally = m.tally; S.unreached = m.unreached; S.today = t; S.sources = s.sources; S.attr = s.attribution;
    drawNewsMarkers(); drawJp(); drawChurch(); updateBanner();
    $('#updated').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) { toast('Load failed: ' + e.message); $('#updated').textContent = 'Load failed'; }
  btn.disabled = false; btn.textContent = '⟳ Refresh';
  render();
}
async function ensureFeed(cat) {
  if (!S.feeds[cat]) { S.feeds[cat] = await api('/api/feeds?cat=' + cat + '&limit=40'); S.feeds[cat].items.forEach(i => S.items[i.id] = i); }
  return S.feeds[cat];
}
function updateBanner() {
  const b = $('#banner'); const bad = S.sources.filter(s => !['ok', 'pending'].includes(s.state));
  const ex = S.today && (S.today.examples.persecution || S.today.examples.missions);
  if (!bad.length && !ex) { b.hidden = true; return; }
  const names = { empty: 'feed currently empty', stale: 'only old items (hidden)', error: 'unreachable', cached: 'showing last good copy' };
  b.hidden = false;
  b.innerHTML = '<strong>Source status:</strong> ' + bad.map(s => `${esc(s.org)} — ${names[s.state] || s.state}`).join(' · ') + (ex ? ' · <strong>Placeholder EXAMPLE items are shown where no live source responded.</strong>' : '') + ' <a href="#" data-act="tab" data-tab="sources">details</a>';
}

/* ---------- rendering ---------- */
function setTab(t) { S.tab = t; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); render(); $('#view').scrollTop = 0; }
async function render() {
  const v = $('#view'); $('#pl-count').textContent = S.prayer.length ? String(S.prayer.filter(p => !prayedToday(p)).length || '✓') : '';
  try {
    if (S.tab === 'today') v.innerHTML = renderToday();
    else if (S.tab === 'country') { v.innerHTML = '<p class="muted">Loading country…</p>'; v.innerHTML = await renderCountry(); }
    else if (['persecution', 'missions', 'sbc'].includes(S.tab)) { const cat = S.tab; v.innerHTML = '<p class="muted">Loading…</p>'; const f = await ensureFeed(cat); if (S.tab === cat) v.innerHTML = renderFeed(cat, f); }
    else if (S.tab === 'prayer') v.innerHTML = renderPrayer();
    else if (S.tab === 'church') v.innerHTML = renderChurch();
    else if (S.tab === 'sources') v.innerHTML = renderSources();
  } catch (e) { v.innerHTML = `<p class="banner">Could not load this view: ${esc(e.message)}</p>`; }
}
const statusLabel = s => ({ active: 'Active on field', furlough: 'On furlough / stateside', needs: 'Urgent needs', transition: 'In transition', other: 'Other' }[s] || s);
const prayedToday = p => (p.prayed || []).includes(todayStr());
const lastPrayed = p => (p.prayed || []).slice().sort().pop() || null;
function wwlBadge(w) { return w && w.rank ? `<span class="badge ${w.category === 'extreme' ? 'ext' : 'vh'}">WWL #${w.rank} · ${w.score}/100 · ${w.category === 'extreme' ? 'Extreme' : 'Very high'}</span>` : ''; }
function countryBadges(list) { return (list || []).slice(0, 5).map(i => S.byIso[i] ? `<a href="#" class="badge" data-act="country" data-iso="${i}">${esc(S.byIso[i].name)}</a>` : '').join(' '); }

function itemCard(it, opts = {}) {
  S.items[it.id] = it;
  const pinned = S.prayer.some(p => p.id === it.id);
  return `<div class="card ${opts.hl ? 'hl' : ''}">
    <h4>${it.link ? `<a href="${safeUrl(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)} ${it.example ? '<span class="badge ex">EXAMPLE DATA</span>' : ''}</h4>
    <div class="meta"><span>${esc(it.sourceName)}</span>${it.published ? `<span>${esc(fmtDate(it.published))}</span>` : ''}${countryBadges(it.countries)}</div>
    ${it.excerpt ? `<p>${esc(it.excerpt)}</p>` : ''}
    <div class="row">${it.example ? '' : `<button class="small" data-act="pin-item" data-id="${esc(it.id)}">${pinned ? '✓ On prayer list' : '＋ Pray for this'}</button>`}
    ${it.countries[0] ? `<button class="small" data-act="country" data-iso="${it.countries[0]}">Show on map</button>` : ''}</div>
  </div>`;
}
function renderFeed(cat, f) {
  const titles = { persecution: 'Persecuted Church — news & prayer requests', missions: 'Missions — IMB & NAMB stories', sbc: 'SBC news' };
  const srcs = f.statuses.map(s => `<span><span class="status-dot st-${s.state}"></span>${esc(s.org)}: ${esc(s.state)}</span>`).join(' ');
  let h = `<h2>${titles[cat]}</h2><div class="meta">${srcs}</div>`;
  if (f.example) h += '<p class="banner">No live source returned items — the placeholders below are <strong>EXAMPLE DATA</strong>.</p>';
  if (cat === 'sbc' && (f.example || f.items.length === 0)) h += linkOuts([['Baptist Press', 'https://www.baptistpress.com/'], ['SBC.net news', 'https://www.sbc.net/'], ['NAMB stories', 'https://www.namb.net/']], 'Open directly (their feeds were empty/stale when last checked):');
  h += f.items.map(i => itemCard(i)).join('') || '<p class="muted">No items.</p>';
  if (cat === 'persecution') h += linkOuts([['Open Doors — World Watch List', 'https://www.opendoors.org/persecution/countries/'], ['Voice of the Martyrs — Pray', 'https://www.persecution.com/prayer'], ['Prayercast', 'https://prayercast.com/']], 'More prayer resources (no public feed, link only):');
  if (cat === 'missions') h += linkOuts([['IMB — Pray', 'https://www.imb.org/pray/'], ['Lottie Moon & Week of Prayer', 'https://www.imb.org/lottie-moon/week-of-prayer/'], ['NAMB — Pray', 'https://www.namb.net/prayer/']], 'IMB/NAMB prayer pages (link only):');
  return h + `<p class="muted">Country tags come from keyword matching on each headline/tags/excerpt and may be imperfect. Content © its publisher; shown as headline, short excerpt and link.</p>`;
}
const linkOuts = (arr, label) => `<div class="card"><div class="meta">${esc(label)}</div><div class="row">${arr.map(([t, u]) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener">${esc(t)}</a>`).join(' · ')}</div></div>`;

function churchOfTheDay() {
  const list = S.missionaries.filter(m => !m.example); const pool = list.length ? list : S.missionaries; if (!pool.length) return null;
  const sorted = pool.slice().sort((a, b) => (lastPrayed(a) || '').localeCompare(lastPrayed(b) || '') || (a.status === 'needs' ? -1 : 0) - (b.status === 'needs' ? -1 : 0) || a.name.localeCompare(b.name));
  return sorted[0];
}
function renderToday() {
  const t = S.today; if (!t) return '<p class="muted">Loading…</p>';
  const pc = t.persecutedCountry; const u = t.unreached; let h = `<h2>Today’s prayer focus <span class="muted">${esc(fmtDate(t.date))}</span></h2>`;
  if (t.scripture) h += `<div class="card"><div class="meta">Scripture of the day · <a href="${safeUrl(t.scripture.link)}" target="_blank" rel="noopener">Joshua Project</a></div><p class="bigscripture">${esc(t.scripture.text)}</p></div>`;
  h += `<div class="card hl"><h4>Persecuted church: ${esc(pc.name)} ${wwlBadge(pc)}</h4>
    <div class="prompt">${esc(pc.prompts[0].text)} <span class="muted">(${esc(pc.prompts[0].ref)})</span></div>
    ${pc.news.map(n => `<p>• <a href="${safeUrl(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted">— ${esc(n.sourceName)}, ${esc(fmtDate(n.published))}</span></p>`).join('') || '<p class="muted">No matching headline in the current feeds — open the country for more.</p>'}
    <div class="row"><button class="small" data-act="country" data-iso="${pc.iso2}">Open country &amp; map</button><button class="small" data-act="pin-country" data-iso="${pc.iso2}">＋ Pray for this country</button></div>
    <div class="meta">Rotation: Open Doors WWL 2026 top 50, one country per day (#${pc.rank} today).</div></div>`;
  if (u) h += `<div class="card hl"><h4>Unreached people of the day: ${esc(u.peopleName)} — ${esc(u.country)}</h4>
    <div class="meta"><span>Population ${esc(u.population)}</span><span>Language: ${esc(u.language)}</span><span>Religion: ${esc(u.religion)}</span><span>Evangelical ${esc(u.evangelicalPct)}%</span><span class="badge">${esc(u.status)}</span></div>
    ${u.apiExtras?.prayForPeople ? `<div class="prompt">${esc(u.apiExtras.prayForPeople)}</div>` : '<div class="prompt">Pray that God would raise up workers, open hearts, and make the gospel known among this people group (Romans 10:14-15).</div>'}
    <div class="row"><a href="${safeUrl(u.link)}" target="_blank" rel="noopener">Data provided by Joshua Project</a>
    ${u.iso2 ? `<button class="small" data-act="country" data-iso="${u.iso2}">Show on map</button>` : ''}<button class="small" data-act="pin-jp">＋ Pray for this people</button></div></div>`;
  else h += `<div class="card"><h4>Unreached people of the day</h4><p class="muted">Joshua Project feed unavailable right now. <a href="https://joshuaproject.net/" target="_blank" rel="noopener">Visit Joshua Project</a>.</p></div>`;
  if (t.missionsStory) h += itemCard(t.missionsStory, { hl: true }).replace('<h4>', '<h4>Missions story: ');
  if (t.persecutionStory) h += itemCard(t.persecutionStory, { hl: true }).replace('<h4>', '<h4>Persecution news: ');
  const m = churchOfTheDay();
  if (m) { const masked = S.settings.privacy && m.sensitive;
    h += `<div class="card hl"><h4>Our church’s missionary to pray for: ${masked ? 'Sensitive worker (details hidden)' : esc(m.name)} ${m.example ? '<span class="badge ex">EXAMPLE</span>' : ''}</h4>
    ${masked ? '<p class="muted">Privacy mode is hiding this entry. Turn it off to see details.</p>' : `<div class="meta"><span class="badge s-${esc(m.status)}">${esc(statusLabel(m.status))}</span><span>${esc(S.byIso[m.iso2]?.name || '')}</span><span>Last prayed: ${esc(fmtDate(lastPrayed(m)) || 'never')}</span></div><p>${esc(m.needs || 'No prayer needs recorded.')}</p>`}
    <div class="row"><button class="small" data-act="m-prayed" data-id="${m.id}">✓ Mark prayed today</button><button class="small" data-act="tab" data-tab="church">All missionaries</button></div><div class="meta">Picks whoever has gone longest without being prayed for.</div></div>`;
  } else h += `<div class="card"><h4>Our church’s missionaries</h4><p class="muted">None entered yet. Add the missionaries your church supports under “Our Missionaries”.</p></div>`;
  if (t.fact) h += `<div class="card"><div class="meta">Mission fact · <a href="${safeUrl(t.fact.link)}" target="_blank" rel="noopener">Joshua Project</a></div><p>${esc(t.fact.text)}</p></div>`;
  const left = S.prayer.filter(p => !prayedToday(p)).length;
  h += `<p class="muted">Prayer list: ${S.prayer.length} item(s), ${left} not yet prayed today. <a href="#" data-act="tab" data-tab="prayer">Open prayer list</a></p>`;
  return h;
}
async function renderCountry() {
  const iso = S.country; if (!iso) return '<p class="muted">Click a country on the map.</p>';
  const d = S.countryData[iso] || (S.countryData[iso] = await api('/api/country/' + iso));
  d.news.forEach(i => S.items[i.id] = i);
  const c = d.country; const mine = S.missionaries.filter(m => m.iso2 === iso && !(S.settings.privacy && m.sensitive));
  const hidden = S.missionaries.filter(m => m.iso2 === iso).length - mine.length;
  let h = `<h2>${esc(c.name)} ${d.wwl.rank ? wwlBadge(d.wwl) : ''}</h2><div class="meta">${esc([c.subregion, c.continent].filter(Boolean).join(' · '))}</div>`;
  h += d.wwl.rank ? `<p class="meta">${esc(d.wwl.listName)} — total persecution score out of 100. <a href="${safeUrl(d.wwl.source)}" target="_blank" rel="noopener">Open Doors</a></p>` : `<p class="muted">${esc(d.wwl.note)}</p>`;
  h += `<div class="row"><button class="small" data-act="pin-country" data-iso="${iso}">＋ Pray for ${esc(c.name)}</button><button class="small" data-act="add-m" data-iso="${iso}">＋ Add our missionary here</button></div>`;
  if (d.unreachedToday) h += `<div class="card hl"><h4>Unreached of the day here: ${esc(d.unreachedToday.peopleName)}</h4><div class="meta">Pop. ${esc(d.unreachedToday.population)} · ${esc(d.unreachedToday.language)} · ${esc(d.unreachedToday.religion)}</div><a href="${safeUrl(d.unreachedToday.link)}" target="_blank" rel="noopener">Data provided by Joshua Project</a></div>`;
  h += `<h3>Prayer points <span class="muted">(${esc(d.promptsNote)})</span></h3>` + d.prompts.map(p => `<div class="prompt">${esc(p.text)} <span class="muted">(${esc(p.ref)})</span></div>`).join('');
  h += `<h3>Our church’s missionaries here</h3>` + (mine.map(m => `<div class="card"><strong>${esc(m.name)}</strong> ${m.example ? '<span class="badge ex">EXAMPLE</span>' : ''} <span class="badge s-${esc(m.status)}">${esc(statusLabel(m.status))}</span><p>${esc(m.needs || '')}</p></div>`).join('') || '<p class="muted">None entered.</p>') + (hidden ? `<p class="muted">${hidden} sensitive entr${hidden > 1 ? 'ies' : 'y'} hidden by Privacy mode.</p>` : '');
  h += `<h3>Latest headlines mentioning ${esc(c.name)}</h3>` + (d.news.map(i => itemCard(i)).join('') || '<p class="muted">None in the current feeds.</p>');
  h += `<div id="imb-slot"><p class="muted">Looking for IMB stories tagged “${esc(c.name)}”…</p></div>`;
  loadImb(iso);
  h += linkOuts(d.links.map(l => [l.label, l.url]), 'Go deeper:');
  return h;
}
async function loadImb(iso) {
  try {
    const r = S.countryData[iso].imb || (S.countryData[iso].imb = await api('/api/country/' + iso + '/imb'));
    r.stories.forEach(i => S.items[i.id] = i);
    const slot = $('#imb-slot'); if (!slot || S.country !== iso || S.tab !== 'country') return;
    slot.innerHTML = r.stories.length ? `<h3>IMB stories tagged “${esc(S.byIso[iso].name)}”</h3>` + r.stories.map(i => itemCard(i)).join('') : '<p class="muted">No IMB stories tagged for this country.</p>';
  } catch (e) { const slot = $('#imb-slot'); if (slot) slot.innerHTML = `<p class="muted">IMB stories unavailable (${esc(e.message)}).</p>`; }
}
function renderPrayer() {
  const items = S.prayer.slice().sort((a, b) => (prayedToday(a) - prayedToday(b)) || (lastPrayed(a) || '').localeCompare(lastPrayed(b) || ''));
  let h = `<h2>Prayer list</h2><p class="muted">Pin items from any tab, then mark them prayed. Stored only in this browser — use Export to keep or share a copy.</p>
  <div class="card"><form data-form="custom-prayer"><label class="f">Add your own request<input name="title" required maxlength="200" placeholder="e.g. Pray for our youth mission trip"></label><div class="row"><button class="small primary">Add to list</button></div></form></div>`;
  const stale = S.missionaries.filter(m => { const d = daysSince(lastPrayed(m)); return d === null || d >= 14; }).length;
  if (S.missionaries.length) h += `<p class="muted">${stale} of ${S.missionaries.length} church missionar${S.missionaries.length > 1 ? 'ies have' : 'y has'} not been prayed for in 14+ days. <a href="#" data-act="tab" data-tab="church">Open</a></p>`;
  h += items.map(p => `<div class="card ${prayedToday(p) ? '' : 'hl'}"><h4>${p.link ? `<a href="${safeUrl(p.link)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}</h4>
    <div class="meta"><span>${esc(p.source || p.type)}</span><span>Pinned ${esc(fmtDate(p.pinnedAt))}</span><span>Prayed ${(p.prayed || []).length}×${lastPrayed(p) ? ', last ' + esc(fmtDate(lastPrayed(p))) : ''}</span>${countryBadges(p.countries)}</div>
    ${p.note ? `<p>${esc(p.note)}</p>` : ''}
    <div class="row"><button class="small ${prayedToday(p) ? '' : 'primary'}" data-act="prayed" data-id="${esc(p.id)}">${prayedToday(p) ? '✓ Prayed today (undo)' : 'Mark prayed today'}</button>
    <button class="small danger" data-act="unpin" data-id="${esc(p.id)}">Remove</button></div></div>`).join('') || '<p class="muted">Nothing pinned yet.</p>';
  return h + dataTools();
}
const dataTools = () => `<h3>Backup</h3><div class="row"><button class="small" data-act="export">⬇ Export all my data (JSON)</button><button class="small" data-act="import">⬆ Import JSON</button><input type="file" id="import-file" accept="application/json" hidden></div>`;

function mForm(m) {
  const ctry = S.countries.map(c => `<option value="${c.iso2}" ${m.iso2 === c.iso2 ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<div class="card"><form data-form="missionary"><input type="hidden" name="id" value="${esc(m.id || '')}">
   <div class="grid2"><label class="f">Name(s) / family<input name="name" required maxlength="120" value="${esc(m.name)}"></label>
   <label class="f">Sending agency / church relationship<input name="agency" maxlength="120" value="${esc(m.agency)}" placeholder="IMB, NAMB, other…"></label></div>
   <div class="grid2"><label class="f">Country of service<select name="iso2" required><option value="">— choose —</option>${ctry}</select></label>
   <label class="f">City / region (optional)<input name="place" maxlength="120" value="${esc(m.place)}"></label></div>
   <div class="grid2"><label class="f">Latitude (optional)<input name="lat" type="number" step="any" min="-90" max="90" value="${esc(m.lat ?? '')}" placeholder="blank = country center"></label>
   <label class="f">Longitude (optional)<input name="lng" type="number" step="any" min="-180" max="180" value="${esc(m.lng ?? '')}"></label></div>
   <div class="grid2"><label class="f">Status<select name="status">${Object.keys(STATUS_COLORS).map(k => `<option value="${k}" ${m.status === k ? 'selected' : ''}>${esc(statusLabel(k))}</option>`).join('')}</select></label>
   <label class="f">Last update from them<input name="lastUpdate" type="date" value="${esc(m.lastUpdate)}"></label></div>
   <label class="f">Prayer needs<textarea name="needs" maxlength="1000">${esc(m.needs)}</textarea></label>
   <label class="f">Private notes (never shown on map)<textarea name="notes" maxlength="1000">${esc(m.notes)}</textarea></label>
   <label class="chk"><input type="checkbox" name="sensitive" ${m.sensitive ? 'checked' : ''}> Sensitive location — hide from map &amp; screen while Privacy mode is on</label>
   <p class="muted">Security tip: do not enter details that could endanger workers in restricted countries (exact addresses, workplace names, real names if they request anonymity). Privacy mode defaults on.</p>
   <div class="row"><button class="small primary">Save</button><button type="button" class="small" data-act="m-cancel">Cancel</button></div></form></div>`;
}
function renderChurch() {
  let h = `<h2>Our church’s missionaries</h2><p class="muted">Entered by you, stored in this browser only, and shown on the map as pins. Mission boards do not publish structured data on individual field workers (security), so this list is the way to track people your church knows personally.</p>
   <div class="row"><button class="small primary" data-act="m-new">＋ Add missionary</button><button class="small" data-act="m-examples">Load 3 EXAMPLE entries</button><button class="small danger" data-act="m-clear-examples">Remove examples</button></div>`;
  if (S.editing) { const m = S.editing === 'new' ? { status: 'active', lastUpdate: todayStr(), sensitive: false, ...(S.draft || {}) } : S.missionaries.find(x => x.id === S.editing); if (m) h += mForm(m); }
  const list = S.missionaries.slice().sort((a, b) => a.name.localeCompare(b.name));
  h += list.map(m => { const masked = S.settings.privacy && m.sensitive; const age = daysSince(m.lastUpdate); const lp = lastPrayed(m);
    if (masked) return `<div class="card"><h4>Sensitive worker (details hidden)</h4><p class="muted">Privacy mode is on. Turn it off in the header to view or edit.</p></div>`;
    return `<div class="card"><h4>${esc(m.name)} ${m.example ? '<span class="badge ex">EXAMPLE — fictional</span>' : ''} <span class="badge s-${esc(m.status)}">${esc(statusLabel(m.status))}</span></h4>
    <div class="meta"><span>${esc(S.byIso[m.iso2]?.name || '')}${m.place ? ' — ' + esc(m.place) : ''}</span>${m.agency ? `<span>${esc(m.agency)}</span>` : ''}<span>Updated ${esc(fmtDate(m.lastUpdate) || '—')}${age !== null && age > 90 ? ' ⚠ update due' : ''}</span><span>Last prayed: ${esc(fmtDate(lp) || 'never')}</span>${m.sensitive ? '<span class="badge">sensitive</span>' : ''}</div>
    ${m.needs ? `<p>${esc(m.needs)}</p>` : ''}${m.notes ? `<p class="muted">Notes: ${esc(m.notes)}</p>` : ''}
    <div class="row"><button class="small ${(m.prayed || []).includes(todayStr()) ? '' : 'primary'}" data-act="m-prayed" data-id="${m.id}">${(m.prayed || []).includes(todayStr()) ? '✓ Prayed today (undo)' : 'Mark prayed today'}</button>
    <button class="small" data-act="m-edit" data-id="${m.id}">Edit</button><button class="small" data-act="m-touch" data-id="${m.id}">Updated today</button>
    <button class="small" data-act="country" data-iso="${m.iso2}">Country</button><button class="small danger" data-act="m-del" data-id="${m.id}">Delete</button></div></div>`;
  }).join('') || '<p class="muted">No missionaries yet.</p>';
  return h + dataTools();
}
function renderSources() {
  let h = '<h2>Sources & status</h2><table><tr><th>Source</th><th>State</th><th>Items</th><th>Last OK</th></tr>';
  h += S.sources.map(s => `<tr><td><a href="${safeUrl(s.home)}" target="_blank" rel="noopener">${esc(s.name)}</a><br><span class="muted">${esc(s.terms)}</span></td><td><span class="status-dot st-${esc(s.state)}"></span>${esc(s.state)}${s.error ? `<br><span class="muted">${esc(s.error)}</span>` : ''}</td><td>${s.itemsShown}/${s.itemsFetched}${s.newestItem ? `<br><span class="muted">newest ${esc(fmtDate(s.newestItem))}</span>` : ''}</td><td>${esc(s.lastOk ? new Date(s.lastOk).toLocaleString() : '—')}</td></tr>`).join('');
  h += '</table>';
  h += `<h3>Static / link-only</h3><ul><li><strong>Open Doors World Watch List 2026</strong> (map colors &amp; ranks): static top-50 table transcribed from Open Doors’ published 2026 list; Open Doors offers no public API. © Open Doors International. <a href="https://www.opendoors.org/persecution/countries/" target="_blank" rel="noopener">Source</a></li>
  <li><strong>Prayercast, Voice of the Martyrs, Operation World, Global Prayer Digest, IMB/NAMB prayer pages</strong>: no public feed/API — links only.</li>
  <li><strong>Joshua Project</strong>: <a href="https://joshuaproject.net/" target="_blank" rel="noopener">Data provided by Joshua Project</a> (public RSS).</li>
  <li><strong>Map</strong>: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors; country boundaries from Natural Earth (public domain); Leaflet (BSD-2).</li></ul>
  <p class="muted">See README.md for full notes on access and terms.</p>`;
  return h;
}

/* ---------- actions ---------- */
function pinItem(it) {
  const i = S.prayer.findIndex(p => p.id === it.id);
  if (i >= 0) { S.prayer.splice(i, 1); toast('Removed from prayer list'); }
  else { S.prayer.push({ id: it.id, type: 'feed', title: it.title, link: it.link, source: it.sourceName, countries: it.countries, pinnedAt: todayStr(), prayed: [] }); toast('Added to prayer list'); }
  saveP(); render();
}
function exportAll() {
  const blob = new Blob([JSON.stringify({ app: 'sbc-prayer-console', version: 1, exportedAt: new Date().toISOString(), missionaries: S.missionaries, prayerList: S.prayer }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `prayer-console-${todayStr()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importFile(file) {
  try {
    const j = JSON.parse(await file.text());
    if (j.app !== 'sbc-prayer-console' || !Array.isArray(j.missionaries) || !Array.isArray(j.prayerList)) throw new Error('not a prayer-console export');
    if (!confirm(`Replace current data with ${j.missionaries.length} missionaries and ${j.prayerList.length} prayer items from the file?`)) return;
    S.missionaries = j.missionaries.map(m => ({ ...m, id: m.id || uid() })); S.prayer = j.prayerList; saveM(); saveP(); drawChurch(); render(); toast('Imported');
  } catch (e) { toast('Import failed: ' + e.message); }
}
const EXAMPLES = [
  { name: 'EXAMPLE – Family A (fictional)', iso2: 'KE', status: 'active', needs: 'Example prayer need: language study progress and health for the children.', agency: 'Example agency' },
  { name: 'EXAMPLE – Family B (fictional)', iso2: 'BR', status: 'furlough', needs: 'Example prayer need: travel to supporting churches and re-entry.', agency: 'Example agency' },
  { name: 'EXAMPLE – Worker C (fictional)', iso2: 'JP', status: 'needs', needs: 'Example prayer need: strength during a hard season.', agency: 'Example agency' },
];

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id; if (el.tagName === 'A') e.preventDefault();
  if (act === 'tab') setTab(el.dataset.tab);
  else if (act === 'country') selectCountry(el.dataset.iso);
  else if (act === 'pin-item') pinItem(S.items[id]);
  else if (act === 'pin-country') { const c = S.byIso[el.dataset.iso]; const pid = 'country:' + c.iso2; if (!S.prayer.some(p => p.id === pid)) { S.prayer.push({ id: pid, type: 'country', title: 'Pray for ' + c.name + (c.wwl ? ` (WWL #${c.wwl.rank})` : ''), source: 'Country', countries: [c.iso2], pinnedAt: todayStr(), prayed: [] }); saveP(); toast('Added to prayer list'); } else toast('Already on prayer list'); render(); }
  else if (act === 'pin-jp') { const u = S.today?.unreached; if (u) { const pid = 'jp:' + u.link; if (!S.prayer.some(p => p.id === pid)) { S.prayer.push({ id: pid, type: 'people', title: `Pray for the ${u.peopleName} (${u.country})`, link: u.link, source: 'Joshua Project', countries: u.iso2 ? [u.iso2] : [], pinnedAt: todayStr(), prayed: [] }); saveP(); toast('Added to prayer list'); } else toast('Already on prayer list'); render(); } }
  else if (act === 'prayed') { const p = S.prayer.find(x => x.id === id); if (p) { p.prayed = p.prayed || []; const t = todayStr(); p.prayed = p.prayed.includes(t) ? p.prayed.filter(d => d !== t) : p.prayed.concat(t); saveP(); render(); } }
  else if (act === 'unpin') { S.prayer = S.prayer.filter(p => p.id !== id); saveP(); render(); }
  else if (act === 'm-new') { S.editing = 'new'; S.draft = null; render(); }
  else if (act === 'add-m') { S.editing = 'new'; S.draft = { iso2: el.dataset.iso, sensitive: !!wwlOf(el.dataset.iso) }; setTab('church'); }
  else if (act === 'm-edit') { S.editing = id; render(); }
  else if (act === 'm-cancel') { S.editing = null; render(); }
  else if (act === 'm-del') { if (confirm('Delete this missionary entry?')) { S.missionaries = S.missionaries.filter(m => m.id !== id); saveM(); drawChurch(); render(); } }
  else if (act === 'm-prayed') { const m = S.missionaries.find(x => x.id === id); if (m) { const t = todayStr(); m.prayed = m.prayed || []; m.prayed = m.prayed.includes(t) ? m.prayed.filter(d => d !== t) : m.prayed.concat(t); saveM(); render(); } }
  else if (act === 'm-touch') { const m = S.missionaries.find(x => x.id === id); if (m) { m.lastUpdate = todayStr(); saveM(); render(); } }
  else if (act === 'm-examples') { if (!S.missionaries.some(m => m.example)) { EXAMPLES.forEach(x => S.missionaries.push({ id: uid(), example: true, lastUpdate: todayStr(), prayed: [], sensitive: false, ...x })); saveM(); drawChurch(); } render(); }
  else if (act === 'm-clear-examples') { S.missionaries = S.missionaries.filter(m => !m.example); saveM(); drawChurch(); render(); }
  else if (act === 'export') exportAll();
  else if (act === 'import') $('#import-file').click();
});
document.addEventListener('change', e => { if (e.target.id === 'import-file' && e.target.files[0]) { importFile(e.target.files[0]); e.target.value = ''; } });
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
  const fd = Object.fromEntries(new FormData(f));
  if (f.dataset.form === 'custom-prayer') { S.prayer.push({ id: 'c:' + uid(), type: 'custom', title: fd.title.trim(), source: 'Our request', countries: [], pinnedAt: todayStr(), prayed: [] }); saveP(); render(); return; }
  if (f.dataset.form === 'missionary') {
    const lat = fd.lat === '' ? null : +fd.lat, lng = fd.lng === '' ? null : +fd.lng;
    if ((lat === null) !== (lng === null)) { toast('Enter both latitude and longitude, or neither.'); return; }
    const rec = { name: fd.name.trim(), agency: fd.agency.trim(), iso2: fd.iso2, place: fd.place.trim(), lat, lng, status: fd.status, lastUpdate: fd.lastUpdate || todayStr(), needs: fd.needs.trim(), notes: fd.notes.trim(), sensitive: !!fd.sensitive };
    if (fd.id) { const m = S.missionaries.find(x => x.id === fd.id); Object.assign(m, rec); } else S.missionaries.push({ id: uid(), prayed: [], ...rec });
    S.editing = null; saveM(); drawChurch(); render(); toast('Saved');
  }
});
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
$('#btn-refresh').addEventListener('click', () => loadAll(true));
$('#layers').addEventListener('change', e => { const k = e.target.dataset.layer; if (k) { S.settings.layers[k] = e.target.checked; saveSet(); syncLayers(); } });
$('#projector').addEventListener('change', e => { S.settings.projector = e.target.checked; document.body.classList.toggle('projector', e.target.checked); saveSet(); setTimeout(() => map && map.invalidateSize(), 100); });
$('#privacy').addEventListener('change', e => { S.settings.privacy = e.target.checked; saveSet(); drawChurch(); render(); });
let autoTimer = null;
$('#auto-refresh').addEventListener('change', e => { S.settings.auto = e.target.checked; saveSet(); clearInterval(autoTimer); if (e.target.checked) autoTimer = setInterval(() => loadAll(false), 15 * 60000); });

/* ---------- boot ---------- */
(async function boot() {
  $('#projector').checked = S.settings.projector; document.body.classList.toggle('projector', S.settings.projector);
  $('#privacy').checked = S.settings.privacy; $('#auto-refresh').checked = S.settings.auto;
  if (S.settings.auto) autoTimer = setInterval(() => loadAll(false), 15 * 60000);
  try {
    const [c, g] = await Promise.all([api('/api/countries'), api('/api/geojson')]);
    S.countries = c.countries; S.countries.forEach(x => S.byIso[x.iso2] = x); S.geojson = g;
    initMap();
  } catch (e) { $('#view').innerHTML = `<p class="banner">Could not load map data: ${esc(e.message)}</p>`; }
  await loadAll(false);
})();
