'use strict';
/* ===== Tá Chovendo Aí? — script.js ===== */

/* ---------- Configuração ---------- */
const CONFIG = {
  refreshMs: 10 * 60 * 1000,      // clima e alertas: a cada 10 min
  staleMs: 25 * 60 * 1000,        // após isso, o dado é marcado como desatualizado
  geoTimeoutMs: 15000,
  fetchTimeoutMs: 12000,
  openMeteo: 'https://api.open-meteo.com/v1/forecast',
  geocode: 'https://api.bigdatacloud.net/data/reverse-geocode-client',   // só para casar alertas oficiais por município
  inmet: 'https://apiprevmet3.inmet.gov.br/avisos/ativos',               // avisos oficiais vigentes (INMET)
  brazil: { minLat: -34, maxLat: 6, minLon: -75, maxLon: -32 }
};

const $ = (id) => document.getElementById(id);

/* ---------- Estado (apenas em memória; nada é gravado no navegador) ---------- */
const state = {
  coords: null, tz: null, place: null,
  weather: null, lastOk: null, failed: false, busy: false,
  forecastAlerts: [], officialAlerts: [],
  official: { status: 'pending', checkedAt: null }, // pending | ok | error | no-coverage
  alertSig: '', timer: null
};

/* ---------- Códigos WMO ---------- */
const WMO_TEXT = {
  0: 'Céu limpo', 1: 'Predominantemente limpo', 2: 'Parcialmente nublado', 3: 'Nublado',
  45: 'Neblina', 48: 'Neblina com geada',
  51: 'Garoa fraca', 53: 'Garoa moderada', 55: 'Garoa intensa', 56: 'Garoa congelante fraca', 57: 'Garoa congelante intensa',
  61: 'Chuva fraca', 63: 'Chuva moderada', 65: 'Chuva forte', 66: 'Chuva congelante fraca', 67: 'Chuva congelante forte',
  71: 'Neve fraca', 73: 'Neve moderada', 75: 'Neve forte', 77: 'Grãos de neve',
  80: 'Pancadas de chuva fracas', 81: 'Pancadas de chuva moderadas', 82: 'Pancadas de chuva fortes',
  85: 'Pancadas de neve fracas', 86: 'Pancadas de neve fortes',
  95: 'Tempestade com raios', 96: 'Tempestade com granizo', 99: 'Tempestade com granizo forte'
};

function describeWeather(code) {
  return WMO_TEXT[code] || 'Condição não identificada';
}

/** Converte código WMO + dia/noite na descrição da cena. */
function sceneFor(code, isDay) {
  const s = { theme: isDay ? 'day-clear' : 'night-clear', sun: isDay, moon: !isDay, stars: !isDay,
              clouds: 0, rain: 0, snow: 0, bolt: false, fog: false, hail: false };
  const cloudy = (n) => {
    s.clouds = n;
    if (n >= 2) s.theme = isDay ? 'day-cloudy' : 'night-cloudy';
    if (n === 3) { s.sun = false; s.moon = false; s.stars = false; }
  };
  const wet = (level) => { cloudy(3); s.rain = level; s.theme = isDay ? 'rain' : 'night-rain'; };

  if (code === 1) s.clouds = 1;
  else if (code === 2) cloudy(2);
  else if (code === 3) cloudy(3);
  else if (code === 45 || code === 48) { cloudy(2); s.fog = true; s.theme = isDay ? 'fog' : 'night-cloudy'; }
  else if ([51, 53, 55, 56, 57].includes(code)) wet(1);
  else if ([61, 63, 66, 80, 81].includes(code)) wet(2);
  else if ([65, 67, 82].includes(code)) wet(3);
  else if ([71, 73, 75, 77, 85, 86].includes(code)) { cloudy(3); s.snow = 1; s.theme = isDay ? 'snow' : 'night-cloudy'; }
  else if ([95, 96, 99].includes(code)) { wet(3); s.bolt = true; s.theme = 'storm'; s.hail = code >= 96; }
  return s;
}

