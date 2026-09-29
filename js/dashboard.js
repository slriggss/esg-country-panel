let allRows = []; // rows of the indicator currently selected (loaded on demand)
let indicatorMeta = []; // [{code, name, pillar, file, rows}] from data/manifest.json
const rowCache = {}; // indicator code -> its parsed rows, so switching back is instant
let charts = {}; // canvasId -> Chart instance
let mapFeatures = null; // GeoJSON features from the world topojson
let isoToNumeric = {}; // ISO3 -> numeric country code (for joining to the map)
let numericToIso3 = {}; // reverse of the above

const state = {
  indicator: null,
  yearFrom: null,
  yearTo: null,
  regions: [],   // empty = all regions
  incomes: [],   // empty = all income groups
  countries: [], // ISO3 codes; empty = all countries
  measure: 'avg',
  breakdown: 'region',
};

const DEFAULT_INDICATOR = 'EG.ELC.ACCS.ZS';

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function applyMeasure(values, measure) {
  if (values.length === 0) return null;
  if (measure === 'avg') return values.reduce((a, b) => a + b, 0) / values.length;
  if (measure === 'median') return median(values);
  if (measure === 'total') return values.reduce((a, b) => a + b, 0);
  if (measure === 'count') return values.length;
  return null;
}

function measureLabel(measure) {
  return { avg: 'Average', median: 'Median', total: 'Total', count: 'Count' }[measure];
}

function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Filter controls. None are dropdowns:
//   indicator  - pillar tabs (E / S / G) + one chip per indicator (pick one)
//   years      - a two-handle range slider
//   region     - chips, select all that apply ("All" = no filter)
//   income     - chips, select all that apply
//   countries  - type-ahead search; each pick becomes a removable chip
// Empty region/income/country lists mean "no filter".
// ---------------------------------------------------------------------------
const PILLARS = [
  { name: 'Environmental', cls: 'env' },
  { name: 'Social', cls: 'soc' },
  { name: 'Governance', cls: 'gov' },
];
const INCOME_ORDER = ['High income', 'Upper middle income', 'Lower middle income', 'Low income'];
let YEARS = [];
let REGIONS = [];
let INCOMES = [];
let COUNTRIES = []; // [iso3, name], sorted by name
let activePillar = null;
let renderQueued = false;

// Coalesce bursts of input (e.g. dragging the slider) into one render per frame.
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function chip(label, pressed, extraClass) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip' + (extraClass ? ' ' + extraClass : '');
  b.textContent = label;
  b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  return b;
}

// --- Indicator: pillar tabs + chips ----------------------------------------
function drawIndicatorPicker() {
  const tabs = document.getElementById('pillar-tabs');
  const chips = document.getElementById('indicator-chips');
  const current = indicatorMeta.find(i => i.code === state.indicator);
  if (!activePillar) activePillar = current ? current.pillar : PILLARS[0].name;

  tabs.innerHTML = '';
  PILLARS.forEach(p => {
    const n = indicatorMeta.filter(i => i.pillar === p.name).length;
    const t = document.createElement('button');
    t.type = 'button';
    t.className = `pillar-tab ${p.cls}`;
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-selected', p.name === activePillar ? 'true' : 'false');
    t.innerHTML = `${p.name} <span class="count">${n}</span>`;
    // A small dot marks the tab holding the selected indicator.
    if (current && current.pillar === p.name) t.classList.add('has-selection');
    t.addEventListener('click', () => { activePillar = p.name; drawIndicatorPicker(); });
    tabs.appendChild(t);
  });

  chips.innerHTML = '';
  const pillarCls = PILLARS.find(p => p.name === activePillar).cls;
  chips.className = `chip-row indicator-chips ${pillarCls}`;
  indicatorMeta.filter(i => i.pillar === activePillar).forEach(i => {
    const b = chip(i.name, i.code === state.indicator);
    b.addEventListener('click', () => selectIndicator(i.code));
    chips.appendChild(b);
  });
}

// --- Multi-select chip groups (region, income) ------------------------------
function drawChipGroup(containerId, options, key, labelOf) {
  const box = document.getElementById(containerId);
  box.innerHTML = '';
  const selected = state[key];
  const all = chip('All', selected.length === 0, 'chip-all');
  all.addEventListener('click', () => { state[key] = []; drawChipGroup(containerId, options, key, labelOf); queueRender(); });
  box.appendChild(all);
  options.forEach(opt => {
    const b = chip(labelOf(opt), selected.includes(opt));
    b.addEventListener('click', () => {
      const next = selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt];
      // Everything selected is the same as no filter.
      state[key] = next.length === options.length ? [] : next;
      drawChipGroup(containerId, options, key, labelOf);
      queueRender();
    });
    box.appendChild(b);
  });
}

