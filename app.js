/* ============================================================
   ROTA DEFTERİ — Uzun Yol ve Tatil Rota Planlayıcı (Prototip)
   Ücretsiz servisler: Nominatim (geocode), OSRM (rota),
   Open-Meteo (hava), Overpass API (mekân)
   ============================================================ */

const STORAGE_KEYS = {
  trips: 'rd_trips',
  settings: 'rd_settings',
  favorites: 'rd_favorites',
};

const DEFAULT_SETTINGS = {
  name: '', home: '', fuelPrice: 45, navApp: 'google', mapProvider: 'carto_voyager', foursquareApiKey: ''
};

const TILE_PROVIDERS = {
  osm: {
    label: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap katkıda bulunanları',
    maxZoom: 19,
  },
  carto_voyager: {
    label: 'CartoDB Voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap katkıda bulunanları, © CARTO',
    subdomains: 'abcd', maxZoom: 20,
  },
  carto_dark: {
    label: 'CartoDB Dark',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© OpenStreetMap katkıda bulunanları, © CARTO',
    subdomains: 'abcd', maxZoom: 20,
  },
  esri: {
    label: 'Esri Sokak Haritası',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri ve katkıda bulunanları',
    maxZoom: 19,
  },
};

let state = {
  trips: loadJSON(STORAGE_KEYS.trips, []),
  favorites: loadJSON(STORAGE_KEYS.favorites, []),
  settings: loadJSON(STORAGE_KEYS.settings, DEFAULT_SETTINGS),
  currentTrip: null,   // yolculuk oluşturma sırasında geçici obje
  map: null,
  standaloneMap: null,
  routeLayer: null,
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* depolama dolu olabilir */ }
}

function toast(msg) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ---------------- VIEW ROUTING ---------------- */
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + name);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-btn, .bn-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  if (name === 'trips') renderAllTrips();
  if (name === 'favorites') renderFavorites();
  if (name === 'map') renderStandaloneMap();
  if (name === 'settings') fillSettingsForm();
  window.scrollTo(0, 0);
}

document.querySelectorAll('[data-view]').forEach(el => {
  el.addEventListener('click', () => showView(el.dataset.view));
});
document.querySelectorAll('[data-back]').forEach(el => {
  el.addEventListener('click', () => showView(el.dataset.back));
});

/* ---------------- HOME ---------------- */
function renderHome() {
  const slot = document.getElementById('upcoming-card-slot');
  const upcoming = state.trips
    .filter(t => t.status !== 'tamamlandı')
    .sort((a, b) => new Date(a.date + 'T' + a.time) - new Date(b.date + 'T' + b.time))[0];

  if (!upcoming) {
    slot.innerHTML = '';
  } else {
    slot.innerHTML = `
      <div class="upcoming-card" onclick="openTrip('${upcoming.id}')">
        <div class="route-line">${esc(upcoming.start)} → ${esc(upcoming.end)}</div>
        <div class="route-meta">${formatDateTR(upcoming.date)} · ${upcoming.time} çıkış</div>
        <div class="stat-grid">
          <div class="stat"><div class="val">${upcoming.distanceKm ? upcoming.distanceKm.toFixed(0) + ' km' : '—'}</div><div class="lbl">Mesafe</div></div>
          <div class="stat"><div class="val">${upcoming.durationText || '—'}</div><div class="lbl">Toplam süre</div></div>
          <div class="stat"><div class="val">${upcoming.arrivalText || '—'}</div><div class="lbl">Varış</div></div>
        </div>
      </div>`;
  }

  const list = document.getElementById('saved-trips-list');
  const rest = state.trips.filter(t => t.id !== (upcoming && upcoming.id)).slice(0, 5);
  if (rest.length === 0 && !upcoming) {
    list.innerHTML = '<div class="empty-state">Henüz kayıtlı yolculuğunuz yok. Yukarıdan yeni bir yolculuk oluşturun.</div>';
  } else {
    list.innerHTML = rest.map(tripListItemHTML).join('');
  }
}

function tripListItemHTML(t) {
  return `<div class="trip-item" onclick="openTrip('${t.id}')">
    <div>
      <div class="ti-route">${esc(t.start)} → ${esc(t.end)}</div>
      <div class="ti-meta">${formatDateTR(t.date)} · ${t.time} · ${t.distanceKm ? t.distanceKm.toFixed(0) + ' km' : 'mesafe hesaplanmadı'}</div>
    </div>
    <div>›</div>
  </div>`;
}

function renderAllTrips() {
  const list = document.getElementById('all-trips-list');
  if (state.trips.length === 0) {
    list.innerHTML = '<div class="empty-state">Henüz kayıtlı yolculuğunuz yok.</div>';
    return;
  }
  const sorted = [...state.trips].sort((a, b) => new Date(b.date) - new Date(a.date));
  list.innerHTML = sorted.map(tripListItemHTML).join('');
}

function renderFavorites() {
  const list = document.getElementById('favorites-list');
  const hint = document.getElementById('favorites-empty-hint');
  if (state.favorites.length === 0) {
    list.innerHTML = '';
    hint.style.display = 'block';
    return;
  }
  hint.style.display = 'none';
  list.innerHTML = state.favorites.map(f => `
    <div class="trip-item">
      <div>
        <div class="ti-route">${esc(f.name)}</div>
        <div class="ti-meta">${esc(f.category || '')}</div>
      </div>
      <a href="https://www.google.com/maps/search/?api=1&query=${f.lat},${f.lon}" target="_blank" class="mini-btn" style="text-decoration:none">Haritada Aç</a>
    </div>`).join('');
}

function esc(s) { return (s || '').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function formatDateTR(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* ---------------- YENİ YOLCULUK FORMU ---------------- */
document.getElementById('btn-new-trip').addEventListener('click', () => {
  document.getElementById('f-date').min = new Date().toISOString().slice(0, 10);
  if (!document.getElementById('f-date').value) {
    document.getElementById('f-date').value = new Date().toISOString().slice(0, 10);
  }
  showView('new-trip');
});

document.getElementById('btn-use-location').addEventListener('click', async () => {
  if (!navigator.geolocation) { toast('Bu tarayıcı konum özelliğini desteklemiyor.'); return; }
  toast('Konum alınıyor…');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    const label = await reverseGeocode(latitude, longitude);
    document.getElementById('f-start').value = label || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    document.getElementById('f-start').dataset.lat = latitude;
    document.getElementById('f-start').dataset.lon = longitude;
  }, () => {
    toast('Konum izni verilmedi. Adresi elle yazabilirsiniz.');
  });
});

