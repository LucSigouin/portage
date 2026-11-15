// Comfort only. The page reads the same without it: every note shows, and the filter row stays put away.
// Shows the filter row and wires its three buttons, and puts the jump to the top away while the top is in view.
// The filter puts notes away, never the plan: a job card is not a note.
// A file of its own, not a script in the page: sigouin.net's security policy runs only scripts served as files.
// No storage, no network.
(() => {
  const filter = document.getElementById('filter');
  const buttons = [...filter.querySelectorAll('button[data-show]')];
  const notes = [...document.querySelectorAll('.note')];
  const show = (which) => {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.show === which));
    for (const note of notes) note.hidden = which !== 'all' && note.dataset.state !== which;
  };
  for (const button of buttons) button.addEventListener('click', () => show(button.dataset.show));
  show('all');
  filter.hidden = false;

  // A link to a note that the filter has put away shows every note again, so the link lands.
  window.addEventListener('hashchange', () => {
    const target = document.getElementById(location.hash.slice(1));
    if (target && target.hidden) { show('all'); target.scrollIntoView(); }
  });
  // The same link pressed a second time changes no hash. So a press on a link to a note put away brings the notes back first.
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
    const target = link && document.getElementById(link.getAttribute('href').slice(1));
    if (target && target.hidden) show('all');
  });

  if (!('IntersectionObserver' in window)) return;
  const jump = document.querySelector('.to-run');
  new IntersectionObserver(([top]) => { jump.hidden = top.isIntersecting; }).observe(document.getElementById('top'));
})();
