// Pulls a country-year-indicator ESG panel from the World Bank API,
// reshapes it to long format, and writes data/esg_panel.csv.
//
// Source: World Bank "Environment, Social and Governance (ESG) Data" (source 75)
// plus the Worldwide Governance Indicators (source 3).
// Run with: node scripts/fetch_data.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const YEAR_START = 2002;
const YEAR_END = 2023;

const INDICATORS = [
  // Environmental
  { code: 'EG.ELC.ACCS.ZS', name: 'Access to electricity (% of population)', pillar: 'Environmental' },
  { code: 'EG.FEC.RNEW.ZS', name: 'Renewable energy consumption (% of final energy)', pillar: 'Environmental' },
  { code: 'EG.ELC.RNEW.ZS', name: 'Renewable electricity output (% of total electricity)', pillar: 'Environmental' },
  { code: 'EG.ELC.COAL.ZS', name: 'Electricity from coal (% of total)', pillar: 'Environmental' },
  { code: 'EG.USE.COMM.FO.ZS', name: 'Fossil fuel energy consumption (% of total)', pillar: 'Environmental' },
  { code: 'AG.LND.FRST.ZS', name: 'Forest area (% of land area)', pillar: 'Environmental' },
  { code: 'EN.GHG.ALL.PC.CE.AR5', name: 'Greenhouse gas emissions per capita (t CO2e)', pillar: 'Environmental' },
  { code: 'EN.ATM.PM25.MC.M3', name: 'PM2.5 air pollution (micrograms per m3)', pillar: 'Environmental' },
  { code: 'ER.PTD.TOTL.ZS', name: 'Protected land and marine areas (% of territory)', pillar: 'Environmental' },
  // Social
  { code: 'SL.UEM.TOTL.ZS', name: 'Unemployment rate (% of labor force)', pillar: 'Social' },
  { code: 'SP.DYN.LE00.IN', name: 'Life expectancy at birth (years)', pillar: 'Social' },
  { code: 'SI.POV.GINI', name: 'Gini index (income inequality)', pillar: 'Social' },
  { code: 'SH.H2O.SMDW.ZS', name: 'Safely managed drinking water (% of population)', pillar: 'Social' },
  { code: 'SE.PRM.CMPT.ZS', name: 'Primary school completion rate (%)', pillar: 'Social' },
  { code: 'SH.DYN.MORT', name: 'Under-5 mortality rate (per 1,000 live births)', pillar: 'Social' },
  { code: 'SL.TLF.ACTI.ZS', name: 'Labor force participation rate (%)', pillar: 'Social' },
  { code: 'SH.MED.BEDS.ZS', name: 'Hospital beds (per 1,000 people)', pillar: 'Social' },
  // Governance
  { code: 'GOV_WGI_CC.EST', name: 'Control of corruption (estimate, -2.5 to 2.5)', pillar: 'Governance' },
  { code: 'GOV_WGI_GE.EST', name: 'Government effectiveness (estimate, -2.5 to 2.5)', pillar: 'Governance' },
  { code: 'GOV_WGI_RL.EST', name: 'Rule of law (estimate, -2.5 to 2.5)', pillar: 'Governance' },
  { code: 'GOV_WGI_RQ.EST', name: 'Regulatory quality (estimate, -2.5 to 2.5)', pillar: 'Governance' },
  { code: 'GOV_WGI_VA.EST', name: 'Voice and accountability (estimate, -2.5 to 2.5)', pillar: 'Governance' },
  { code: 'GOV_WGI_PV.EST', name: 'Political stability (estimate, -2.5 to 2.5)', pillar: 'Governance' },
  { code: 'SG.GEN.PARL.ZS', name: 'Seats held by women in parliament (%)', pillar: 'Governance' },
];

function getJSON(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      https.get(url, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { if (n > 0) setTimeout(() => attempt(n - 1), 500); else reject(e); }
        });
      }).on('error', e => { if (n > 0) setTimeout(() => attempt(n - 1), 500); else reject(e); });
    };
    attempt(retries);
  });
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

