// Comfort only. The page reads the same without it.
// Marks the step on screen in the run list, and puts the jump button away while the run list itself is in view.
// A file of its own, not a script in the page: sigouin.net's security policy runs only scripts served as files.
(() => {
  if (!('IntersectionObserver' in window)) return;
  const jump = document.querySelector('.to-run');
  new IntersectionObserver(([run]) => { jump.hidden = run.isIntersecting; }).observe(document.getElementById('run'));
  const rows = new Map([...document.querySelectorAll('.run a')].map((row) => [row.hash.slice(1), row]));
  const seen = new Set();
  const steps = new IntersectionObserver((changes) => {
    for (const change of changes) seen[change.isIntersecting ? 'add' : 'delete'](change.target.id);
    const first = [...rows.keys()].find((id) => seen.has(id));
    for (const [id, row] of rows) id === first ? row.setAttribute('aria-current', 'step') : row.removeAttribute('aria-current');
  }, { rootMargin: '-20% 0px -55% 0px' });
  document.querySelectorAll('.step').forEach((step) => steps.observe(step));
})();