/* ---------- Ilustração ---------- */
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function buildSceneParts() {
  const rays = $('rays');
  for (let i = 0; i < 12; i++) rays.appendChild(svgEl('line', { x1: 0, y1: -40, x2: 0, y2: -52, transform: `rotate(${i * 30})` }));

  const stars = $('stars');
  for (let i = 0; i < 26; i++) {
    const x = (i * 97) % 380 + 10, y = (i * 53) % 150 + 8;
    const c = svgEl('circle', { cx: x, cy: y, r: i % 5 === 0 ? 2.2 : 1.3, class: 'star' });
    c.style.animationDelay = `-${(i * 0.37).toFixed(2)}s`;
    stars.appendChild(c);
  }

  const rain = $('rain');
  for (let i = 0; i < 24; i++) {
    const x = 14 + i * 16 + (i % 2) * 6, y = 130 + (i * 37) % 40;
    const l = svgEl('line', { x1: x, y1: y, x2: x - 3, y2: y + 14, class: 'drop' });
    l.style.animationDelay = `-${((i * 0.19) % 0.9).toFixed(2)}s`;
    rain.appendChild(l);
  }

  const snow = $('snow');
  for (let i = 0; i < 26; i++) {
    const c = svgEl('circle', { cx: 12 + i * 15, cy: 120 + (i * 29) % 40, r: i % 3 === 0 ? 3.4 : 2.2, class: 'flake' });
    c.style.animationDelay = `-${((i * 0.7) % 6).toFixed(2)}s`;
    snow.appendChild(c);
  }

  const hail = $('hail');
  for (let i = 0; i < 8; i++) {
    const c = svgEl('circle', { cx: 40 + i * 44, cy: 140 + (i * 23) % 30, r: 3.6, class: 'hailstone' });
    c.style.animationDelay = `-${((i * 0.31) % 1).toFixed(2)}s`;
    hail.appendChild(c);
  }
}

function applyScene(s, label) {
  document.body.dataset.theme = s.theme;
  const sc = $('scene');
  const set = (k, v) => sc.setAttribute(`data-${k}`, String(v));
  set('sun', s.sun ? 1 : 0); set('moon', s.moon ? 1 : 0); set('stars', s.stars ? 1 : 0);
  set('clouds', s.clouds); set('rain', s.rain); set('snow', s.snow);
  set('bolt', s.bolt ? 1 : 0); set('fog', s.fog ? 1 : 0); set('hail', s.hail ? 1 : 0);
  sc.setAttribute('aria-label', `Ilustração do clima atual: ${label}`);
}

/* ---------- Utilidades de rede ---------- */
async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CONFIG.fetchTimeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.http = res.status; throw e; }
    return await res.json();
  } finally { clearTimeout(t); }
}

/* ---------- Geolocalização ---------- */
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject({ code: 'unsupported' });
    if (!window.isSecureContext) return reject({ code: 'insecure' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2) }), // precisão reduzida
      (e) => reject(e),
      { enableHighAccuracy: false, timeout: CONFIG.geoTimeoutMs, maximumAge: 10 * 60 * 1000 }
    );
  });
}

function geoErrorMessage(e) {
  switch (e && e.code) {
    case 1: return ['Localização bloqueada', 'Para mostrar o tempo onde você está, permita o acesso à localização nas configurações do navegador e tente novamente.'];
    case 2: return ['Localização indisponível', 'Seu dispositivo não conseguiu determinar onde você está. Verifique o GPS ou a conexão e tente novamente.'];
    case 3: return ['A localização demorou demais', 'Não recebemos sua posição a tempo. Tente novamente.'];
    case 'insecure': return ['Conexão não segura', 'A localização só funciona em HTTPS ou em localhost (por exemplo, com o Live Server do VS Code).'];
    case 'unsupported': return ['Navegador sem suporte', 'Este navegador não oferece geolocalização. Tente um navegador mais recente.'];
    default: return ['Não foi possível obter a localização', 'Tente novamente em instantes.'];
  }
}

/* ---------- Clima (Open-Meteo) ---------- */
async function fetchWeather({ lat, lon }) {
  const p = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: 'auto', wind_speed_unit: 'kmh', temperature_unit: 'celsius', forecast_days: 2,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m,wind_gusts_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    hourly: 'temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_gusts_10m'
  });
  const data = await fetchJson(`${CONFIG.openMeteo}?${p}`);
  if (!data || !data.current || !data.hourly) throw new Error('Resposta inesperada da API');
  return data;
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