document.getElementById('trip-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Rota hesaplanıyor…';

  try {
    const startText = document.getElementById('f-start').value.trim();
    const endText = document.getElementById('f-end').value.trim();
    const date = document.getElementById('f-date').value;
    const time = document.getElementById('f-time').value;

    if (!date || !time) { toast('Lütfen tarih ve saat girin.'); return; }
    const departureDT = new Date(date + 'T' + time);
    if (isNaN(departureDT.getTime())) { toast('Geçersiz tarih/saat.'); return; }

    // 1) Geocode
    const startCoord = document.getElementById('f-start').dataset.lat
      ? { lat: +document.getElementById('f-start').dataset.lat, lon: +document.getElementById('f-start').dataset.lon, label: startText }
      : await geocode(startText);
    const endCoord = await geocode(endText);

    if (!startCoord) { toast('Başlangıç adresi bulunamadı. Farklı bir yazım deneyin.'); return; }
    if (!endCoord) { toast('Varış adresi bulunamadı. Farklı bir yazım deneyin.'); return; }

    // 2) Route (OSRM) — alternatif rotalarla birlikte
    const routeOptions = await fetchRoutes(startCoord, endCoord);
    if (!routeOptions) { toast('Rota hesaplanamadı. Rota servisi şu anda yanıt vermiyor olabilir.'); return; }
    const defaultRoute = routeOptions[0]; // fetchRoutes en hızlıyı ilk sıraya koyar

    const trip = {
      id: 'trip_' + Date.now(),
      start: startText, end: endText,
      startCoord, endCoord,
      date, time,
      passengers: +document.getElementById('f-passengers').value || 1,
      children: document.getElementById('f-children').value === 'evet',
      breakIntervalMin: +document.getElementById('f-break-interval').value,
      breakDurationMin: +document.getElementById('f-break-duration').value,
      fuelType: document.getElementById('f-fuel-type').value,
      consumption: +document.getElementById('f-consumption').value || 7,
      fuelPrice: +document.getElementById('f-fuel-price').value || state.settings.fuelPrice,
      routeOptions,
      selectedRouteId: defaultRoute.id,
      distanceKm: defaultRoute.distanceKm,
      driveMinutes: defaultRoute.durationMin,
      geometry: defaultRoute.geometry,
      hasFerry: defaultRoute.hasFerry,
      ferryNames: defaultRoute.ferryNames,
      tollInfo: null,
      manualExpenses: [],
      breaks: [],
      addedPois: [],
      status: 'planlandı',
      createdAt: Date.now(),
    };

    generateAutoBreaks(trip);
    recalcTrip(trip);

    state.trips.unshift(trip);
    saveJSON(STORAGE_KEYS.trips, state.trips);
    toast('Rota oluşturuldu.');
    openTrip(trip.id);
  } catch (err) {
    console.error(err);
    toast('Bir şeyler ters gitti. Lütfen tekrar deneyin.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Rotayı Oluştur';
  }
});

/* ---------------- GEOCODING (Nominatim) ---------------- */
async function geocode(text) {
  if (!text) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=tr&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'tr' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.length) {
      // Türkiye dışı olabilir, ülke kısıtını kaldırarak tekrar dene
      const url2 = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(text)}`;
      const res2 = await fetch(url2, { headers: { 'Accept-Language': 'tr' } });
      const data2 = await res2.json();
      if (!data2.length) return null;
      return { lat: +data2[0].lat, lon: +data2[0].lon, label: data2[0].display_name };
    }
    return { lat: +data[0].lat, lon: +data[0].lon, label: data[0].display_name };
  } catch (e) { return null; }
}
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'tr' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name || null;
  } catch (e) { return null; }
}

/* ---------------- ROUTING (OSRM demo sunucusu) — alternatif rotalar ---------------- */
async function fetchRoutes(start, end) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson&alternatives=true&steps=true`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.routes || !data.routes.length) return null;

    const raw = data.routes.map((r, i) => {
      const ferrySteps = [];
      (r.legs || []).forEach(leg => (leg.steps || []).forEach(step => {
        if (step.mode === 'ferry') ferrySteps.push(step.name || 'İsimsiz feribot hattı');
      }));
      return {
        rawIndex: i,
        distanceKm: r.distance / 1000,
        durationMin: r.duration / 60,
        geometry: r.geometry.coordinates,
        hasFerry: ferrySteps.length > 0,
        ferryNames: [...new Set(ferrySteps)],
      };
    });

    const fastestIdx = raw.reduce((best, r, i) => (r.durationMin < raw[best].durationMin ? i : best), 0);
    const shortestIdx = raw.reduce((best, r, i) => (r.distanceKm < raw[best].distanceKm ? i : best), 0);

    const options = raw.map((r, i) => {
      let label;
      if (i === fastestIdx && i === shortestIdx) label = 'En Hızlı ve En Kısa Rota';
      else if (i === fastestIdx) label = 'En Hızlı Rota';
      else if (i === shortestIdx) label = 'En Kısa Rota';
      else label = 'Alternatif Rota';
      return { id: 'route_' + i, label, distanceKm: r.distanceKm, durationMin: r.durationMin, geometry: r.geometry, hasFerry: r.hasFerry, ferryNames: r.ferryNames };
    });

    // Aynı etikette birden fazla rota varsa (nadiren), sıralı numaralandır
    const labelCounts = {};
    options.forEach(o => { labelCounts[o.label] = (labelCounts[o.label] || 0) + 1; });
    const seen = {};
    options.forEach(o => {
      if (labelCounts[o.label] > 1) {
        seen[o.label] = (seen[o.label] || 0) + 1;
        if (seen[o.label] > 1) o.label += ` ${seen[o.label]}`;
      }
    });

    return options;
  } catch (e) { return null; }
}

/* ---------------- MOLA OLUŞTURMA ---------------- */
function generateAutoBreaks(trip) {
  const breaks = [];
  const intervalMin = trip.breakIntervalMin;
  let elapsed = 0;
  let n = 1;
  while (elapsed + intervalMin < trip.driveMinutes) {
    elapsed += intervalMin;
    const fraction = elapsed / trip.driveMinutes;
    breaks.push({
      id: 'brk_' + n,
      order: n,
      title: n % 3 === 0 ? 'Yakıt / Kahve Molası' : 'Kısa Dinlenme',
      type: n % 3 === 0 ? 'yakit' : 'kisa',
      durationMin: trip.breakDurationMin,
      atDriveMinute: elapsed,
      routeFraction: fraction,
    });
    n++;
  }
  trip.breaks = breaks;
}

function pointAtFraction(geometry, fraction) {
  if (!geometry || !geometry.length) return null;
  const idx = Math.min(geometry.length - 1, Math.max(0, Math.round(fraction * (geometry.length - 1))));
  const [lon, lat] = geometry[idx];
  return { lat, lon };
}

/* ---------------- YENİDEN HESAPLAMA ---------------- */
function recalcTrip(trip) {
  const totalBreakMin = trip.breaks.filter(b => !b.skipped).reduce((s, b) => s + b.durationMin, 0);
  const addedPoiExtraMin = trip.addedPois.reduce((s, p) => s + (p.extraMinutes || 0) + (p.stayMinutes || 0), 0);
  const totalMin = trip.driveMinutes + totalBreakMin + addedPoiExtraMin;

  trip.totalBreakMin = totalBreakMin;
  trip.totalMinutes = totalMin;
  trip.durationText = minutesToText(totalMin);
  trip.pureDriveText = minutesToText(trip.driveMinutes);

  const dep = new Date(trip.date + 'T' + trip.time);
  const arrival = new Date(dep.getTime() + totalMin * 60000);
  trip.arrivalText = arrival.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  trip.arrivalDateText = arrival.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  trip.crossesMidnight = arrival.toDateString() !== dep.toDateString();

  // yakıt maliyeti
  if (trip.consumption && trip.distanceKm) {
    trip.fuelAmount = (trip.distanceKm / 100) * trip.consumption;
    trip.fuelCost = trip.fuelAmount * (trip.fuelPrice || 45);
  }
}

function minutesToText(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h <= 0) return `${m} dakika`;
  if (m === 0) return `${h} saat`;
  return `${h} saat ${m} dakika`;
}

/* ---------------- YOLCULUK DETAY EKRANI ---------------- */
let activeTabId = 'ozet';

function openTrip(id) {
  const trip = state.trips.find(t => t.id === id);
  if (!trip) return;
  state.currentTrip = trip;
  activeTabId = 'ozet';
  renderTripDetail(trip);
  showView('trip');
}

