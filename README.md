# ESG Country Panel

A two-page site built around a 2002&ndash;2023 country-level panel of World Bank
Environmental, Social, and Governance (ESG) indicators &mdash; 217 countries,
24 indicators, 95,355 rows. Built for the FDA II Data Website Project.

**Live site:** https://slriggss.github.io/esg-country-panel/
**Repository:** https://github.com/slriggss/esg-country-panel

## Files

| File | What it does |
|---|---|
| `index.html` | The report page. Title, byline, headline numbers, 9 findings (each with a chart, including a percentile-based ESG composite score and country ranking), and a closing methodology section. Loads `data/findings.json` and renders charts with Chart.js. |
| `dashboard.html` | The interactive dashboard. Loads `data/esg_panel.csv` directly in the browser (via PapaParse) and lets the reader filter by indicator, year range, region, income group, and country; switch the measure (average/median/total/count) and the breakdown variable (region/income group/none); and see five charts (trend, group comparison, distribution, high/low ranking, and a world map), four summary numbers, and a data table all recompute live. Also supports shareable filtered links (state syncs to the URL), CSV export of the filtered rows, and PNG export of any chart. |
| `css/style.css` | Shared styles for both pages &mdash; one navigation bar, one type system, one color palette (light and dark mode, plus a manual toggle). |
| `js/charts-common.js` | Shared Chart.js defaults (colors, fonts, tooltip style, the sequential color ramp used by the map) so every chart on the site looks like one system. |
| `js/theme.js` | The light/dark theme toggle button, shared by both pages. |
| `js/report.js` | Builds the 9 report-page charts from `data/findings.json`. |
| `js/dashboard.js` | All dashboard interactivity: filtering, URL state sync, the measure/breakdown switches, the five charts (including the choropleth map), CSV/PNG export, the summary tiles, and the table. |
| `data/esg_panel.csv` | The data set itself. One row = one country, in one year, for one indicator. Columns: `country, iso3, region, income_group, year, pillar, indicator_code, indicator_name, value, pct_change_yoy, percentile_rank`. |
| `data/findings.json` | Precomputed numbers behind every report-page finding (trends, group averages, correlations, the ESG composite ranking), generated from `data/esg_panel.csv` so every number in the report is reproducible from the source data. |
| `data/world-countries-50m.json` | World country boundaries (TopoJSON, via the `world-atlas` package) used by the dashboard's map chart. |
| `data/iso3_numeric.json` | Maps each country's World Bank ISO3 code to the numeric country code the map's TopoJSON uses, so the panel data can be joined to the map. |
| `scripts/fetch_data.js` | Pulls the raw panel from the World Bank API (source: ESG Data + Worldwide Governance Indicators) and writes `data/esg_panel.csv`. Run with `node scripts/fetch_data.js`. |
| `scripts/analyze.js` | Reads `data/esg_panel.csv` and computes every number used in the report, including the ESG composite score, writing `data/findings.json`. Run with `node scripts/analyze.js`. |
| `FDA Data Website Project.pdf` | The assignment instructions. |
| `submission.txt` | Name, student ID, repository URL, and live site URL, as required for turn-in. |

## Where the data came from

Both data files are pulled from the [World Bank API](https://api.worldbank.org/),
combining two World Bank sources:

- **Environment, Social and Governance (ESG) Data** (source 75) &mdash; the World
  Bank's own purpose-built ESG indicator collection.
- **Worldwide Governance Indicators** (source 3) &mdash; the six WGI governance
  estimates (control of corruption, government effectiveness, rule of law,
  regulatory quality, voice and accountability, political stability).

24 indicators were selected across the three pillars (9 environmental, 8 social,
7 governance) for 217 countries (World Bank member/reporting economies, excluding
regional aggregates like "World" or "Euro area") from 2002 to 2023. Rows with no
reported value are dropped entirely rather than filled in. See the "About this
data set" section on the report page for the full explanation, including why two
charts exclude 2022&ndash;2023 (thin reporting coverage in those years).

To regenerate the data from scratch:

```
node scripts/fetch_data.js   # pulls from the World Bank API, writes data/esg_panel.csv
node scripts/analyze.js      # computes report numbers, writes data/findings.json
```

## Running locally

This is a static site with no build step. Any local HTTP server works, e.g.:

```
npx serve .
```

(Opening `index.html` directly with `file://` will not work for the dashboard,
since browsers block `fetch` of local files under that protocol.)
