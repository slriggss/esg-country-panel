// Builds index.html from index.template.html and data/findings.json.
// Every number and country name in the report's prose is a {{token}} in the
// template, filled in here from findings.json, so re-running analyze.js and
// then this script keeps the text and the charts in agreement.
//
// Claims the prose makes in words ("rose in every year", "the smallest
// footprint") are checked against the data below; if the data stops
// supporting one, this script fails instead of publishing a false sentence.
//
// Run with: node scripts/build_report.js   (after scripts/analyze.js)

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const f = JSON.parse(fs.readFileSync(path.join(root, 'data', 'findings.json'), 'utf8'));
const template = fs.readFileSync(path.join(root, 'index.template.html'), 'utf8');

// --- formatting helpers ------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fx = (n, d = 1) => Number(n).toFixed(d);
const abs = (n, d = 1) => Math.abs(Number(n)).toFixed(d);
const int = (n) => Number(n).toLocaleString('en-US');
const signed = (n, d = 3) => (Number(n) < 0 ? '&minus;' : '') + Math.abs(Number(n)).toFixed(d);
const shortName = (s) => s.replace(/,\s*(Fed\. Rep\.|Rep\.|Islamic Rep\.|Arab Rep\.|Dem\. Rep\.)$/, '');
const list = (names) => (names.length < 3
  ? names.join(' and ')
  : names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1]);

function check(cond, message) {
  if (!cond) throw new Error('Report claim no longer supported by the data: ' + message);
}

// --- values available to the template ----------------------------------------
const byGroup = (arr, g) => arr.find(x => x.group === g);
const v = {};

// Headline
v['head.rows'] = int(f.headline.total_rows);
v['head.countries'] = int(f.headline.countries);
v['head.indicators'] = int(f.headline.indicators);
v['head.years'] = f.headline.years_span.replace('–', '&ndash;');
{
  const [a, b] = f.headline.years_span.split('–').map(Number);
  v['head.nyears'] = String(b - a + 1);
}

// 1. Renewables
{
  const r = f.renewables_trend, e = r.electricity;
  v['ren.y0'] = r.first.year; v['ren.y1'] = r.last.year;
  v['ren.first'] = fx(r.first.avg); v['ren.last'] = fx(r.last.avg); v['ren.drop'] = abs(r.change);
  for (const [key, g] of [['hi', 'High income'], ['lmi', 'Lower middle income'], ['li', 'Low income']]) {
    const x = byGroup(r.byIncome, g);
    v[`ren.${key}.first`] = fx(x.first.avg); v[`ren.${key}.last`] = fx(x.last.avg);
  }
  v['ren.same.n'] = int(r.sameCountries.countries);
  v['ren.same.first'] = fx(r.sameCountries.first); v['ren.same.last'] = fx(r.sameCountries.last);
  v['ren.same.drop'] = abs(r.sameCountries.change);
  v['ren.elec.n'] = int(e.countries); v['ren.elec.first'] = fx(e.firstAvg); v['ren.elec.last'] = fx(e.lastAvg); v['ren.elec.rose'] = int(e.rose);
  check(r.change < 0, 'renewable share of final energy should have declined');
  check(e.lastAvg > e.firstAvg, 'renewable share of electricity should have risen');
  check(byGroup(r.byIncome, 'High income').last.avg > byGroup(r.byIncome, 'High income').first.avg, 'high-income renewable share should have risen');
  check(r.sameCountries.change < 0, 'the renewables decline should hold for a fixed set of countries');
}

// 2. Electricity access
{
  const l = f.electricity_access.latest;
  v['acc.year'] = f.electricity_access.latestYear;
  v['acc.hi'] = fx(byGroup(l, 'High income').avg); v['acc.umi'] = fx(byGroup(l, 'Upper middle income').avg);
  v['acc.lmi'] = fx(byGroup(l, 'Lower middle income').avg); v['acc.li'] = fx(byGroup(l, 'Low income').avg);
  v['acc.gap'] = fx(f.electricity_access.gap);
}

// 3. Emissions
{
  const l = f.ghg_by_income.latest;
  const hi = byGroup(l, 'High income').avg, umi = byGroup(l, 'Upper middle income').avg;
  const lmi = byGroup(l, 'Lower middle income').avg, li = byGroup(l, 'Low income').avg;
  v['ghg.year'] = f.ghg_by_income.latestYear;
  v['ghg.hi'] = fx(hi, 2); v['ghg.umi'] = fx(umi, 2); v['ghg.lmi'] = fx(lmi, 2); v['ghg.li'] = fx(li, 2);
  v['ghg.ratio'] = fx(f.ghg_by_income.ratio);
  check(f.ghg_by_income.ratio >= 7 && f.ghg_by_income.ratio < 8, 'the emissions headline says "more than seven times"');
  check(umi / hi > 0.4 && umi / hi < 0.6, '"roughly half the high-income level"');
  check(lmi / hi > 0.15 && lmi / hi < 0.3, '"about a fifth of the high-income level"');
  const acc = f.electricity_access.latest;
  check(li < lmi && lmi < umi && umi < hi, 'emissions should step down with income');
  check(byGroup(acc, 'Low income').avg === Math.min(...acc.map(x => x.avg)), 'low income should have the lowest electricity access');
}