function renderTripDetail(trip) {
  const el = document.getElementById('trip-detail');
  el.innerHTML = `
    <h1 class="page-title">${esc(trip.start)} → ${esc(trip.end)}</h1>
    <p class="page-sub">${formatDateTR(trip.date)} · ${trip.time} çıkış${trip.crossesMidnight ? ' · gece yarısını geçiyor' : ''}</p>

    <div class="stat-grid">
      <div class="stat"><div class="val">${trip.distanceKm.toFixed(0)} km</div><div class="lbl">Mesafe</div></div>
      <div class="stat"><div class="val">${trip.pureDriveText}</div><div class="lbl">Saf sürüş</div></div>
      <div class="stat"><div class="val">${minutesToText(trip.totalBreakMin)}</div><div class="lbl">Molalar</div></div>
      <div class="stat"><div class="val">${trip.durationText}</div><div class="lbl">Toplam süre</div></div>
      <div class="stat"><div class="val">${trip.arrivalText}</div><div class="lbl">Tahmini varış</div></div>
      <div class="stat"><div class="val">${trip.fuelCost ? '₺' + trip.fuelCost.toFixed(0) : '—'}</div><div class="lbl">Yakıt maliyeti</div></div>
    </div>

    <div id="trip-map" class="map-box"></div>

    <div class="tabs">
      <button class="tab-btn" data-tab="ozet">Özet</button>
      <button class="tab-btn" data-tab="rotalar">Rotalar</button>
      <button class="tab-btn" data-tab="molalar">Molalar</button>
      <button class="tab-btn" data-tab="mekanlar">Mekânlar</button>
      <button class="tab-btn" data-tab="maliyet">Maliyet</button>
      <button class="tab-btn" data-tab="program">Program</button>
    </div>

    <div id="tab-content"></div>

    <div class="nav-export-row">
      <button class="drive-mode-cta" onclick="startDriveMode('${trip.id}')">🚗 Yolculuk Modunu Başlat</button>
    </div>
    <div class="nav-export-row">
      <button onclick="openInGoogleMaps()">Google Maps'te Aç</button>
      <button onclick="openInAppleMaps()">Apple Haritalar'da Aç</button>
      <button onclick="exportTripJSON()">JSON Dışa Aktar</button>
      <button onclick="deleteTrip('${trip.id}')" style="color:var(--bad)">Yolculuğu Sil</button>
    </div>
  `;

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === activeTabId);
    b.addEventListener('click', () => { activeTabId = b.dataset.tab; renderTripDetail(trip); });
  });

  renderMapForTrip(trip, 'trip-map');
  renderTabContent(trip);
}

function renderTabContent(trip) {
  const c = document.getElementById('tab-content');
  if (activeTabId === 'ozet') c.innerHTML = renderOzetTab(trip);
  if (activeTabId === 'rotalar') c.innerHTML = renderRotalarTab(trip);
  if (activeTabId === 'molalar') { c.innerHTML = renderMolalarTab(trip); bindMolaEvents(trip); }
  if (activeTabId === 'mekanlar') { c.innerHTML = '<div class="empty-state">Mekânlar yükleniyor…</div>'; loadAndRenderPois(trip); }
  if (activeTabId === 'maliyet') { loadAndRenderMaliyet(trip).then(() => bindMaliyetEvents(trip)); }
  if (activeTabId === 'program') c.innerHTML = renderProgramTab(trip);
}

function renderOzetTab(trip) {
  return `
    <div class="card">
      <div class="summary-row"><span class="lbl">Yolcu sayısı</span><span class="val">${trip.passengers}${trip.children ? ' (çocuklu)' : ''}</span></div>
      <div class="summary-row"><span class="lbl">Mola sıklığı</span><span class="val">Her ${trip.breakIntervalMin} dakikada</span></div>
      <div class="summary-row"><span class="lbl">Mola süresi</span><span class="val">${trip.breakDurationMin} dakika</span></div>
      <div class="summary-row"><span class="lbl">Yakıt türü</span><span class="val">${trip.fuelType}</span></div>
      <div class="summary-row"><span class="lbl">Tahmini yakıt</span><span class="val">${trip.fuelAmount ? trip.fuelAmount.toFixed(1) + (trip.fuelType === 'elektrik' ? ' kWh' : ' L') : '—'}</span></div>
      <div class="summary-row"><span class="lbl">Tahmini varış tarihi</span><span class="val">${trip.arrivalDateText}, ${trip.arrivalText}</span></div>
    </div>
    <div class="warning-box">Trafik gecikmesi ve yol çalışması verileri için canlı, ücretsiz bir kaynak bu prototipte bağlanmadı — bu nedenle toplam süreye dahil edilmedi. Yolculuktan önce güncel trafik durumunu kendi navigasyon uygulamanızdan kontrol edin.</div>
  `;
}

function renderMolalarTab(trip) {
  if (!trip.breaks.length) return '<div class="empty-state">Bu mesafe için otomatik mola önerilmedi. Aşağıdan kendi molanızı ekleyebilirsiniz.</div>' + addBreakButtonHTML();
  const dep = new Date(trip.date + 'T' + trip.time);
  let items = trip.breaks.map(b => {
    const atTime = new Date(dep.getTime() + b.atDriveMinute * 60000);
    return `<div class="break-item" style="${b.skipped ? 'opacity:.5' : ''}">
      <div>
        <div class="bi-title">${esc(b.title)}${b.skipped ? ' (atlandı)' : ''}</div>
        <div class="bi-meta">~${atTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} civarı · ${b.durationMin} dk</div>
      </div>
      <div style="display:flex; align-items:center; gap:6px">
        <select data-brk="${b.id}" class="brk-duration">
          ${[10, 15, 20, 30, 45, 60].map(v => `<option value="${v}" ${v === b.durationMin ? 'selected' : ''}>${v} dk</option>`).join('')}
        </select>
        <button class="bi-remove" data-remove="${b.id}" title="Molayı sil">✕</button>
      </div>
    </div>`;
  }).join('');
  return items + addBreakButtonHTML();
}
function addBreakButtonHTML() {
  return `<button class="secondary-btn" id="btn-add-break" style="width:100%; margin-top:6px">+ Özel Mola Ekle</button>`;
}
function bindMolaEvents(trip) {
  document.querySelectorAll('.brk-duration').forEach(sel => {
    sel.addEventListener('change', () => {
      const b = trip.breaks.find(x => x.id === sel.dataset.brk);
      if (b) { b.durationMin = +sel.value; recalcTrip(trip); persistCurrentTrip(); renderTripDetail(trip); }
    });
  });
  document.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      trip.breaks = trip.breaks.filter(x => x.id !== btn.dataset.remove);
      recalcTrip(trip); persistCurrentTrip(); renderTripDetail(trip);
      toast('Mola kaldırıldı, süre güncellendi.');
    });
  });
  const addBtn = document.getElementById('btn-add-break');
  if (addBtn) addBtn.addEventListener('click', () => {
    const n = trip.breaks.length + 1;
    trip.breaks.push({
      id: 'brk_custom_' + Date.now(), order: n, title: 'Özel Mola', type: 'ozel',
      durationMin: 15, atDriveMinute: trip.driveMinutes, routeFraction: 1,
    });
    recalcTrip(trip); persistCurrentTrip(); renderTripDetail(trip);
  });
}

