'use strict';
/* Missionary Status & Prayer Console — front end. User data stays in this browser (localStorage). */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');
const todayStr = () => { try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); } catch { return new Date().toLocaleDateString('en-CA'); } };
const fmtDate = iso => { if (!iso) return ''; const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };
const daysSince = s => s ? Math.floor((Date.parse(todayStr() + 'T00:00:00Z') - Date.parse(s.slice(0, 10) + 'T00:00:00Z')) / 86400000) : null;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlain = v => v && typeof v === 'object' && !Array.isArray(v);
const STATUS_OK = new Set(['active', 'furlough', 'needs', 'transition', 'other']);
const ID_RE = /^[a-zA-Z0-9:_-]{2,40}$/;
const ISO_RE = /^[A-Z]{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function normMissionary(m, byIso) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const id = typeof m.id === 'string' && ID_RE.test(m.id) ? m.id : uid();
  const iso2 = typeof m.iso2 === 'string' && ISO_RE.test(m.iso2) && (!byIso || !Object.keys(byIso).length || hasOwn(byIso, m.iso2)) ? m.iso2 : '';
  if (!iso2 && byIso && Object.keys(byIso).length) return null;
  const name = String(m.name || '').slice(0, 120).trim();
  if (!name) return null;
  let lat = m.lat, lng = m.lng;
  if (lat === '' || lat === undefined) lat = null;
  if (lng === '' || lng === undefined) lng = null;
  if (lat !== null) { lat = +lat; if (!Number.isFinite(lat) || lat < -90 || lat > 90) lat = null; }
  if (lng !== null) { lng = +lng; if (!Number.isFinite(lng) || lng < -180 || lng > 180) lng = null; }
  if ((lat === null) !== (lng === null)) { lat = null; lng = null; }
  const sensitive = m.sensitive !== false;
  const prayed = Array.isArray(m.prayed) ? m.prayed.filter(d => typeof d === 'string' && DATE_RE.test(d)).slice(0, 400) : [];
  return { id, name, agency: String(m.agency || '').slice(0, 120), iso2, place: sensitive ? '' : String(m.place || '').slice(0, 120),
    lat: sensitive ? null : lat, lng: sensitive ? null : lng, status: STATUS_OK.has(m.status) ? m.status : 'active',
    lastUpdate: (typeof m.lastUpdate === 'string' && DATE_RE.test(m.lastUpdate)) ? m.lastUpdate : todayStr(),
    needs: String(m.needs || '').slice(0, 1000), notes: String(m.notes || '').slice(0, 1000), sensitive, prayed, example: !!m.example, publicName: String(m.publicName || '').slice(0, 120) };
}
function normPrayer(p, byIso) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const id = typeof p.id === 'string' && ID_RE.test(p.id) ? p.id : ('c:' + uid());
  const title = String(p.title || '').slice(0, 200).trim();
  if (!title) return null;
  const countries = Array.isArray(p.countries) ? p.countries.filter(c => typeof c === 'string' && ISO_RE.test(c) && (!byIso || !Object.keys(byIso).length || hasOwn(byIso, c))).slice(0, 10) : [];
  return { id, type: String(p.type || 'custom').slice(0, 40), title, link: /^https?:\/\//i.test(p.link || '') ? String(p.link).slice(0, 500) : '',
    source: String(p.source || '').slice(0, 120), countries, pinnedAt: (typeof p.pinnedAt === 'string' && DATE_RE.test(p.pinnedAt)) ? p.pinnedAt : todayStr(),
    prayed: Array.isArray(p.prayed) ? p.prayed.filter(d => typeof d === 'string' && DATE_RE.test(d)).slice(0, 400) : [], note: String(p.note || '').slice(0, 500) };
}
function loadArr(key, norm) {
  let raw; try { raw = localStorage.getItem('spc.' + key); } catch { return []; }
  if (raw == null) return [];
  let v; try { v = JSON.parse(raw); } catch { try { localStorage.setItem('spc.corrupt.' + key, raw); } catch {} return []; }
  if (!Array.isArray(v)) { try { localStorage.setItem('spc.corrupt.' + key, raw); } catch {} return []; }
  return v.map(x => norm(x)).filter(Boolean);
}
const LS = {
  get(k, d) { try { const v = localStorage.getItem('spc.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('spc.' + k, JSON.stringify(v)); } catch (e) { toast('Could not save locally: ' + e.message); } },
  del(k) { try { localStorage.removeItem('spc.' + k); } catch {} },
};
const savedSettings = (() => { const s = LS.get('settings', {}); return isPlain(s) ? s : {}; })();
const S = {
  countries: [], byIso: Object.create(null), geojson: null, tally: {}, unreached: null, today: null, sources: [], feeds: {}, countryData: {},
  missionaries: loadArr('missionaries', m => normMissionary(m, null)), prayer: loadArr('prayer', p => normPrayer(p, null)),
  tab: 'today', country: null, editing: null, draft: null, attr: null, apiDown: false, items: {},
  settings: Object.assign({ projector: !!savedSettings.projector, privacy: true, auto: !!savedSettings.auto, gentle: savedSettings.gentle !== false,
    layers: Object.assign({ wwl: true, news: true, church: true, jp: true }, isPlain(savedSettings.layers) ? savedSettings.layers : {}) }, {}),
};
const saveM = () => LS.set('missionaries', S.missionaries);
const saveP = () => LS.set('prayer', S.prayer);
const saveSet = () => LS.set('settings', { ...S.settings, privacy: true });
function toast(msg, isErr) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.setAttribute('role', isErr ? 'alert' : 'status'); t.setAttribute('aria-live', isErr ? 'assertive' : 'polite');
  t.textContent = msg; t.style.display = 'block'; clearTimeout(t._t); t._t = setTimeout(() => { t.style.display = 'none'; }, 4500);
}
async function api(path, opts) {
  const r = await fetch(path, opts); const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 429) throw new Error(j.error || ('HTTP ' + r.status));
  j._status = r.status; return j;
}
let map, wwlLayer, newsLayer, churchLayer, jpLayer, polyByIso = {}, selectedIso = null, renderSeq = 0;
const WWL_COLORS = { extreme: '#7f0000', very_high: '#c2410c', high: '#b45309', none: '#dcd6c8' };
const STATUS_COLORS = { active: '#16a34a', furlough: '#2563eb', needs: '#ca8a04', transition: '#9333ea', other: '#6b7280' };
function wwlOf(iso) { return S.byIso[iso]?.wwl || null; }
function polyStyle(iso) {
  const w = wwlOf(iso); const sel = iso === selectedIso;
  const cat = w ? (w.category || (w.score >= 81 ? 'extreme' : w.score >= 61 ? 'very_high' : 'high')) : null;
  return { fillColor: cat ? (WWL_COLORS[cat] || WWL_COLORS.high) : WWL_COLORS.none, fillOpacity: w ? 0.75 : 0.35, color: sel ? '#1d4ed8' : '#7c7466', weight: sel ? 3 : 0.6 };
}
function initMap() {
  const isMobile = window.innerWidth <= 900 || ('ontouchstart' in window);
  map = L.map('map', { worldCopyJump: true, minZoom: 2, zoomSnap: 0.5, dragging: !isMobile, tap: false, scrollWheelZoom: !isMobile }).setView([22, 15], 2);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 7, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
  wwlLayer = L.layerGroup(); newsLayer = L.layerGroup(); churchLayer = L.layerGroup(); jpLayer = L.layerGroup();
  const gj = L.geoJSON(S.geojson, {
    style: f => polyStyle(f.properties.iso2),
    onEachFeature: (f, layer) => {
      const iso = f.properties.iso2; if (!iso) return; polyByIso[iso] = layer;
      const w = wwlOf(iso);
      layer.bindTooltip(esc(S.byIso[iso]?.name || f.properties.NAME) + (w ? ' — Open Doors score ' + w.score : ''), { sticky: true });
      layer.on('click', () => selectCountry(iso));
      layer.on('add', () => { try { const el = layer.getElement?.() || layer._path; if (el) el.setAttribute('tabindex', '-1'); } catch {} });
    },
  });
  wwlLayer.addLayer(gj);
  for (const c of S.countries) if (!c.hasPolygon && c.wwl) {
    L.circleMarker([c.lat, c.lng], { radius: 7, color: '#fff', weight: 1, fillColor: WWL_COLORS[c.wwl.category] || WWL_COLORS.high, fillOpacity: .9 }).bindTooltip(esc(c.name) + ' — score ' + c.wwl.score).on('click', () => selectCountry(c.iso2)).addTo(wwlLayer);
  }
  syncLayers();
  const act = $('#map-activate');
  if (act && isMobile) {
    act.hidden = false;
    act.onclick = () => { $('.mapwrap')?.classList.add('map-on'); $('#map')?.classList.add('map-active'); map.dragging.enable(); map.scrollWheelZoom.enable(); act.hidden = true; };
  }
}
function syncLayers() {
  const L_ = S.settings.layers;
  [['wwl', wwlLayer], ['news', newsLayer], ['church', churchLayer], ['jp', jpLayer]].forEach(([k, lay]) => {
    if (!lay) return; const has = map.hasLayer(lay);
    try { if (L_[k] && !has) lay.addTo(map); else if (!L_[k] && has) map.removeLayer(lay); } catch (e) {}
  });
  document.querySelectorAll('#layers input[data-layer]').forEach(i => { i.checked = !!L_[i.dataset.layer]; });
  if (L_.wwl) wwlLayer.bringToBack?.();
}
function drawNewsMarkers() {
  newsLayer.clearLayers();
  for (const [iso, t] of Object.entries(S.tally)) {
    const c = S.byIso[iso]; if (!c) continue;
    const total = t.persecution + t.missions + t.sbc; if (!total) continue;
    const color = t.persecution >= t.missions ? '#dc2626' : '#2563eb';
    L.circleMarker([c.lat, c.lng], { radius: 6 + Math.min(total, 8) * 1.3, color: '#fff', weight: 2, fillColor: color, fillOpacity: .85 })
      .bindTooltip(esc(c.name) + ': ' + t.persecution + ' persecution, ' + t.missions + ' missions').on('click', () => selectCountry(iso)).addTo(newsLayer);
  }
}
function drawJp() {
  jpLayer.clearLayers();
  const u = S.unreached; const c = u && S.byIso[u.iso2]; if (!c) return;
  L.circleMarker([c.lat, c.lng], { radius: 11, color: '#fff', weight: 3, fillColor: '#9333ea', fillOpacity: .95 })
    .bindTooltip('Unreached of the day: ' + esc(u.peopleName)).on('click', () => selectCountry(u.iso2)).addTo(jpLayer);
}
function mPos(m) {
  if (m.sensitive) { const c = S.byIso[m.iso2]; return c ? [c.lat, c.lng] : null; }
  if (isFinite(m.lat) && isFinite(m.lng) && m.lat !== '' && m.lat !== null) return [+m.lat, +m.lng];
  const c = S.byIso[m.iso2]; return c ? [c.lat, c.lng] : null;
}
function displayName(m) { return m.publicName || m.name; }
function drawChurch() {
  churchLayer.clearLayers();
  for (const m of S.missionaries) {
    if (S.settings.privacy && m.sensitive) continue;
    const p = mPos(m); if (!p) continue;
    const color = STATUS_COLORS[m.status] || STATUS_COLORS.other;
    const icon = L.divIcon({ className: '', html: '<div class="divicon" style="background:' + color + '"></div>', iconSize: [22, 22], iconAnchor: [11, 22] });
    L.marker(p, { icon, title: displayName(m) }).bindPopup('<strong>' + esc(displayName(m)) + '</strong>' + (m.example ? ' <em>(EXAMPLE)</em>' : '') + '<br>' + esc(statusLabel(m.status)) + ' · ' + esc(S.byIso[m.iso2]?.name || '') + '<br><small>Updated ' + esc(fmtDate(m.lastUpdate)) + '</small>').addTo(churchLayer);
  }
}
function redrawStyles() { Object.entries(polyByIso).forEach(([iso, l]) => l.setStyle(polyStyle(iso))); }
function selectCountry(iso, fly = true) {
  if (!S.byIso[iso]) return;
  S.country = iso; selectedIso = iso; redrawStyles();
  if (fly && map) { const c = S.byIso[iso]; map.flyTo([c.lat, c.lng], Math.max(map.getZoom(), 3.5), { duration: .8 }); }
  const tc = $('#tabbtn-country'); if (tc) tc.hidden = false;
  setTab('country');
  if (window.innerWidth <= 900) { $('#panel')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); $('#view')?.focus?.(); }
}
async function loadAll() {
  const btn = $('#btn-refresh'); if (btn) { btn.disabled = true; btn.textContent = '⟳ Refreshing…'; }
  try {
    S.feeds = {}; S.countryData = {};
    const [m, t, s] = await Promise.all([api('/api/map'), api('/api/today?date=' + todayStr()), api('/api/sources')]);
    S.tally = m.tally; S.unreached = m.unreached; S.today = t; S.sources = s.sources; S.attr = s.attribution; S.apiDown = false;
    drawNewsMarkers(); drawJp(); drawChurch(); updateBanner();
    $('#updated').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) { S.apiDown = true; toast('Load failed: ' + e.message, true); $('#updated').textContent = 'Load failed'; }
  if (btn) { btn.disabled = false; btn.textContent = '⟳ Refresh'; }
  render();
}
async function ensureFeed(cat) {
  if (!S.feeds[cat]) { S.feeds[cat] = await api('/api/feeds?cat=' + cat + '&limit=40'); S.feeds[cat].items.forEach(i => { S.items[i.id] = i; }); }
  return S.feeds[cat];
}
function updateBanner() {
  const b = $('#banner'); if (!b) return;
  const bad = S.sources.filter(s => !['ok', 'pending'].includes(s.state));
  const ex = S.today && (S.today.examples?.persecution || S.today.examples?.missions);
  if (!bad.length && !ex) { b.hidden = true; return; }
  const names = { empty: 'resting today', stale: 'older copy', error: 'unreachable', cached: 'showing last good copy', pending: 'pending first fetch' };
  b.hidden = false;
  b.innerHTML = '<strong>Source status:</strong> ' + bad.map(s => esc(s.org) + ' — ' + (names[s.state] || s.state)).join(' · ') + (ex ? ' · <strong>EXAMPLE placeholders shown.</strong>' : '') + ' <a href="#" data-act="tab" data-tab="sources">details</a>';
}
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('#tabs button[role="tab"]').forEach(b => {
    const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
  });
  $('#view')?.setAttribute('aria-labelledby', 'tabbtn-' + t);
  render(); $('#view') && ($('#view').scrollTop = 0);
}
async function render() {
  const my = ++renderSeq; const v = $('#view'); if (!v) return;
  const focusId = document.activeElement?.dataset?.id;
  try { $('#pl-count').textContent = S.prayer.length ? String(S.prayer.filter(p => !prayedToday(p)).length || '✓') : ''; } catch { try { $('#pl-count').textContent = ''; } catch {} }
  try {
    if (S.apiDown && !S.today) { v.innerHTML = '<div class="error-panel"><h2>Can\'t reach the prayer server</h2><p>Check your connection, then try again.</p><button class="primary" data-act="retry">Try again</button></div>'; return; }
    if (S.tab === 'today') v.innerHTML = renderToday();
    else if (S.tab === 'country') {
      v.innerHTML = '<p class="muted">Loading country…</p>';
      const html = await renderCountry();
      if (my !== renderSeq || S.tab !== 'country') return;
      v.innerHTML = html; loadImb(S.country);
    } else if (['persecution', 'missions', 'sbc'].includes(S.tab)) {
      const cat = S.tab; v.innerHTML = '<p class="muted">Loading…</p>';
      const f = await ensureFeed(cat); if (my !== renderSeq || S.tab !== cat) return; v.innerHTML = renderFeed(cat, f);
    } else if (S.tab === 'prayer') v.innerHTML = renderPrayer();
    else if (S.tab === 'church') v.innerHTML = renderChurch();
    else if (S.tab === 'sources') v.innerHTML = renderSources();
    if (focusId) { try { v.querySelector('[data-id="' + CSS.escape(focusId) + '"]')?.focus?.(); } catch {} }
  } catch (e) { if (my === renderSeq) v.innerHTML = '<p class="banner">Could not load this view: ' + esc(e.message) + '</p>'; }
}
const statusLabel = s => ({ active: 'Active on field', furlough: 'On furlough / stateside', needs: 'Specific prayer request', transition: 'In transition', other: 'Other' }[s] || s);
const prayedToday = p => (p.prayed || []).includes(todayStr());
const lastPrayed = p => (p.prayed || []).slice().sort().pop() || null;
function wwlBadge(w) {
  if (!w || !w.rank) return '';
  const cat = w.category === 'extreme' ? 'ext' : w.category === 'high' ? 'hi' : 'vh';
  const label = w.category === 'extreme' ? 'Extreme' : w.category === 'high' ? 'High' : 'Very high';
  return '<span class="badge ' + cat + '">Open Doors ' + label + ' · ' + w.score + '/100</span>';
}
function countryBadges(list) { return (list || []).slice(0, 5).map(i => S.byIso[i] ? '<a href="#" class="badge" data-act="country" data-iso="' + esc(i) + '">' + esc(S.byIso[i].name) + '</a>' : '').join(' '); }
function itemCard(it, opts = {}) {
  S.items[it.id] = it;
  const pinned = S.prayer.some(p => p.id === it.id);
  const gentle = S.settings.projector || S.settings.gentle;
  const showExcerpt = it.excerpt && !(gentle && opts.graphic);
  return '<div class="card ' + (opts.hl ? 'hl ' : '') + (opts.hope ? 'hope' : '') + '"><h3>' + (it.link ? '<a href="' + safeUrl(it.link) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a>' : esc(it.title)) + (it.example ? ' <span class="badge ex">EXAMPLE DATA</span>' : '') + '</h3><div class="meta"><span>' + esc(it.sourceName) + '</span>' + (it.published ? '<span>' + esc(fmtDate(it.published)) + '</span>' : '') + countryBadges(it.countries) + '</div>' + (showExcerpt ? '<p>' + esc(it.excerpt) + '</p>' : (it.excerpt && gentle && opts.graphic ? '<details class="disclose"><summary>Recent report (may be distressing)</summary><p>' + esc(it.excerpt) + '</p></details>' : '')) + '<div class="row">' + (it.example ? '' : '<button class="small" data-act="pin-item" data-id="' + esc(it.id) + '" aria-label="Add to prayer list: ' + esc(it.title) + '">' + (pinned ? '✓ On prayer list' : '＋ Add to my prayer list') + '</button>') + (it.countries[0] ? '<button class="small" data-act="country" data-iso="' + esc(it.countries[0]) + '">Show on map</button>' : '') + '</div></div>';
}
function renderFeed(cat, f) {
  const titles = { persecution: 'Persecuted Church — news & prayer requests', missions: 'Missions — IMB & NAMB stories', sbc: 'SBC news' };
  let h = '<h2>' + titles[cat] + '</h2><div class="meta">' + f.statuses.map(s => '<span><span class="status-dot st-' + esc(s.state) + '"></span>' + esc(s.org) + ': ' + esc(s.state) + '</span>').join(' ') + '</div>';
  if (f.example) h += '<p class="banner">No live source returned items — placeholders are <strong>EXAMPLE DATA</strong>.</p>';
  if (cat === 'missions') h += linkOuts([['IMB — Pray', 'https://www.imb.org/pray/'], ['IMB PrayerPoints', 'https://www.imb.org/prayerpoints/'], ['NAMB — Pray', 'https://www.namb.net/resources/pray/'], ['NAMB 2026 Prayer Calendar', 'https://cdn.namb.net/aaeo_2026/NAMB_Prayer_Calendar_2026.pdf']], 'Prayer pages:');
  h += f.items.map(i => itemCard(i, { graphic: cat === 'persecution' })).join('') || '<p class="muted">No items.</p>';
  return h + '<p class="muted">Country tags are keyword matches and may be imperfect. Content © its publisher.</p>';
}
const linkOuts = (arr, label) => '<div class="card"><div class="meta">' + esc(label) + '</div><div class="row">' + arr.map(([t, u]) => '<a href="' + safeUrl(u) + '" target="_blank" rel="noopener">' + esc(t) + '</a>').join(' · ') + '</div></div>';
function churchOfTheDay() {
  const list = S.missionaries.filter(m => !m.example && !(S.settings.privacy && m.sensitive));
  const pool = list.length ? list : S.missionaries.filter(m => !(S.settings.privacy && m.sensitive));
  if (!pool.length) return null;
  return pool.slice().sort((a, b) => (lastPrayed(a) || '').localeCompare(lastPrayed(b) || '') || a.name.localeCompare(b.name))[0];
}
function renderToday() {
  const t = S.today; if (!t) return '<p class="muted">Loading…</p>';
  const pc = t.persecutedCountry; const u = t.unreached;
  let h = '<h2>Today’s prayer guide <span class="muted">' + esc(fmtDate(t.date)) + '</span></h2><p class="frame">Take a breath. Let’s pray together — about five minutes.</p>';
  if (t.scripture) h += '<div class="card"><div class="meta">Come · Scripture of the day (ESV) · <a href="' + safeUrl(t.scripture.link) + '" target="_blank" rel="noopener">Data provided by Joshua Project</a></div><p class="bigscripture">' + esc(t.scripture.text) + '</p></div>';
  h += '<div class="card hope"><h3>Give thanks</h3><p class="frame">We pray as one body — if one member suffers, all suffer together (1 Cor 12:26). We also give thanks: Christ is building His church (Matt 16:18).</p>';
  if (t.missionsStory) h += itemCard(t.missionsStory, { hope: true });
  else if (t.fact) h += '<p>' + esc(t.fact.text) + ' <a href="' + safeUrl(t.fact.link) + '" target="_blank" rel="noopener">Data provided by Joshua Project</a></p>';
  else h += '<div class="prompt">Give thanks for workers God has already sent, and for every open door for the gospel.</div>';
  h += '</div>';
  const m = churchOfTheDay();
  if (m) h += '<div class="card hl"><h3>Our missionaries</h3><h4>' + esc(displayName(m)) + (m.example ? ' <span class="badge ex">EXAMPLE</span>' : '') + '</h4><div class="meta"><span class="badge s-' + esc(m.status) + '">' + esc(statusLabel(m.status)) + '</span><span>' + esc(S.byIso[m.iso2]?.name || '') + '</span></div><p>' + esc(m.needs || 'Hold them before the Lord today.') + '</p><div class="row"><button class="small primary" data-act="m-prayed" data-id="' + esc(m.id) + '">✓ Mark prayed today</button><button class="small" data-act="tab" data-tab="church">All missionaries</button></div></div>';
  else if (S.missionaries.some(x => x.sensitive) && S.settings.privacy) h += '<div class="card hl"><h3>Our missionaries</h3><p>Pray for our workers in hard-to-reach places (names withheld).</p></div>';
  else h += '<div class="card"><h3>Our missionaries</h3><p class="muted">None entered yet. Add them under “Our Missionaries” (stored only on this device).</p></div>';
  if (u) h += '<div class="card hl"><h3>Unreached people</h3><h4>The ' + esc(u.peopleName) + ' of ' + esc(u.country) + '</h4><p>About ' + esc(u.population) + ' ' + esc(u.language) + '-speaking ' + esc(u.religion) + (u.evangelicalPct != null ? ', with ' + esc(u.evangelicalPct) + '% evangelical' : '') + '.</p>' + (u.apiExtras?.prayForPeople ? '<div class="prompt">' + esc(u.apiExtras.prayForPeople) + '</div>' : '<div class="prompt">Pray that God would raise up workers and open hearts (Romans 10:14-15).</div>') + '<div class="row"><a href="' + safeUrl(u.link) + '" target="_blank" rel="noopener">Data provided by Joshua Project</a>' + (u.iso2 ? '<button class="small" data-act="country" data-iso="' + esc(u.iso2) + '">Show on map</button>' : '') + '<button class="small" data-act="pin-jp">＋ Add to my prayer list</button></div></div>';
  else h += '<div class="card"><h3>Unreached people</h3><p class="muted">Joshua Project feed unavailable.</p></div>';
  h += '<div class="card hl"><h3>The suffering church</h3><h4>Today we remember believers in ' + esc(pc.name) + ' ' + wwlBadge(pc) + '</h4><div class="prompt">' + esc(pc.prompts[0].text) + ' <span class="muted">(' + esc(pc.prompts[0].ref) + ')</span></div>';
  if (pc.news?.length) {
    if (S.settings.projector || S.settings.gentle) { h += '<details class="disclose"><summary>Recent report about ' + esc(pc.name) + ' (may be distressing)</summary>' + pc.news.map(n => '<p>• <a href="' + safeUrl(n.link) + '" target="_blank" rel="noopener">' + esc(n.title) + '</a></p>').join('') + '</details>'; }
    else h += pc.news.map(n => '<p>• <a href="' + safeUrl(n.link) + '" target="_blank" rel="noopener">' + esc(n.title) + '</a> <span class="muted">— ' + esc(n.sourceName) + '</span></p>').join('');
  }
  if (t.persecutionStory) h += (S.settings.projector || S.settings.gentle) ? '<details class="disclose"><summary>Other recent persecution news (may be distressing)</summary>' + itemCard(t.persecutionStory, { graphic: true }) + '</details>' : itemCard(t.persecutionStory, { graphic: true });
  h += '<div class="row"><button class="small" data-act="country" data-iso="' + esc(pc.iso2) + '">Open country &amp; map</button><button class="small" data-act="pin-country" data-iso="' + esc(pc.iso2) + '">＋ Pray for this country</button></div></div>';
  h += '<div class="card hope"><h3>Send</h3><div class="prompt">Lord of the harvest, send out workers into Your harvest. Amen. <span class="muted">(Matthew 9:37-38)</span></div><div class="row"><button class="small primary" data-act="prayed-today-all">✓ I prayed through today</button></div></div>';
  h += '<p class="muted"><a href="#" data-act="tab" data-tab="prayer">Open prayer list</a> · <a href="#" data-act="print">Print weekly sheet</a></p>';
  h += '<div class="print-only"><h2>Weekly prayer sheet — ' + esc(fmtDate(t.date)) + '</h2><p>Country: ' + esc(pc.name) + '. Unreached: ' + esc(u?.peopleName || '—') + '. Missionaries: ' + (S.missionaries.filter(m => !(m.sensitive && S.settings.privacy)).map(m => esc(displayName(m))).join(', ') || '—') + '</p></div>';
  return h;
}
async function renderCountry() {
  const iso = S.country; if (!iso) return '<p class="muted">Click a country on the map.</p>';
  const d = S.countryData[iso] || (S.countryData[iso] = await api('/api/country/' + iso));
  d.news.forEach(i => { S.items[i.id] = i; });
  const c = d.country; const mine = S.missionaries.filter(m => m.iso2 === iso && !(S.settings.privacy && m.sensitive));
  let h = '<h2>' + esc(c.name) + ' ' + (d.wwl.rank ? wwlBadge(d.wwl) : '') + '</h2>';
  h += d.wwl.rank ? '<p class="meta"><a href="' + safeUrl(d.wwl.source) + '" target="_blank" rel="noopener">© Open Doors International</a></p>' : '<p class="muted">' + esc(d.wwl.note) + '</p>';
  h += '<div class="row"><button class="small" data-act="pin-country" data-iso="' + esc(iso) + '">＋ Pray for ' + esc(c.name) + '</button><button class="small" data-act="add-m" data-iso="' + esc(iso) + '">＋ Add our missionary here</button></div>';
  h += '<h3>Prayer points</h3>' + d.prompts.map(p => '<div class="prompt">' + esc(p.text) + ' <span class="muted">(' + esc(p.ref) + ')</span></div>').join('');
  h += '<h3>Our church’s missionaries here</h3>' + (mine.map(m => '<div class="card"><strong>' + esc(displayName(m)) + '</strong> <span class="badge s-' + esc(m.status) + '">' + esc(statusLabel(m.status)) + '</span><p>' + esc(m.needs || '') + '</p></div>').join('') || '<p class="muted">None entered (or hidden while privacy is on).</p>');
  h += '<h3>Latest headlines</h3>' + (d.news.map(i => itemCard(i, { graphic: true })).join('') || '<p class="muted">None.</p>');
  if (S.countryData[iso]?.imb) {
    const imb = S.countryData[iso].imb;
    h += imb.stories?.length ? '<h3>IMB stories</h3>' + imb.stories.map(i => itemCard(i)).join('') : '<p class="muted">No IMB stories tagged for this country.</p>';
  } else h += '<div id="imb-slot"><p class="muted">Looking for IMB stories tagged “' + esc(c.name) + '”…</p></div>';
  h += linkOuts(d.links.map(l => [l.label, l.url]), 'Go deeper:');
  return h;
}
async function loadImb(iso) {
  if (!iso || !S.countryData[iso]) return;
  try {
    const r = S.countryData[iso].imb || (S.countryData[iso].imb = await api('/api/country/' + iso + '/imb'));
    r.stories.forEach(i => { S.items[i.id] = i; });
    const slot = $('#imb-slot'); if (!slot || S.country !== iso || S.tab !== 'country') return;
    slot.innerHTML = r.stories.length ? '<h3>IMB stories tagged “' + esc(S.byIso[iso].name) + '”</h3>' + r.stories.map(i => itemCard(i)).join('') : '<p class="muted">No IMB stories tagged for this country.</p>';
  } catch (e) { const slot = $('#imb-slot'); if (slot) slot.innerHTML = '<p class="muted">IMB stories unavailable (' + esc(e.message) + ').</p>'; }
}
function renderPrayer() {
  const items = S.prayer.slice().sort((a, b) => (prayedToday(a) - prayedToday(b)) || (lastPrayed(a) || '').localeCompare(lastPrayed(b) || ''));
  let h = '<h2>Prayer list</h2><div class="card"><form data-form="custom-prayer"><label class="f">Add your own request<input name="title" required maxlength="200"></label><div class="row"><button class="small primary">Add to list</button></div></form></div>';
  h += items.map(p => '<div class="card ' + (prayedToday(p) ? '' : 'hl') + '"><h3>' + (p.link ? '<a href="' + safeUrl(p.link) + '" target="_blank" rel="noopener">' + esc(p.title) + '</a>' : esc(p.title)) + '</h3><div class="meta"><span>' + esc(p.source || p.type) + '</span></div><div class="row"><button class="small ' + (prayedToday(p) ? '' : 'primary') + '" data-act="prayed" data-id="' + esc(p.id) + '">' + (prayedToday(p) ? '✓ Prayed today (undo)' : 'Mark prayed today') + '</button><button class="small danger" data-act="unpin" data-id="' + esc(p.id) + '">Remove</button></div></div>').join('') || '<p class="muted">Nothing pinned yet.</p>';
  return h + dataTools();
}
const dataTools = () => '<h3>Backup</h3><label class="chk"><input type="checkbox" id="export-full"> Include sensitive entries &amp; private notes (full private backup)</label><div class="row"><button class="small" data-act="export">⬇ Export JSON</button><button class="small" data-act="import">⬆ Import JSON</button><button class="small danger" data-act="wipe">Wipe all data on this device</button><input type="file" id="import-file" accept="application/json" hidden></div><p class="muted">Default export excludes sensitive workers and private notes.</p>';
function mForm(m) {
  const ctry = S.countries.map(c => '<option value="' + esc(c.iso2) + '" ' + (m.iso2 === c.iso2 ? 'selected' : '') + '>' + esc(c.name) + '</option>').join('');
  const forceSens = !!(m.iso2 && wwlOf(m.iso2));
  return '<div class="card"><form data-form="missionary"><input type="hidden" name="id" value="' + esc(m.id || '') + '"><div class="grid2"><label class="f">Name(s) / family (private)<input name="name" required maxlength="120" value="' + esc(m.name) + '"></label><label class="f">Public display name<input name="publicName" maxlength="120" value="' + esc(m.publicName || '') + '" placeholder="e.g. The J. family"></label></div><div class="grid2"><label class="f">Agency<input name="agency" maxlength="120" value="' + esc(m.agency) + '"></label><label class="f">Country<select name="iso2" required><option value="">—</option>' + ctry + '</select></label></div><label class="f">Status<select name="status">' + [...STATUS_OK].map(k => '<option value="' + k + '" ' + (m.status === k ? 'selected' : '') + '>' + esc(statusLabel(k)) + '</option>').join('') + '</select></label><label class="f">Last update<input name="lastUpdate" type="date" value="' + esc(m.lastUpdate) + '"></label><label class="f">Public prayer text<textarea name="needs" maxlength="1000">' + esc(m.needs) + '</textarea></label><label class="f">Private notes<textarea name="notes" maxlength="1000">' + esc(m.notes) + '</textarea></label><label class="chk"><input type="checkbox" name="sensitive" ' + (m.sensitive !== false || forceSens ? 'checked' : '') + (forceSens ? ' disabled' : '') + '> Sensitive — hide while privacy is on' + (forceSens ? ' (required for Open Doors-listed countries)' : '') + '</label>' + (forceSens ? '<input type="hidden" name="sensitive" value="on">' : '') + '<p class="muted">New entries default to sensitive. Exact coordinates are not collected for sensitive workers.</p><div class="row"><button class="small primary">Save</button><button type="button" class="small" data-act="m-cancel">Cancel</button></div></form></div>';
}
function renderChurch() {
  let h = '<h2>Our church’s missionaries</h2><p class="muted">Stored in this browser only. New entries default to <strong>sensitive</strong>.</p><div class="row"><button class="small primary" data-act="m-new">＋ Add missionary</button><button class="small" data-act="m-examples">Load 3 EXAMPLE entries</button><button class="small danger" data-act="m-clear-examples">Remove examples</button></div>';
  if (S.editing) { const m = S.editing === 'new' ? { status: 'active', lastUpdate: todayStr(), sensitive: true, ...(S.draft || {}) } : S.missionaries.find(x => x.id === S.editing); if (m) h += mForm(m); }
  h += S.missionaries.slice().sort((a, b) => a.name.localeCompare(b.name)).map(m => {
    if (S.settings.privacy && m.sensitive) return '';
    return '<div class="card"><h3>' + esc(displayName(m)) + (m.example ? ' <span class="badge ex">EXAMPLE</span>' : '') + ' <span class="badge s-' + esc(m.status) + '">' + esc(statusLabel(m.status)) + '</span></h3><div class="meta"><span>' + esc(S.byIso[m.iso2]?.name || '') + '</span>' + (m.sensitive ? '<span class="badge">sensitive</span>' : '') + '</div>' + (m.needs ? '<p>' + esc(m.needs) + '</p>' : '') + '<div class="row"><button class="small" data-act="m-prayed" data-id="' + esc(m.id) + '">Mark prayed today</button><button class="small" data-act="m-edit" data-id="' + esc(m.id) + '">Edit</button><button class="small" data-act="country" data-iso="' + esc(m.iso2) + '">Country</button><button class="small danger" data-act="m-del" data-id="' + esc(m.id) + '">Delete</button></div></div>';
  }).join('') || '<p class="muted">No missionaries yet (or all hidden while privacy is on).</p>';
  return h + dataTools();
}
function renderSources() {
  let h = '<h2>Sources & status</h2><table><tr><th>Source</th><th>State</th><th>Items</th><th>Last OK</th></tr>';
  h += S.sources.map(s => '<tr><td><a href="' + safeUrl(s.home) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a><br><span class="muted">' + esc(s.terms) + '</span></td><td><span class="status-dot st-' + esc(s.state) + '"></span>' + esc(s.state) + '</td><td>' + s.itemsShown + '/' + s.itemsFetched + '</td><td>' + esc(s.lastOk ? new Date(s.lastOk).toLocaleString() : '—') + '</td></tr>').join('');
  h += '</table>';
  const a = S.attr || {};
  h += '<h3>Attribution</h3><ul><li><strong>Open Doors:</strong> ' + esc(a.openDoors?.text || '© Open Doors International') + ' — <a href="' + safeUrl(a.openDoors?.url || 'https://www.opendoors.org/research-reports/wwl-documentation/') + '" target="_blank" rel="noopener">docs</a></li><li><a href="https://joshuaproject.net/" target="_blank" rel="noopener">Data provided by Joshua Project</a></li><li>' + esc(a.imb?.text || '') + '</li><li><a href="' + safeUrl(a.morningStar?.url) + '" target="_blank" rel="noopener">' + esc(a.morningStar?.text || 'Morning Star News CC BY 3.0 US') + '</a></li><li>' + esc(a.icc?.text || 'ICC (International Christian Concern) · www.persecution.org') + '</li><li>' + esc(a.esv?.text || 'ESV © Crossway') + '</li></ul>';
  return h;
}
function pinItem(it) {
  if (!it) return;
  const i = S.prayer.findIndex(p => p.id === it.id);
  if (i >= 0) { S.prayer.splice(i, 1); toast('Removed from prayer list'); }
  else { S.prayer.push({ id: it.id, type: 'feed', title: it.title, link: it.link, source: it.sourceName, countries: it.countries || [], pinnedAt: todayStr(), prayed: [] }); toast('Added to prayer list'); }
  saveP(); render();
}
function exportAll() {
  const full = !!$('#export-full')?.checked;
  let missionaries = S.missionaries;
  if (!full) missionaries = missionaries.filter(m => !m.sensitive).map(m => { const { notes, lat, lng, ...rest } = m; return { ...rest, notes: undefined, lat: null, lng: null }; });
  else if (!confirm('Full backup includes sensitive entries and private notes. Continue?')) return;
  const blob = new Blob([JSON.stringify({ app: 'sbc-prayer-console', version: 2, exportedAt: new Date().toISOString(), full, missionaries, prayerList: S.prayer }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'prayer-console-' + todayStr() + '.json'; document.body.appendChild(a); a.click(); a.remove();
}
async function importFile(file) {
  try {
    if (file.size > 1000000) throw new Error('file too large (max 1 MB)');
    const j = JSON.parse(await file.text());
    if (j.app !== 'sbc-prayer-console' || !Array.isArray(j.missionaries) || !Array.isArray(j.prayerList)) throw new Error('not a prayer-console export');
    const ms = j.missionaries.map(m => normMissionary(m, S.byIso)).filter(Boolean);
    const ps = j.prayerList.map(p => normPrayer(p, S.byIso)).filter(Boolean);
    if (!ms.length && !ps.length) throw new Error('no valid rows after schema validation');
    if (!confirm('Replace with ' + ms.length + ' missionaries and ' + ps.length + ' prayer items?')) return;
    try { LS.set('backup.' + Date.now(), { missionaries: S.missionaries, prayer: S.prayer }); } catch {}
    S.missionaries = ms; S.prayer = ps; saveM(); saveP(); drawChurch(); render(); toast('Imported');
  } catch (e) { toast('Import failed: ' + e.message, true); }
}
function wipeAll() {
  if (!confirm('Wipe ALL data on this device?') || !confirm('Really wipe everything?')) return;
  Object.keys(localStorage).filter(k => k.startsWith('spc.')).forEach(k => { try { localStorage.removeItem(k); } catch {} });
  S.missionaries = []; S.prayer = []; S.editing = null; S.settings.privacy = true; S.settings.projector = false;
  drawChurch(); render(); toast('All local data wiped');
}
const EXAMPLES = [
  { name: 'EXAMPLE – Family A', publicName: 'EXAMPLE Family A', iso2: 'KE', status: 'active', needs: 'Example prayer need.', agency: 'Example', sensitive: false },
  { name: 'EXAMPLE – Family B', publicName: 'EXAMPLE Family B', iso2: 'BR', status: 'furlough', needs: 'Example prayer need.', agency: 'Example', sensitive: false },
  { name: 'EXAMPLE – Worker C', publicName: 'EXAMPLE Worker C', iso2: 'JP', status: 'needs', needs: 'Example prayer need.', agency: 'Example', sensitive: false },
];
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id; if (el.tagName === 'A') e.preventDefault();
  if (act === 'tab') setTab(el.dataset.tab);
  else if (act === 'country') selectCountry(el.dataset.iso);
  else if (act === 'pin-item') pinItem(S.items[id]);
  else if (act === 'pin-country') { const c = S.byIso[el.dataset.iso]; const pid = 'country:' + c.iso2; if (!S.prayer.some(p => p.id === pid)) { S.prayer.push({ id: pid, type: 'country', title: 'Pray for believers in ' + c.name, source: 'Country', countries: [c.iso2], pinnedAt: todayStr(), prayed: [] }); saveP(); toast('Added'); } render(); }
  else if (act === 'pin-jp') { const u = S.today?.unreached; if (u) { const pid = 'jp:' + String(u.link || u.peopleName).slice(0, 30).replace(/[^a-zA-Z0-9:_-]/g, ''); if (!S.prayer.some(p => p.id === pid)) { S.prayer.push({ id: pid, type: 'people', title: 'Pray for the ' + u.peopleName + ' (' + u.country + ')', link: u.link, source: 'Joshua Project', countries: u.iso2 ? [u.iso2] : [], pinnedAt: todayStr(), prayed: [] }); saveP(); toast('Added'); } render(); } }
  else if (act === 'prayed') { const p = S.prayer.find(x => x.id === id); if (p) { const t = todayStr(); p.prayed = p.prayed || []; p.prayed = p.prayed.includes(t) ? p.prayed.filter(d => d !== t) : p.prayed.concat(t); saveP(); render(); } }
  else if (act === 'unpin') { S.prayer = S.prayer.filter(p => p.id !== id); saveP(); render(); }
  else if (act === 'prayed-today-all') { const t = todayStr(); S.prayer.forEach(p => { p.prayed = p.prayed || []; if (!p.prayed.includes(t)) p.prayed.push(t); }); const m = churchOfTheDay(); if (m) { m.prayed = m.prayed || []; if (!m.prayed.includes(t)) m.prayed.push(t); saveM(); } saveP(); toast('Marked today’s focus prayed'); render(); }
  else if (act === 'm-new') { S.editing = 'new'; S.draft = { sensitive: true }; render(); }
  else if (act === 'add-m') { S.editing = 'new'; S.draft = { iso2: el.dataset.iso, sensitive: true }; setTab('church'); }
  else if (act === 'm-edit') { S.editing = id; render(); }
  else if (act === 'm-cancel') { S.editing = null; render(); }
  else if (act === 'm-del') { if (confirm('Delete this missionary entry?')) { S.missionaries = S.missionaries.filter(m => m.id !== id); saveM(); drawChurch(); render(); } }
  else if (act === 'm-prayed') { const m = S.missionaries.find(x => x.id === id); if (m) { const t = todayStr(); m.prayed = m.prayed || []; m.prayed = m.prayed.includes(t) ? m.prayed.filter(d => d !== t) : m.prayed.concat(t); saveM(); render(); } }
  else if (act === 'm-examples') { if (!S.missionaries.some(m => m.example)) { EXAMPLES.forEach(x => S.missionaries.push({ id: uid(), example: true, lastUpdate: todayStr(), prayed: [], ...x })); saveM(); drawChurch(); } render(); }
  else if (act === 'm-clear-examples') { S.missionaries = S.missionaries.filter(m => !m.example); saveM(); drawChurch(); render(); }
  else if (act === 'export') exportAll();
  else if (act === 'import') $('#import-file').click();
  else if (act === 'wipe') wipeAll();
  else if (act === 'retry') { S.apiDown = false; loadAll(); }
  else if (act === 'print') window.print();
  else if (act === 'install') doInstall();
  else if (act === 'install-dismiss') { const tip = $('#install-tip'); if (tip) tip.hidden = true; try { sessionStorage.setItem('spc.installDismissed', '1'); } catch {} }
});
document.addEventListener('change', e => { if (e.target.id === 'import-file' && e.target.files[0]) { importFile(e.target.files[0]); e.target.value = ''; } });
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
  const fd = Object.fromEntries(new FormData(f));
  if (f.dataset.form === 'custom-prayer') { S.prayer.push({ id: 'c:' + uid(), type: 'custom', title: fd.title.trim(), source: 'Our request', countries: [], pinnedAt: todayStr(), prayed: [] }); saveP(); render(); return; }
  if (f.dataset.form === 'missionary') {
    const forceSens = !!(fd.iso2 && wwlOf(fd.iso2));
    const sensitive = forceSens || fd.sensitive === 'on' || !!fd.sensitive;
    const rec = normMissionary({ id: fd.id || uid(), name: fd.name, publicName: fd.publicName, agency: fd.agency, iso2: fd.iso2, place: '', lat: null, lng: null, status: fd.status, lastUpdate: fd.lastUpdate || todayStr(), needs: fd.needs, notes: fd.notes, sensitive, prayed: fd.id ? (S.missionaries.find(x => x.id === fd.id)?.prayed || []) : [] }, S.byIso);
    if (!rec) { toast('Could not save — check fields.', true); return; }
    if (fd.id) { const i = S.missionaries.findIndex(x => x.id === fd.id); if (i >= 0) S.missionaries[i] = { ...S.missionaries[i], ...rec }; else S.missionaries.push(rec); }
    else S.missionaries.push(rec);
    S.editing = null; saveM(); drawChurch(); render(); toast('Saved');
  }
});
$('#tabs')?.addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
$('#tabs')?.addEventListener('keydown', e => {
  const tabs = [...document.querySelectorAll('#tabs button[role="tab"]:not([hidden])')];
  const i = tabs.indexOf(document.activeElement); if (i < 0) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = e.key === 'ArrowRight' ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length; tabs[n].focus(); setTab(tabs[n].dataset.tab); }
});
$('#btn-refresh')?.addEventListener('click', () => loadAll());
$('#btn-install')?.addEventListener('click', () => doInstall());
$('#layers')?.addEventListener('change', e => { const k = e.target.dataset.layer; if (k) { S.settings.layers[k] = e.target.checked; saveSet(); syncLayers(); } });
$('#layers-toggle')?.addEventListener('click', () => { const body = $('#layers-body'); const open = body.hidden; body.hidden = !open; $('#layers-toggle').setAttribute('aria-expanded', open ? 'true' : 'false'); });
$('#projector')?.addEventListener('change', e => { S.settings.projector = e.target.checked; document.documentElement.classList.toggle('projector', e.target.checked); document.body.classList.toggle('projector', e.target.checked); saveSet(); setTimeout(() => map && map.invalidateSize(), 100); render(); });
$('#privacy')?.addEventListener('change', e => {
  if (!e.target.checked) { if (!confirm('Reveal sensitive workers for this session only? Privacy turns back on when you reload.')) { e.target.checked = true; return; } }
  S.settings.privacy = e.target.checked; S.editing = null;
  const pb = $('#privacy-banner'); if (pb) pb.hidden = !e.target.checked;
  saveSet(); drawChurch(); render();
});
let autoTimer = null;
$('#auto-refresh')?.addEventListener('change', e => { S.settings.auto = e.target.checked; saveSet(); clearInterval(autoTimer); if (e.target.checked) autoTimer = setInterval(() => loadAll(), 15 * 60000); });
function scheduleMidnight() {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).formatToParts(now);
    const get = t => +parts.find(p => p.type === t).value;
    const ms = (86400 - (get('hour') * 3600 + get('minute') * 60 + get('second')) + 2) * 1000;
    setTimeout(() => { loadAll(); scheduleMidnight(); }, ms);
  } catch {}
}

