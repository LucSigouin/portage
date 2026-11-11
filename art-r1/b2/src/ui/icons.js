// Ink & Wash — icons. Drawn as loose pen strokes with a watercolour dab behind them.
// Every icon is inline SVG on a 24-unit grid; `wash` is the dab colour.
const svg = (body, wash, vb = '0 0 24 24') =>
  `<svg class="ico" viewBox="${vb}" aria-hidden="true">${wash ? `<g class="wash" fill="${wash}">${body.wash || ''}</g>` : ''}<g class="pen">${body.pen}</g></svg>`;

const RUST = 'var(--rust)';
const SLATE = 'var(--water)';
const OCHRE = 'var(--ochre)';
const SAGE = 'var(--sage)';

export const ICON = {
  hunger: () =>
    svg(
      {
        wash: '<path d="M3 12.2C6 7 13 7 17 12c-4 5.2-11 5-14 .2Z"/>',
        pen: '<path d="M2.6 12C5.8 7.2 12.8 6.8 17.2 12 12.9 17 5.9 17 2.6 12Z"/><path d="M17 12l4.2-3.7c-.6 2.5-.5 5 .1 7.3Z"/><path d="M8.6 9.4c.9 1.6.9 3.4 0 5"/><circle cx="6" cy="11.3" r=".55" class="dot"/>',
      },
      RUST
    ),
  thirst: () =>
    svg(
      {
        wash: '<path d="M12 3.4C9.4 8 6.8 11 6.8 14.4a5.2 5.2 0 0 0 10.4 0c0-3.4-2.6-6.4-5.2-11Z"/>',
        pen: '<path d="M12 2.8C9.2 7.8 6.3 10.8 6.3 14.5a5.7 5.7 0 0 0 11.4 0c0-3.7-2.9-6.7-5.7-11.7Z"/><path d="M9.2 14.6c.1 1.5 1 2.6 2.3 3"/>',
      },
      SLATE
    ),
  energy: () =>
    svg(
      {
        wash: '<path d="M12 3.6c1 3.6 4.6 5.6 4.6 10a4.6 4.6 0 0 1-9.2 0c0-2.6 1.8-3.6 2.3-6 .9.7 1.9-1.4 2.300-4Z"/>',
        pen: '<path d="M12 3c1 4 5.1 5.8 5.1 10.5a5.1 5.1 0 0 1-10.2 0c0-2.9 2-3.8 2.5-6.5 1 .9 2.2-1.300 2.600-4Z"/><path d="M12 12c.8 1.200 1.700 1.800 1.700 3.100a1.700 1.700 0 0 1-3.400 0c0-1 .9-1.500 1.700-3.100Z"/><path d="M4.500 20.600l15-2.300M4.500 18.200l15 2.500"/>',
      },
      OCHRE
    ),
  paddle: () =>
    svg(
      {
        wash: '<path d="M13 11c-.3-3.500 3.300-7.400 7.300-7.200.300 3.900-3.600 7.500-7.300 7.200Z"/>',
        pen: '<path d="M12.900 11.100C12.500 7.500 16.300 3.500 20.400 3.600 20.600 7.700 16.600 11.400 12.900 11.100Z"/><path d="M13.400 10.600 5 19"/><path d="M3.700 17.800l2.500 2.500"/><path d="M15.200 8.800l3-3"/>',
      },
      RUST
    ),
  hatchet: () =>
    svg(
      {
        wash: '<path d="M11.400 6.500 14.500 3.400c2.100 1.100 4.100 1.500 6.200 1.200.500 2.400.300 4.600-.600 6.700-1.900-1.200-3.700-1.600-5.800-1Z"/>',
        pen: '<path d="M11.200 6.400 14.400 3.200c2.200 1.200 4.200 1.600 6.400 1.200.600 2.600.400 5-.600 7.200-2-1.400-3.800-1.800-6-1.200Z"/><path d="M13 8.200C10.800 12 8.200 16 5.400 20.600"/><path d="M4.300 19.900l2.200 1.400"/><path d="M17.600 5.600c.400 1.400.300 2.800-.200 4.100"/>',
      },
      SLATE
    ),
  bailer: () =>
    svg(
      {
        wash: '<path d="M6.700 10 8.100 19.500h7.800L17.300 10Z"/>',
        pen: '<path d="M6.400 9.800 7.900 19.700h8.200l1.500-9.900"/><ellipse cx="12" cy="9.700" rx="5.600" ry="1.700"/><path d="M6.400 9.600C6.600 2.600 17.400 2.600 17.600 9.600"/><path d="M8.300 14.200c2.400.800 5 .800 7.400 0"/><path d="M20.300 13.500v2.200M21.600 17.800v1.400M19.400 18.600v1.200"/>',
      },
      OCHRE
    ),
  rod: () =>
    svg(
      {
        wash: '<circle cx="7.600" cy="16.800" r="2.300"/>',
        pen: '<path d="M3.500 20.500C9 15.500 15 9.500 20.200 3"/><path d="M20.200 3v9.500"/><path d="M20.200 12.500c.2 3.200-3.300 3.200-3 .6"/><circle cx="7.600" cy="16.800" r="1.900"/><path d="M5.200 18.600l-1.700-1.300"/>',
      },
      SAGE
    ),
  hammer: () =>
    svg(
      {
        wash: '<path d="M10.800 7.600 16.600 4.300 19.300 8.200 13.500 11.500Z"/>',
        pen: '<path d="M10.600 7.600 16.700 4.100 19.500 8.300 13.400 11.800Z"/><path d="M16.700 4.100c1.700-.9 3.300-.6 4 .500"/><path d="M12.500 10.200 5 20.300"/><path d="M3.800 19.500l2.300 1.600"/>',
      },
      RUST
    ),
  flag: () =>
    svg(
      {
        wash: '<path d="M7 4.500c3.500-1.500 6 1.800 10 .3v7c-4 1.500-6.500-1.800-10-.3Z"/>',
        pen: '<path d="M6.800 3v18"/><path d="M6.800 4.300c3.700-1.600 6.300 1.900 10.400.3v7.200c-4.100 1.600-6.700-1.900-10.400-.3"/>',
      },
      RUST
    ),
  check: () => '<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.500 12.800c2 1.500 3.600 3.300 4.900 5.400C12 12 15.500 7.500 20.500 3.800"/></svg>',
  spark: () => '<svg class="spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9.500V2.500M6.800 11.200 2.500 6M17.200 11.200 21.500 6"/></svg>',
  caret: () => '<svg class="caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.500 4.200 6 8.200l3.500-4"/></svg>',
};