// --- Year range slider -------------------------------------------------------
function syncYearSlider() {
  const from = document.getElementById('f-year-from');
  const to = document.getElementById('f-year-to');
  from.value = state.yearFrom;
  to.value = state.yearTo;
  const span = YEARS[YEARS.length - 1] - YEARS[0] || 1;
  const a = (state.yearFrom - YEARS[0]) / span * 100;
  const b = (state.yearTo - YEARS[0]) / span * 100;
  const fill = document.querySelector('#year-slider .range-fill');
  fill.style.left = a + '%';
  fill.style.width = (b - a) + '%';
  document.getElementById('year-readout').textContent =
    state.yearFrom === state.yearTo ? `${state.yearFrom}` : `${state.yearFrom} – ${state.yearTo}`;
}

function setupYearSlider() {
  const from = document.getElementById('f-year-from');
  const to = document.getElementById('f-year-to');
  [from, to].forEach(el => {
    el.min = YEARS[0];
    el.max = YEARS[YEARS.length - 1];
    el.step = 1;
  });
  from.setAttribute('aria-label', 'From year');
  to.setAttribute('aria-label', 'To year');
  // The handles can meet but not cross.
  from.addEventListener('input', () => {
    state.yearFrom = Math.min(Number(from.value), state.yearTo);
    syncYearSlider();
    queueRender();
  });
  to.addEventListener('input', () => {
    state.yearTo = Math.max(Number(to.value), state.yearFrom);
    syncYearSlider();
    queueRender();
  });
  document.getElementById('year-min').textContent = YEARS[0];
  document.getElementById('year-max').textContent = YEARS[YEARS.length - 1];
}

// --- Country type-ahead --------------------------------------------------------
function drawCountryChips() {
  const box = document.getElementById('country-chips');
  box.innerHTML = '';
  state.countries.forEach(iso3 => {
    const entry = COUNTRIES.find(c => c[0] === iso3);
    const b = chip(entry ? entry[1] : iso3, true, 'chip-removable');
    b.setAttribute('aria-label', `Remove ${entry ? entry[1] : iso3}`);
    b.addEventListener('click', () => {
      state.countries = state.countries.filter(c => c !== iso3);
      drawCountryChips();
      queueRender();
    });
    box.appendChild(b);
  });
  document.getElementById('f-country-search').placeholder =
    state.countries.length ? 'Add another country…' : 'All countries — type to search…';
}

function setupCountrySearch() {
  const input = document.getElementById('f-country-search');
  const list = document.getElementById('country-suggest');
  let matches = [];
  let cursor = -1;

  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); cursor = -1; }
  function pick(iso3) {
    if (!state.countries.includes(iso3)) state.countries = [...state.countries, iso3];
    input.value = '';
    close();
    drawCountryChips();
    queueRender();
    input.focus();
  }
  function show() {
    const q = input.value.trim().toLowerCase();
    if (!q) { close(); return; }
    const pool = COUNTRIES.filter(c => !state.countries.includes(c[0]));
    const starts = pool.filter(c => c[1].toLowerCase().startsWith(q));
    const contains = pool.filter(c => !c[1].toLowerCase().startsWith(q) && c[1].toLowerCase().includes(q));
    matches = [...starts, ...contains].slice(0, 8);
    cursor = matches.length ? 0 : -1;
    list.innerHTML = matches.length
      ? matches.map((c, i) => `<li role="option" id="cs-${c[0]}" data-iso="${c[0]}" aria-selected="${i === cursor}">${c[1]}</li>`).join('')
      : '<li class="empty">No matching country</li>';
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function moveCursor(d) {
    if (!matches.length) return;
    cursor = (cursor + d + matches.length) % matches.length;
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', i === cursor ? 'true' : 'false'));
    input.setAttribute('aria-activedescendant', `cs-${matches[cursor][0]}`);
  }

  input.addEventListener('input', show);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) show(); else moveCursor(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(-1); }
    else if (e.key === 'Enter') { if (cursor >= 0 && matches[cursor]) { e.preventDefault(); pick(matches[cursor][0]); } }
    else if (e.key === 'Escape') { close(); }
    else if (e.key === 'Backspace' && !input.value && state.countries.length) {
      state.countries = state.countries.slice(0, -1);
      drawCountryChips();
      queueRender();
    }
  });
  // mousedown (not click) so the pick lands before the input's blur closes the list
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-iso]');
    if (li) { e.preventDefault(); pick(li.dataset.iso); }
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
}

