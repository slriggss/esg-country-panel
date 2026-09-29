// Splits data/esg_panel.csv into one small file per indicator so the dashboard
// only downloads the indicator being viewed (about 0.5 MB) instead of the whole
// 14 MB panel. Also writes data/manifest.json: the indicator list and the
// filter options (years, regions, income groups, countries) the dashboard needs
// before any indicator file has loaded.
// Run with: node scripts/split_data.js  (after scripts/fetch_data.js)

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const outDir = path.join(dataDir, 'indicators');
const lines = fs.readFileSync(path.join(dataDir, 'esg_panel.csv'), 'utf8').split('\n').filter(l => l.length > 0);

function parseLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const esc = (v) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);

const header = parseLine(lines[0].replace(/\r$/, ''));
const idx = {};
header.forEach((h, i) => { idx[h] = i; });

// Columns kept in each indicator file. The indicator's own code, name, and
// pillar are the same on every row, so they live in the manifest instead.
const KEEP = ['country', 'iso3', 'region', 'income_group', 'year', 'value', 'pct_change_yoy', 'percentile_rank'];

const byIndicator = new Map();
const years = new Set(), regions = new Set(), incomes = new Set(), countries = new Map();
for (let i = 1; i < lines.length; i++) {
  const f = parseLine(lines[i].replace(/\r$/, ''));
  f[idx.region] = f[idx.region].trim();
  const code = f[idx.indicator_code];
  if (!byIndicator.has(code)) {
    byIndicator.set(code, { code, name: f[idx.indicator_name], pillar: f[idx.pillar], rows: [] });
  }
  byIndicator.get(code).rows.push(KEEP.map(c => esc(f[idx[c]])).join(','));
  years.add(Number(f[idx.year]));
  regions.add(f[idx.region]);
  incomes.add(f[idx.income_group]);
  countries.set(f[idx.iso3], f[idx.country]);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const indicators = [];
for (const ind of byIndicator.values()) {
  const file = `indicators/${ind.code}.csv`;
  fs.writeFileSync(path.join(dataDir, file), [KEEP.join(',')].concat(ind.rows).join('\n') + '\n');
  indicators.push({ code: ind.code, name: ind.name, pillar: ind.pillar, file, rows: ind.rows.length });
}
indicators.sort((a, b) => a.name.localeCompare(b.name));

const manifest = {
  years: [...years].sort((a, b) => a - b),
  regions: [...regions].sort(),
  incomes: [...incomes],
  countries: [...countries.entries()].sort((a, b) => a[1].localeCompare(b[1])),
  indicators,
};
fs.writeFileSync(path.join(dataDir, 'manifest.json'), JSON.stringify(manifest));

console.log(`Wrote ${indicators.length} indicator files to data/indicators/ and data/manifest.json`);
