async function main() {
  const findings = await fetch('data/findings.json').then(r => r.json());
  const C = window.ESG_COLORS;

  // Headline numbers
  document.getElementById('stat-rows').textContent = findings.headline.total_rows.toLocaleString();
  document.getElementById('stat-countries').textContent = findings.headline.countries;
  document.getElementById('stat-years').textContent = findings.headline.years_span;
  document.getElementById('stat-indicators').textContent = findings.headline.indicators;

  const commonScales = (yLabel) => ({
    x: { grid: { display: false }, ticks: { color: C.muted } },
    y: {
      grid: { color: C.grid, drawTicks: false },
      border: { display: false },
      ticks: { color: C.muted },
      title: yLabel ? { display: true, text: yLabel, color: C.textSecondary, font: { size: 11 } } : undefined,
    },
  });

  function lineChart(canvasId, series, label, color, yLabel) {
    new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: series.map(s => s.year),
        datasets: [{
          label,
          data: series.map(s => s.avg),
          borderColor: color,
          backgroundColor: color + '1a',
          borderWidth: 2,
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
        plugins: { legend: { display: false } },
        scales: commonScales(yLabel),
      },
    });
  }

  function multiLineChart(canvasId, groups, yLabel) {
    new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: groups[0].series.map(s => s.year),
        datasets: groups.map((g, i) => ({
          label: g.group,
          data: g.series.map(s => s.avg),
          borderColor: C.series[i],
          backgroundColor: C.series[i] + '1a',
          borderWidth: 2,
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
        plugins: { legend: { position: 'bottom', labels: { color: C.textSecondary } } },
        scales: commonScales(yLabel),
      },
    });
  }

  function barChartGroups(canvasId, items, yLabel) {
    new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels: items.map(i => i.group),
        datasets: [{
          data: items.map(i => i.avg),
          backgroundColor: items.map((_, i) => C.series[i]),
          borderRadius: 4,
          maxBarThickness: 48,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: C.muted, autoSkip: false, maxRotation: 20, minRotation: 0 } },
          y: commonScales(yLabel).y,
        },
      },
    });
  }

  function rankedBarChart(canvasId, items, yLabel) {
    new Chart(document.getElementById(canvasId), {
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
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: C.grid }, ticks: { color: C.muted }, title: { display: true, text: yLabel, color: C.textSecondary, font: { size: 11 } } },
          y: { grid: { display: false }, ticks: { color: C.textSecondary } },
        },
      },
    });
  }

  function scatterChart(canvasId, points, xLabel, yLabel, color) {
    new Chart(document.getElementById(canvasId), {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Country average, 2002–2023',
          data: points.map(p => ({ x: p.x, y: p.y, country: p.country })),
          backgroundColor: color + 'b3',
          borderColor: color,
          borderWidth: 1,
          radius: 4,
          hoverRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.raw.country}: ${ctx.parsed.x}, ${ctx.parsed.y}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: C.muted }, title: { display: true, text: xLabel, color: C.textSecondary, font: { size: 11 } } },
          y: { grid: { color: C.grid }, ticks: { color: C.muted }, title: { display: true, text: yLabel, color: C.textSecondary, font: { size: 11 } } },
        },
      },
    });
  }

  // 1. Renewables trend
  lineChart('chart-renewables', findings.renewables_trend.series, 'Renewable energy share (%)', C.series[0], '% of final energy');

  // 2. Electricity access by income group
  multiLineChart('chart-electricity', findings.electricity_access.byIncome, '% of population');

  // 3. GHG per capita by income group
  barChartGroups('chart-ghg', findings.ghg_by_income.latest, 't CO2e per capita');

  // 4. Coal trend
  lineChart('chart-coal', findings.coal_trend.series, 'Electricity from coal (%)', C.series[0], '% of electricity mix');

  // 5. Governance vs electricity scatter
  scatterChart('chart-governance', findings.governance_vs_electricity.points, findings.governance_vs_electricity.xLabel, findings.governance_vs_electricity.yLabel, C.series[0]);

  // 6. Gini by region
  rankedBarChart('chart-gini', findings.gini_by_region.latest, 'Gini index');

  // 7. Women in parliament trend
  lineChart('chart-women', findings.women_parliament_trend.series, 'Seats held by women (%)', C.series[0], '% of parliamentary seats');

  // 8. Regulation vs pollution scatter
  scatterChart('chart-regulation', findings.regulation_vs_pollution.points, findings.regulation_vs_pollution.xLabel, findings.regulation_vs_pollution.yLabel, C.series[1]);

  // 9. ESG composite ranking
  compositeChart('chart-composite', findings.esg_composite.top10, findings.esg_composite.bottom10);
}

function compositeChart(canvasId, top10, bottom10) {
  const C = window.ESG_COLORS;
  const combined = [...top10, ...[...bottom10].reverse()];
  new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: {
      labels: combined.map(c => c.country),
      datasets: [{
        data: combined.map(c => c.overall),
        backgroundColor: combined.map(c => top10.includes(c) ? C.series[0] : C.series[7]),
        borderRadius: 4,
        maxBarThickness: 16,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `Composite score: ${ctx.parsed.x}` } },
      },
      scales: {
        x: { min: 0, max: 100, grid: { color: C.grid }, ticks: { color: C.muted }, title: { display: true, text: 'ESG composite score (0–100)', color: C.textSecondary, font: { size: 11 } } },
        y: { grid: { display: false }, ticks: { color: C.textSecondary, font: { size: 10.5 } } },
      },
    },
  });
}

main();
