// Ink & Wash — UI: HUD, lobby, settings, how-to, credits, pause. All DOM, styled by theme.css.
import './theme.css';
import { ICON, DEFS, bilgeGauge, seal, logotype } from './icons.js';

// Paper tooth for cards, generated once.
function paperTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const img = x.createImageData(256, 256);
  let s = 1234567;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 256 * 256; i++) {
    const n = (r() + r() + r()) / 3;
    const v = n > 0.5 ? 255 : 30;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v - 8;
    img.data[i * 4 + 2] = v - 30;
    img.data[i * 4 + 3] = Math.abs(n - 0.5) * 2 * 46;
  }
  x.putImageData(img, 0, 0);
  x.strokeStyle = 'rgba(90,70,40,0.07)';
  x.lineWidth = 0.6;
  for (let i = 0; i < 60; i++) {
    const px = r() * 256;
    const py = r() * 256;
    const a = r() * 6.28;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * 9, py + Math.sin(a) * 9);
    x.stroke();
  }
  return c.toDataURL('image/png');
}

const slider = (key, v, min = 0, max = 100, unit = '') =>
  `<span class="sl"><input type="range" data-k="${key}" min="${min}" max="${max}" value="${v}" data-unit="${unit}" style="--v:${(v - min) / (max - min)}"><output>${v}${unit}</output></span>`;
const toggle = (key, on) => `<label class="tg"><input type="checkbox" data-k="${key}" ${on ? 'checked' : ''}><span class="box">${ICON.check()}</span><span class="st"></span></label>`;
const dropdown = (key, opts, sel = 0) => `<span class="dd"><select data-k="${key}">${opts.map((o, i) => `<option${i === sel ? ' selected' : ''}>${o}</option>`).join('')}</select>${ICON.caret()}</span>`;
const bind = (key, k) => `<button class="key bind" data-bind="${key}">${k}</button>`;
const row = (label, note, control) => `<div class="row"><div class="l">${label}${note ? `<small>${note}</small>` : ''}</div>${control}</div>`;

