// Applies the stored/OS theme before paint (see inline <head> snippet) and
// wires up the visible toggle button. A full reload on toggle is deliberate:
// Chart.js reads colors once at chart-creation time, so the simplest correct
// way to re-theme already-rendered charts is to redraw the page from scratch.
(function () {
  function getStored() { try { return localStorage.getItem('esg-theme'); } catch (e) { return null; } }
  function setStored(v) { try { localStorage.setItem('esg-theme', v); } catch (e) {} }

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const current = document.documentElement.getAttribute('data-theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    btn.textContent = current === 'dark' ? '☀️ Light' : '🌙 Dark';
    btn.addEventListener('click', function () {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      setStored(next);
      location.reload();
    });
  });
})();