// Canoe-in-section gauge: how much water is in the boat.
export function bilgeGauge(level) {
  const y = 19 - level * 9.5;
  return `<svg class="bilge-svg" viewBox="0 0 66 24" aria-hidden="true">
    <defs><clipPath id="hullclip"><path d="M4 9.500c1.700 5.700 6.200 9.500 12 9.500h34c5.800 0 10.300-3.800 12-9.500Z"/></clipPath></defs>
    <g clip-path="url(#hullclip)"><rect x="0" y="${y.toFixed(2)}" width="66" height="24" fill="var(--water)" opacity=".85"/>
    <path d="M0 ${y.toFixed(2)}c5-1.600 8 1.600 13 0s8-1.600 13 0 8 1.600 13 0 8-1.600 13 0 8 1.600 14 0" fill="none" stroke="var(--paper)" stroke-width="1.200"/></g>
    <g class="pen"><path d="M2.500 8.200c1.700.9 3.600 1.300 5.700 1.300h49.600c2.100 0 4-.4 5.700-1.300C61.900 14.700 57 19.200 50 19.200H16C9 19.200 4.100 14.700 2.500 8.200Z"/>
    <path d="M22 9.500v9.500M33 9.500v9.700M44 9.500v9.500" opacity=".35"/><path d="M36.500 21.200v1.600M30 21.300v1" /></g></svg>`;
}

// The seal: a red chop, as on an ink painting — a canoe under a rising sun, cut in reverse.
export function seal() {
  return `<svg class="seal-svg" viewBox="0 0 40 40" aria-hidden="true">
    <path d="M3.500 4.200c10.500-1.500 22.500-1.200 33 .2 1 10.200 1.200 21.500-.2 32.200-10.800 1.300-22.200 1.300-32.800-.3C2.300 25.800 2.200 14.500 3.500 4.200Z" fill="var(--rust)"/>
    <g fill="none" stroke="var(--paper)" stroke-width="2.100" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8.500 23.500c3.800 1.200 7.500 1.700 11.500 1.700s7.700-.5 11.500-1.700c-1.500 4.200-5.500 6.700-11.500 6.700s-10-2.500-11.500-6.700Z"/>
      <path d="M20 19.500a5 5 0 0 1 0-10 5 5 0 0 1 0 10Z" stroke-width="1.900"/>
      <path d="M26.500 10 15 30.500" stroke-width="1.700"/>
    </g></svg>`;
}

// The logotype: "Portage" in a Fell italic, roughened like ink on cold-press paper,
// underlined by a paddle laid flat, with the seal beside it.
export function logotype() {
  return `<svg class="logo-svg" viewBox="0 0 560 216" role="img" aria-label="Portage">
    <g filter="url(#inkbleed)">
      <text x="2" y="124" class="logo-word">Portage</text>
      <path class="logo-paddle" d="M6 181c-1.500-6 2-11.500 7.500-11.500 3 0 5.500 1.500 7 4 92-2.500 196-4 288-3.500 26-13 76-18.500 134-12.500 9 1 14.500 6 14.300 12-.3 6-6.300 10.500-15.300 10.800-58 2-106-4.500-133-15.800-92 .500-196 3-288 6.500-1.500 4-4.500 6.500-8 6.500-3.500 0-6-1.500-6.500-6.500Z"/>
      <path class="logo-ripple" d="M330 203c14-3 26 3 40 0s26-3 40 0M70 204c12-2.500 22 2.500 34 0s22-2.500 34 0M452 200c9-2 16 2 25 0"/>
    </g>
  </svg>`;
}

export const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <filter id="rough" x="-4%" y="-8%" width="108%" height="116%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.400" xChannelSelector="R" yChannelSelector="G"/></filter>
  <filter id="rough-s" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.800" xChannelSelector="R" yChannelSelector="G"/></filter>
  <filter id="inkbleed" x="-3%" y="-10%" width="106%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="11" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="4.200" xChannelSelector="R" yChannelSelector="G" result="d"/><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="2" result="g"/><feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.600 1.550" result="holes"/><feComposite in="d" in2="holes" operator="in"/></filter>
</defs></svg>`;