// 4. Coal
{
  const c = f.coal_trend;
  v['coal.y0'] = c.first.year; v['coal.y1'] = c.last.year;
  v['coal.first'] = fx(c.first.avg); v['coal.last'] = fx(c.last.avg); v['coal.drop'] = abs(c.change, 2);
  v['coal.same.n'] = int(c.sameCountries.countries);
  v['coal.same.first'] = fx(c.sameCountries.first); v['coal.same.last'] = fx(c.sameCountries.last);
  check(c.change < 0 && abs(c.change, 2) < 5, 'coal share should have declined modestly');
  check(c.sameCountries.change < 0, 'the coal decline should hold for a fixed set of countries');
}

// 5. Governance vs electricity
{
  const g = f.governance_vs_electricity;
  v['gov.n'] = int(g.n); v['gov.r'] = fx(g.r, 3);
  v['gov.nc'] = int(g.n_countries); v['gov.rc'] = fx(g.r_country, 3);
  v['gov.strong'] = int(g.split.strong); v['gov.strong80'] = int(g.split.strongBelow80);
  v['gov.weak'] = int(g.split.weak); v['gov.weak90'] = int(g.split.weakAbove90);
  check(g.r > 0.5 && g.r_country > 0.5, '"strong positive relationship"');
  check(g.split.strongBelow80 / g.split.strong < 0.1, 'few high-governance countries should have low electricity access');
  check(g.split.weakAbove90 / g.split.weak > 0.2, 'a meaningful share of low-governance countries should have high access');
}

// 6. Gini
{
  const g = f.gini_by_region;
  const l = g.latest;
  v['gini.from'] = g.windowStart; v['gini.to'] = g.windowEnd; v['gini.n'] = int(g.countries);
  v['gini.r1.name'] = esc(l[0].group); v['gini.r1.avg'] = fx(l[0].avg); v['gini.r1.n'] = int(l[0].n);
  v['gini.r2.name'] = esc(l[1].group); v['gini.r2.avg'] = fx(l[1].avg); v['gini.r2.n'] = int(l[1].n);
  const na = byGroup(l, 'North America');
  v['gini.na.avg'] = fx(na.avg); v['gini.na.n'] = int(na.n);
  const last = l[l.length - 1];
  v['gini.low.name'] = esc(last.group); v['gini.low.avg'] = fx(last.avg); v['gini.low.n'] = int(last.n);
  v['gini.topyears'] = int(g.topRegionYears); v['gini.years'] = int(g.totalYears);
  check(g.topRegion.startsWith('Latin America'), 'the headline names Latin America & the Caribbean as the top region');
  check(g.topRegionYears === g.totalYears, 'the headline says the top region led in every year');
  check(l[1].group === 'Sub-Saharan Africa', 'the text names Sub-Saharan Africa as second');
  check(na.n < 5, 'the text flags North America as a very small sample');
}

// 7. Women in parliament
{
  const w = f.women_parliament_trend;
  v['wom.y0'] = w.first.year; v['wom.y1'] = w.last.year;
  v['wom.first'] = fx(w.first.avg); v['wom.last'] = fx(w.last.avg); v['wom.change'] = fx(w.change);
  v['wom.steps'] = int(w.steps);
  v['wom.same.n'] = int(w.sameCountries.countries);
  v['wom.same.first'] = fx(w.sameCountries.first); v['wom.same.last'] = fx(w.sameCountries.last);
  check(w.upYears === w.steps, 'the text says the average rose in every year');
  check(w.last.avg / w.first.avg > 1.7 && w.last.avg / w.first.avg < 2.05, '"nearly doubled"');
}

// 8. Regulation vs pollution
{
  const g = f.regulation_vs_pollution;
  v['reg.n'] = int(g.n); v['reg.r'] = signed(g.r); v['reg.nc'] = int(g.n_countries); v['reg.rc'] = signed(g.r_country);
  check(g.r < -0.2 && g.r_country < -0.2 && g.r > -0.5 && g.r_country > -0.5, '"moderate" negative relationship');
}

// 9. Composite
{
  const c = f.esg_composite;
  v['esg.n'] = int(c.n_countries); v['esg.excluded'] = int(c.n_excluded);
  v['esg.min'] = int(c.min_indicators); v['esg.total'] = int(c.total_indicators);
  v['esg.top5'] = list(c.top10.slice(0, 5).map(x => esc(shortName(x.country))));
  v['esg.bottom5'] = list(c.bottom10.slice(0, 5).map(x => esc(shortName(x.country))));
  const t = c.top10[0];
  v['esg.top1.name'] = esc(shortName(t.country)); v['esg.top1.env'] = fx(t.Environmental); v['esg.top1.gov'] = fx(t.Governance);
  const spread = c.top10[0].overall - c.top10[4].overall;
  v['esg.top5.spread'] = fx(spread);
  check(c.top10.every(x => x.Governance > x.Environmental), 'the text says governance outscores environment among the top countries');
}

// --- fill the template -------------------------------------------------------
const used = new Set();
const html = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => {
  if (!(key in v)) throw new Error(`Template token {{${key}}} has no value in scripts/build_report.js`);
  used.add(key);
  return v[key];
});

const banner = '<!-- GENERATED FILE: edit index.template.html and run `node scripts/build_report.js`. -->\n';
fs.writeFileSync(path.join(root, 'index.html'), html.replace('<!doctype html>', '<!doctype html>\n' + banner));

const unused = Object.keys(v).filter(k => !used.has(k));
console.log(`Wrote index.html (${used.size} tokens filled).`);
if (unused.length) console.log('Unused values (safe to remove):', unused.join(', '));
