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
    Chart.defaults.font.family = v('--font-chart');
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

// ---------------------------------------------------------------------------
// Hover focus: hovering a line, bar, point, or legend item fades everything
// else so the hovered series stands out. Colors are restored on mouse-out.
// ---------------------------------------------------------------------------
(function () {
  if (!window.Chart) return;
  const DIM = 0.2;
  const PROPS = ['backgroundColor', 'borderColor', 'pointBackgroundColor'];

  function withAlpha(c, a) {
    if (typeof c !== 'string') return c;
    let m = c.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      const base = m[2] ? parseInt(m[2], 16) / 255 : 1;
      return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${(base * a).toFixed(3)})`;
    }
    m = c.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(',').map(s => s.trim());
      const base = p[3] != null ? parseFloat(p[3]) : 1;
      return `rgba(${p[0]},${p[1]},${p[2]},${(base * a).toFixed(3)})`;
    }
    return c;
  }
  const dimAll = (v) => Array.isArray(v) ? v.map(c => withAlpha(c, DIM)) : withAlpha(v, DIM);

  function focusable(chart) {
    const type = chart.config.type;
    if (type === 'choropleth') return false;
    if (chart.data.datasets.length > 1) return true;
    return type === 'bar' || type === 'scatter';
  }

  function setFocus(chart, focus) {
    const prev = chart.$focus || null;
    if ((!prev && !focus) || (prev && focus && prev.d === focus.d && prev.i === focus.i)) return;
    chart.$focus = focus;
    const multi = chart.data.datasets.length > 1;
    chart.data.datasets.forEach((ds, d) => {
      if (!ds.$base) {
        ds.$base = {};
        PROPS.forEach(p => { if (p in ds) ds.$base[p] = ds[p]; });
      }
      Object.keys(ds.$base).forEach(p => {
        const base = ds.$base[p];
        if (!focus) { ds[p] = base; return; }
        if (multi) { ds[p] = d === focus.d ? base : dimAll(base); return; }
        ds[p] = ds.data.map((_, i) => {
          const c = Array.isArray(base) ? base[i] : base;
          return i === focus.i ? c : withAlpha(c, DIM);
        });
      });
      if (!focus) delete ds.$base;
    });
    chart.update('none');
  }

  Chart.register({
    id: 'esgFocus',
    afterEvent(chart, args) {
      if (!focusable(chart) || chart.$legendFocus) return;
      const e = args.event;
      if (e.type === 'mouseout' || (e.type === 'mousemove' && !args.inChartArea)) { setFocus(chart, null); return; }
      if (e.type !== 'mousemove') return;
      const multiLine = chart.data.datasets.length > 1 && chart.config.type === 'line';
      const els = chart.getElementsAtEventForMode(e, 'nearest', { intersect: !multiLine }, false);
      setFocus(chart, els.length ? { d: els[0].datasetIndex, i: els[0].index } : null);
    },
  });

  // Exposed so page elements (e.g. the text under a chart) can drive the
  // same highlight: ESG_FOCUS(chart, { d: datasetIndex, i: index }) or null.
  window.ESG_FOCUS = setFocus;

  const legend = Chart.defaults.plugins.legend;
  legend.onHover = function (e, item, lg) {
    const chart = lg.chart;
    if (e.native && e.native.target) e.native.target.style.cursor = 'pointer';
    if (chart.data.datasets.length < 2) return;
    chart.$legendFocus = true;
    setFocus(chart, { d: item.datasetIndex, i: -1 });
  };
  legend.onLeave = function (e, item, lg) {
    const chart = lg.chart;
    if (e.native && e.native.target) e.native.target.style.cursor = '';
    chart.$legendFocus = false;
    setFocus(chart, null);
  };
})();

// ---------------------------------------------------------------------------
// Annotations: small, data-driven labels drawn on top of a chart. Every value
// shown comes from the chart's own data or from findings.json -- nothing is
// typed in by hand. Configure per chart via options.plugins.esgAnnotate:
//   baseline:    { value, label }          dashed reference line (line charts)
//   endpoints:   { suffix, decimals }      label first + last point (line)
//   endLabels:   { suffix, decimals }      name + value at each line's end
//   valueLabels: { suffix, decimals }      value at the end of each bar
//   note:        'text'                    small callout in a plot corner
//   notePos:     'tl' | 'tr' | 'bl' | 'br' which corner (default 'tl')
//   fitLine:     true                      least-squares trend line (scatter)
// ---------------------------------------------------------------------------
(function () {
  if (!window.Chart) return;
  const C = window.ESG_COLORS;
  const FONT = getComputedStyle(document.documentElement).getPropertyValue('--font-chart').trim();
  const fmt = (v, o) => (o.prefix || '') + Number(v).toFixed(o.decimals == null ? 1 : o.decimals) + (o.suffix || '');
  const lastIndex = (data) => { for (let i = data.length - 1; i >= 0; i--) if (data[i] != null) return i; return -1; };
  const firstIndex = (data) => data.findIndex(v => v != null);
  const colorOf = (ds, i) => {
    const c = ds.borderColor || ds.backgroundColor;
    return Array.isArray(c) ? c[i] : c;
  };

  function label(ctx, text, x, y, opts) {
    ctx.save();
    ctx.font = `${opts.weight || 500} ${opts.size || 11}px ${FONT}`;
    ctx.fillStyle = opts.color || C.textSecondary;
    ctx.textAlign = opts.align || 'left';
    ctx.textBaseline = 'middle';
    if (opts.halo) {
      ctx.lineWidth = 3; ctx.strokeStyle = C.surface; ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
    }
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function dashedLine(ctx, x0, y0, x1, y1) {
    ctx.save();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = C.muted; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  }

  // Chart intros (esgIntro, below) can hold annotations back while the data
  // draws in: chart.$intro.annot is 0..1 (or one value per dataset), and
  // chart.$intro.fit is how far the scatter trend line has drawn across.
  const introAlpha = (chart, d) => {
    const a = chart.$intro ? chart.$intro.annot : 1;
    return Array.isArray(a) ? (a[d] == null ? 1 : a[d]) : (a == null ? 1 : a);
  };

  Chart.register({
    id: 'esgAnnotate',
    afterDatasetsDraw(chart, args, o) {
      const { ctx, chartArea: area, scales } = chart;
      if (!o || !area) return;
      const meta0 = chart.getDatasetMeta(0);
      const ds0 = chart.data.datasets[0];
      ctx.save();
      ctx.globalAlpha = introAlpha(chart, 0);

      if (o.baseline && scales.y) {
        const y = scales.y.getPixelForValue(o.baseline.value);
        dashedLine(ctx, area.left, y, area.right, y);
        label(ctx, o.baseline.label, area.right - 4, y - 9, { align: 'right', color: C.muted, halo: true });
      }

      if (o.endpoints && ds0) {
        [[firstIndex(ds0.data), 'left'], [lastIndex(ds0.data), 'right']].forEach(([i, align]) => {
          const pt = meta0.data[i];
          if (!pt) return;
          ctx.save();
          ctx.fillStyle = colorOf(ds0, i); ctx.strokeStyle = C.surface; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.restore();
          // Put the label on the side the line is not heading toward.
          const nb = ds0.data[align === 'left' ? i + 1 : i - 1];
          const above = nb == null || nb <= ds0.data[i];
          const text = `${fmt(ds0.data[i], o.endpoints)} (${chart.data.labels[i]})`;
          label(ctx, text, pt.x, pt.y + (above ? -15 : 16), { align, weight: 600, size: 12, color: C.text, halo: true });
        });
      }

      if (o.endLabels) {
        const items = chart.data.datasets.map((ds, d) => {
          const meta = chart.getDatasetMeta(d);
          const i = lastIndex(ds.data);
          if (meta.hidden || i < 0 || !meta.data[i]) return null;
          return { d, x: meta.data[i].x, y: meta.data[i].y, text: `${ds.label} ${fmt(ds.data[i], o.endLabels)}`, color: colorOf(ds, i) };
        }).filter(Boolean).sort((a, b) => a.y - b.y);
        for (let k = 1; k < items.length; k++) {
          if (items[k].y - items[k - 1].y < 15) items[k].y = items[k - 1].y + 15;
        }
        items.forEach(it => {
          ctx.save();
          ctx.globalAlpha = introAlpha(chart, it.d);
          label(ctx, it.text, it.x + 8, it.y, { color: it.color, weight: 600 });
          ctx.restore();
        });
      }

      if (o.valueLabels && ds0) {
        const horizontal = chart.options.indexAxis === 'y';
        meta0.data.forEach((bar, i) => {
          const v = ds0.data[i];
          if (v == null) return;
          const text = fmt(v, o.valueLabels);
          // Negative bars run left from zero, so label them just right of the zero line.
          if (horizontal) label(ctx, text, (v < 0 ? bar.base : bar.x) + 5, bar.y, { size: 11.5 });
          else label(ctx, text, bar.x, bar.y - 9, { align: 'center', weight: 600, color: C.text });
        });
      }

      if (o.fitLine && ds0 && scales.x && scales.y) {
        const pts = ds0.data.filter(p => p && p.x != null && p.y != null);
        const n = pts.length;
        const progress = chart.$intro && chart.$intro.fit != null ? chart.$intro.fit : 1;
        if (n > 2 && progress > 0) {
          const mx = pts.reduce((s, p) => s + p.x, 0) / n;
          const my = pts.reduce((s, p) => s + p.y, 0) / n;
          let sxy = 0, sxx = 0;
          pts.forEach(p => { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; });
          const slope = sxy / sxx, icpt = my - slope * mx;
          const x0 = Math.min(...pts.map(p => p.x));
          const x1 = x0 + (Math.max(...pts.map(p => p.x)) - x0) * progress;
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.rect(area.left, area.top, area.width, area.height); ctx.clip();
          ctx.setLineDash([6, 5]); ctx.strokeStyle = C.text; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(scales.x.getPixelForValue(x0), scales.y.getPixelForValue(slope * x0 + icpt));
          ctx.lineTo(scales.x.getPixelForValue(x1), scales.y.getPixelForValue(slope * x1 + icpt));
          ctx.stroke();
          ctx.restore();
        }
      }

      if (o.note) {
        ctx.save();
        ctx.font = `600 13px ${FONT}`;
        const w = ctx.measureText(o.note).width + 16;
        const pos = o.notePos || 'tl';
        const x = pos[1] === 'r' ? area.right - w - 8 : area.left + 8;
        const y = pos[0] === 'b' ? area.bottom - 30 : area.top + 6;
        ctx.fillStyle = C.surface; ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(x, y, w, 24, 6); ctx.fill(); ctx.stroke();
        ctx.restore();
        label(ctx, o.note, x + 8, y + 12, { weight: 600, size: 13, color: C.text });
      }
      ctx.restore();
    },
  });
})();

// Canvas text can't use a web font until it has loaded, and the browser only
// downloads a font once something asks for it -- the chart font is used only
// on canvas, so request it up front. Charts drawn before it arrives measured
// their labels with the fallback font, so clear those cached widths and
// redraw once it's in.
if (window.Chart && document.fonts && document.fonts.load) {
  const chartFont = getComputedStyle(document.documentElement).getPropertyValue('--font-chart').trim();
  Promise.all(['400', '500', '600'].map(w => document.fonts.load(`${w} 12px ${chartFont}`)))
    .catch(() => {})
    .then(() => document.fonts.ready)
    .then(() => Object.values(Chart.instances).forEach(ch => {
      Object.values(ch.scales).forEach(s => { s._longestTextCache = {}; });
      ch.update('none');
    }));
}

// ===========================================================================
// Shared by the report and dashboard: chart intros and card opening.
// ===========================================================================
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// Chart intros. Each chart can declare options.plugins.esgIntro to control
// how its data first appears:
//   { mode: 'sweep' }                 line(s) draw left to right together
//   { mode: 'sequence', gap }         one line at a time, in dataset order
//   { mode: 'fade', after }           native animation, then annotations fade in
//   { mode: 'scatter', after }        points fall in, then trend line draws across
// Annotations (labels, callouts) are held back until the data has landed.
// Hover highlighting is untouched: this only affects the first draw.
// ---------------------------------------------------------------------------
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function tween(chart, duration, delay, step) {
  return new Promise(resolve => {
    setTimeout(() => {
      const start = performance.now();
      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        step(ease(t));
        if (chart.ctx) chart.draw();
        if (t < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    }, delay);
  });
}

if (window.Chart) Chart.register({
  id: 'esgIntro',
  beforeInit(chart, args, o) {
    if (!o || !o.mode) return;
    const n = chart.data.datasets.length;
    const clipped = o.mode === 'sweep' || o.mode === 'sequence';
    chart.$intro = {
      clip: clipped ? Array(n).fill(0) : null,
      annot: o.mode === 'sequence' ? Array(n).fill(0) : 0,
      fill: o.mode === 'sweep' ? 0 : null, // area fill (drawn outside the clip) fades in after
      fit: o.mode === 'scatter' ? 0 : null,
    };
    // Start once the first frame exists.
    setTimeout(() => runIntro(chart, o), 0);
  },
  beforeDatasetDraw(chart, args) {
    const s = chart.$intro;
    if (!s || !s.clip) return;
    const p = s.clip[args.index];
    const a = chart.chartArea;
    chart.ctx.save();
    chart.ctx.beginPath();
    chart.ctx.rect(a.left - 8, a.top - 30, (a.width + 16) * p, a.height + 60);
    chart.ctx.clip();
  },
  afterDatasetDraw(chart) {
    if (chart.$intro && chart.$intro.clip) chart.ctx.restore();
  },
});

async function runIntro(chart, o) {
  const s = chart.$intro;
  if (o.mode === 'sweep') {
    await tween(chart, 1500, 0, p => s.clip.fill(p));
    await tween(chart, 450, 0, p => { s.annot = p; s.fill = p; chart.update('none'); });
  } else if (o.mode === 'sequence') {
    const gap = o.gap || 750;
    await Promise.all(s.clip.map((_, d) =>
      tween(chart, 1000, d * gap, p => { s.clip[d] = p; })
        .then(() => tween(chart, 350, 0, p => { s.annot[d] = p; }))));
  } else if (o.mode === 'fade') {
    await tween(chart, 450, o.after || 0, p => { s.annot = p; });
  } else if (o.mode === 'scatter') {
    await tween(chart, 900, o.after || 0, p => { s.fit = p; });
    await tween(chart, 400, 0, p => { s.annot = p; });
  }
  chart.$intro = null; // done: behave exactly like a normal chart from here on
  chart.draw();
}

// Staggered first-draw animation for bars. Only the initial ('default') draw
// is delayed, so hover transitions stay instant.
const staggered = (step, duration = 800) => ({
  duration,
  easing: 'easeOutQuart',
  delay: (ctx) => (ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * step : 0),
});

// Card opening: the card lifts in with a brief glow in its --pillar color the
// first time it scrolls into view, then onOpen runs (typically: build the
// chart so its intro plays where the reader can see it). Returns a function
// reporting whether the card has opened yet.
function whenCardOpens(card, onOpen) {
  let opened = false;
  if (REDUCED_MOTION || !('IntersectionObserver' in window) || !card) {
    opened = true;
    onOpen();
    return () => opened;
  }
  card.classList.add('card-closed');
  const io = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    io.disconnect();
    card.classList.remove('card-closed');
    card.classList.add('card-open');
    setTimeout(() => { opened = true; onOpen(); }, 380);
  }, { threshold: 0.3 });
  io.observe(card);
  return () => opened;
}
