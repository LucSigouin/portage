// The Portage logotype: hand-drawn monoline capitals standing on a waterline, with their own
// broken reflection. The O carries the lantern, the A's crossbar is a canoe.

const LETTERS = [
  'M0 110V10H30A26 26 0 0 1 30 62H0', // P
  'M192 60A50 50 0 1 1 92 60A50 50 0 1 1 192 60', // O
  'M228 110V10H258A26 26 0 0 1 258 62H228M256 62L290 110', // R
  'M324 10H390M357 10V110', // T
  'M426 110L464 10L502 110M440 80Q464 93 488 80', // A
  'M623.4 24.6A50 50 0 1 0 638 60H602', // G
  'M732 10H674V110H732M674 60H720', // E
].join('');

export function logoSvg() {
  const ripples = Array.from({ length: 9 }, (_, i) => {
    const y = 121 + i * 6.4, height = Math.max(0.9, 4.6 - i * 0.5);
    return `<rect x="-10" y="${y.toFixed(1)}" width="760" height="${height.toFixed(1)}" fill="#fff" opacity="${(0.95 - i * 0.1).toFixed(2)}"/>`;
  }).join('');
  return `
<svg viewBox="-6 2 744 180" role="img" aria-label="Portage">
  <defs>
    <mask id="pg-ripple" maskUnits="userSpaceOnUse" x="-10" y="116" width="760" height="80">${ripples}</mask>
    <radialGradient id="pg-lamp"><stop offset="0" stop-color="#ffb454" stop-opacity="0.55"/><stop offset="1" stop-color="#ffb454" stop-opacity="0"/></radialGradient>
    <g id="pg-word" fill="none" stroke-width="3.2">
      <path d="${LETTERS}"/>
    </g>
  </defs>
  <use href="#pg-word" stroke="#ece8dd"/>
  <circle cx="142" cy="60" r="30" fill="url(#pg-lamp)"/>
  <circle cx="142" cy="60" r="5.2" fill="#ffb454"/>
  <line x1="-6" y1="116" x2="738" y2="116" stroke="#ece8dd" stroke-width="1" opacity="0.4"/>
  <g mask="url(#pg-ripple)" opacity="0.42">
    <use href="#pg-word" stroke="#9aa3c2" transform="translate(0 232) scale(1 -1)"/>
    <circle cx="142" cy="172" r="5.2" fill="#ffb454"/>
    <rect x="138" y="118" width="8" height="52" fill="#ffb454" opacity="0.55"/>
  </g>
</svg>`;
}