/* ---------- PWA: service worker + install ---------- */
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = $('#btn-install'); if (btn) btn.hidden = false;
  showInstallTip(false);
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  const tip = $('#install-tip'); if (tip) tip.hidden = true;
  const btn = $('#btn-install'); if (btn) btn.hidden = true;
  toast('Installed — open Pray from your home screen');
});
function showInstallTip(forceIos) {
  if (isStandalone()) return;
  const tip = $('#install-tip'); if (!tip) return;
  try { if (sessionStorage.getItem('spc.installDismissed') && !forceIos) return; } catch {}
  if (isIOS() || forceIos) {
    tip.hidden = false;
    tip.innerHTML = '<span><strong>Install on iPhone/iPad:</strong> open in <b>Safari</b>, tap <b>Share</b> → <b>Add to Home Screen</b>. The app then works offline with today’s focus cached.</span><button type="button" class="small" data-act="install-dismiss">Dismiss</button>';
  } else if (deferredPrompt) {
    tip.hidden = false;
    tip.innerHTML = '<span><strong>Install app</strong> for full-screen, offline prayer on this device.</span><span class="row"><button type="button" class="small primary" data-act="install">Install app</button><button type="button" class="small" data-act="install-dismiss">Not now</button></span>';
  }
}
async function doInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch {}
    deferredPrompt = null;
    const btn = $('#btn-install'); if (btn) btn.hidden = true;
    const tip = $('#install-tip'); if (tip) tip.hidden = true;
    return;
  }
  if (isIOS()) { showInstallTip(true); toast('Safari: Share → Add to Home Screen'); }
  else toast('Browser menu → Install app / Add to Home screen');
}
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) toast('Update ready — reload to apply');
      });
    });
  }).catch((e) => console.warn('SW register failed', e.message));
}