function renderProgramTab(trip) {
  const dep = new Date(trip.date + 'T' + trip.time);
  const rows = [{ time: dep, title: `${trip.start}'den hareket`, meta: 'Başlangıç' }];
  let cum = 0;
  trip.breaks.forEach(b => {
    cum = b.atDriveMinute;
    const t = new Date(dep.getTime() + cum * 60000);
    rows.push({ time: t, title: b.title, meta: `${b.durationMin} dakika mola` });
  });
  const arrival = new Date(dep.getTime() + trip.totalMinutes * 60000);
  rows.push({ time: arrival, title: `${trip.end}'e tahmini varış`, meta: 'Varış' });

  return rows.map(r => `
    <div class="schedule-row">
      <div class="schedule-time">${r.time.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</div>
      <div class="schedule-body">
        <div class="sb-title">${esc(r.title)}</div>
        <div class="sb-meta">${esc(r.meta)}</div>
      </div>
    </div>`).join('');
}

function renderRotalarTab(trip) {
  if (!trip.routeOptions || trip.routeOptions.length <= 1) {
    return `<div class="warning-box">Bu güzergâh için OSRM servisi tek rota döndürdü, alternatif bulunamadı.</div>` + renderOzetTab(trip);
  }
  const cards = trip.routeOptions.map(opt => {
    const isSelected = opt.id === trip.selectedRouteId;
    const fuelAmount = trip.consumption ? (opt.distanceKm / 100) * trip.consumption : null;
    const fuelCost = fuelAmount ? fuelAmount * (trip.fuelPrice || 45) : null;
    return `<div class="card" style="${isSelected ? 'border-color:var(--accent)' : ''}">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
        <div style="font-weight:700; font-size:16px">${esc(opt.label)}</div>
        ${isSelected ? '<span class="badge live">Seçili</span>' : ''}
      </div>
      <div class="summary-row"><span class="lbl">Toplam kilometre</span><span class="val">${opt.distanceKm.toFixed(0)} km</span></div>
      <div class="summary-row"><span class="lbl">Saf sürüş süresi</span><span class="val">${minutesToText(opt.durationMin)}</span></div>
      <div class="summary-row"><span class="lbl">Tahmini yakıt maliyeti</span><span class="val">${fuelCost ? '₺' + fuelCost.toFixed(0) : '—'}</span></div>
      ${!isSelected ? `<button class="secondary-btn" style="width:100%; margin-top:10px" onclick="selectRouteOption('${opt.id}')">Bu Rotayı Kullan</button>` : ''}
    </div>`;
  }).join('');

  return cards + `<div class="warning-box">Ücretli yol/köprü/feribot geçiş ücretleri ve "manzaralı rota" ayrımı için bu prototipte bağlı bir veri kaynağı yok — rotalar yalnızca OSRM'in mesafe/süre hesabına göre etiketlendi. Bir rota değiştirildiğinde molalar otomatik olarak yeniden oluşturulur.</div>`;
}

function selectRouteOption(routeId) {
  const trip = state.currentTrip;
  const opt = trip.routeOptions.find(o => o.id === routeId);
  if (!opt) return;
  trip.selectedRouteId = opt.id;
  trip.distanceKm = opt.distanceKm;
  trip.driveMinutes = opt.durationMin;
  trip.geometry = opt.geometry;
  trip.hasFerry = opt.hasFerry;
  trip.ferryNames = opt.ferryNames;
  trip.tollInfo = null; // rota değişti, geçiş verisi tekrar tespit edilecek
  trip.addedPois = [];
  generateAutoBreaks(trip);
  recalcTrip(trip);
  persistCurrentTrip();
  toast('Rota değiştirildi. Molalar ve süre yeniden hesaplandı.');
  activeTabId = 'ozet';
  renderTripDetail(trip);
}

function persistCurrentTrip() {
  const idx = state.trips.findIndex(t => t.id === state.currentTrip.id);
  if (idx > -1) state.trips[idx] = state.currentTrip;
  saveJSON(STORAGE_KEYS.trips, state.trips);
}

function deleteTrip(id) {
  if (!confirm('Bu yolculuğu silmek istediğinize emin misiniz?')) return;
  state.trips = state.trips.filter(t => t.id !== id);
  saveJSON(STORAGE_KEYS.trips, state.trips);
  toast('Yolculuk silindi.');
  showView('home'); renderHome();
}

/* ---------------- HARİTA (Leaflet) ---------------- */
function renderMapForTrip(trip, elementId) {
  const container = document.getElementById(elementId);
  if (!container || !trip.geometry) return;
  container.innerHTML = '';
  const map = L.map(elementId, { zoomControl: true, attributionControl: true });
  const provider = TILE_PROVIDERS[state.settings.mapProvider] || TILE_PROVIDERS.carto_voyager;
  L.tileLayer(provider.url, {
    maxZoom: provider.maxZoom || 19,
    subdomains: provider.subdomains || 'abc',
    attribution: provider.attribution,
  }).addTo(map);

  const latlngs = trip.geometry.map(([lon, lat]) => [lat, lon]);
  const line = L.polyline(latlngs, { color: '#ff8a4c', weight: 5, opacity: 0.9 }).addTo(map);
  L.marker(latlngs[0]).addTo(map).bindPopup('Başlangıç: ' + esc(trip.start));
  L.marker(latlngs[latlngs.length - 1]).addTo(map).bindPopup('Varış: ' + esc(trip.end));

  trip.breaks.forEach(b => {
    const pt = pointAtFraction(trip.geometry, b.routeFraction);
    if (pt) {
      L.circleMarker([pt.lat, pt.lon], { radius: 6, color: '#4fc3f7', fillColor: '#4fc3f7', fillOpacity: 1 })
        .addTo(map).bindPopup(esc(b.title));
    }
  });

  trip.addedPois.forEach(p => {
    L.marker([p.lat, p.lon]).addTo(map).bindPopup(esc(p.name));
  });

  map.fitBounds(line.getBounds(), { padding: [24, 24] });
  if (elementId === 'trip-map') state.map = map;
}

function renderStandaloneMap() {
  const trip = state.currentTrip || state.trips[0];
  const box = document.getElementById('standalone-map');
  if (!trip) { box.innerHTML = '<div class="empty-state">Henüz görüntülenecek bir rota yok.</div>'; return; }
  renderMapForTrip(trip, 'standalone-map');
}

