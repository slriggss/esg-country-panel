// Reads data/esg_panel.csv and computes every number used in the report page.
// Writes data/findings.json. Run with: node scripts/analyze.js
// This keeps every reported number reproducible straight from the CSV.

const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'data', 'esg_panel.csv');
const text = fs.readFileSync(csvPath, 'utf8');
const lines = text.split('\n').filter(l => l.length > 0);
const header = lines[0].split(',');

function parseLine(line) {
  // Simple CSV parser matching our own writer (quotes only around fields with , " or \n)
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const idx = {};
header.forEach((h, i) => idx[h] = i);

const rows = [];
for (let i = 1; i < lines.length; i++) {
  const f = parseLine(lines[i]);
  rows.push({
    country: f[idx.country],
    iso3: f[idx.iso3],
    region: f[idx.region],
    income_group: f[idx.income_group],
    year: Number(f[idx.year]),
    pillar: f[idx.pillar],
    indicator_code: f[idx.indicator_code],
    indicator_name: f[idx.indicator_name],
    value: Number(f[idx.value]),
    percentile_rank: Number(f[idx.percentile_rank]),
  });
}

console.log(`Loaded ${rows.length} rows.`);

function filterInd(code) { return rows.filter(r => r.indicator_code === code); }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function round(n, d = 1) { return n === null ? null : Number(n.toFixed(d)); }

function yearlyGlobalAvg(code) {
  const data = filterInd(code);
  const years = [...new Set(data.map(r => r.year))].sort((a, b) => a - b);
  return years.map(y => ({ year: y, avg: round(avg(data.filter(r => r.year === y).map(r => r.value)), 2) }));
}

const INCOME_ORDER = ['High income', 'Upper middle income', 'Lower middle income', 'Low income'];

function yearlyGroupAvg(code, groupField) {
  const data = filterInd(code);
  const years = [...new Set(data.map(r => r.year))].sort((a, b) => a - b);
  let groups = [...new Set(data.map(r => r[groupField]))];
  if (groupField === 'income_group') {
    groups = INCOME_ORDER.filter(g => groups.includes(g));
  } else {
    groups = groups.sort();
  }
  return groups.map(g => ({
    group: g,
    series: years.map(y => ({ year: y, avg: round(avg(data.filter(r => r.year === y && r[groupField] === g).map(r => r.value)), 2) }))
  }));
}

function latestYearFor(code) {
  const data = filterInd(code);
  return Math.max(...data.map(r => r.year));
}

// World Bank data for the most recent year or two is often reported by only a
// subset of countries (early/provisional release). Using that thin year as
// "latest" would compare a full 2002 sample against a skewed handful of
// countries in 2023. This finds the latest year whose country count is still
// close to the indicator's typical (median) coverage.
function robustLatestYear(code) {
  const data = filterInd(code);
  const years = [...new Set(data.map(r => r.year))].sort((a, b) => a - b);
  const counts = years.map(y => data.filter(r => r.year === y).length);
  const sorted = [...counts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  for (let i = years.length - 1; i >= 0; i--) {
    if (counts[i] >= 0.7 * median) return years[i];
  }
  return years[years.length - 1];
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = avg(xs), my = avg(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  return num / Math.sqrt(dx2 * dy2);
}

function correlation(codeA, codeB, nameA, nameB) {
  const a = filterInd(codeA);
  const b = filterInd(codeB);
  const bMap = {};
  b.forEach(r => bMap[`${r.iso3}|${r.year}`] = r.value);
  const xs = [], ys = [];
  a.forEach(r => {
    const k = `${r.iso3}|${r.year}`;
    if (bMap[k] !== undefined) { xs.push(r.value); ys.push(bMap[k]); }
  });

  // Country-level averages (across all years) for a legible scatter -- one
  // point per country instead of one per country-year observation.
  const byCountryA = {}, byCountryB = {};
  a.forEach(r => { (byCountryA[r.iso3] = byCountryA[r.iso3] || []).push(r.value); });
  b.forEach(r => { (byCountryB[r.iso3] = byCountryB[r.iso3] || []).push(r.value); });
  const points = [];
  for (const iso3 of Object.keys(byCountryA)) {
    if (byCountryB[iso3]) {
      const country = rows.find(r => r.iso3 === iso3)?.country || iso3;
      points.push({ country, x: round(avg(byCountryA[iso3]), 3), y: round(avg(byCountryB[iso3]), 3) });
    }
  }

  return { n: xs.length, r: round(pearson(xs, ys), 3), xLabel: nameA, yLabel: nameB, points };
}

const findings = {};

// --- Finding 1: Renewable energy adoption, global trend ---
{
  const series = yearlyGlobalAvg('EG.FEC.RNEW.ZS');
  const robustYear = robustLatestYear('EG.FEC.RNEW.ZS');
  const first = series[0], last = series.find(s => s.year === robustYear);
  findings.renewables_trend = { series: series.filter(s => s.year <= robustYear), first, last, change: round(last.avg - first.avg, 2) };
}

// --- Finding 2: Electricity access gap by income group ---
{
  const byIncome = yearlyGroupAvg('EG.ELC.ACCS.ZS', 'income_group');
  const latestYear = latestYearFor('EG.ELC.ACCS.ZS');
  const latest = byIncome.map(g => ({ group: g.group, avg: g.series.find(s => s.year === latestYear)?.avg }));
  const high = latest.find(g => g.group === 'High income');
  const low = latest.find(g => g.group === 'Low income');
  findings.electricity_access = { byIncome, latestYear, latest, gap: round(high.avg - low.avg, 1) };
}

// --- Finding 3: GHG emissions per capita by income group ---
{
  const byIncome = yearlyGroupAvg('EN.GHG.ALL.PC.CE.AR5', 'income_group');
  const latestYear = latestYearFor('EN.GHG.ALL.PC.CE.AR5');
  const latest = byIncome.map(g => ({ group: g.group, avg: g.series.find(s => s.year === latestYear)?.avg }));
  const high = latest.find(g => g.group === 'High income');
  const low = latest.find(g => g.group === 'Low income');
  findings.ghg_by_income = { byIncome, latestYear, latest, ratio: round(high.avg / low.avg, 1) };
}

// --- Finding 4: Coal reliance trend, global ---
{
  const series = yearlyGlobalAvg('EG.ELC.COAL.ZS');
  const robustYear = robustLatestYear('EG.ELC.COAL.ZS');
  const first = series[0], last = series.find(s => s.year === robustYear);
  findings.coal_trend = { series: series.filter(s => s.year <= robustYear), first, last, change: round(last.avg - first.avg, 2) };
}

// --- Finding 5: Government effectiveness vs electricity access (correlation) ---
{
  findings.governance_vs_electricity = correlation('GOV_WGI_GE.EST', 'EG.ELC.ACCS.ZS', 'Government effectiveness (estimate)', 'Access to electricity (%)');
}

// --- Finding 6: Income inequality (Gini) by region ---
{
  const byRegion = yearlyGroupAvg('SI.POV.GINI', 'region');
  const latestYear = latestYearFor('SI.POV.GINI');
  const latest = byRegion.map(g => ({ group: g.group, avg: g.series.find(s => s.year === latestYear)?.avg })).filter(g => g.avg !== undefined && g.avg !== null);
  latest.sort((a, b) => b.avg - a.avg);
  findings.gini_by_region = { byRegion, latestYear, latest };
}

// --- Finding 7: Women in parliament, global trend ---
{
  const series = yearlyGlobalAvg('SG.GEN.PARL.ZS');
  const first = series[0], last = series[series.length - 1];
  findings.women_parliament_trend = { series, first, last, change: round(last.avg - first.avg, 2) };
}

// --- Finding 8: Regulatory quality vs PM2.5 pollution (correlation) ---
{
  findings.regulation_vs_pollution = correlation('GOV_WGI_RQ.EST', 'EN.ATM.PM25.MC.M3', 'Regulatory quality (estimate)', 'PM2.5 air pollution (micrograms/m3)');
}

// --- Finding 9: ESG composite score & country ranking ---
// Built from the percentile_rank column already in the CSV (each country's
// standing among all countries reporting that indicator in that year, 0-100).
// For indicators where a HIGH value is a bad outcome (emissions, pollution,
// unemployment, coal share, inequality, child mortality), the percentile is
// inverted so "100" always means "best outcome" across every indicator, in
// every pillar, before anything is averaged together.
{
  const BAD_WHEN_HIGH = new Set([
    'EG.ELC.COAL.ZS', 'EG.USE.COMM.FO.ZS', 'EN.GHG.ALL.PC.CE.AR5', 'EN.ATM.PM25.MC.M3',
    'SL.UEM.TOTL.ZS', 'SI.POV.GINI', 'SH.DYN.MORT',
  ]);

  // country -> pillar -> [adjusted percentiles across all its years/indicators]
  const byCountryPillar = {};
  const countryNames = {};
  for (const r of rows) {
    if (Number.isNaN(r.percentile_rank)) continue;
    countryNames[r.iso3] = r.country;
    const adjusted = BAD_WHEN_HIGH.has(r.indicator_code) ? 100 - r.percentile_rank : r.percentile_rank;
    byCountryPillar[r.iso3] = byCountryPillar[r.iso3] || {};
    (byCountryPillar[r.iso3][r.pillar] = byCountryPillar[r.iso3][r.pillar] || []).push(adjusted);
  }

  const composite = [];
  for (const iso3 of Object.keys(byCountryPillar)) {
    const pillars = byCountryPillar[iso3];
    const pillarScores = {};
    for (const p of ['Environmental', 'Social', 'Governance']) {
      if (pillars[p] && pillars[p].length >= 3) pillarScores[p] = round(avg(pillars[p]), 1);
    }
    // Require all three pillars represented so the composite isn't skewed by
    // a country that only reports, say, governance indicators.
    if (pillarScores.Environmental !== undefined && pillarScores.Social !== undefined && pillarScores.Governance !== undefined) {
      const overall = round(avg([pillarScores.Environmental, pillarScores.Social, pillarScores.Governance]), 1);
      composite.push({ country: countryNames[iso3], iso3, overall, ...pillarScores });
    }
  }
  composite.sort((a, b) => b.overall - a.overall);

  findings.esg_composite = {
    n_countries: composite.length,
    methodology_note: 'Average of each country\'s percentile rank (0-100) across all 24 indicators and all years reported, split into three pillar sub-scores, then averaged across the three pillars. Indicators where a high value is a bad outcome are inverted first so 100 always means "best".',
    top10: composite.slice(0, 10),
    bottom10: composite.slice(-10).reverse(),
  };
}

// --- Headline numbers ---
findings.headline = {
  total_rows: rows.length,
  countries: new Set(rows.map(r => r.iso3)).size,
  years_span: `${Math.min(...rows.map(r => r.year))}–${Math.max(...rows.map(r => r.year))}`,
  indicators: new Set(rows.map(r => r.indicator_code)).size,
};

fs.writeFileSync(path.join(__dirname, '..', 'data', 'findings.json'), JSON.stringify(findings, null, 2));
console.log('Wrote data/findings.json');
console.log(JSON.stringify(findings.headline, null, 2));
console.log('renewables_trend:', findings.renewables_trend.first, '->', findings.renewables_trend.last);
console.log('electricity_access gap (high vs low income, latest year):', findings.electricity_access.gap);
console.log('ghg ratio high/low income:', findings.ghg_by_income.ratio);
console.log('coal_trend:', findings.coal_trend.first, '->', findings.coal_trend.last);
console.log('governance_vs_electricity r:', findings.governance_vs_electricity);
console.log('gini_by_region latest:', findings.gini_by_region.latest);
console.log('women_parliament_trend:', findings.women_parliament_trend.first, '->', findings.women_parliament_trend.last);
console.log('regulation_vs_pollution r:', findings.regulation_vs_pollution);
