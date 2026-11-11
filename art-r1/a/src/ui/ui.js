// Cutbank UI: lobby, HUD, settings, pause. Plain DOM + inline SVG, themed by theme.css.
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import './theme.css';

const svg = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" fill="currentColor" aria-hidden="true">${body}</svg>`;
// Faceted icons: straight cuts only, like the world.
export const ICON = {
  hunger: svg('<path d="M2 12 8 6.5h6.5L18 9.5l4-4v13l-4-4-3.5 3H8z"/><path d="M7.4 10.2h1.8v1.8H7.4z" fill="#f6e9cb"/>'),
  thirst: svg('<path d="M12 2 18.5 12 17.5 17.5 12 22 6.5 17.5 5.500 12z"/><path d="m9 13 1 3.4 2 1.6-.6-2.4z" fill="#f6e9cb"/>'),
  energy: svg('<path d="M13.500 1.500 4.500 13.500H10.500L8.500 22.500 19.500 9.500H13z"/>'),
  paddle: svg('<g transform="rotate(38 12 12)"><path d="M10 0h4v2h-1.200v11.500l2.200 2.500v5.500L12 24l-3-2.500V16l2.200-2.500V2H10z"/></g>'),
  hatchet: svg('<path d="m4.500 21.500 2 1.500L16.500 10.500l-2-1.500z"/><path d="M11.500 7.500 15 2.500l6.500 5L19.500 13.500 15.500 12.500 13 9.500z"/>'),
  bailer: svg('<path d="M5.500 9h13L17 21.500H7z"/><path d="M6.500 9C7.500 3.500 16.500 3.500 17.500 9" fill="none" stroke="currentColor" stroke-width="1.800"/><path d="M8.500 12h7l-.4 2.500H8.900z" fill="#f6e9cb"/>'),
  rod: svg('<path d="m2.500 20.500 1.300 1.500L20.500 4.500l-.9-1z"/><path d="M19.700 4v10.500" fill="none" stroke="currentColor" stroke-width="1"/><path d="m19.700 14.500 2.300 3-2.300 3-2.300-3z"/><path d="M6.500 15.500 9.500 18.500 7.500 20.500 4.500 17.500z"/>'),
  hammer: svg('<path d="M10.500 9.500h3V23h-3z"/><path d="M5 3h12l3 3v3.500H5z"/>'),
};

const LOGO = (() => {
  const L = [
    ['M0 0H52L72 20V44L52 64H24V100H0ZM24 22H44L50 28V36L44 42H24Z', 0], // P
    ['M18 0H62L80 18V82L62 100H18L0 82V18ZM40 15 55 40V60L40 85 25 60V40Z', 81], // O: the counter is a canoe from above
    ['M0 0H52L72 20V42L58 58 76 100H50L36 64H24V100H0ZM24 22H44L50 28V36L44 42H24Z', 170], // R
    ['M0 0H72V24H48V100H24V24H0Z', 252], // T
    ['M30 0H54L84 100H59L54 80H30L25 100H0ZM42 26 49.500 58H34.500Z', 327], // A
    ['M18 0H60L78 18V30H54V26L50 22H28L24 26V74L28 78H50L54 74V64H40V44H78V82L60 100H18L0 82V18Z', 420], // G
    ['M0 0H66V22H24V39H56V59H24V78H66V100H0Z', 507], // E
  ];
  const word = L.map(([d, x]) => `<path transform="translate(${x} 0)" d="${d}"/>`).join('');
  return `<svg viewBox="-8 -4 596 168" role="img" aria-label="Portage">
    <g fill="#12332a" fill-rule="evenodd" transform="translate(6 8)">${word}<path d="M-8 114 24 130H549L581 114 566 146H7Z"/></g>
    <g fill="#f6e9cb" fill-rule="evenodd">${word}</g>
    <path d="M-8 114 24 130H549L581 114 566 146H7Z" fill="#e0392a"/>
    <path d="M24 130H549L544 137H29Z" fill="#a5261f"/>
    <path d="M50 138 58 130 66 138 58 146Z" fill="#f6b52e"/>
    <g fill="#f6e9cb"><path d="M40 156H170L166 162H44Z"/><path d="M196 156H250L247 162H199Z"/><path d="M330 156H500L496 162H334Z"/></g>
  </svg>`;
})();