/* ---------- Alertas ---------- */
const LEVELS = {
  1: { name: 'Amarelo — Atenção' },
  2: { name: 'Laranja — Perigo' },
  3: { name: 'Vermelho — Perigo extremo' }
};

const ADVICE = {
  rain: ['Evite áreas sujeitas a alagamento e não atravesse ruas inundadas.', 'Redobre a atenção ao dirigir e reduza a velocidade.', 'Acompanhe as orientações da Defesa Civil.'],
  storm: ['Procure abrigo seguro em local fechado.', 'Afaste-se de árvores, postes, praias e áreas abertas.', 'Desconecte aparelhos eletrônicos da tomada.'],
  hail: ['Procure abrigo e evite permanecer ao ar livre.', 'Proteja veículos e animais, se possível.'],
  wind: ['Fique longe de árvores, placas, andaimes e fios elétricos.', 'Guarde ou prenda objetos soltos em varandas e quintais.'],
  heat: ['Beba bastante água e evite exposição ao sol nas horas mais quentes.', 'Atenção a crianças, idosos e animais de estimação.'],
  cold: ['Agasalhe-se bem, principalmente crianças e idosos.', 'Evite aquecedores sem ventilação adequada.'],
  generic: ['Acompanhe as orientações da Defesa Civil (199).', 'Evite se expor a situações de risco.']
};

function kindFromText(t) {
  const s = norm(t);
  if (/granizo/.test(s)) return 'hail';
  if (/tempest|raio|trovoad/.test(s)) return 'storm';
  if (/chuva|alagament|inunda|enxurrada|deslizamento/.test(s)) return 'rain';
  if (/vento|ventania|ciclone/.test(s)) return 'wind';
  if (/calor/.test(s)) return 'heat';
  if (/frio|geada|friagem/.test(s)) return 'cold';
  return 'generic';
}

/** Alertas estimados a partir da previsão (nunca chegam ao nível vermelho). */
function evaluateForecastAlerts(w) {
  const h = w.hourly;
  const nowKey = w.current.time.slice(0, 13);
  const idx = [];
  h.time.forEach((t, i) => { if (t.slice(0, 13) >= nowKey && idx.length < 24) idx.push(i); });
  if (!idx.length) return [];

  const col = (name) => idx.map((i) => (h[name] ? num(h[name][i]) : null));
  const precip = col('precipitation'), prob = col('precipitation_probability');
  const gust = col('wind_gusts_10m'), app = col('apparent_temperature'), temp = col('temperature_2m');
  const codes = idx.map((i) => h.weather_code ? h.weather_code[i] : null);
  const max = (a) => a.reduce((m, v) => (v != null && v > m ? v : m), -Infinity);
  const min = (a) => a.reduce((m, v) => (v != null && v < m ? v : m), Infinity);
  const sum6 = precip.slice(0, 6).reduce((s, v) => s + (v || 0), 0);
  const maxP = max(precip);
  const probMax = max(prob);
  const until = Date.now() + 3 * 3600 * 1000; // se as atualizações falharem, a estimativa expira em 3 h
  const out = [];
  const add = (key, level, kind, type, message) => out.push({
    key, level, kind: 'forecast', hazard: kind, type, message, until,
    validity: 'Previsto para as próximas 24 horas', advice: ADVICE[kind]
  });

  const thunder = codes.some((c) => c === 95 || c === 96 || c === 99);
  const hail = codes.some((c) => c === 96 || c === 99);

  if (thunder) add('f-storm', 2, 'storm', 'Tempestade com raios',
    'Alerta de tempestade: há possibilidade de raios, chuva intensa e rajadas de vento. Procure abrigo seguro.');
  if (hail) add('f-hail', 1, 'hail', 'Possibilidade de granizo',
    'Possibilidade de granizo na sua região. Procure abrigo e evite permanecer ao ar livre durante a tempestade.');

  if (maxP >= 20 || sum6 >= 50) add('f-rain', 2, 'rain', 'Chuva intensa',
    'Previsão de chuva intensa na sua região. Evite áreas de alagamento e acompanhe as orientações da Defesa Civil.');
  else if ((maxP >= 7.6 && (probMax == null || probMax >= 40)) || sum6 >= 25) add('f-rain', 1, 'rain', 'Chuva moderada a forte',
    'Atenção: previsão de chuva forte na sua região. Acompanhe as condições do tempo.');

  const g = max(gust);
  if (g >= 70) add('f-wind', 2, 'wind', 'Rajadas de vento fortes', `Rajadas de até ${Math.round(g)} km/h previstas. Procure abrigo seguro e evite áreas com árvores e fios.`);
  else if (g >= 50) add('f-wind', 1, 'wind', 'Ventos fortes', `Rajadas de até ${Math.round(g)} km/h previstas. Redobre a atenção ao ar livre.`);

  const a = max(app);
  if (a >= 42) add('f-heat', 2, 'heat', 'Calor extremo', `Sensação térmica de até ${Math.round(a)} °C prevista. Hidrate-se e evite o sol nas horas mais quentes.`);
  else if (a >= 38) add('f-heat', 1, 'heat', 'Calor intenso', `Sensação térmica de até ${Math.round(a)} °C prevista. Beba água e evite exposição prolongada ao sol.`);

  const t = min(temp);
  if (t <= 0) add('f-cold', 2, 'cold', 'Frio extremo', `Temperatura de até ${Math.round(t)} °C prevista. Proteja pessoas vulneráveis e animais.`);
  else if (t <= 5) add('f-cold', 1, 'cold', 'Frio intenso', `Temperatura de até ${Math.round(t)} °C prevista. Agasalhe-se bem.`);

  return out;
}