const TABS = {
  Audio: () =>
    [
      row('Master volume', 'everything at once', slider('master', 80, 0, 100)),
      row('Music', 'fiddle, harmonium, long silences', slider('music', 55, 0, 100)),
      row('Water &amp; weather', 'lapping, rain on the tarp, wind', slider('ambience', 90, 0, 100)),
      row('Wildlife', 'loons at dusk, ravens, frogs', slider('wildlife', 70, 0, 100)),
      row('Tools &amp; canoe', 'paddle strokes, hull creak, winch', slider('sfx', 85, 0, 100)),
      row('Output', '', dropdown('output', ['System default', 'Headphones', 'Speakers'])),
      row('Dynamic range', 'night mode squashes the loud parts', dropdown('range', ['Full', 'Night mode'])),
      row('Mute when in background', '', toggle('mutebg', true)),
    ].join(''),
  Graphics: () =>
    [
      row('Quality', 'how finished the plate is', dropdown('quality', ['Thumbnail sketch', 'Field study', 'Finished plate'], 2)),
      row('Render scale', 'sharper pen lines cost frames', slider('scale', 100, 50, 150, '%')),
      row('Line weight', 'how heavy the pen is', slider('line', 50, 0, 100)),
      row('Paper grain', 'tooth of the sheet', slider('grain', 36, 0, 100)),
      row('Mist', 'how soon the far shore fades', slider('mist', 50, 0, 100)),
      row('Hatching', 'pen strokes in the shadows', toggle('hatch', true)),
      row('Line boil', 'outlines breathe like hand animation', toggle('boil', false)),
      row('Reflections', '', dropdown('refl', ['Brushed', 'Simple wash', 'Off'])),
      row('Frame-rate cap', '', dropdown('cap', ['Match display', '60', '120', 'Uncapped'])),
      row('Show frame rate', '', toggle('fps', false)),
    ].join(''),
  Controls: () =>
    [
      row('Paddle forward', '', bind('fwd', 'W')),
      row('Back-paddle', '', bind('back', 'S')),
      row('Steer left', '', bind('left', 'A')),
      row('Steer right', '', bind('right', 'D')),
      row('Land / interact', '', bind('use', 'E')),
      row('Bail the bilge', '', bind('bail', 'B')),
      row('Swap canoe (preview)', '', bind('swap', 'U')),
      row('Pause', '', bind('pause', 'Esc')),
      row('Look sensitivity', 'mouse drag to orbit', slider('sens', 45, 0, 100)),
      row('Invert vertical look', '', toggle('inverty', false)),
    ].join(''),
  Gameplay: () =>
    [
      row('Survival', 'how fast hunger and thirst bite', dropdown('survival', ['Gentle', 'As written', 'Lean season'], 1)),
      row('Autosave', '', dropdown('autosave', ['Every landing', 'Every 5 minutes', 'Only at camp'])),
      row('Units', '', dropdown('units', ['Metres, litres', 'Feet, quarts'])),
      row('Loot notes', 'pencil labels on things you can take', toggle('labels', true)),
      row('Quest hints', 'margin notes on what to do next', toggle('hints', true)),
      row('Compass', '', dropdown('compass', ['Strip', 'Off'])),
      row('Auto-bail when idle', '', toggle('autobail', false)),
      row('Tutorial pages', '', toggle('tutorial', true)),
    ].join(''),
  Accessibility: () =>
    [
      row('Text size', 'scales every label and card', slider('text', 100, 85, 130, '%')),
      row('High-contrast ink', 'darker lines, plainer washes', toggle('contrast', false)),
      row('Colour-blind palette', '', dropdown('cvd', ['Off', 'Protan / deutan', 'Tritan'])),
      row('Reduce motion', 'stills the line boil and camera sway', toggle('reduce', false)),
      row('Hold to paddle', 'off = tap to keep paddling', toggle('hold', true)),
      row('Subtitles &amp; sound captions', '', toggle('subs', true)),
      row('Screen-reader hints', '', toggle('sr', false)),
      row('Dyslexia-friendly type', 'swaps the notebook hand for a plain face', toggle('plain', false)),
    ].join(''),
};
const TAB_ICON = { Audio: '', Graphics: '', Controls: '', Gameplay: '', Accessibility: '' };

