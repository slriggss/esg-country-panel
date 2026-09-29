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
    region: f[idx.region].trim(),
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

  // The scatter plots one point per country, so also report r on exactly those
  // points (the trend line drawn on the chart is fit to them, not to the
  // pooled country-year observations behind `r`).
  const rCountry = pearson(points.map(p => p.x), points.map(p => p.y));
  return { n: xs.length, r: round(pearson(xs, ys), 3), n_countries: points.length, r_country: round(rCountry, 3), xLabel: nameA, yLabel: nameB, points };
}

// Robustness check for unweighted yearly means: the set of reporting countries
// changes from year to year, so also compute the change over the same
// countries only (those with a value in both the first and last year).
function sameCountryChange(code, firstYear, lastYear) {
  const data = filterInd(code);
  const a = new Map(data.filter(r => r.year === firstYear).map(r => [r.iso3, r.value]));
  const b = new Map(data.filter(r => r.year === lastYear).map(r => [r.iso3, r.value]));
  const both = [...a.keys()].filter(k => b.has(k));
  const first = avg(both.map(k => a.get(k))), last = avg(both.map(k => b.get(k)));
  return { countries: both.length, first: round(first, 1), last: round(last, 1), change: round(last - first, 1) };
}

const findings = {};

// --- Finding 1: Renewable energy adoption, global trend ---
{
  const series = yearlyGlobalAvg('EG.FEC.RNEW.ZS');
  const robustYear = robustLatestYear('EG.FEC.RNEW.ZS');
  const first = series[0], last = series.find(s => s.year === robustYear);
  findings.renewables_trend = { series: series.filter(s => s.year <= robustYear), first, last, change: round(last.avg - first.avg, 2) };

  // The final-energy series counts traditional biomass (firewood, charcoal) as
  // renewable, so split it by income group to see where the decline sits.
  findings.renewables_trend.sameCountries = sameCountryChange('EG.FEC.RNEW.ZS', first.year, robustYear);
  findings.renewables_trend.byIncome = yearlyGroupAvg('EG.FEC.RNEW.ZS', 'income_group').map(g => ({
    group: g.group,
    first: g.series.find(s => s.year === first.year),
    last: g.series.find(s => s.year === robustYear),
  }));

  // Renewable share of electricity generation over the same years, for the
  // power sector specifically. Countries that rose/fell are counted on a
  // balanced panel: only countries reporting in both the first and last year.
  const elec = filterInd('EG.ELC.RNEW.ZS');
  const startMap = new Map(elec.filter(r => r.year === first.year).map(r => [r.iso3, r.value]));
  const endMap = new Map(elec.filter(r => r.year === robustYear).map(r => [r.iso3, r.value]));
  const both = [...startMap.keys()].filter(k => endMap.has(k));
  const deltas = both.map(k => endMap.get(k) - startMap.get(k));
  findings.renewables_trend.electricity = {
    firstYear: first.year,
    lastYear: robustYear,
    countries: both.length,
    firstAvg: round(avg(both.map(k => startMap.get(k))), 1),
    lastAvg: round(avg(both.map(k => endMap.get(k))), 1),
    rose: deltas.filter(d => d > 0).length,
    fell: deltas.filter(d => d < 0).length,
  };
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
  findings.coal_trend = { series: series.filter(s => s.year <= robustYear), first, last, change: round(last.avg - first.avg, 2), sameCountries: sameCountryChange('EG.ELC.COAL.ZS', first.year, robustYear) };
}

// --- Finding 5: Government effectiveness vs electricity access (correlation) ---
{
  const g = correlation('GOV_WGI_GE.EST', 'EG.ELC.ACCS.ZS', 'Government effectiveness (estimate)', 'Access to electricity (%)');
  // Who breaks the pattern? Split countries at a governance score of 0 (the
  // WGI scale is centered near 0) and count exceptions in each direction.
  const strongGov = g.points.filter(p => p.x >= 0), weakGov = g.points.filter(p => p.x < 0);
  g.split = {
    strong: strongGov.length,
    strongBelow80: strongGov.filter(p => p.y < 80).length,
    weak: weakGov.length,
    weakAbove90: weakGov.filter(p => p.y > 90).length,
  };
  findings.governance_vs_electricity = g;
}

