// Create each chart once its card opens (see whenCardOpens in charts-common.js).
function makeChart(canvasId, config, onCreate) {
  const canvas = document.getElementById(canvasId);
  whenCardOpens(canvas.closest('.chart-card'), () => {
    if (REDUCED_MOTION) {
      if (config.options && config.options.plugins) delete config.options.plugins.esgIntro;
      if (config.options) config.options.animation = false;
    }
    const chart = new Chart(canvas, config);
    if (onCreate) onCreate(chart);
  });
}

// Count a headline number up from 0; the final text is the exact value.
function countUp(el, target) {
  if (REDUCED_MOTION) { el.textContent = target.toLocaleString(); return; }
  const start = performance.now(), dur = 1400;
  function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(target * eased).toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Link a single-dataset bar chart to a list of notes (one per bar): hovering
// a bar emphasizes its note, and hovering a note highlights its bar.
// Returns a plugin to pass in the chart config, and attach() to call once
// the chart exists.
function noteLink(listId) {
  const items = [...document.querySelectorAll(`#${listId} [data-index]`)];
  let shown = -2;
  const plugin = {
    id: 'noteSync',
    afterDraw(c) {
      const i = c.$focus ? c.$focus.i : -1;
      if (i === shown) return;
      shown = i;
      items.forEach(li => li.classList.toggle('is-active', Number(li.dataset.index) === i));
    },
  };
  const attach = (chart) => items.forEach(li => {
    const i = Number(li.dataset.index);
    const on = () => {
      const el = [{ datasetIndex: 0, index: i }];
      chart.setActiveElements(el);
      const bar = chart.getDatasetMeta(0).data[i];
      chart.tooltip.setActiveElements(el, { x: bar.x, y: bar.y });
      window.ESG_FOCUS(chart, { d: 0, i });
    };
    const off = () => {
      chart.setActiveElements([]);
      chart.tooltip.setActiveElements([], { x: 0, y: 0 });
      window.ESG_FOCUS(chart, null);
    };
    li.addEventListener('mouseenter', on);
    li.addEventListener('mouseleave', off);
    li.addEventListener('focus', on);
    li.addEventListener('blur', off);
  });
  return { plugin, attach };
}

async function main() {
  const findings = await fetch('data/findings.json').then(r => r.json());
  const C = window.ESG_COLORS;

  // Headline numbers
  countUp(document.getElementById('stat-rows'), findings.headline.total_rows);
  countUp(document.getElementById('stat-countries'), findings.headline.countries);
  document.getElementById('stat-years').textContent = findings.headline.years_span;
  countUp(document.getElementById('stat-indicators'), findings.headline.indicators);

  const commonScales = (yLabel) => ({
    x: { grid: { display: false }, ticks: { color: C.muted } },
    y: {
      grid: { color: C.grid, drawTicks: false },
      border: { display: false },
      ticks: { color: C.muted },
      title: yLabel ? { display: true, text: yLabel, color: C.textSecondary, font: { size: 12 } } : undefined,
    },
  });

  function lineChart(canvasId, series, label, color, yLabel, annotate) {
    makeChart(canvasId, {
      type: 'line',
      data: {
        labels: series.map(s => s.year),
        datasets: [{
          label,
          data: series.map(s => s.avg),
          borderColor: color,
          backgroundColor: (ctx) => {
            const area = ctx.chart.chartArea;
            const intro = ctx.chart.$intro;
            const k = intro && intro.fill != null ? intro.fill : 1;
            const hex = (a) => Math.round(a * k).toString(16).padStart(2, '0');
            if (!area) return color + hex(0x1a);
            const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
            g.addColorStop(0, color + hex(0x40));
            g.addColorStop(1, color + '00');
            return g;
          },
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointBackgroundColor: color,
          pointBorderColor: C.surface,
          pointBorderWidth: 2,
          tension: 0.25,
          fill: true,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 0 },
        layout: { padding: { top: 22, left: 8, right: 8 } },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, esgAnnotate: annotate, esgIntro: { mode: 'sweep' } },
        scales: { ...commonScales(yLabel), y: { ...commonScales(yLabel).y, grace: '8%' } },
      },
    });
  }

  function multiLineChart(canvasId, groups, yLabel, annotate) {
    // Label each line at its end instead of a legend, unless the card is too
    // narrow for the labels to fit -- then fall back to the legend.
    const narrow = document.getElementById(canvasId).parentElement.clientWidth < 560;
    makeChart(canvasId, {
      type: 'line',
      data: {
        labels: groups[0].series.map(s => s.year),
        datasets: groups.map((g, i) => ({
          label: g.group,
          data: g.series.map(s => s.avg),
          borderColor: C.series[i],
          backgroundColor: C.series[i] + '1a',
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointBackgroundColor: C.series[i],
          pointBorderColor: C.surface,
          pointBorderWidth: 2,
          tension: 0.25,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 0 },
        layout: { padding: { right: narrow ? 0 : 170 } },
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: narrow, position: 'bottom', labels: { color: C.textSecondary } },
          esgAnnotate: narrow ? undefined : annotate,
          // One income group at a time, richest first, so the gap builds up.
          esgIntro: { mode: 'sequence', gap: 850 },
        },
        scales: commonScales(yLabel),
      },
    });
  }

  function barChartGroups(canvasId, items, yLabel, annotate, link) {
    const step = 220;
    makeChart(canvasId, {
      type: 'bar',
      data: {
        labels: items.map(i => i.group),
        datasets: [{
          data: items.map(i => i.avg),
          backgroundColor: items.map((_, i) => C.series[i]),
          borderRadius: 4,
          maxBarThickness: 64,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: staggered(step, 900),
        layout: { padding: { top: 34 } },
        plugins: { legend: { display: false }, esgAnnotate: annotate, esgIntro: { mode: 'fade', after: 900 + step * (items.length - 1) } },
        scales: {
          x: { grid: { display: false }, ticks: { color: C.textSecondary, autoSkip: false, maxRotation: 20, minRotation: 0, font: { size: 13 } } },
          y: commonScales(yLabel).y,
        },
      },
      plugins: link ? [link.plugin] : [],
    }, link && link.attach);
  }

  function rankedBarChart(canvasId, items, xLabel, annotate) {
    const step = 130;
    makeChart(canvasId, {
      type: 'bar',
      data: {
        labels: items.map(i => i.group.trim()),
        datasets: [{
          data: items.map(i => i.avg),
          backgroundColor: C.series[0],
          borderRadius: 4,
          maxBarThickness: 22,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        animation: staggered(step, 800),
        layout: { padding: { right: 36 } },
        plugins: { legend: { display: false }, esgAnnotate: annotate, esgIntro: { mode: 'fade', after: 800 + step * (items.length - 1) } },
        scales: {
          x: { grid: { color: C.grid }, ticks: { color: C.muted }, title: { display: true, text: xLabel, color: C.textSecondary, font: { size: 12 } } },
          y: { grid: { display: false, drawTicks: false }, ticks: { color: C.textSecondary } },
        },
      },
    });
  }

  function scatterChart(canvasId, points, xLabel, yLabel, color, annotate) {
    // Points drop in from the top, sweeping left to right by x value.
    const order = points.map((p, i) => [p.x, i]).sort((a, b) => a[0] - b[0]);
    const delayOf = [];
    const spread = 1100 / Math.max(1, points.length - 1);
    order.forEach(([, i], rank) => { delayOf[i] = rank * spread; });
    const firstDraw = (ctx) => ctx.type === 'data' && ctx.mode === 'default';
    makeChart(canvasId, {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Country average, 2002–2023',
          data: points.map(p => ({ x: p.x, y: p.y, country: p.country })),
          backgroundColor: color + 'b3',
          borderColor: color,
          borderWidth: 1,
          radius: 4,
          hoverRadius: 7,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animations: {
          y: {
            duration: 700,
            easing: 'easeOutBounce',
            from: (ctx) => (firstDraw(ctx) ? ctx.chart.chartArea.top : undefined),
            delay: (ctx) => (firstDraw(ctx) ? delayOf[ctx.dataIndex] : 0),
          },
        },
        plugins: {
          legend: { display: false },
          esgAnnotate: annotate,
          esgIntro: { mode: 'scatter', after: 1100 + 700 },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.raw.country}: ${ctx.parsed.x}, ${ctx.parsed.y}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: C.muted }, title: { display: true, text: xLabel, color: C.textSecondary, font: { size: 12 } } },
          y: { grid: { color: C.grid }, ticks: { color: C.muted }, title: { display: true, text: yLabel, color: C.textSecondary, font: { size: 12 } } },
        },
      },
    });
  }

  function countryBars(canvasId, countries, color) {
    const step = 110;
    makeChart(canvasId, {
      type: 'bar',
      data: {
        labels: countries.map(c => c.country),
        datasets: [{
          data: countries.map(c => c.overall),
          backgroundColor: color,
          borderRadius: 4,
          maxBarThickness: 18,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        animation: staggered(step, 800),
        layout: { padding: { right: 34 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `Composite score: ${ctx.parsed.x}` } },
          esgAnnotate: { valueLabels: { decimals: 1 } },
          esgIntro: { mode: 'fade', after: 800 + step * (countries.length - 1) },
        },
        scales: {
          // Shared 0-100 axis on both charts so the gap between them is honest.
          x: { min: 0, max: 100, grid: { color: C.grid }, ticks: { color: C.muted }, title: { display: true, text: 'ESG composite score (0–100)', color: C.textSecondary, font: { size: 12 } } },
          y: { grid: { display: false, drawTicks: false }, ticks: { color: C.textSecondary, font: { size: 12 } } },
        },
      },
    });
  }

  const trendAnnotate = (f, suffix) => ({
    baseline: { value: f.first.avg, label: `${f.first.year} level` },
    endpoints: { suffix, decimals: 1 },
  });
  const scatterNote = (f) => `r = ${f.r} across ${f.n.toLocaleString()} country-years`;

  // 1. Renewables trend
  lineChart('chart-renewables', findings.renewables_trend.series, 'Renewable energy share (%)', C.series[0], '% of final energy',
    trendAnnotate(findings.renewables_trend, '%'));

  // 2. Electricity access by income group
  multiLineChart('chart-electricity', findings.electricity_access.byIncome, '% of population',
    { endLabels: { suffix: '%', decimals: 1 } });

  // 3. GHG per capita by income group (notes under the chart follow the hover)
  barChartGroups('chart-ghg', findings.ghg_by_income.latest, 't CO2e per capita',
    { valueLabels: { suffix: ' t', decimals: 2 }, note: `${findings.ghg_by_income.ratio}× gap, high- vs low-income`, notePos: 'tr' },
    noteLink('ghg-notes'));

  // 4. Coal trend
  lineChart('chart-coal', findings.coal_trend.series, 'Electricity from coal (%)', C.series[0], '% of electricity mix',
    trendAnnotate(findings.coal_trend, '%'));

  // 5. Governance vs electricity scatter
  scatterChart('chart-governance', findings.governance_vs_electricity.points, findings.governance_vs_electricity.xLabel, findings.governance_vs_electricity.yLabel, C.series[0],
    { fitLine: true, note: scatterNote(findings.governance_vs_electricity), notePos: 'br' });

  // 6. Gini by region
  rankedBarChart('chart-gini', findings.gini_by_region.latest, 'Gini index',
    { valueLabels: { decimals: 1 } });

  // 7. Women in parliament trend
  lineChart('chart-women', findings.women_parliament_trend.series, 'Seats held by women (%)', C.series[0], '% of parliamentary seats',
    trendAnnotate(findings.women_parliament_trend, '%'));

  // 8. Regulation vs pollution scatter
  scatterChart('chart-regulation', findings.regulation_vs_pollution.points, findings.regulation_vs_pollution.xLabel, findings.regulation_vs_pollution.yLabel, C.series[1],
    { fitLine: true, note: scatterNote(findings.regulation_vs_pollution), notePos: 'tr' });

  // 9. ESG composite: top 10 and bottom 10, side by side
  countryBars('chart-top10', findings.esg_composite.top10, C.series[0]);
  countryBars('chart-bottom10', findings.esg_composite.bottom10, C.series[7]);
}

main();
