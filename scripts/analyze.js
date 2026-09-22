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

function yearlyGroupAvg(code, groupField) {
  const data = filterInd(code);
  const years = [...new Set(data.map(r => r.year))].sort((a, b) => a - b);
  const groups = [...new Set(data.map(r => r[groupField]))].sort();
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

function correlation(codeA, codeB) {
  const a = filterInd(codeA);
  const b = filterInd(codeB);
  const bMap = {};
  b.forEach(r => bMap[`${r.iso3}|${r.year}`] = r.value);
  const xs = [], ys = [];
  a.forEach(r => {
    const k = `${r.iso3}|${r.year}`;
    if (bMap[k] !== undefined) { xs.push(r.value); ys.push(bMap[k]); }
  });
  return { n: xs.length, r: round(pearson(xs, ys), 3) };
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
  findings.governance_vs_electricity = correlation('GOV_WGI_GE.EST', 'EG.ELC.ACCS.ZS');
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
  findings.regulation_vs_pollution = correlation('GOV_WGI_RQ.EST', 'EN.ATM.PM25.MC.M3');
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
