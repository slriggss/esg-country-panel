// Applies the stored theme before paint (see inline <head> snippet) and wires
// up the visible toggle button. Switching themes happens in place: the CSS
// variables change immediately, the shared chart colors are re-read, and the
// page's charts are redrawn from fresh configs (each page listens for the
// 'esg-theme-change' event) -- no reload, so scroll position and open state stay put.
(function () {
  function getStored() { try { return localStorage.getItem('esg-theme'); } catch (e) { return null; } }
  function setStored(v) { try { localStorage.setItem('esg-theme', v); } catch (e) {} }

  const ICONS = {
    // Shown while in dark mode: click to go light.
    sun: '<svg class="tt-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    // Shown while in light mode: click to go dark.
    moon: '<svg class="tt-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  };

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  function paintButton(btn) {
    const dark = currentTheme() === 'dark';
    btn.innerHTML = (dark ? ICONS.sun : ICONS.moon) + ' <span class="tt-label">' + (dark ? 'Light' : 'Dark') + '</span>';
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  }

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    paintButton(btn);
    btn.addEventListener('click', function () {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      setStored(next);
      paintButton(btn);
      if (window.ESG_REFRESH_THEME) window.ESG_REFRESH_THEME();
      window.dispatchEvent(new Event('esg-theme-change'));
    });
  });
})();
