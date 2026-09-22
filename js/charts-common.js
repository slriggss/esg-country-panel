// Shared Chart.js defaults so every chart on the site looks like one system.
(function () {
  const style = getComputedStyle(document.documentElement);
  const v = (name) => style.getPropertyValue(name).trim();

  window.ESG_COLORS = {
    series: [1,2,3,4,5,6,7,8].map(n => v(`--series-${n}`)),
    text: v('--text-primary'),
    textSecondary: v('--text-secondary'),
    muted: v('--text-muted'),
    grid: v('--gridline'),
    baseline: v('--baseline'),
    surface: v('--surface-1'),
    accent: v('--accent'),
    sequential: [v('--seq-100'), v('--seq-250'), v('--seq-400'), v('--seq-500'), v('--seq-650')],
  };

  if (window.Chart) {
    Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = window.ESG_COLORS.textSecondary;
    Chart.defaults.borderColor = window.ESG_COLORS.grid;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.boxHeight = 8;
    Chart.defaults.plugins.tooltip.backgroundColor = window.ESG_COLORS.surface;
    Chart.defaults.plugins.tooltip.titleColor = window.ESG_COLORS.text;
    Chart.defaults.plugins.tooltip.bodyColor = window.ESG_COLORS.textSecondary;
    Chart.defaults.plugins.tooltip.borderColor = window.ESG_COLORS.grid;
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.displayColors = true;
    Chart.defaults.plugins.tooltip.boxPadding = 4;
  }

  window.baseGrid = {
    color: window.ESG_COLORS.grid,
    drawTicks: false,
  };
})();