/* fetchWeatherAt fonksiyonu Yolculuk Modu'ndaki hava uyarısı için hâlâ kullanılıyor. */
async function fetchWeatherAt(coord, targetDate) {
  try {
    const dateStr = targetDate.toISOString().slice(0, 10);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coord.lat}&longitude=${coord.lon}&hourly=temperature_2m,precipitation_probability,weathercode&start_date=${dateStr}&end_date=${dateStr}&timezone=Europe%2FIstanbul`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.hourly || !data.hourly.time) return null;
    const hour = targetDate.getHours();
    const idx = data.hourly.time.findIndex(t => new Date(t).getHours() === hour);
    const i = idx === -1 ? 0 : idx;
    return {
      temp: Math.round(data.hourly.temperature_2m[i]),
      desc: weatherCodeToText(data.hourly.weathercode[i]),
      precip: data.hourly.precipitation_probability ? data.hourly.precipitation_probability[i] : null,
    };
  } catch (e) { return null; }
}
function weatherCodeToText(code) {
  const map = {
    0: 'Açık', 1: 'Az bulutlu', 2: 'Parçalı bulutlu', 3: 'Kapalı',
    45: 'Sisli', 48: 'Kırağı sisi', 51: 'Hafif çisenti', 61: 'Hafif yağmur',
    63: 'Yağmurlu', 65: 'Kuvvetli yağmur', 71: 'Hafif kar', 73: 'Kar',
    75: 'Yoğun kar', 80: 'Sağanak', 95: 'Fırtına',
  };
  return map[code] || 'Bilinmiyor';
}

/* ---------------- MEKÂN BULMA (Foursquare — puanlı, yoksa Overpass) ---------------- */
const CHAIN_BLOCKLIST = ['burger king', 'mcdonald', 'kfc', "domino's", 'dominos', 'pizza hut', 'subway sandwiches', 'popeyes'];
function isChainName(name) {
  const n = (name || '').toLowerCase();
  return CHAIN_BLOCKLIST.some(c => n.includes(c));
}

async function fetchFoursquarePois(lat, lon, apiKey) {
  try {
    const url = `https://api.foursquare.com/v3/places/search?ll=${lat},${lon}&radius=15000&categories=13000&sort=RATING&limit=20&fields=name,rating,location,categories,geocodes,tel,website&locale=tr`;
    const res = await fetch(url, { headers: { Authorization: apiKey, Accept: 'application/json' } });
    if (!res.ok) return { error: res.status };
    const data = await res.json();
    const items = (data.results || [])
      .filter(r => !isChainName(r.name))
      .map(r => {
        const geo = r.geocodes && (r.geocodes.main || r.geocodes.roof);
        const catName = (r.categories && r.categories[0] && r.categories[0].name) || 'Mekân';
        return {
          id: 'fsq_' + (r.fsq_id || r.name),
          name: r.name,
          category: catName,
          rating: typeof r.rating === 'number' ? r.rating : null,
          lat: geo ? geo.latitude : null,
          lon: geo ? geo.longitude : null,
          locality: (r.location && (r.location.locality || r.location.region)) || '',
          region: (r.location && r.location.region) || '',
          openingHours: null,
        };
      })
      .filter(p => p.lat && p.lon)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0));
    return { items };
  } catch (e) { return { error: 'network' }; }
}

async function loadAndRenderPois(trip) {
  const c = document.getElementById('tab-content');
  try {
    const mid = pointAtFraction(trip.geometry, 0.5);
    if (!mid) { c.innerHTML = '<div class="error-box">Rota üzerinde mekân aranacak nokta bulunamadı.</div>'; return; }

    const relevantBreak = trip.breaks.find(b => !b.skipped) || null;
    const relevantDuration = relevantBreak ? relevantBreak.durationMin : trip.breakDurationMin;
    const apiKey = state.settings.foursquareApiKey;

    if (apiKey) {
      const result = await fetchFoursquarePois(mid.lat, mid.lon, apiKey);
      if (result.items && result.items.length) {
        c.innerHTML = `<p class="hint-text" style="margin-bottom:12px">Rotanın orta noktası civarında, puanına göre sıralanmış dinlenme tesisleri (Foursquare verisi) — ${relevantDuration} dakikalık molanıza göre işaretlendi.</p>` +
          result.items.slice(0, 8).map(p => poiCardHTML(p, trip, relevantDuration)).join('');
        bindPoiEvents(trip, result.items);
        return;
      }
      if (result.error) {
        c.innerHTML = `<div class="warning-box">Foursquare'den mekân verisi alınamadı (anahtar geçersiz olabilir). OpenStreetMap verisine geçiliyor…</div>`;
      } else {
        c.innerHTML = `<div class="warning-box">Foursquare bu bölge için sonuç döndürmedi. OpenStreetMap verisine geçiliyor…</div>`;
      }
      await sleep(600);
    } else {
      c.innerHTML = `<div class="warning-box">Puana göre sıralanmış öneriler için Ayarlar'dan ücretsiz bir Foursquare API anahtarı ekleyebilirsiniz. Şimdilik OpenStreetMap verisiyle devam ediliyor.</div>`;
      await sleep(400);
    }

    // Yedek kaynak: Overpass / OpenStreetMap (puansız)
    const pois = await fetchPoisNear(mid.lat, mid.lon, 15000);
    if (!pois || !pois.length) {
      c.innerHTML += '<div class="warning-box">Bu rota bölümü için doğrulanmış mekân verisi şu anda alınamadı. Farklı bir zamanda tekrar deneyin.</div>';
      return;
    }
    c.innerHTML += pois.map(p => poiCardHTML(p, trip, relevantDuration)).join('');
    bindPoiEvents(trip, pois);

    for (const p of pois) {
      const loc = await reverseGeocodeLocality(p.lat, p.lon);
      const el = document.querySelector(`[data-loc-for="${p.id}"]`);
      if (el) el.textContent = loc || 'Konum bilgisi bulunamadı';
      await sleep(1100);
    }
  } catch (e) {
    c.innerHTML = '<div class="error-box">Mekân verisi alınırken bir sorun oluştu.</div>';
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function reverseGeocodeLocality(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=12&addressdetails=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'tr' } });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};
    const il = a.province || a.state || '';
    const ilce = a.county || a.town || a.city_district || a.district || a.municipality || '';
    if (!il && !ilce) return null;
    return [ilce, il].filter(Boolean).join(', ');
  } catch (e) { return null; }
}

function breakSuitability(category, durationMin) {
  const c = (category || '').toLowerCase();
  const isShort = c.includes('kahve') || c.includes('cafe') || c.includes('coffee') || c.includes('akaryakıt') || c.includes('gas') || c.includes('fuel');
  const isMedium = c.includes('fast food');
  const isLong = c.includes('restoran') || c.includes('restaurant') || (!isShort && !isMedium);

  if (isShort) {
    return durationMin <= 25
      ? { ok: true, text: `${durationMin} dakikalık molanız için uygun` }
      : { ok: false, text: 'Kısa moladan çok, daha uzun molalar için uygun olabilir' };
  }
  if (isMedium) {
    return (durationMin >= 15 && durationMin <= 40)
      ? { ok: true, text: `${durationMin} dakikalık molanız için uygun` }
      : { ok: false, text: durationMin < 15 ? 'Molanız için biraz uzun sürebilir' : 'Molanıza göre kısa kalabilir, oturarak yemek isterseniz uygun' };
  }
  return durationMin >= 30
    ? { ok: true, text: `${durationMin} dakikalık molanız için uygun` }
    : { ok: false, text: 'Oturarak yemek için molanız kısa kalabilir' };
}