function drawAllFilters() {
  drawIndicatorPicker();
  syncYearSlider();
  drawChipGroup('region-chips', REGIONS, 'regions', r => r.trim());
  drawChipGroup('income-chips', INCOMES, 'incomes', g => g);
  drawCountryChips();
}

function populateFilters(manifest) {
  YEARS = manifest.years;
  REGIONS = manifest.regions;
  INCOMES = INCOME_ORDER.filter(g => manifest.incomes.includes(g));
  COUNTRIES = manifest.countries;

  state.indicator = DEFAULT_INDICATOR;
  state.yearFrom = YEARS[0];
  state.yearTo = YEARS[YEARS.length - 1];

  setupYearSlider();
  setupCountrySearch();

  document.querySelectorAll('#measure-switch button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#measure-switch button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.measure = btn.dataset.measure;
      render();
    });
  });
  document.querySelectorAll('#breakdown-switch button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#breakdown-switch button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.breakdown = btn.dataset.breakdown;
      render();
    });
  });

  document.getElementById('btn-reset').addEventListener('click', async () => {
    document.querySelectorAll('#measure-switch button').forEach(b => b.classList.remove('active'));
    document.querySelector('#measure-switch button[data-measure="avg"]').classList.add('active');
    document.querySelectorAll('#breakdown-switch button').forEach(b => b.classList.remove('active'));
    document.querySelector('#breakdown-switch button[data-breakdown="region"]').classList.add('active');
    Object.assign(state, {
      indicator: DEFAULT_INDICATOR, yearFrom: YEARS[0], yearTo: YEARS[YEARS.length - 1],
      regions: [], incomes: [], countries: [], measure: 'avg', breakdown: 'region',
    });
    activePillar = null;
    document.getElementById('f-country-search').value = '';
    drawAllFilters();
    if (await loadCurrentIndicator()) render();
  });

  document.getElementById('btn-share').addEventListener('click', () => {
    const btn = document.getElementById('btn-share');
    const original = btn.textContent;
    navigator.clipboard.writeText(location.href).then(() => {
      btn.textContent = 'Link copied!';
      setTimeout(() => { btn.textContent = original; }, 1500);
    }).catch(() => {
      btn.textContent = 'Could not copy — copy the URL bar';
      setTimeout(() => { btn.textContent = original; }, 2000);
    });
  });

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    const rows = filteredForIndicator();
    const cols = ['country', 'iso3', 'region', 'income_group', 'year', 'pillar', 'indicator_code', 'indicator_name', 'value', 'pct_change_yoy', 'percentile_rank'];
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => esc(r[c])).join(','))).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `esg-panel-${state.indicator}-${state.yearFrom}-${state.yearTo}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  document.querySelectorAll('[data-download]').forEach(btn => {
    btn.addEventListener('click', () => {
      const chart = charts[btn.dataset.download];
      if (!chart) return;
      const a = document.createElement('a');
      a.href = chart.toBase64Image();
      a.download = `${btn.dataset.download}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  });
}

// Shareable links. Multi-select filters repeat their parameter
// (?region=A&region=B) because some region names contain commas.
function applyStateFromURL() {
  const params = new URLSearchParams(location.search);
  if (params.has('indicator') && indicatorMeta.some(i => i.code === params.get('indicator'))) {
    state.indicator = params.get('indicator');
  }
  const clampYear = (y, fallback) => (YEARS.includes(y) ? y : fallback);
  if (params.has('from')) state.yearFrom = clampYear(Number(params.get('from')), YEARS[0]);
  if (params.has('to')) state.yearTo = clampYear(Number(params.get('to')), YEARS[YEARS.length - 1]);
  if (state.yearFrom > state.yearTo) [state.yearFrom, state.yearTo] = [state.yearTo, state.yearFrom];
  state.regions = params.getAll('region').filter(r => REGIONS.includes(r));
  state.incomes = params.getAll('income').filter(g => INCOMES.includes(g));
  state.countries = params.getAll('country').filter(c => COUNTRIES.some(e => e[0] === c));
  if (params.has('measure')) {
    state.measure = params.get('measure');
    document.querySelectorAll('#measure-switch button').forEach(b => b.classList.toggle('active', b.dataset.measure === state.measure));
  }
  if (params.has('breakdown')) {
    state.breakdown = params.get('breakdown');
    document.querySelectorAll('#breakdown-switch button').forEach(b => b.classList.toggle('active', b.dataset.breakdown === state.breakdown));
  }
  drawAllFilters();
}