const SETTINGS = {
  Audio: [
    ['slider', 'Master volume', 80, '%'], ['slider', 'Music', 55, '%'],
    ['slider', 'Ambience: water, wind, loons', 70, '%'], ['slider', 'Effects', 85, '%'],
    ['select', 'Output device', ['System default', 'Headphones', 'Speakers'], 0], ['select', 'Music in the lobby', ['Full score', 'Fiddle only', 'Off'], 0],
    ['toggle', 'Mute when window loses focus', true], ['toggle', 'Night mode (soft peaks)', false],
  ],
  Graphics: [
    ['select', 'Quality preset', ['Low', 'Medium', 'High', 'Diorama (max)'], 2], ['slider', 'Render scale', 100, '%', 50, 150],
    ['select', 'Shadows', ['Off', 'Short', 'Long and soft'], 2], ['slider', 'Draw distance', 1400, ' m', 400, 2000],
    ['select', 'Water detail', ['Flat', 'Faceted', 'Faceted + foam bands'], 2], ['select', 'Frame-rate cap', ['30', '60', '120', 'Unlimited'], 1],
    ['toggle', 'Shoreline foam', true], ['toggle', 'Wake and paddle splashes', true],
    ['toggle', 'Cloud shadows', false], ['toggle', 'V-Sync', true],
  ],
  Controls: [
    ['key', 'Paddle forward', 'W'], ['key', 'Back-paddle', 'S'],
    ['key', 'Steer left', 'A'], ['key', 'Steer right', 'D'],
    ['key', 'Interact / land', 'E'], ['key', 'Swap canoe build', 'U'],
    ['key', 'Build menu', 'B'], ['key', 'Pause', 'Esc'],
    ['slider', 'Camera sensitivity', 50, ''], ['toggle', 'Invert camera Y', false],
  ],
  Gameplay: [
    ['select', 'Survival pace', ['Gentle', 'Standard', 'Lean'], 1], ['select', 'Units', ['Metric', 'Imperial'], 0],
    ['toggle', 'Loot blazes (yellow diamonds)', true], ['toggle', 'Tutorial hints', true],
    ['toggle', 'Auto-bail when idle', false], ['toggle', 'Pause when menu is open', true],
    ['slider', 'Autosave every', 5, ' min', 1, 15], ['select', 'Language', ['English', 'Français'], 0],
  ],
  Accessibility: [
    ['slider', 'UI scale', 100, '%', 80, 140], ['slider', 'Subtitle size', 100, '%', 80, 160],
    ['select', 'Colour-blind palette', ['Off', 'Deuteranopia', 'Protanopia', 'Tritanopia'], 0], ['select', 'Screen shake', ['Off', 'Low', 'Full'], 1],
    ['toggle', 'Reduce camera bob', false], ['toggle', 'High-contrast HUD', false],
    ['toggle', 'Hold to paddle (no tapping)', true], ['toggle', 'Subtitles', true],
  ],
};

const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