export function createUI(h) {
  const root = document.getElementById('ui');
  document.documentElement.style.setProperty('--tex', `url(${paperTexture()})`);

  const hot = [
    ['paddle', 'paddle'],
    ['hatchet', 'hatchet'],
    ['bailer', 'bailer'],
    ['rod', 'hand line'],
    ['hammer', 'hammer'],
  ];
  // compass track: ticks every 15°, letters every 45°, drawn over two turns so it never runs out
  const DEG = 0.1667; // rem per degree
  let track = '';
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  for (let d = -360; d <= 720; d += 15) {
    const big = d % 45 === 0;
    track += `<i class="tk${big ? ' big' : ''}" style="left:${(d * DEG).toFixed(3)}rem"></i>`;
    if (big) {
      const nm = names[(((d / 45) % 8) + 8) % 8];
      track += `<span class="lb${nm.length > 1 ? ' minor' : ''}" style="left:${(d * DEG).toFixed(3)}rem">${nm}</span>`;
    }
  }

  root.innerHTML = `${DEFS}
  <div id="callouts"></div>
  <div id="hud">
    <div class="vitals paper"><i class="tape"></i>
      <div class="meter"><span>${ICON.hunger()}</span><span class="lab">Hunger</span><div class="bar"><i style="--v:.64;--c:var(--rust)"></i></div><span class="val">64</span></div>
      <div class="meter low"><span>${ICON.thirst()}</span><span class="lab">Thirst</span><div class="bar"><i style="--v:.31;--c:var(--water)"></i></div><span class="val">31</span></div>
      <div class="meter"><span>${ICON.energy()}</span><span class="lab">Energy</span><div class="bar"><i style="--v:.82;--c:var(--ochre)"></i></div><span class="val">82</span></div>
      <div class="bilge">${bilgeGauge(0.38)}<div class="txt"><b>Bilge 38%</b><span>taking water — bail soon</span></div></div>
    </div>
    <div class="compass">
      <div class="strip"><div class="track">${track}<span class="mk">${ICON.flag()}</span></div></div>
      <i class="needle"></i>
    </div>
    <div class="quest paper"><i class="tape"></i>
      <div class="over">Field notes · today</div>
      <h3>Stop the leak</h3>
      <ul>
        <li><span>spruce gum</span><span class="pips"><i class="f"></i><i class="f"></i><i></i><b>2/3</b></span></li>
        <li><span>birch bark</span><span class="pips"><i class="f"></i><i></i><i></i><i></i><b>1/4</b></span></li>
      </ul>
      <div class="then">then melt the gum, patch the seam by the stern seat.</div>
    </div>
    <div class="prompt paper" hidden><span class="key">E</span><span class="txt">Land here</span></div>
    <div class="hotbar">${hot.map(([ic, nm], i) => `<div class="slot paper${i === 0 ? ' sel' : ''}"><span class="n">${i + 1}</span>${ICON[ic]()}${i === 0 ? `<span class="nm">${nm}</span>` : ''}</div>`).join('')}</div>
  </div>
  <div id="lobby">
    <div class="lobby-col">
      <div class="logo-row">${logotype()}${seal()}</div>
      <p class="tagline">A drowned valley · a leaky canoe</p>
      <nav class="menu">
        <button class="mi sel" data-act="continue"><span>Continue</span><span class="n">day 12 · Birch Knoll · the homestead floats</span></button>
        <button class="mi" data-act="new"><span>New Game</span><span class="n">one canoe, one leak</span></button>
        <button class="mi" data-act="settings"><span>Settings</span></button>
        <button class="mi" data-act="howto"><span>How to Play</span></button>
        <button class="mi" data-act="credits"><span>Credits</span></button>
      </nav>
      <div class="plate">Plate I. — Birch Knoll at first light, the steeple of St. Agnes beyond. Water still rising, or so it feels.</div>
    </div>
    <div class="lobby-foot">Art study B2 · Ink &amp; Wash</div>
  </div>
  <div id="veil" hidden></div>
  <div id="fps" hidden></div>`;

  const $ = (s) => root.querySelector(s);
  const hud = $('#hud');
  const lobby = $('#lobby');
  const veil = $('#veil');
  const fpsEl = $('#fps');
  const prompt = $('.prompt');
  const trackEl = $('.compass .track');
  const mkEl = $('.compass .mk');
  const calloutsEl = $('#callouts');
  let panel = null;
  let mode = 'lobby';

  // ---- lobby menu ----
  const items = [...lobby.querySelectorAll('.mi')];
  const select = (el) => items.forEach((m) => m.classList.toggle('sel', m === el));
  items.forEach((el) => {
    el.addEventListener('mouseenter', () => select(el));
    el.addEventListener('click', () => h.onAction(el.dataset.act));
  });

  // ---- panels ----
  function settingsHTML(tab) {
    return `<div class="panel paper" data-panel="settings"><i class="tape a"></i><i class="tape b"></i>
      <header><h2>Settings</h2><span class="sub">kept in the back of the notebook</span></header>
      <div class="tabs">${Object.keys(TABS).map((t) => `<button class="tab${t === tab ? ' on' : ''}" data-tab="${t}">${TAB_ICON[t]}${t}</button>`).join('')}</div>
      <div class="tabbody">${TABS[tab]()}</div>
      <footer><button class="btn quiet" data-act="defaults">Restore defaults</button><span class="note">changes apply as you make them</span><button class="btn go" data-act="close">Done</button></footer>
    </div>`;
  }
  const howtoHTML = () => `<div class="panel mid paper" data-panel="howto"><i class="tape a"></i>
      <header><h2>How to Play</h2><span class="sub">page one of the notebook</span></header>
      <div class="cols">
        <div class="keys">
          <span class="ks"><span class="key">W</span><span class="key">S</span></span><span>paddle forward, back-paddle</span>
          <span class="ks"><span class="key">A</span><span class="key">D</span></span><span>steer</span>
          <span class="ks"><span class="key">drag</span></span><span>look around the canoe</span>
          <span class="ks"><span class="key">E</span></span><span>land, pick up, use</span>
          <span class="ks"><span class="key">U</span></span><span>swap starter / upgraded canoe</span>
          <span class="ks"><span class="key">Esc</span></span><span>pause</span>
        </div>
        <div class="notes">
          <p><b>i.</b>Paddle to anything that still pokes out of the water. Roofs, knolls and pylons all hold something.</p>
          <p><b>ii.</b>Land, scavenge on foot, carry it back. Things with a pencil note beside them can be taken.</p>
          <p><b>iii.</b>Bolt what you build onto the canoe. It keeps every piece, and it only gets sillier.</p>
          <p><b>iv.</b>Eat, drink, sleep, bail. Nothing out here is hunting you but the weather.</p>
        </div>
      </div>
      <footer><span class="note">the valley flooded and stayed flooded.</span><button class="btn go" data-act="close">Back</button></footer>
    </div>`;
  const creditsHTML = () => `<div class="panel mid paper" data-panel="credits"><i class="tape b"></i>
      <header><h2>Credits</h2><span class="sub">Portage — art study B2</span></header>
      <div class="credits">
        Every line, wash, mesh and icon on screen is drawn in code at load. No image, model or sound files.
        <dl>
          <dt>Direction</dt><dd>Ink &amp; Wash — a storybook you can paddle through</dd>
          <dt>Rendering</dt><dd>three.js · three-tone cel wash, edge-inked outlines, brushed reflections, paper grain</dd>
          <dt>Type</dt><dd>IM Fell English (Igino Marini) · Kalam (Indian Type Foundry), both SIL OFL</dd>
          <dt>Setting</dt><dd>a boreal valley on the Shield, some years after the water came up</dd>
        </dl>
      </div>
      <footer><span class="note">made for the look bake-off, round one.</span><button class="btn go" data-act="close">Back</button></footer>
    </div>`;
  const pauseHTML = () => `<div class="panel narrow paper" data-panel="pause"><i class="tape a"></i>
      ${seal()}
      <h2>Paused</h2>
      <p class="pause-note">the kettle can wait.</p>
      <nav class="menu">
        <button class="mi sel" data-act="resume"><span>Resume</span></button>
        <button class="mi" data-act="settings"><span>Settings</span></button>
        <button class="mi" data-act="quit"><span>Quit to lobby</span></button>
      </nav>
      <div class="hint"><span class="key">Esc</span> to pick the paddle back up</div>
    </div>`;

  let returnTo = null; // panel to go back to when settings closes (pause)
  function open(name, tab = 'Graphics') {
    panel = name;
    lobby.classList.add('dim');
    veil.hidden = false;
    veil.innerHTML = name === 'settings' ? settingsHTML(tab) : name === 'howto' ? howtoHTML() : name === 'credits' ? creditsHTML() : pauseHTML();
    h.onPanel?.(name);
  }
  function close() {
    if (panel === 'settings' && returnTo === 'pause') {
      returnTo = null;
      open('pause');
      return;
    }
    panel = null;
    lobby.classList.remove('dim');
    veil.hidden = true;
    veil.innerHTML = '';
    h.onPanel?.(null);
  }
  veil.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab],[data-act],[data-bind]');
    if (!t) return;
    if (t.dataset.tab) {
      veil.querySelector('.tabs .on')?.classList.remove('on');
      t.classList.add('on');
      veil.querySelector('.tabbody').innerHTML = TABS[t.dataset.tab]();
    } else if (t.dataset.bind) {
      veil.querySelectorAll('.bind.listen').forEach((b) => b.classList.remove('listen'));
      t.classList.add('listen');
      t.textContent = 'press…';
    } else if (t.dataset.act === 'close') close();
    else if (t.dataset.act === 'defaults') {
      const cur = veil.querySelector('.tabs .on').dataset.tab;
      veil.querySelector('.tabbody').innerHTML = TABS[cur]();
      veil.querySelectorAll('.tabbody [data-k]').forEach((el) => emit(el));
    } else if (t.dataset.act === 'settings') {
      returnTo = panel === 'pause' ? 'pause' : null;
      open('settings');
    } else h.onAction(t.dataset.act);
  });
  veil.addEventListener('mouseover', (e) => {
    const mi = e.target.closest('.mi');
    if (mi) veil.querySelectorAll('.mi').forEach((m) => m.classList.toggle('sel', m === mi));
  });
  function emit(el) {
    const k = el.dataset.k;
    if (el.type === 'range') {
      const v = (el.value - el.min) / (el.max - el.min);
      el.style.setProperty('--v', v);
      el.nextElementSibling.textContent = el.value + (el.dataset.unit || '');
      h.onSetting?.(k, v, +el.value);
    } else if (el.type === 'checkbox') h.onSetting?.(k, el.checked);
    else h.onSetting?.(k, el.selectedIndex, el.value);
  }
  veil.addEventListener('input', (e) => {
    if (e.target.dataset.k) emit(e.target);
  });
  // key rebinding: next key pressed lands in the listening cap
  window.addEventListener(
    'keydown',
    (e) => {
      const b = veil.querySelector('.bind.listen');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      b.textContent = e.key === ' ' ? 'Space' : e.key === 'Escape' ? 'Esc' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      b.classList.remove('listen');
    },
    true
  );

  // ---- callouts (loot notes + waypoint), projected by main ----
  const callouts = new Map();
  function callout(key, label, way = false) {
    const el = document.createElement('div');
    el.className = `callout${way ? ' way' : ''}`;
    el.innerHTML = way
      ? `<div class="in"><span class="lbl">${ICON.flag()}<span class="t">${label}</span></span><i class="stem"></i></div>`
      : `<div class="in"><span class="lbl">${label}</span>${ICON.spark()}</div>`;
    calloutsEl.appendChild(el);
    callouts.set(key, el);
    return el;
  }

  return {
    get panel() {
      return panel;
    },
    get mode() {
      return mode;
    },
    setMode(m) {
      mode = m;
      lobby.classList.toggle('on', m === 'lobby');
      lobby.style.pointerEvents = m === 'lobby' ? '' : 'none';
      items.forEach((i) => (i.style.pointerEvents = m === 'lobby' ? 'auto' : 'none'));
    },
    showHud(on) {
      hud.classList.toggle('on', on);
    },
    showPrompt(on, text) {
      prompt.hidden = !on;
      if (text) prompt.querySelector('.txt').textContent = text;
    },
    open,
    close,
    setCompass(headingDeg, markDeg) {
      const hd = ((headingDeg % 360) + 360) % 360;
      trackEl.style.transform = `translateX(${(-hd * DEG).toFixed(3)}rem)`;
      const d = (((markDeg - hd) % 360) + 540) % 360 - 180;
      mkEl.style.left = `${((hd + d) * DEG).toFixed(3)}rem`;
    },
    callout,
    placeCallout(key, x, y, visible, far, text) {
      const el = callouts.get(key);
      if (!el) return;
      el.classList.toggle('on', visible);
      if (!visible) return;
      el.classList.toggle('far', !!far);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (text) el.querySelector('.t').textContent = text;
    },
    setFps(text) {
      fpsEl.hidden = !text;
      if (text) fpsEl.textContent = text;
    },
    setTextScale(v) {
      document.documentElement.style.setProperty('--ui-scale', v);
    },
  };
}