async function fetchPoisNear(lat, lon, radiusM, amenities) {
  const list = (amenities && amenities.length) ? amenities : ['restaurant', 'cafe', 'fuel', 'fast_food'];
  const query = `
    [out:json][timeout:20];
    (
      node["amenity"~"${list.join('|')}"](around:${radiusM},${lat},${lon});
    );
    out center 12;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: query
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.elements || []).slice(0, 8).map(el => ({
      id: 'poi_' + el.id,
      name: (el.tags && el.tags.name) || categoryLabel(el.tags && el.tags.amenity),
      category: categoryLabel(el.tags && el.tags.amenity),
      lat: el.lat, lon: el.lon,
      openingHours: el.tags && el.tags['opening_hours'],
    }));
  } catch (e) { return null; }
}
function categoryLabel(amenity) {
  const map = {
    restaurant: 'Restoran', cafe: 'Kahve Dükkânı', fuel: 'Akaryakıt İstasyonu', fast_food: 'Fast Food',
    hospital: 'Hastane', pharmacy: 'Eczane', police: 'Polis',
  };
  return map[amenity] || 'Mekân';
}

function poiCardHTML(p, trip, relevantDuration) {
  const alreadyAdded = trip.addedPois.some(x => x.id === p.id);
  const isFav = state.favorites.some(f => f.id === p.id);
  const suit = breakSuitability(p.category, relevantDuration || trip.breakDurationMin);
  const hasRating = typeof p.rating === 'number';
  const locKnown = p.locality || p.region;
  return `<div class="poi-card">
    <div class="poi-top">
      <div>
        <div class="poi-name">${esc(p.name)}</div>
        <div class="poi-cat">${esc(p.category)}${hasRating ? ` · ★ ${p.rating.toFixed(1)}/10` : ''}</div>
        ${locKnown
          ? `<div class="poi-loc">${esc([...new Set([p.locality, p.region].filter(Boolean))].join(', '))}</div>`
          : `<div class="poi-loc" data-loc-for="${p.id}">Konum bilgisi alınıyor…</div>`}
      </div>
      <span class="status-unknown">${p.openingHours ? esc(p.openingHours) : 'Saat bilgisi yok'}</span>
    </div>
    ${suit.text ? `<div class="poi-suit ${suit.ok ? 'ok' : 'warn'}">${suit.ok ? '✓' : '•'} ${esc(suit.text)}</div>` : ''}
    <div class="poi-actions">
      <button data-add="${p.id}" ${alreadyAdded ? 'disabled' : ''}>${alreadyAdded ? 'Rotaya Eklendi ✓' : '+ Rotaya Ekle'}</button>
      <button data-fav="${p.id}">${isFav ? '★ Favoride' : '☆ Favorilere Ekle'}</button>
      <a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}" target="_blank" class="mini-btn" style="text-decoration:none; padding:7px 11px; font-size:12px">Haritada Gör</a>
    </div>
  </div>`;
}

function bindPoiEvents(trip, pois) {
  document.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = pois.find(x => x.id === btn.dataset.add);
      if (!p) return;
      trip.addedPois.push({ ...p, extraMinutes: 8, stayMinutes: 20 });
      recalcTrip(trip); persistCurrentTrip();
      toast(`${p.name} rotaya eklendi. Süre ve varış güncellendi.`);
      renderTripDetail(trip);
    });
  });
  document.querySelectorAll('[data-fav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = pois.find(x => x.id === btn.dataset.fav);
      if (!p) return;
      if (!state.favorites.some(f => f.id === p.id)) {
        state.favorites.push(p);
        saveJSON(STORAGE_KEYS.favorites, state.favorites);
        toast(`${p.name} favorilere eklendi.`);
        renderTabContent(trip);
      }
    });
  });
}

/* ---------------- NAVİGASYONA AKTARMA ---------------- */
function openInGoogleMaps() {
  const t = state.currentTrip; if (!t) return;
  const waypoints = t.addedPois.map(p => `${p.lat},${p.lon}`).join('|');
  let url = `https://www.google.com/maps/dir/?api=1&origin=${t.startCoord.lat},${t.startCoord.lon}&destination=${t.endCoord.lat},${t.endCoord.lon}`;
  if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
  window.open(url, '_blank');
}
function openInAppleMaps() {
  const t = state.currentTrip; if (!t) return;
  const url = `https://maps.apple.com/?saddr=${t.startCoord.lat},${t.startCoord.lon}&daddr=${t.endCoord.lat},${t.endCoord.lon}&dirflg=d`;
  window.open(url, '_blank');
}
function exportTripJSON() {
  const t = state.currentTrip; if (!t) return;
  const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `yolculuk_${t.start}_${t.end}.json`.replace(/\s+/g, '_');
  a.click();
}

/* ---------------- YOLCULUK MODU (Aşama 8) ---------------- */
let driveTimer = null;

function startDriveMode(tripId) {
  const trip = state.trips.find(t => t.id === tripId);
  if (!trip) return;
  state.currentTrip = trip;
  if (!trip.driveState) {
    trip.driveState = { startedAt: Date.now(), activeBreakId: null, activeBreakStartedAt: null };
    persistCurrentTrip();
  }
  document.body.classList.add('drive-active');
  showView('drive');
  renderDriveMode();
  if (driveTimer) clearInterval(driveTimer);
  driveTimer = setInterval(renderDriveMode, 15000);
}

function exitDriveMode() {
  if (driveTimer) { clearInterval(driveTimer); driveTimer = null; }
  document.body.classList.remove('drive-active');
  const trip = state.currentTrip;
  showView('trip');
  if (trip) renderTripDetail(trip);
}

function buildTimeline(trip) {
  const events = [];
  let cumMin = 0, driveSoFar = 0;
  const activeBreaks = trip.breaks.filter(b => !b.skipped).sort((a, b) => a.atDriveMinute - b.atDriveMinute);
  activeBreaks.forEach(b => {
    cumMin += (b.atDriveMinute - driveSoFar);
    events.push({ type: 'break', ref: b, title: b.title, offsetMin: cumMin, driveMinuteMark: b.atDriveMinute, fraction: b.routeFraction });
    cumMin += b.durationMin;
    driveSoFar = b.atDriveMinute;
  });
  cumMin += (trip.driveMinutes - driveSoFar);
  events.push({ type: 'arrival', title: `${trip.end}'e varış`, offsetMin: cumMin, driveMinuteMark: trip.driveMinutes, fraction: 1 });
  return events;
}

function getNextStopInfo(trip) {
  const ds = trip.driveState;
  const now = Date.now();
  const elapsedMin = (now - ds.startedAt) / 60000;

  if (ds.activeBreakId) {
    const b = trip.breaks.find(x => x.id === ds.activeBreakId);
    if (b) {
      const breakElapsed = (now - ds.activeBreakStartedAt) / 60000;
      const remaining = Math.max(0, b.durationMin - breakElapsed);
      return { onBreak: true, title: b.title, remainingMin: remaining, fraction: b.routeFraction, breakRef: b };
    }
  }

  const timeline = buildTimeline(trip);
  const avgSpeed = trip.distanceKm / trip.driveMinutes; // km / dakika
  let lastEvent = null;
  for (const ev of timeline) { if (ev.offsetMin <= elapsedMin) lastEvent = ev; else break; }
  const nextEvent = timeline.find(ev => ev.offsetMin > elapsedMin) || timeline[timeline.length - 1];

  const driveDoneBase = lastEvent ? lastEvent.driveMinuteMark : 0;
  const offsetBase = lastEvent ? lastEvent.offsetMin : 0;
  const drivenSoFarPure = driveDoneBase + Math.max(0, elapsedMin - offsetBase);
  const remainingDriveMin = Math.max(0, nextEvent.driveMinuteMark - drivenSoFarPure);

  return {
    onBreak: false,
    title: nextEvent.title,
    remainingMin: remainingDriveMin,
    remainingKm: remainingDriveMin * avgSpeed,
    fraction: nextEvent.fraction,
    isArrival: nextEvent.type === 'arrival',
    breakRef: nextEvent.ref || null,
  };
}