function control([kind, label, a, b, c, d]) {
  const row = el(`<div class="row"><label>${label}</label></div>`);
  if (kind === 'slider') {
    const min = c ?? 0, max = d ?? 100;
    const s = el(`<div class="slider" role="slider" tabindex="0" aria-label="${label}"><div class="track"><div class="fill"></div><div class="thumb"></div></div><div class="out"></div></div>`);
    let v = a;
    const set = (nv) => { v = Math.round(Math.min(max, Math.max(min, nv))); s.style.setProperty('--v', (v - min) / (max - min)); s.querySelector('.out').textContent = v + b; s.setAttribute('aria-valuenow', v); };
    const at = (e) => { const r = s.querySelector('.track').getBoundingClientRect(); set(min + ((e.clientX - r.left) / r.width) * (max - min)); };
    s.addEventListener('pointerdown', (e) => { s.setPointerCapture(e.pointerId); s.classList.add('drag'); at(e); });
    s.addEventListener('pointermove', (e) => { if (s.classList.contains('drag')) at(e); });
    s.addEventListener('pointerup', () => s.classList.remove('drag'));
    s.addEventListener('keydown', (e) => { const step = (max - min) / 20; if (e.key === 'ArrowRight') set(v + step); if (e.key === 'ArrowLeft') set(v - step); });
    set(a);
    row.append(s);
  } else if (kind === 'toggle') {
    const t = el(`<button class="toggle" aria-pressed="${a}" aria-label="${label}"><span class="st">${a ? 'ON' : 'OFF'}</span><span class="sw"></span></button>`);
    t.addEventListener('click', () => { const on = t.getAttribute('aria-pressed') !== 'true'; t.setAttribute('aria-pressed', on); t.querySelector('.st').textContent = on ? 'ON' : 'OFF'; });
    row.append(t);
  } else if (kind === 'select') {
    const s = el(`<div class="select"><button aria-haspopup="listbox" aria-label="${label}"><span>${a[b]}</span></button><ul hidden role="listbox">${a.map((o, i) => `<li role="option" class="${i === b ? 'on' : ''}">${o}</li>`).join('')}</ul></div>`);
    const list = s.querySelector('ul');
    s.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); document.querySelectorAll('.select ul').forEach((u) => { if (u !== list) u.hidden = true; }); list.hidden = !list.hidden; });
    list.addEventListener('click', (e) => { const li = e.target.closest('li'); if (!li) return; list.querySelectorAll('li').forEach((x) => x.classList.toggle('on', x === li)); s.querySelector('span').textContent = li.textContent; list.hidden = true; });
    row.append(s);
  } else {
    const k = el(`<button class="bind" aria-label="Rebind ${label}"><span class="re">Rebind</span><span class="keycap">${a}</span></button>`);
    k.addEventListener('click', () => {
      k.classList.add('listen'); k.querySelector('.re').textContent = 'Press a key'; k.querySelector('.keycap').textContent = '...';
      const done = (e) => {
        e.preventDefault(); e.stopPropagation();
        k.querySelector('.keycap').textContent = e.key === 'Escape' ? a : e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key.replace('Arrow', '');
        k.classList.remove('listen'); k.querySelector('.re').textContent = 'Rebind';
        window.removeEventListener('keydown', done, true);
      };
      window.addEventListener('keydown', done, true);
    });
    row.append(k);
  }
  return row;
}

