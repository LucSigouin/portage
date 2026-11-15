// Comfort only. The page reads the same without it: every note shows, and the filter row stays put away.
// Shows the filter row and wires its three buttons, and puts the jump to the top away while the top is in view.
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

  if (!('IntersectionObserver' in window)) return;
  const jump = document.querySelector('.to-run');
  new IntersectionObserver(([top]) => { jump.hidden = top.isIntersecting; }).observe(document.getElementById('top'));
})();