/* --- Alertas oficiais (INMET) --- */
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function inBrazil({ lat, lon }) {
  const b = CONFIG.brazil;
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
}

async function resolvePlace(coords) {
  if (state.place) return state.place;
  const p = new URLSearchParams({ latitude: coords.lat, longitude: coords.lon, localityLanguage: 'pt' });
  const d = await fetchJson(`${CONFIG.geocode}?${p}`);
  const code = String(d.principalSubdivisionCode || '');
  state.place = { city: d.city || d.locality || '', state: d.principalSubdivision || '', uf: code.includes('-') ? code.split('-')[1] : '' };
  return state.place;
}

function extractPolygon(raw) {
  const nums = (JSON.stringify(raw).match(/-?\d{1,3}\.\d+/g) || []).map(Number);
  const pts = [];
  const lonFirst = nums[0] < -34 ? true : (nums[1] < -34 ? false : false);
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push(lonFirst ? [nums[i], nums[i + 1]] : [nums[i + 1], nums[i]]); // [lon, lat]
  return pts;
}

function pointInPolygon(lon, lat, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function matchesLocation(item, place, coords) {
  const geo = [item.polygon, item.poligono, item.geometry, item.area].find((g) => g);
  if (geo) {
    const pts = extractPolygon(geo);
    if (pts.length >= 3) return pointInPolygon(coords.lon, coords.lat, pts);
  }
  if (!place || !place.city) return false;
  const states = norm(JSON.stringify([item.estados, item.estado, item.uf]));
  if (states.length > 6 && place.uf && !(states.includes(norm(place.state)) || new RegExp(`\\b${norm(place.uf)}\\b`).test(states))) return false;
  const cities = norm(JSON.stringify([item.municipios, item.cidades, item.localidades]));
  return cities.includes(norm(place.city));
}

function parseDate(v) {
  if (!v) return null;
  let s = String(v).trim().replace(' ', 'T');
  if (/^\d{4}-\d\d-\d\dT?$/.test(s)) s = s.replace('T', '') + 'T23:59:59';
  if (!/(Z|[+-]\d\d:?\d\d)$/i.test(s)) s += '-03:00'; // avisos do INMET usam horário de Brasília
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

function levelFromOfficial(item) {
  const cor = norm(item.aviso_cor || item.cor);
  if (cor.includes('vermelho')) return 3;
  if (cor.includes('laranja')) return 2;
  if (cor.includes('amarelo')) return 1;
  const sev = norm(item.severidade);
  if (sev.includes('grande')) return 3;
  if (sev.includes('potencial')) return 1;
  if (sev.includes('perigo')) return 2;
  return null; // sem classificação confiável: não exibimos
}

const asText = (v) => (Array.isArray(v) ? v.join(' ') : String(v || '')).replace(/\s+/g, ' ').trim();

const OFFICIAL_LEAD = {
  1: 'Aviso oficial de atenção para sua região.',
  2: 'Aviso oficial de perigo para sua região.',
  3: 'Alerta de alto risco: há aviso oficial de condições meteorológicas perigosas para sua região. Siga as orientações da Defesa Civil.'
};

async function fetchOfficialAlerts(coords) {
  const raw = await fetchJson(CONFIG.inmet);
  let items = [];
  if (Array.isArray(raw)) items = raw;
  else if (raw && typeof raw === 'object') Object.values(raw).forEach((v) => { if (Array.isArray(v)) items.push(...v); });
  const place = await resolvePlace(coords);
  const now = Date.now();
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const level = levelFromOfficial(it);
    if (!level || !matchesLocation(it, place, coords)) continue;
    const start = parseDate(it.inicio || it.data_inicio), end = parseDate(it.fim || it.data_fim);
    if (end && end < now) continue;
    if (/cancel/i.test(asText([it.status, it.situacao]))) continue;
    const type = asText(it.descricao || it.evento || it.titulo) || 'Aviso meteorológico';
    const key = `o-${it.id || it.aviso_id || type}-${level}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hazard = kindFromText(type + ' ' + asText(it.riscos));
    const instr = asText(it.instrucoes).split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 4);
    out.push({
      key, level, kind: 'official', hazard, type,
      message: `${OFFICIAL_LEAD[level]} ${asText(it.riscos)}`.trim(),
      until: end, start,
      validity: start || end ? `Válido ${start ? 'de ' + fmtDateTime(start) : ''}${end ? ' até ' + fmtDateTime(end) : ''}`.replace('Válido  ', 'Válido ') : null,
      advice: instr.length ? instr : ADVICE[hazard]
    });
  }
  return out;
}

async function updateOfficialAlerts() {
  if (!state.coords) return;
  if (!inBrazil(state.coords)) { state.officialAlerts = []; state.official = { status: 'no-coverage', checkedAt: Date.now() }; return; }
  try {
    state.officialAlerts = await fetchOfficialAlerts(state.coords);
    state.official = { status: 'ok', checkedAt: Date.now() };
  } catch (err) {
    // mantém alertas ainda vigentes; apenas informa a falha na verificação
    state.official = { status: 'error', checkedAt: state.official.checkedAt };
    console.warn('Alertas oficiais indisponíveis:', err.message);
  }
}

/* --- Renderização dos alertas --- */
function renderAlerts() {
  const now = Date.now();
  state.officialAlerts = state.officialAlerts.filter((a) => !a.until || a.until > now);
  state.forecastAlerts = state.forecastAlerts.filter((a) => !a.until || a.until > now);

  // alertas oficiais têm prioridade sobre estimativas do mesmo tipo
  const officialKinds = new Set(state.officialAlerts.map((a) => a.hazard));
  const list = [...state.officialAlerts, ...state.forecastAlerts.filter((a) => !officialKinds.has(a.hazard))]
    .sort((a, b) => b.level - a.level || (a.kind === 'official' ? -1 : 1));

  renderAlertNote();

  const sig = list.map((a) => a.key + a.level).join('|');
  if (sig === state.alertSig) return;
  state.alertSig = sig;

  const box = $('alerts');
  box.replaceChildren();
  list.slice(0, 4).forEach((a) => box.appendChild(buildAlert(a)));
  if (list.length > 4) {
    const more = document.createElement('p');
    more.className = 'alert-more';
    more.textContent = `E mais ${list.length - 4} aviso(s) para sua região.`;
    box.appendChild(more);
  }
}

function buildAlert(a) {
  const art = document.createElement('article');
  art.className = `alert level-${a.level}`;
  art.setAttribute('role', a.level >= 2 ? 'alert' : 'status');

  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('class', 'ico'); icon.setAttribute('aria-hidden', 'true');
  icon.appendChild(svgEl('use', { href: '#i-alert' }));

  const body = document.createElement('div');
  const meta = document.createElement('p');
  const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = LEVELS[a.level].name;
  const src = document.createElement('span'); src.className = 'src';
  src.textContent = a.kind === 'official' ? 'Alerta oficial do INMET' : 'Previsão, risco estimado';
  meta.append(badge, src);

  const h = document.createElement('h2'); h.textContent = a.type;
  const msg = document.createElement('p'); msg.textContent = a.message;
  body.append(meta, h, msg);

  if (a.validity) { const v = document.createElement('p'); v.className = 'valid'; v.textContent = a.validity; body.appendChild(v); }
  if (a.advice && a.advice.length) {
    const ul = document.createElement('ul');
    a.advice.forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
    body.appendChild(ul);
  }
  art.append(icon, body);
  return art;
}

function renderAlertNote() {
  const o = state.official;
  let t = 'Previsões e alertas estimados não substituem avisos oficiais. A ausência de alertas não é garantia de segurança.';
  if (o.status === 'ok') t = `Alertas oficiais do INMET verificados às ${fmtTime(o.checkedAt)}. A ausência de alertas não é garantia de segurança.`;
  else if (o.status === 'error') t = 'Não foi possível verificar os alertas oficiais agora. Isso não significa que não haja perigo: consulte a Defesa Civil (199) e o INMET.';
  else if (o.status === 'no-coverage') t = 'Os alertas oficiais do INMET cobrem apenas o Brasil, então não há verificação oficial para esta localização.';
  $('alert-note').textContent = t;
}

/* ---------- Formatação de data e hora ---------- */
const fmtCache = {};
function formatter(key, tz, opts) {
  const k = `${key}|${tz}`;
  if (!fmtCache[k]) {
    try { fmtCache[k] = new Intl.DateTimeFormat('pt-BR', { ...opts, timeZone: tz }); }
    catch { fmtCache[k] = new Intl.DateTimeFormat('pt-BR', opts); }
  }
  return fmtCache[k];
}
const timeFmt = (tz) => formatter('t', tz, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const hmFmt = (tz) => formatter('hm', tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFmt = (tz) => formatter('d', tz, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dtFmt = (tz) => formatter('dt', tz, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const fmtTime = (ms) => hmFmt(state.tz || undefined).format(ms);
const fmtDateTime = (ms) => dtFmt(state.tz || undefined).format(ms).replace(',', '');

/* ---------- Relógios ---------- */
function tickClocks() {
  const now = Date.now();
  try {
    if (state.tz) {
      $('clock-local').textContent = timeFmt(state.tz).format(now);
      $('date-local').textContent = dateFmt(state.tz).format(now);
      $('tz-local').textContent = state.tz.replace(/_/g, ' ');
    }
  } catch (e) { $('clock-local').textContent = '--:--:--'; }
  try {
    $('clock-br').textContent = timeFmt('America/Sao_Paulo').format(now);
    $('date-br').textContent = dateFmt('America/Sao_Paulo').format(now);
  } catch (e) { $('clock-br').textContent = '--:--:--'; }
}

/* ---------- Renderização do clima ---------- */
function setStat(cardId, valueId, value, text) {
  $(cardId).hidden = value == null;
  if (value != null) $(valueId).textContent = text;
}

function renderWeather() {
  const w = state.weather, c = w.current, d = w.daily || {};
  state.tz = w.timezone || state.tz;

  const code = c.weather_code, isDay = c.is_day === 1;
  const label = describeWeather(code);
  applyScene(sceneFor(code, isDay), label);

  const t = num(c.temperature_2m), f = num(c.apparent_temperature);
  $('temp').textContent = t == null ? '--' : Math.round(t);
  $('hero-desc').textContent = label;
  $('feels').textContent = f == null ? 'indisponível' : `${Math.round(f)} °C`;

  const tmin = d.temperature_2m_min ? num(d.temperature_2m_min[0]) : null;
  const tmax = d.temperature_2m_max ? num(d.temperature_2m_max[0]) : null;
  setStat('card-minmax', 'tmin', tmin != null && tmax != null ? 1 : null, '');
  if (tmin != null && tmax != null) { $('tmin').textContent = `${Math.round(tmin)}°`; $('tmax').textContent = `${Math.round(tmax)}°`; }

  const pr = d.precipitation_probability_max ? num(d.precipitation_probability_max[0]) : null;
  setStat('card-rain', 'rain', pr, `${Math.round(pr)}%`);
  const hu = num(c.relative_humidity_2m);
  setStat('card-hum', 'hum', hu, `${Math.round(hu)}%`);
  const wi = num(c.wind_speed_10m), gu = num(c.wind_gusts_10m);
  setStat('card-wind', 'wind', wi, `${Math.round(wi)} km/h${gu != null && gu - wi >= 15 ? ` (rajadas de ${Math.round(gu)})` : ''}`);

  renderPlace();
  renderUpdated();
  tickClocks();
}

function renderPlace() {
  const p = state.place;
  const txt = p && p.city ? `${p.city}${p.uf ? ', ' + p.uf : ''}` : '';
  $('place').hidden = !txt;
  $('place-text').textContent = txt;
}

function renderUpdated() {
  if (!state.lastOk) return;
  const tz = state.tz || undefined;
  $('updated').textContent = `Atualizado às ${hmFmt(tz).format(state.lastOk)} de ${formatter('dm', tz, { day: 'numeric', month: 'long' }).format(state.lastOk)}`;

  const stale = state.failed || Date.now() - state.lastOk > CONFIG.staleMs;
  $('stale').hidden = !stale;
  if (stale) $('stale').textContent = `Dados possivelmente desatualizados: não foi possível atualizar. Exibindo a última leitura, de ${hmFmt(tz).format(state.lastOk)}.`;
  $('status-text').textContent = stale ? 'Dados desatualizados' : 'Dados atualizados';
}

/* ---------- Telas ---------- */
function showView(name) {
  $('view-loading').hidden = name !== 'loading';
  $('view-error').hidden = name !== 'error';
  $('view-main').hidden = name !== 'main';
}

function showError(title, text) {
  $('error-title').textContent = title;
  $('error-text').textContent = text;
  $('status-text').textContent = 'Sem dados';
  showView('error');
  $('btn-retry').focus();
}

function setBusy(on) {
  state.busy = on;
  $('spinner').hidden = !on;
  if (on) $('status-text').textContent = 'Atualizando…';
}

function weatherErrorMessage(e) {
  if (e && e.name === 'AbortError') return ['Tempo esgotado', 'O serviço de clima demorou para responder. Tente novamente.'];
  if (e && e.http) return ['Serviço de clima indisponível', `O serviço meteorológico respondeu com erro (${e.http}). Tente novamente em instantes.`];
  if (!navigator.onLine) return ['Sem conexão', 'Parece que você está sem internet. Verifique a conexão e tente novamente.'];
  return ['Falha ao buscar o clima', 'Não foi possível consultar o serviço meteorológico. Tente novamente.'];
}

/* ---------- Ciclo de atualização ---------- */
async function refresh() {
  if (state.busy || !state.coords) return;
  setBusy(true);
  let ok = false;
  try {
    state.weather = await fetchWeather(state.coords);
    state.tz = state.weather.timezone || state.tz;
    state.lastOk = Date.now();
    state.failed = false;
    state.forecastAlerts = evaluateForecastAlerts(state.weather);
    ok = true;
  } catch (err) {
    state.failed = true;
    console.warn('Falha ao atualizar o clima:', err.message);
    if (!state.weather) { const [t, m] = weatherErrorMessage(err); showError(t, m); }
  }

  if (ok) {
    showView('main');
    await updateOfficialAlerts();   // depois do clima, para exibir os dados rapidamente
    renderWeather();
  }
  renderAlerts();
  if (state.weather) { showView('main'); renderUpdated(); }
  setBusy(false);
  if (state.weather) renderUpdated();
}

function scheduleRefresh() {
  clearInterval(state.timer);
  state.timer = setInterval(() => { if (!document.hidden) refresh(); }, CONFIG.refreshMs);
}

async function start() {
  showView('loading');
  $('status-text').textContent = 'Aguardando localização…';
  try {
    state.coords = await getPosition();
  } catch (e) {
    const [t, m] = geoErrorMessage(e);
    showError(t, m);
    return;
  }
  await refresh();
  scheduleRefresh();
}

/* ---------- Inicialização ---------- */
document.addEventListener('DOMContentLoaded', () => {
  buildSceneParts();
  tickClocks();
  setInterval(tickClocks, 1000);
  // a cada 30 s: expira alertas vencidos e reavalia o aviso de dados desatualizados
  setInterval(() => { renderAlerts(); if (state.lastOk) renderUpdated(); }, 30000);

  $('btn-retry').addEventListener('click', () => {
    if (state.coords && state.weather) { showView('main'); refresh(); } else start();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.lastOk && Date.now() - state.lastOk > CONFIG.refreshMs) refresh();
  });
  window.addEventListener('online', () => { if (state.coords) refresh(); });

  start();
});