(async function boot() {
  $('#projector').checked = S.settings.projector;
  document.documentElement.classList.toggle('projector', S.settings.projector);
  document.body.classList.toggle('projector', S.settings.projector);
  $('#privacy').checked = true; S.settings.privacy = true;
  const pb = $('#privacy-banner'); if (pb) pb.hidden = false;
  $('#auto-refresh').checked = S.settings.auto;
  if (S.settings.auto) autoTimer = setInterval(() => loadAll(), 15 * 60000);
  try { const q = new URLSearchParams(location.search); const tab = q.get('tab'); if (tab && ['today','prayer','church','missions','persecution','sbc','sources'].includes(tab)) S.tab = tab; } catch {}
  if (window.innerWidth <= 900) { const body = $('#layers-body'); if (body) body.hidden = true; }
  else { const body = $('#layers-body'); if (body) { body.hidden = false; $('#layers-toggle')?.setAttribute('aria-expanded', 'true'); } }
  try {
    const [c, g] = await Promise.all([api('/api/countries'), api('/api/geojson')]);
    S.countries = c.countries; S.byIso = Object.create(null); S.countries.forEach(x => { S.byIso[x.iso2] = x; });
    S.missionaries = S.missionaries.map(m => normMissionary(m, S.byIso)).filter(Boolean);
    S.prayer = S.prayer.map(p => normPrayer(p, S.byIso)).filter(Boolean);
    saveM(); saveP(); S.geojson = g; initMap();
  } catch (e) { S.apiDown = true; $('#view').innerHTML = '<div class="error-panel"><h2>Could not load map data</h2><p>' + esc(e.message) + '</p><button class="primary" data-act="retry">Try again</button></div>'; }
  scheduleMidnight(); await loadAll();
  registerSW();
  if (!isStandalone() && isIOS()) setTimeout(() => showInstallTip(true), 1800);
  else if (!isStandalone()) setTimeout(() => showInstallTip(false), 2500);
})();