export function createUI(on) {
  const ui = el(`<div id="ui">
    <div id="hud" hidden>
      <div class="board hud-quest">
        <div class="kicker caps"><i class="diamond"></i>Quest</div>
        <h3>Stop the leak</h3>
        <div class="quest-row"><span class="name">Spruce gum</span><span class="pips"><i class="on"></i><i class="on"></i><i></i></span><span class="count">2/3</span></div>
        <div class="quest-row"><span class="name">Birch bark</span><span class="pips"><i class="on"></i><i></i><i></i><i></i></span><span class="count">1/4</span></div>
      </div>
      <div class="board hud-compass"><div class="strip"></div><div class="fade"></div><div class="needle"></div><div class="target"></div></div>
      <div class="hud-target caps"><i class="diamond"></i><span>Knoll 60 m</span></div>
      <div class="board hud-day"><b>Day 3</b><span class="caps">Dusk, wind NW</span></div>
      <div class="board hud-vitals">
        <div class="meter" style="--c:var(--blaze);--v:.72">${ICON.hunger}<div class="bar"><i></i></div><div class="val">72</div></div>
        <div class="meter" style="--c:var(--teal);--v:.48">${ICON.thirst}<div class="bar"><i></i></div><div class="val">48</div></div>
        <div class="meter" style="--c:var(--red);--v:.86">${ICON.energy}<div class="bar"><i></i></div><div class="val">86</div></div>
        <div class="gauge">
          <svg viewBox="0 0 122 40" aria-hidden="true">
            <path d="M10 8 22 31H100L112 8Z" fill="#f6e9cb"/>
            <path d="M16.800 21 19 19.500 27 21.500 36 19.500 45 21.500 54 19.500 63 21.500 72 19.500 81 21.500 90 19.500 99 21.500 105.200 21 100 31H22Z" fill="#1fb3a6"/>
            <path d="M2 6H14L24.500 27H97.500L108 6H120L104 36H18Z" fill="#e0392a"/>
            <path d="M2 6H120L118.400 9H3.600Z" fill="#12332a"/>
          </svg>
          <div><div class="lbl caps">Water in hull</div><div class="num">35%<span class="tag caps">Leak</span></div></div>
        </div>
      </div>
      <div class="board hud-hotbar">
        ${['paddle', 'hatchet', 'bailer', 'rod', 'hammer'].map((n, i) => `<div class="slot${i ? '' : ' on'}"><span class="key">${i + 1}</span>${ICON[n]}</div>`).join('')}
      </div>
      <div class="board dark hud-prompt" hidden><span class="keycap">E</span><span class="txt">Land here</span></div>
    </div>

    <div id="lobby" hidden>
      <div class="logo">${LOGO}<p class="tagline">A drowned valley. A leaky canoe. Bolt on the rest.</p></div>
      <nav class="menu">
        <div class="post"></div>
        <button class="sign primary" data-act="continue" style="--tilt:-1.2deg">Continue <small>Day 12, the homestead</small></button>
        <button class="sign" data-act="new" style="--tilt:0.8deg">New Game</button>
        <button class="sign" data-act="settings" style="--tilt:-0.5deg">Settings</button>
        <button class="sign" data-act="howto" style="--tilt:1.1deg">How to Play</button>
        <button class="sign" data-act="credits" style="--tilt:-0.9deg">Credits</button>
      </nav>
      <div class="lobby-foot">Art prototype A: Cutbank &nbsp;/&nbsp; build 0.1</div>
      <div class="board lobby-save"><b>Lac Perdu, day 12</b><span>15 attachments bolted on</span><span>Hull <i>dry</i></span></div>
    </div>

    <div id="pause" class="veil" hidden>
      <div class="stack">
        <div class="post"></div>
        <div class="board card"><h2>Paused</h2><p><i class="diamond"></i>Stop the leak: gum 2/3, bark 1/4</p></div>
        <button class="sign primary" data-act="resume" style="--tilt:-1deg">Resume</button>
        <button class="sign" data-act="settings" style="--tilt:0.8deg">Settings</button>
        <button class="sign" data-act="quit" style="--tilt:-0.6deg">Quit to lobby</button>
      </div>
    </div>

    <div id="overlay" class="veil" hidden><div class="board panel"></div></div>
    <div id="fps" hidden></div>
  </div>`);
  document.body.append(ui);
  const $ = (s) => ui.querySelector(s);
  const hud = $('#hud'), lobby = $('#lobby'), pause = $('#pause'), overlay = $('#overlay'), panel = $('.panel'), fps = $('#fps');

  // compass strip: three turns so it can slide either way
  const strip = $('.hud-compass .strip');
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  for (let i = 0; i < 24; i++) strip.append(el(`<div class="cell${i % 2 ? ' minor' : ''}">${names[i % 8]}</div>`));
  const target = $('.hud-compass .target'), targetTxt = $('.hud-target span');

  const head = (title, sub) => `<div class="panel-head"><div><p>${sub}</p><h2>${title}</h2></div><button class="x" data-act="close" aria-label="Close">X</button></div>`;
  let tab = 'Graphics';
  const panels = {
    settings() {
      panel.innerHTML = `${head('Settings', 'Trail kit')}
        <div class="tabs" role="tablist">${Object.keys(SETTINGS).map((t) => `<button class="tab" role="tab" aria-selected="${t === tab}" data-tab="${t}">${t}</button>`).join('')}</div>
        <div class="rows"></div>
        <div class="panel-foot"><span class="hint">Changes apply as you make them</span><div class="btns"><button class="sign small flat" data-act="defaults">Restore defaults</button><button class="sign small primary" data-act="close">Done</button></div></div>`;
      panel.querySelector('.rows').append(...SETTINGS[tab].map(control));
    },
    howto() {
      const rows = [[['W', 'S'], 'Paddle forward, back-paddle'], [['A', 'D'], 'Steer'], [['Drag'], 'Look around the canoe'], [['E'], 'Land, launch, pick up'],
        [['U'], 'Swap starter / homestead canoe'], [['1-5'], 'Pick a tool'], [['Esc'], 'Pause'], [['B'], 'Bolt something on']];
      panel.innerHTML = `${head('How to play', 'Trail notes')}
        <div class="howto">${rows.map(([k, t]) => `<div class="row"><span class="keys">${k.map((x) => `<span class="keycap">${x}</span>`).join('')}</span><span>${t}</span></div>`).join('')}</div>
        <div class="panel-foot"><span class="hint">Yellow diamonds mark what you can take</span><div class="btns"><button class="sign small primary" data-act="close">Got it</button></div></div>`;
    },
    credits() {
      panel.innerHTML = `${head('Credits', 'Art prototype A')}
        <div class="credits"><p><b>Cutbank</b> is one of three looks for Portage. Faceted low-poly diorama at golden hour, painted trail-sign UI.</p>
        <p>Every mesh, colour, wave and icon on screen is generated in code. No image, model or audio files.</p>
        <p>Three.js for rendering, Barlow Condensed for lettering.</p></div>
        <div class="panel-foot"><span class="hint">Portage, working name</span><div class="btns"><button class="sign small primary" data-act="close">Back</button></div></div>`;
    },
  };
  let open = null;
  const shown = { prompt: undefined, compass: '' };
  const api = {
    root: ui,
    get overlayOpen() { return open; },
    openPanel(name, t) { if (t) tab = t; open = name; panels[name](); overlay.hidden = false; },
    closePanel() { open = null; overlay.hidden = true; },
    setState(s) { lobby.hidden = s !== 'lobby'; },
    showHud(v) { hud.hidden = !v; },
    showPause(v) { pause.hidden = !v; },
    setPrompt(text) { if (text === shown.prompt) return; shown.prompt = text; const p = $('.hud-prompt'); p.hidden = !text; if (text) p.querySelector('.txt').textContent = text; },
    // heading + bearing in degrees, clockwise from north; dist in metres
    setCompass(heading, bearing, dist) {
      const rem = 6 / 45;
      const rel = ((bearing - heading + 540) % 360) - 180;
      const key = `${heading.toFixed(1)}|${rel.toFixed(1)}|${Math.round(dist)}`;
      if (key === shown.compass) return; // touch the DOM only when something moved
      shown.compass = key;
      strip.style.transform = `translateX(${(-(((heading % 360) + 360) % 360) - 360) * rem}rem)`;
      target.style.display = Math.abs(rel) > 95 ? 'none' : '';
      target.style.transform = `translateX(${rel * rem}rem) rotate(45deg)`;
      targetTxt.textContent = `Knoll ${Math.round(dist)} m`;
    },
    setFps(text, bad) { fps.hidden = false; fps.textContent = text; fps.classList.toggle('bad', !!bad); },
  };
  ui.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; panels.settings(); return; }
    const a = e.target.closest('[data-act]');
    if (!a) { document.querySelectorAll('.select ul').forEach((u) => { u.hidden = true; }); return; }
    const act = a.dataset.act;
    if (act === 'close') api.closePanel();
    else if (act === 'defaults') panels.settings();
    else if (act === 'settings' || act === 'howto' || act === 'credits') api.openPanel(act);
    else on[act]?.();
  });
  return api;
}