(async () => {
  console.log('Fetching country metadata...');
  const countryResp = await getJSON('https://api.worldbank.org/v2/country?format=json&per_page=400');
  const countries = {};
  for (const c of countryResp[1]) {
    if (c.region.value === 'Aggregates') continue;
    countries[c.id] = {
      name: c.name,
      region: c.region.value,
      incomeGroup: c.incomeLevel.value,
    };
  }
  console.log(`  ${Object.keys(countries).length} countries.`);

  // rows[indicatorCode][countryIso3][year] = value
  const raw = {};

  for (const ind of INDICATORS) {
    process.stdout.write(`Fetching ${ind.code} (${ind.name})... `);
    const url = `https://api.worldbank.org/v2/country/all/indicator/${ind.code}?format=json&date=${YEAR_START}:${YEAR_END}&per_page=20000`;
    let resp;
    try {
      resp = await getJSON(url);
    } catch (e) {
      console.log(`FAILED (${e.message}) - retrying once more`);
      resp = await getJSON(url, 5);
    }
    const rows = resp[1] || [];
    const byCountryYear = {};
    let count = 0;
    for (const r of rows) {
      if (r.value === null) continue;
      if (!countries[r.countryiso3code]) continue;
      if (!byCountryYear[r.countryiso3code]) byCountryYear[r.countryiso3code] = {};
      byCountryYear[r.countryiso3code][r.date] = r.value;
      count++;
    }
    raw[ind.code] = byCountryYear;
    console.log(`${count} values.`);
  }

  // Build long rows, then compute pct_change_yoy and rank_in_year per indicator+year.
  const longRows = [];
  for (const ind of INDICATORS) {
    const byCountryYear = raw[ind.code];
    for (const iso3 of Object.keys(byCountryYear)) {
      for (const year of Object.keys(byCountryYear[iso3])) {
        longRows.push({
          country: countries[iso3].name,
          iso3,
          region: countries[iso3].region,
          income_group: countries[iso3].incomeGroup,
          year: Number(year),
          pillar: ind.pillar,
          indicator_code: ind.code,
          indicator_name: ind.name,
          value: byCountryYear[iso3][year],
        });
      }
    }
  }

  console.log(`\nBuilt ${longRows.length} long-format rows. Computing derived numeric columns...`);

  // pct_change_yoy: change vs prior year, same country + indicator
  const byKey = {}; // `${indicator_code}|${iso3}` -> {year: value}
  for (const r of longRows) {
    const k = `${r.indicator_code}|${r.iso3}`;
    if (!byKey[k]) byKey[k] = {};
    byKey[k][r.year] = r.value;
  }
  for (const r of longRows) {
    const k = `${r.indicator_code}|${r.iso3}`;
    const prev = byKey[k][r.year - 1];
    r.pct_change_yoy = (prev !== undefined && prev !== 0) ? Number((((r.value - prev) / Math.abs(prev)) * 100).toFixed(3)) : '';
  }

  // rank_in_year: percentile rank of country's value within indicator+year (1 = lowest, 100 = highest)
  const byIndYear = {}; // `${indicator_code}|${year}` -> [values]
  for (const r of longRows) {
    const k = `${r.indicator_code}|${r.year}`;
    if (!byIndYear[k]) byIndYear[k] = [];
    byIndYear[k].push(r.value);
  }
  for (const k of Object.keys(byIndYear)) byIndYear[k].sort((a, b) => a - b);
  for (const r of longRows) {
    const k = `${r.indicator_code}|${r.year}`;
    const sorted = byIndYear[k];
    const idx = sorted.indexOf(r.value);
    r.percentile_rank = sorted.length > 1 ? Number(((idx / (sorted.length - 1)) * 100).toFixed(1)) : 100;
  }

  // Write CSV
  const cols = ['country','iso3','region','income_group','year','pillar','indicator_code','indicator_name','value','pct_change_yoy','percentile_rank'];
  const outPath = path.join(__dirname, '..', 'data', 'esg_panel.csv');
  const stream = fs.createWriteStream(outPath);
  stream.write(cols.join(',') + '\n');
  for (const r of longRows) {
    stream.write(cols.map(c => csvEscape(r[c])).join(',') + '\n');
  }
  stream.end();

  console.log(`\nWrote ${longRows.length} rows to ${outPath}`);
  console.log(`Distinct countries: ${new Set(longRows.map(r => r.iso3)).size}`);
  console.log(`Distinct years: ${new Set(longRows.map(r => r.year)).size}`);
  console.log(`Distinct indicators: ${new Set(longRows.map(r => r.indicator_code)).size}`);
})();