function renderDriveMode() {
  const trip = state.currentTrip;
  if (!trip) return;
  const info = getNextStopInfo(trip);
  const c = document.getElementById('drive-content');

  const metricsHTML = info.onBreak
    ? `<div class="drive-metrics">
        <div class="drive-metric"><div class="val">${Math.ceil(info.remainingMin)} dk</div><div class="lbl">Kalan mola</div></div>
        <div class="drive-metric"><div class="val">${trip.arrivalText}</div><div class="lbl">Planlanan varış</div></div>
      </div>`
    : `<div class="drive-metrics">
        <div class="drive-metric"><div class="val">${info.remainingKm ? info.remainingKm.toFixed(0) + ' km' : '—'}</div><div class="lbl">Kalan mesafe</div></div>
        <div class="drive-metric"><div class="val">${minutesToText(info.remainingMin)}</div><div class="lbl">Kalan süre</div></div>
      </div>`;

  c.innerHTML = `
    <div class="drive-wrap">
      <button class="drive-exit" onclick="exitDriveMode()">← Yolculuk Modundan Çık</button>

      <div class="drive-next-card">
        <div class="drive-next-label">${info.onBreak ? 'Moladasınız' : (info.isArrival ? 'Son Durak' : 'Sonraki Durak')}</div>
        <div class="drive-next-title">${esc(info.title)}</div>
        ${metricsHTML}
      </div>

      <div id="drive-weather-alert" class="drive-alert calm">Hava durumu kontrol ediliyor…</div>
      <div class="drive-alert">Bu prototipte canlı trafik / yol çalışması verisi bağlanmadı. Yol durumunu kendi navigasyon uygulamanızdan da kontrol edin.</div>

      ${info.onBreak
        ? `<button class="drive-big-btn on-break" onclick="endActiveBreak()">✅ Molayı Bitir</button>`
        : `<button class="drive-big-btn primary" onclick="openDriveNavigation()">🧭 Navigasyonu Aç</button>
           ${info.breakRef ? `<button class="drive-big-btn" onclick="startActiveBreak('${info.breakRef.id}')">☕ Mola Verildi</button>` : ''}
           ${info.breakRef ? `<button class="drive-big-btn" onclick="skipUpcomingBreak('${info.breakRef.id}')">⏭ Durağı Atla</button>` : ''}`
      }

      <div class="drive-row-2">
        <button class="drive-big-btn" onclick="driveFindNearby('fuel')">⛽ Yakıt İstasyonu</button>
        <button class="drive-big-btn" onclick="driveFindNearby('rest')">🛑 Dinlenme Tesisi</button>
      </div>
      <button class="drive-big-btn" onclick="driveFindNearby('generic')">📍 Yeni Durak Bul</button>
      <button class="drive-big-btn" onclick="driveFindNearby('emergency')" style="color:var(--bad)">🚨 Acil Yardım Noktalarını Göster</button>

      <div id="drive-results" class="drive-emergency-list"></div>
    </div>
  `;

  loadDriveWeatherAlert(trip, info);
}

async function loadDriveWeatherAlert(trip, info) {
  const box = document.getElementById('drive-weather-alert');
  if (!box) return;
  try {
    const pt = pointAtFraction(trip.geometry, info.fraction != null ? info.fraction : 1);
    if (!pt) { box.remove(); return; }
    const targetTime = new Date(Date.now() + info.remainingMin * 60000);
    const w = await fetchWeatherAt(pt, targetTime);
    if (!w) { box.textContent = 'Hava durumu şu anda alınamadı.'; return; }
    const risky = /yağmur|kar|fırtına|sağanak|sis/i.test(w.desc);
    box.className = 'drive-alert' + (risky ? '' : ' calm');
    box.textContent = risky
      ? `Sonraki durakta ${w.desc.toLowerCase()} bekleniyor, ${w.temp}°C. Sürüşe dikkat edin.`
      : `Sonraki durak civarında hava uygun görünüyor: ${w.desc.toLowerCase()}, ${w.temp}°C.`;
  } catch (e) {
    box.textContent = 'Hava durumu şu anda alınamadı.';
  }
}

function startActiveBreak(breakId) {
  const trip = state.currentTrip;
  trip.driveState.activeBreakId = breakId;
  trip.driveState.activeBreakStartedAt = Date.now();
  persistCurrentTrip();
  renderDriveMode();
}
function endActiveBreak() {
  const trip = state.currentTrip;
  trip.driveState.activeBreakId = null;
  trip.driveState.activeBreakStartedAt = null;
  persistCurrentTrip();
  toast('Molayı bitirdiniz, iyi yolculuklar.');
  renderDriveMode();
}
function skipUpcomingBreak(breakId) {
  const trip = state.currentTrip;
  const b = trip.breaks.find(x => x.id === breakId);
  if (b) b.skipped = true;
  recalcTrip(trip);
  persistCurrentTrip();
  toast('Durak atlandı, süre güncellendi.');
  renderDriveMode();
}

function openDriveNavigation() {
  const trip = state.currentTrip;
  const info = getNextStopInfo(trip);
  const pt = pointAtFraction(trip.geometry, info.fraction != null ? info.fraction : 1);
  const dest = pt || trip.endCoord;
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lon}`, '_blank');
}

function driveFindNearby(kind) {
  const results = document.getElementById('drive-results');
  if (!navigator.geolocation) {
    results.innerHTML = '<div class="warning-box">Bu tarayıcı konum özelliğini desteklemiyor.</div>';
    return;
  }
  results.innerHTML = '<div class="empty-state">Konumunuz alınıyor…</div>';
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    let amenities, label;
    if (kind === 'fuel') { amenities = ['fuel']; label = 'yakıt istasyonu'; }
    else if (kind === 'rest') { amenities = ['restaurant', 'cafe', 'fast_food']; label = 'dinlenme / yeme-içme noktası'; }
    else if (kind === 'emergency') { amenities = ['hospital', 'pharmacy', 'police']; label = 'acil yardım noktası'; }
    else { amenities = ['restaurant', 'cafe', 'fuel', 'fast_food']; label = 'durak'; }

    results.innerHTML = `<div class="empty-state">Yakındaki ${label} aranıyor…</div>`;
    const pois = await fetchPoisNear(latitude, longitude, 20000, amenities);
    if (!pois || !pois.length) {
      results.innerHTML = `<div class="warning-box">Yakınınızda doğrulanmış ${label} verisi şu anda bulunamadı.</div>`;
      return;
    }
    results.innerHTML = pois.slice(0, 5).map(p => `
      <div class="poi-card">
        <div class="poi-top">
          <div><div class="poi-name">${esc(p.name)}</div><div class="poi-cat">${esc(p.category)}</div></div>
        </div>
        <div class="poi-actions">
          <a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}" target="_blank" class="mini-btn primary" style="text-decoration:none">Yol Tarifi Al</a>
        </div>
      </div>`).join('');
  }, () => {
    results.innerHTML = '<div class="warning-box">Konum izni verilmedi. Yakındaki yerleri bulmak için konum erişimi gerekir.</div>';
  });
}

/* ---------------- ÜCRETLİ YOL / KÖPRÜ TESPİTİ (Overpass) ---------------- */
async function detectTollSegments(trip) {
  const geo = trip.geometry;
  if (!geo || geo.length < 2) return [];
  // Rota boyunca ~6-8 örnekleme noktası seç
  const sampleCount = Math.min(8, Math.max(4, Math.round(trip.distanceKm / 100)));
  const points = [];
  for (let i = 0; i <= sampleCount; i++) {
    const pt = pointAtFraction(geo, i / sampleCount);
    if (pt) points.push(pt);
  }
  const clauses = points.map(p => `way["toll"="yes"](around:3000,${p.lat},${p.lon});`).join('\n');
  const query = `[out:json][timeout:25];(${clauses});out tags 30;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
    if (!res.ok) return null;
    const data = await res.json();
    const names = (data.elements || [])
      .map(el => (el.tags && (el.tags.name || el.tags.ref)) || null)
      .filter(Boolean);
    return [...new Set(names)];
  } catch (e) { return null; }
}

async function loadAndRenderMaliyet(trip) {
  const c = document.getElementById('tab-content');
  trip.manualExpenses = trip.manualExpenses || [];
  c.innerHTML = renderMaliyetTab(trip, true);
  if (!trip.tollInfo) {
    const segments = await detectTollSegments(trip);
    trip.tollInfo = segments === null ? { error: true, segments: [] } : { error: false, segments };
    persistCurrentTrip();
  }
  if (activeTabId === 'maliyet') c.innerHTML = renderMaliyetTab(trip, false);
}