// --- Finding 6: Income inequality (Gini) by region ---
// Gini is reported sparsely (a country may report only every few years), and
// a single year leaves some regions with one country. So each country counts
// once, at its most recent reading in the window below, and every region
// carries the number of countries behind its average.
{
  const WINDOW_START = 2015;
  const data = filterInd('SI.POV.GINI');
  const latestByCountry = new Map();
  for (const r of data) {
    if (r.year < WINDOW_START) continue;
    const cur = latestByCountry.get(r.iso3);
    if (!cur || r.year > cur.year) latestByCountry.set(r.iso3, r);
  }
  const groups = {};
  for (const r of latestByCountry.values()) (groups[r.region] = groups[r.region] || []).push(r.value);
  const latest = Object.entries(groups).map(([group, vals]) => ({ group, avg: round(avg(vals), 1), n: vals.length }));
  latest.sort((a, b) => b.avg - a.avg);

  // Was the top region a one-year fluke? Rank regions within every year.
  const years = [...new Set(data.map(r => r.year))].sort((a, b) => a - b);
  const topByYear = years.map(y => {
    const by = {};
    data.filter(r => r.year === y).forEach(r => (by[r.region] = by[r.region] || []).push(r.value));
    return Object.entries(by).map(([g, v]) => [g, avg(v)]).sort((a, b) => b[1] - a[1])[0][0];
  });
  findings.gini_by_region = {
    windowStart: WINDOW_START,
    windowEnd: Math.max(...data.map(r => r.year)),
    countries: latestByCountry.size,
    latest,
    topRegion: latest[0].group,
    topRegionYears: topByYear.filter(g => g === latest[0].group).length,
    totalYears: years.length,
  };
}

// --- Finding 7: Women in parliament, global trend ---
{
  const series = yearlyGlobalAvg('SG.GEN.PARL.ZS');
  const first = series[0], last = series[series.length - 1];
  let upYears = 0;
  for (let i = 1; i < series.length; i++) if (series[i].avg > series[i - 1].avg) upYears++;
  findings.women_parliament_trend = { series, first, last, change: round(last.avg - first.avg, 2), upYears, steps: series.length - 1, sameCountries: sameCountryChange('SG.GEN.PARL.ZS', first.year, last.year) };
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
// inverted so "100" always means "best outcome" across every indicator.
//
// Every indicator counts equally: a country's years are averaged within each
// indicator first, then the indicator scores are averaged into a pillar score,
// so an indicator with more years reported doesn't outweigh the others.
// A country needs at least MIN_INDICATORS of the 24 indicators (and 2 in each
// pillar) to be scored -- otherwise tiny economies that report only a handful
// of indicators would be ranked on which few happen to be available.
{
  const BAD_WHEN_HIGH = new Set([
    'EG.ELC.COAL.ZS', 'EG.USE.COMM.FO.ZS', 'EN.GHG.ALL.PC.CE.AR5', 'EN.ATM.PM25.MC.M3',
    'SL.UEM.TOTL.ZS', 'SI.POV.GINI', 'SH.DYN.MORT',
  ]);
  const TOTAL_INDICATORS = new Set(rows.map(r => r.indicator_code)).size;
  const MIN_INDICATORS = Math.ceil(0.75 * TOTAL_INDICATORS);
  const MIN_PER_PILLAR = 2;

  // country -> indicator -> { pillar, adjusted percentiles across its years }
  const byCountry = {};
  const countryNames = {};
  for (const r of rows) {
    if (Number.isNaN(r.percentile_rank)) continue;
    countryNames[r.iso3] = r.country;
    const adjusted = BAD_WHEN_HIGH.has(r.indicator_code) ? 100 - r.percentile_rank : r.percentile_rank;
    const c = (byCountry[r.iso3] = byCountry[r.iso3] || {});
    const ind = (c[r.indicator_code] = c[r.indicator_code] || { pillar: r.pillar, vals: [] });
    ind.vals.push(adjusted);
  }

  const composite = [];
  let tooFew = 0;
  for (const iso3 of Object.keys(byCountry)) {
    const inds = Object.values(byCountry[iso3]);
    const pillarScores = {};
    for (const p of ['Environmental', 'Social', 'Governance']) {
      const scores = inds.filter(i => i.pillar === p).map(i => avg(i.vals));
      if (scores.length >= MIN_PER_PILLAR) pillarScores[p] = round(avg(scores), 1);
    }
    if (inds.length < MIN_INDICATORS || Object.keys(pillarScores).length < 3) { tooFew++; continue; }
    const overall = round(avg([pillarScores.Environmental, pillarScores.Social, pillarScores.Governance]), 1);
    composite.push({ country: countryNames[iso3], iso3, overall, indicators: inds.length, ...pillarScores });
  }
  composite.sort((a, b) => b.overall - a.overall);

  findings.esg_composite = {
    n_countries: composite.length,
    n_excluded: tooFew,
    total_indicators: TOTAL_INDICATORS,
    min_indicators: MIN_INDICATORS,
    methodology_note: 'Percentile rank (0-100) of each country on each indicator, inverted where a high value is bad, averaged over years within an indicator, then across indicators within a pillar, then across the three pillars. Countries reporting fewer than ' + MIN_INDICATORS + ' of ' + TOTAL_INDICATORS + ' indicators are not scored.',
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
console.log('governance_vs_electricity:', { ...findings.governance_vs_electricity, points: undefined });
console.log('gini_by_region:', JSON.stringify(findings.gini_by_region));
console.log('women_parliament_trend:', findings.women_parliament_trend.first, '->', findings.women_parliament_trend.last);
console.log('regulation_vs_pollution:', { ...findings.regulation_vs_pollution, points: undefined });
console.log('esg_composite:', JSON.stringify({ ...findings.esg_composite, methodology_note: undefined }));