function syncURL() {
  const params = new URLSearchParams();
  params.set('indicator', state.indicator);
  params.set('from', state.yearFrom);
  params.set('to', state.yearTo);
  state.regions.forEach(r => params.append('region', r));
  state.incomes.forEach(g => params.append('income', g));
  state.countries.forEach(c => params.append('country', c));
  params.set('measure', state.measure);
  params.set('breakdown', state.breakdown);
  history.replaceState(null, '', '?' + params.toString());
}

function filteredForIndicator() {
  return allRows.filter(r =>
    r.indicator_code === state.indicator &&
    r.year >= state.yearFrom && r.year <= state.yearTo &&
    (!state.regions.length || state.regions.includes(r.region)) &&
    (!state.incomes.length || state.incomes.includes(r.income_group)) &&
    (!state.countries.length || state.countries.includes(r.iso3))
  );
}

function breakdownKey(row) {
  if (state.breakdown === 'region') return row.region.trim();
  if (state.breakdown === 'income_group') return row.income_group;
  return 'All countries';
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

// Charts are built the first time their card scrolls into view, with an intro
// matched to the chart type (as on the report page). Later renders -- every
// filter change -- rebuild immediately with the normal quick animation, so
// dragging the year slider doesn't replay the intros.
const cardOpened = {};    // canvasId -> () => boolean
const pendingConfig = {}; // canvasId -> latest config waiting for its card

function addIntro(id, cfg) {
  const o = cfg.options = cfg.options || {};
  o.plugins = o.plugins || {};
  if (id === 'chart-trend') {
    // One breakdown group at a time, or a single left-to-right sweep.
    const n = cfg.data.datasets.length;
    o.animation = { duration: 0 };
    o.plugins.esgIntro = n > 1 ? { mode: 'sequence', gap: Math.max(220, 1800 / n) } : { mode: 'sweep' };
  } else if (id === 'chart-groups') {
    o.animation = staggered(160, 800);
  } else if (id === 'chart-distribution') {
    o.animation = staggered(70, 700);
  } else if (id === 'chart-top' || id === 'chart-bottom') {
    o.animation = staggered(90, 800);
    o.plugins.esgIntro = { mode: 'fade', after: 800 + 90 * 9 }; // value labels after bars land
  }
}

// Filter changes update the existing chart in place (new data and options, no
// rebuild, no animation) instead of destroying and recreating it, so dragging
// the year slider stays smooth.
function updateChart(chart, config) {
  chart.$focus = null; // hover-fade state belongs to the datasets being replaced
  chart.$legendFocus = false;
  chart.data = config.data;
  chart.options = config.options;
  chart.update('none');
}

// True while charts are being redrawn for a theme switch: no intro/animation replay.
let redrawingForTheme = false;

function mountChart(id, config) {
  const canvas = document.getElementById(id);
  const isOpen = cardOpened[id];
  const existing = charts[id];
  if (existing && existing.config.type === config.type && isOpen && isOpen()) {
    updateChart(existing, config);
    return;
  }
  destroyChart(id);
  if (isOpen && isOpen()) {
    if (redrawingForTheme) { config.options = config.options || {}; config.options.animation = false; }
    charts[id] = new Chart(canvas, config);
    return;
  }
  pendingConfig[id] = config;
  if (isOpen) return; // card is already opening; it will use the latest config
  cardOpened[id] = whenCardOpens(canvas.closest('.chart-card'), () => {
    const cfg = pendingConfig[id];
    delete pendingConfig[id];
    if (REDUCED_MOTION) { cfg.options = cfg.options || {}; cfg.options.animation = false; } else addIntro(id, cfg);
    charts[id] = new Chart(canvas, cfg);
  });
}

function render() {
  syncURL();
  // Wait until the selected indicator's rows have arrived (they load on demand).
  if (!allRows.length || allRows[0].indicator_code !== state.indicator) return;
  const rows = filteredForIndicator();
  const ind = indicatorMeta.find(i => i.code === state.indicator);
  const C = window.ESG_COLORS;
  if (ind) document.querySelector('main').dataset.pillar = ind.pillar;

  // --- Summary tiles ---
  document.getElementById('stat-countries').textContent = new Set(rows.map(r => r.iso3)).size;
  document.getElementById('stat-years').textContent = new Set(rows.map(r => r.year)).size;
  document.getElementById('stat-measure-label').textContent = fmt(applyMeasure(rows.map(r => r.value), state.measure));
  document.getElementById('stat-measure-caption').textContent = `${measureLabel(state.measure)} value in view`;

  const latestYearInView = rows.length ? Math.max(...rows.map(r => r.year)) : null;
  const latestRows = rows.filter(r => r.year === latestYearInView);
  document.getElementById('stat-latest').textContent = latestYearInView ? fmt(applyMeasure(latestRows.map(r => r.value), state.measure)) : '–';
  document.getElementById('stat-latest-caption').textContent = latestYearInView ? `${measureLabel(state.measure)}, ${latestYearInView}` : 'Latest year';

  // --- Chart 1: trend over time, by breakdown group ---
  {
    const byGroupYear = {};
    rows.forEach(r => {
      const g = breakdownKey(r);
      byGroupYear[g] = byGroupYear[g] || {};
      (byGroupYear[g][r.year] = byGroupYear[g][r.year] || []).push(r.value);
    });
    const years = [...new Set(rows.map(r => r.year))].sort((a, b) => a - b);
    const groups = Object.keys(byGroupYear).sort();
    mountChart('chart-trend', {
      type: 'line',
      data: {
        labels: years,
        datasets: groups.slice(0, 8).map((g, i) => ({
          label: g,
          data: years.map(y => applyMeasure(byGroupYear[g][y] || [], state.measure)),
          borderColor: C.series[i],
          backgroundColor: C.series[i] + '1a',
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.25,
          pointBackgroundColor: C.series[i], pointBorderColor: C.surface, pointBorderWidth: 2,
          spanGaps: true,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: groups.length > 1, position: 'bottom', labels: { color: C.textSecondary } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: C.muted } },
          y: { grid: { color: C.grid }, ticks: { color: C.muted } },
        },
      },
    });
  }

  // --- Chart 2: latest year, by group (bar) ---
  {
    const g2 = latestRows.reduce((acc, r) => {
      const g = breakdownKey(r);
      (acc[g] = acc[g] || []).push(r.value);
      return acc;
    }, {});
    const groupNames = Object.keys(g2).sort();
    mountChart('chart-groups', {
      type: 'bar',
      data: {
        labels: groupNames,
        datasets: [{
          data: groupNames.map(g => applyMeasure(g2[g], state.measure)),
          backgroundColor: groupNames.map((_, i) => C.series[i % 8]),
          borderRadius: 4, maxBarThickness: 40,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: C.muted, autoSkip: false, maxRotation: 25 } },
          y: { grid: { color: C.grid }, ticks: { color: C.muted } },
        },
      },
    });
  }

  // --- Chart 3: distribution of country values, latest year (histogram) ---
  {
    const vals = latestRows.map(r => r.value);
    let bins = [], binLabels = [];
    if (vals.length) {
      const min = Math.min(...vals), max = Math.max(...vals);
      const n = 10;
      const width = (max - min) / n || 1;
      bins = new Array(n).fill(0);
      vals.forEach(v => {
        let idx = Math.floor((v - min) / width);
        if (idx >= n) idx = n - 1;
        if (idx < 0) idx = 0;
        bins[idx]++;
      });
      binLabels = bins.map((_, i) => (min + i * width).toFixed(1));
    }
    mountChart('chart-distribution', {
      type: 'bar',
      data: {
        labels: binLabels,
        datasets: [{ data: bins, backgroundColor: C.series[0], borderRadius: 3, maxBarThickness: 34 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: (items) => `${items[0].label} and up` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: C.muted }, title: { display: true, text: ind ? ind.name : '', color: C.textSecondary, font: { size: 10 } } },
          y: { grid: { color: C.grid }, ticks: { color: C.muted }, title: { display: true, text: 'Countries', color: C.textSecondary, font: { size: 11 } } },
        },
      },
    });
  }

  // --- Chart 4: highest 10 and lowest 10 countries, latest year ---
  // Two charts side by side on one shared value axis, matching the report's
  // top 10 / bottom 10 pair. Lowest 10 lists the lowest value first.
  {
    const desc = [...latestRows].sort((a, b) => b.value - a.value);
    const top = desc.slice(0, 10);
    // With fewer than 20 countries in view the two lists overlap; each is still correct.
    const bottom = [...desc].reverse().slice(0, 10);
    const vals = [...top, ...bottom].map(r => r.value);
    const lo = vals.length ? Math.min(0, ...vals) : 0;
    const hi = vals.length ? Math.max(0, ...vals) : 1;
    // Round the shared range out to a half step so both axes match exactly.
    const roundOut = (v) => {
      if (v === 0) return 0;
      const step = Math.pow(10, Math.floor(Math.log10(Math.abs(v)))) / 2;
      return Math.sign(v) * Math.ceil(Math.abs(v) / step) * step;
    };
    const axisMin = roundOut(lo), axisMax = roundOut(hi) || 1;
    const decimals = Math.max(Math.abs(lo), Math.abs(hi)) < 10 ? 2 : 1;
    const rankChart = (id, list, color) => mountChart(id, {
      type: 'bar',
      data: {
        labels: list.map(r => r.country),
        datasets: [{ data: list.map(r => r.value), backgroundColor: color, borderRadius: 4, maxBarThickness: 18 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 44 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `${ind ? ind.name : 'Value'}: ${fmt(ctx.parsed.x)}` } },
          esgAnnotate: { valueLabels: { decimals } },
        },
        scales: {
          x: { min: axisMin, max: axisMax, grid: { color: C.grid }, ticks: { color: C.muted } },
          // Long names are shortened on the axis; the tooltip shows the full name.
          y: { grid: { display: false, drawTicks: false }, ticks: { color: C.textSecondary, font: { size: 11 }, autoSkip: false,
            callback(v) { const s = this.getLabelForValue(v); return s.length > 20 ? s.slice(0, 19) + '…' : s; } } },
        },
      },
    });
    rankChart('chart-top', top, C.series[0]);
    rankChart('chart-bottom', bottom, C.series[7]);
  }

  // --- Chart 5: world map, latest year ---
  const mapCanvas = document.getElementById('chart-map');
  if (!mapFeatures && mapCanvas) {
    mapCanvas.parentElement.innerHTML = '<p class="loading-note">The map library could not be loaded, so the map is not shown. The other charts and the table below are unaffected.</p>';
  } else if (mapFeatures && window.ChartGeo && mapCanvas) {
    try {
      const valueByIso3 = {};
      latestRows.forEach(r => { valueByIso3[r.iso3] = r.value; });
      const vals = Object.values(valueByIso3);
      const vMin = vals.length ? Math.min(...vals) : 0;
      const vMax = vals.length ? Math.max(...vals) : 1;
      const bucketColor = (v) => {
        if (v === undefined || v === null) return C.grid;
        const t = vMax > vMin ? (v - vMin) / (vMax - vMin) : 0.5;
        const bucket = Math.min(4, Math.max(0, Math.floor(t * 5)));
        return C.sequential[bucket];
      };
      mountChart('chart-map', {
        type: 'choropleth',
        data: {
          labels: mapFeatures.map(f => f.properties.name),
          datasets: [{
            label: ind ? ind.name : '',
            outline: { type: 'Sphere' },
            data: mapFeatures.map(f => ({ feature: f, value: valueByIso3[numericToIso3[f.id]] })),
            backgroundColor: (ctx) => bucketColor(ctx.raw && ctx.raw.value),
            borderColor: C.surface,
            borderWidth: 0.5,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          showOutline: true,
          showGraticule: true,
          scales: {
            projection: {
              axis: 'x',
              projection: 'equalEarth',
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const v = ctx.raw && ctx.raw.value;
                  return `${ctx.raw.feature.properties.name}: ${v === undefined || v === null ? 'no data' : fmt(v)}`;
                },
              },
            },
          },
        },
      });
    } catch (err) {
      console.error('Map chart failed to render:', err);
      const holder = document.getElementById('chart-map').parentElement;
      holder.innerHTML = `<p class="loading-note">Map failed to load (${err.message}). The other charts and the table below are unaffected.</p>`;
    }
  }

  // --- Table ---
  const tbody = document.getElementById('table-body');
  const sortedRows = [...rows].sort((a, b) => b.year - a.year || a.country.localeCompare(b.country));
  const CAP = 500;
  const shown = sortedRows.slice(0, CAP);
  tbody.innerHTML = shown.map(r => `
    <tr>
      <td>${r.country}</td><td>${r.year}</td><td>${r.region.trim()}</td><td>${r.income_group}</td>
      <td>${r.indicator_name}</td><td>${fmt(r.value)}</td>
      <td>${r.pct_change_yoy === '' || r.pct_change_yoy === null ? '–' : fmt(r.pct_change_yoy)}</td>
      <td>${fmt(r.percentile_rank)}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="loading-note">No rows match these filters.</td></tr>';

  document.getElementById('result-count').textContent = rows.length > CAP
    ? `Showing ${CAP.toLocaleString()} of ${rows.length.toLocaleString()} matching rows. Narrow the filters to see more.`
    : `${rows.length.toLocaleString()} matching row${rows.length === 1 ? '' : 's'}.`;
}

function parseCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true, header: true, dynamicTyping: true, skipEmptyLines: true,
      complete: (results) => resolve(results.data.filter(r => r.iso3)),
      error: (err) => reject(new Error(err && err.message ? err.message : 'download failed')),
    });
  });
}

// Fetch one indicator's rows (about 0.4 MB) the first time it is needed. The
// per-indicator files leave out the columns that are constant for the
// indicator, so put them back here to keep the rest of the code unchanged.
async function loadIndicator(code) {
  if (rowCache[code]) return rowCache[code];
  const meta = indicatorMeta.find(i => i.code === code);
  const rows = await parseCSV('data/' + meta.file);
  rows.forEach(r => {
    r.indicator_code = meta.code;
    r.indicator_name = meta.name;
    r.pillar = meta.pillar;
  });
  rowCache[code] = rows;
  return rows;
}

function setLoading(on) {
  document.querySelector('main').classList.toggle('is-loading', on);
  if (on) document.getElementById('result-count').textContent = 'Loading indicator data…';
}

function showDataError(err) {
  document.getElementById('table-body').innerHTML =
    `<tr><td colspan="8" class="loading-note">Could not load the data (${err.message}). Try reloading.</td></tr>`;
  document.getElementById('result-count').textContent = '';
}

// Load the rows for state.indicator into allRows. Returns false if the reader
// picked a different indicator while this one was downloading (a newer call
// owns the screen) or if the download failed.
async function loadCurrentIndicator() {
  const code = state.indicator;
  if (!rowCache[code]) setLoading(true);
  try {
    const rows = await loadIndicator(code);
    if (state.indicator !== code) return false;
    allRows = rows;
    setLoading(false);
    return true;
  } catch (err) {
    if (state.indicator === code) { setLoading(false); showDataError(err); }
    return false;
  }
}

async function selectIndicator(code) {
  state.indicator = code;
  drawIndicatorPicker();
  if (await loadCurrentIndicator()) queueRender();
}

// Charts hold theme colors in their configs, so after a theme switch rebuild
// them all from the new colors (without replaying intro animations).
ESG_ON_THEME_CHANGE(() => {
  if (!allRows.length) return;
  Object.keys(charts).forEach(destroyChart);
  redrawingForTheme = true;
  try { render(); } finally { redrawingForTheme = false; }
});

function fatal(message) {
  document.getElementById('table-body').innerHTML = `<tr><td colspan="8" class="loading-note">${message}</td></tr>`;
}

async function init() {
  if (!window.Chart || !window.Papa) {
    fatal('A charting or data library could not be loaded (check your connection or an ad/script blocker). Try reloading.');
    return;
  }
  const [manifest, topology, isoMap] = await Promise.all([
    fetch('data/manifest.json').then(r => { if (!r.ok) throw new Error('manifest: HTTP ' + r.status); return r.json(); }),
    fetch('data/world-countries-50m.json').then(r => r.json()),
    fetch('data/iso3_numeric.json').then(r => r.json()),
  ]);
  indicatorMeta = manifest.indicators;

  isoMap.forEach(m => { isoToNumeric[m.iso3] = m.numeric; numericToIso3[m.numeric] = m.iso3; });
  if (window.ChartGeo) mapFeatures = ChartGeo.topojson.feature(topology, topology.objects.countries).features;

  populateFilters(manifest);
  applyStateFromURL();
  if (await loadCurrentIndicator()) render();
}

init().catch((err) => fatal(`Could not load the data set (${err.message}). Try reloading.`));
