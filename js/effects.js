// Page-level motion shared by both pages: fade-up reveal on scroll, and the
// scroll-driven green/blue backdrop glow.
(function () {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasIO = 'IntersectionObserver' in window;

  // Reveal: content is visible by default; only once JS runs do we hide it
  // and fade it in as it scrolls into view.
  if (!reduced && hasIO) {
    const targets = document.querySelectorAll('section.finding, section.methodology, .stat-tile, .chart-card, .dashboard-toolbar, .table-wrap');
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    targets.forEach((el, i) => {
      // Chart cards have their own opening animation (whenCardOpens).
      if (el.matches('.chart-card')) return;
      el.classList.add('reveal');
      // Stagger tiles in a row slightly.
      if (el.classList.contains('stat-tile')) el.style.transitionDelay = `${(i % 4) * 70}ms`;
      io.observe(el);
    });
  }

  // Scroll-driven backdrop: as the reader moves down the page the green glow
  // fades and drifts down while the blue one strengthens, then they trade
  // back. Values are written to CSS variables read by style.css.
  if (reduced) return;
  const root = document.documentElement.style;
  let queued = false;
  function update() {
    queued = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    const wave = (1 + Math.cos(p * Math.PI * 2)) / 2; // 1 at top and bottom, 0 midway
    root.setProperty('--scroll', p.toFixed(4));
    root.setProperty('--glow-green', (0.35 + 0.65 * wave).toFixed(3));
    root.setProperty('--glow-blue', (0.35 + 0.65 * (1 - wave)).toFixed(3));
  }
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update);
  update();
})();
