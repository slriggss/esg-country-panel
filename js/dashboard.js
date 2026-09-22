let allRows = [];
let indicatorMeta = []; // [{code, name, pillar}]
let charts = {}; // canvasId -> Chart instance

const state = {
  indicator: null,
  yearFrom: null,
  yearTo: null,
  region: '',
  income: '',
  country: '',
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

function populateFilters() {
  const indSel = document.getElementById('f-indicator');
  const pillars = ['Environmental', 'Social', 'Governance'];
  pillars.forEach(p => {
    const group = document.createElement('optgroup');
    group.label = p;
    indicatorMeta.filter(i => i.pillar === p).forEach(i => {
      const opt = document.createElement('option');
      opt.value = i.code;
      opt.textContent = i.name;
      group.appendChild(opt);
    });
    indSel.appendChild(group);
  });
  indSel.value = DEFAULT_INDICATOR;

  const years = [...new Set(allRows.map(r => r.year))].sort((a, b) => a - b);
  const fromSel = document.getElementById('f-year-from');
  const toSel = document.getElementById('f-year-to');
  years.forEach(y => {
    fromSel.appendChild(new Option(y, y));
    toSel.appendChild(new Option(y, y));
  });
  fromSel.value = years[0];
  toSel.value = years[years.length - 1];
  state.yearFrom = years[0];
  state.yearTo = years[years.length - 1];

  const regions = [...new Set(allRows.map(r => r.region))].sort();
  const regionSel = document.getElementById('f-region');
  regions.forEach(r => regionSel.appendChild(new Option(r.trim(), r)));

  const incomeOrder = ['High income', 'Upper middle income', 'Lower middle income', 'Low income'];
  const incomeSel = document.getElementById('f-income');
  incomeOrder.filter(g => allRows.some(r => r.income_group === g)).forEach(g => incomeSel.appendChild(new Option(g, g)));

  const countries = [...new Map(allRows.map(r => [r.iso3, r.country])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const countrySel = document.getElementById('f-country');
  countries.forEach(([iso3, name]) => countrySel.appendChild(new Option(name, iso3)));

  state.indicator = DEFAULT_INDICATOR;

  indSel.addEventListener('change', () => { state.indicator = indSel.value; render(); });
  fromSel.addEventListener('change', () => { state.yearFrom = Number(fromSel.value); render(); });
  toSel.addEventListener('change', () => { state.yearTo = Number(toSel.value); render(); });
  regionSel.addEventListener('change', () => { state.region = regionSel.value; render(); });
  incomeSel.addEventListener('change', () => { state.income = incomeSel.value; render(); });
  countrySel.addEventListener('change', () => { state.country = countrySel.value; render(); });

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

  document.getElementById('btn-reset').addEventListener('click', () => {
    indSel.value = DEFAULT_INDICATOR;
    fromSel.value = years[0];
    toSel.value = years[years.length - 1];
    regionSel.value = '';
    incomeSel.value = '';
    countrySel.value = '';
    document.querySelectorAll('#measure-switch button').forEach(b => b.classList.remove('active'));
    document.querySelector('#measure-switch button[data-measure="avg"]').classList.add('active');
    document.querySelectorAll('#breakdown-switch button').forEach(b => b.classList.remove('active'));
    document.querySelector('#breakdown-switch button[data-breakdown="region"]').classList.add('active');
    Object.assign(state, {
      indicator: DEFAULT_INDICATOR, yearFrom: years[0], yearTo: years[years.length - 1],
      region: '', income: '', country: '', measure: 'avg', breakdown: 'region',
    });
    render();
  });
}

function filteredForIndicator() {
  return allRows.filter(r =>
    r.indicator_code === state.indicator &&
    r.year >= state.yearFrom && r.year <= state.yearTo &&
    (!state.region || r.region === state.region) &&
    (!state.income || r.income_group === state.income) &&
    (!state.country || r.iso3 === state.country)
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

function render() {
  const rows = filteredForIndicator();
  const ind = indicatorMeta.find(i => i.code === state.indicator);
  const C = window.ESG_COLORS;

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
    destroyChart('chart-trend');
    charts['chart-trend'] = new Chart(document.getElementById('chart-trend'), {
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
    destroyChart('chart-groups');
    charts['chart-groups'] = new Chart(document.getElementById('chart-groups'), {
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
    destroyChart('chart-distribution');
    charts['chart-distribution'] = new Chart(document.getElementById('chart-distribution'), {
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

  // --- Chart 4: highest & lowest countries, latest year ---
  {
    const sorted = [...latestRows].sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, 8);
    const bottom = sorted.slice(-8).reverse();
    const combined = [...top, ...bottom.filter(b => !top.includes(b))];
    destroyChart('chart-rank');
    charts['chart-rank'] = new Chart(document.getElementById('chart-rank'), {
      type: 'bar',
      data: {
        labels: combined.map(r => r.country),
        datasets: [{
          data: combined.map(r => r.value),
          backgroundColor: combined.map(r => top.includes(r) ? C.series[0] : C.series[7]),
          borderRadius: 4, maxBarThickness: 16,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: C.grid }, ticks: { color: C.muted } },
          y: { grid: { display: false }, ticks: { color: C.textSecondary, font: { size: 10.5 } } },
        },
      },
    });
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

Papa.parse('data/esg_panel.csv', {
  download: true,
  header: true,
  dynamicTyping: true,
  skipEmptyLines: true,
  complete: (results) => {
    allRows = results.data.filter(r => r.iso3);
    const seen = new Set();
    indicatorMeta = [];
    allRows.forEach(r => {
      if (!seen.has(r.indicator_code)) {
        seen.add(r.indicator_code);
        indicatorMeta.push({ code: r.indicator_code, name: r.indicator_name, pillar: r.pillar });
      }
    });
    indicatorMeta.sort((a, b) => a.name.localeCompare(b.name));
    populateFilters();
    render();
  },
});