function renderMaliyetTab(trip, tollLoading) {
  const fuelCost = trip.fuelCost || 0;
  const expensesTotal = (trip.manualExpenses || []).reduce((s, e) => s + e.amount, 0);
  const grandTotal = fuelCost + expensesTotal;

  let tollHTML;
  if (tollLoading) {
    tollHTML = '<div class="empty-state">Ücretli yol/köprü verisi kontrol ediliyor…</div>';
  } else if (trip.tollInfo.error) {
    tollHTML = '<div class="warning-box">Ücretli yol verisi şu anda alınamadı (OpenStreetMap/Overpass servisi yanıt vermedi).</div>';
  } else if (trip.tollInfo.segments.length === 0) {
    tollHTML = '<div class="hint-text">Bu rota üzerinde OpenStreetMap verisine göre işaretli ücretli yol/köprü bulunamadı. Bu, güzergâhta ücretli geçiş olmadığı anlamına gelmeyebilir — veri eksik olabilir.</div>';
  } else {
    tollHTML = `<div class="hint-text" style="margin-bottom:8px">Rotanızda şu ücretli yol/köprüler tespit edildi:</div>` +
      trip.tollInfo.segments.map(s => `<div class="summary-row"><span class="val">${esc(s)}</span></div>`).join('');
  }

  const ferryHTML = trip.hasFerry
    ? `<div class="warning-box">Bu rota feribot geçişi içeriyor: ${esc(trip.ferryNames.join(', ') || 'isimsiz hat')}. Güncel tarife ve sefer saatleri için feribot işletmecisinin kendi kaynağından kontrol edin.</div>`
    : '';

  return `
    <div class="card">
      <div class="summary-row"><span class="lbl">Tahmini yakıt maliyeti</span><span class="val">${fuelCost ? '₺' + fuelCost.toFixed(0) : '—'}</span></div>
      <div class="summary-row"><span class="lbl">Ek giderler toplamı</span><span class="val">₺${expensesTotal.toFixed(0)}</span></div>
      <div class="summary-row"><span class="lbl" style="font-weight:700">Toplam tahmini bütçe</span><span class="val" style="font-weight:700; color:var(--accent)">₺${grandTotal.toFixed(0)}</span></div>
    </div>

    <div class="warning-box">
      Geçiş ücreti (köprü/otoyol) ve feribot fiyatları için bu prototipte bağlı, güncel bir ücret kaynağı yok — bu prototip yalnızca OpenStreetMap verisine bakarak ücretli yol/köprü <em>varlığını</em> tespit ediyor, tutar üretmiyor. Güncel tarife için
      <a href="https://www.kgm.gov.tr" target="_blank">kgm.gov.tr</a> geçiş ücretleri sayfasını kontrol edin.
    </div>

    <div class="section-title" style="margin-top:20px">Ücretli Yol / Köprü</div>
    ${tollHTML}

    ${ferryHTML}

    <div class="section-title" style="margin-top:20px">Diğer Giderler (otopark, yemek, konaklama vb.)</div>
    <div id="expense-list">
      ${(trip.manualExpenses || []).map(e => `
        <div class="break-item">
          <div>
            <div class="bi-title">${esc(e.label)}</div>
            <div class="bi-meta">₺${e.amount.toFixed(0)}</div>
          </div>
          <button class="bi-remove" data-remove-expense="${e.id}" title="Sil">✕</button>
        </div>`).join('') || '<div class="empty-state">Henüz ek gider eklenmedi.</div>'}
    </div>
    <form id="expense-form" class="form" style="margin-top:10px">
      <div class="grid-2">
        <input type="text" id="exp-label" placeholder="Örn. Otopark" required>
        <input type="number" id="exp-amount" placeholder="₺ Tutar" min="0" step="1" required>
      </div>
      <button type="submit" class="secondary-btn" style="width:100%">+ Gider Ekle</button>
    </form>
  `;
}

function bindMaliyetEvents(trip) {
  document.querySelectorAll('[data-remove-expense]').forEach(btn => {
    btn.addEventListener('click', () => {
      trip.manualExpenses = trip.manualExpenses.filter(e => e.id !== btn.dataset.removeExpense);
      persistCurrentTrip();
      renderTabContent(trip);
    });
  });
  const form = document.getElementById('expense-form');
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    const label = document.getElementById('exp-label').value.trim();
    const amount = +document.getElementById('exp-amount').value;
    if (!label || !amount) return;
    trip.manualExpenses = trip.manualExpenses || [];
    trip.manualExpenses.push({ id: 'exp_' + Date.now(), label, amount });
    persistCurrentTrip();
    renderTabContent(trip);
  });
}

/* ---------------- AYARLAR ---------------- */
function fillSettingsForm() {
  document.getElementById('s-name').value = state.settings.name || '';
  document.getElementById('s-home').value = state.settings.home || '';
  document.getElementById('s-fuel-price').value = state.settings.fuelPrice || 45;
  document.getElementById('s-nav-app').value = state.settings.navApp || 'google';
  document.getElementById('s-map-provider').value = state.settings.mapProvider || 'carto_voyager';
  document.getElementById('s-foursquare-key').value = state.settings.foursquareApiKey || '';
}
document.getElementById('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  state.settings = {
    name: document.getElementById('s-name').value,
    home: document.getElementById('s-home').value,
    fuelPrice: +document.getElementById('s-fuel-price').value || 45,
    navApp: document.getElementById('s-nav-app').value,
    mapProvider: document.getElementById('s-map-provider').value,
    foursquareApiKey: document.getElementById('s-foursquare-key').value.trim(),
  };
  saveJSON(STORAGE_KEYS.settings, state.settings);
  toast('Ayarlar kaydedildi.');
});
document.getElementById('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ trips: state.trips, favorites: state.favorites, settings: state.settings }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rota_defteri_yedek.json';
  a.click();
});
document.getElementById('btn-clear-data').addEventListener('click', () => {
  if (!confirm('Tüm yolculuklar, favoriler ve ayarlar silinecek. Emin misiniz?')) return;
  localStorage.clear();
  state.trips = []; state.favorites = []; state.settings = { ...DEFAULT_SETTINGS };
  toast('Tüm veriler temizlendi.');
  showView('home'); renderHome();
});

/* ---------------- DEMO VERİSİ (ilk açılış) ---------------- */
function ensureDemoTrip() {
  if (state.trips.length > 0 || localStorage.getItem('rd_demo_dismissed')) return;
  const demo = {
    id: 'demo_trip',
    isDemo: true,
    start: 'İstanbul', end: 'Antalya',
    startCoord: { lat: 41.0082, lon: 28.9784, label: 'İstanbul' },
    endCoord: { lat: 36.8969, lon: 30.7133, label: 'Antalya' },
    date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    time: '23:00',
    passengers: 4, children: true,
    breakIntervalMin: 120, breakDurationMin: 20,
    fuelType: 'benzin', consumption: 7.5, fuelPrice: 45,
    distanceKm: 720, driveMinutes: 8.5 * 60,
    geometry: [[28.9784, 41.0082], [31.5, 39.5], [30.7133, 36.8969]].map(([lon, lat]) => [lon, lat]),
    hasFerry: false, ferryNames: [], tollInfo: null, manualExpenses: [],
    breaks: [], addedPois: [], status: 'planlandı', createdAt: Date.now(),
  };
  generateAutoBreaks(demo);
  recalcTrip(demo);
  state.trips.push(demo);
}

/* ---------------- SERVICE WORKER / PWA ---------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline destek olmadan devam et */ });
  });
}

/* ---------------- BAŞLANGIÇ ---------------- */
ensureDemoTrip();
renderHome();
