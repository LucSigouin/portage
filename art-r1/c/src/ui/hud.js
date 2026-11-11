// In-game HUD mock: compass, quest, vitals, hull water gauge, hotbar, context prompt, loot tags.
import { icon } from './icons.js';

const PX_PER_DEGREE = 0.3; // rem
const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

function compassStrip() {
  let html = '';
  for (let degree = -180; degree <= 540; degree += 5) {
    const bearing = ((degree % 360) + 360) % 360, left = (degree * PX_PER_DEGREE).toFixed(2);
    if (bearing % 15 === 0) html += `<i class="${bearing % 45 === 0 ? 'major' : ''}" style="left:${left}rem"></i>`;
    if (bearing % 45 === 0) html += `<b class="${bearing % 90 === 0 ? 'cardinal' : ''}" style="left:${left}rem">${CARDINALS[bearing]}</b>`;
    else if (bearing % 15 === 0) html += `<b style="left:${left}rem;opacity:.55">${bearing}</b>`;
  }
  return html;
}

const vital = (name, label, value, low) => `
  <div class="vital${low ? ' low' : ''}">${icon(name)}<span class="caps">${label}</span>
    <span class="track"><em style="width:${value}%"></em></span><span class="num">${value}</span></div>`;

const slot = (key, name, label, on) => `
  <div class="slot${on ? ' on' : ''}"><span class="key">${key}</span>${icon(name)}${on ? `<span class="name caps">${label}</span>` : ''}</div>`;

export function createHud(root) {
  const el = document.createElement('div');
  el.className = 'hud';
  el.hidden = true;
  el.innerHTML = `
    <div class="compass">
      <div class="compass-window"><div class="compass-strip">${compassStrip()}</div></div>
      <div class="compass-caret"></div>
      <div class="compass-mark caps" data-mark="island"><span></span></div>
      <div class="compass-mark far caps" data-mark="steeple"><span></span></div>
    </div>
    <div class="quest">
      <div class="caps kicker">Current task</div>
      <h3>Stop the leak</h3>
      <div class="quest-line"><span>Spruce gum</span><span class="count">2 / 3</span><span class="bar"><em style="width:66.6%"></em></span></div>
      <div class="quest-line"><span>Birch bark</span><span class="count">1 / 4</span><span class="bar"><em style="width:25%"></em></span></div>
      <p class="hint serif">Both grow on the knoll ahead.</p>
    </div>
    <div class="clock">
      <div class="caps">Day 14 &nbsp;·&nbsp; Dusk</div>
      <span class="serif">light wind from the west</span>
      <div class="keys caps"><span><span class="keycap">U</span>Swap canoe</span><span><span class="keycap">Esc</span>Pause</span></div>
    </div>
    <div class="vitals">
      ${vital('hunger', 'Hunger', 64, false)}
      ${vital('thirst', 'Thirst', 31, true)}
      ${vital('energy', 'Energy', 82, false)}
    </div>
    <div class="hull">
      <div>
        <div class="caps">Water in hull</div>
        <div class="pct">38<small>%</small></div>
        <div class="caps state">Leaking</div>
      </div>
      <svg viewBox="0 0 64 40" fill="none">
        <defs><clipPath id="hull-clip"><path d="M5 6C5 24 16 35 32 35S59 24 59 6Z"/></clipPath></defs>
        <rect x="0" y="23.5" width="64" height="20" fill="#ffb454" opacity="0.22" clip-path="url(#hull-clip)"/>
        <path d="M9.500 23.500q3.500-2 7 0t7 0 7 0 7 0 7 0 7 0 3 -1" stroke="#ffb454" stroke-width="1.2" clip-path="url(#hull-clip)"/>
        <path d="M5 6C5 24 16 35 32 35S59 24 59 6" stroke="#ece8dd" stroke-width="1.4"/>
        <path d="M1.500 6h7M55.500 6h7M5 12.500h54" stroke="#ece8dd" stroke-width="1.2" opacity="0.8"/>
        <path d="M32 35v3" stroke="#ece8dd" stroke-width="1.4"/>
      </svg>
    </div>
    <div class="prompt" hidden><span class="keycap">E</span><span data-prompt>Land here</span></div>
    <div class="hotbar">
      ${slot(1, 'paddle', 'Paddle', true)}${slot(2, 'hatchet', 'Hatchet')}${slot(3, 'knife', 'Knife')}${slot(4, 'bailer', 'Bailing can')}${slot(5, 'lantern', 'Lantern')}
    </div>
    <div data-tags></div>`;
  root.appendChild(el);

  const strip = el.querySelector('.compass-strip');
  const marks = { island: el.querySelector('[data-mark=island]'), steeple: el.querySelector('[data-mark=steeple]') };
  const prompt = el.querySelector('.prompt'), promptText = el.querySelector('[data-prompt]');
  const tagLayer = el.querySelector('[data-tags]');
  const tags = new Map();

  // Every write is cached: a HUD that re-lays-out each frame costs more than the 3D scene does.
  const cache = new Map();
  const write = (key, value, apply) => {
    if (cache.get(key) === value) return;
    cache.set(key, value);
    apply(value);
  };
  const setMark = (name, heading, bearing, text) => {
    const node = marks[name], relative = ((bearing - heading + 540) % 360) - 180;
    write(`${name}:hidden`, Math.abs(relative) > 44, (hidden) => { node.hidden = hidden; });
    if (node.hidden) return;
    write(`${name}:x`, (relative * PX_PER_DEGREE).toFixed(1), (x) => { node.style.transform = `translateX(${x}rem) translateX(-50%)`; });
    write(`${name}:text`, text, (value) => { node.firstElementChild.textContent = value; });
  };

  return {
    el,
    setVisible(visible) { el.hidden = !visible; },
    /** heading and bearings in degrees, 0 = north (-z), clockwise. */
    setCompass(heading, island, steeple) {
      write('strip', (15 - heading * PX_PER_DEGREE).toFixed(2), (x) => { strip.style.transform = `translateX(${x}rem)`; });
      if (island) setMark('island', heading, island.bearing, `Granite knoll  ${Math.round(island.distance)} m`);
      else write('island:hidden', true, (hidden) => { marks.island.hidden = hidden; });
      setMark('steeple', heading, steeple.bearing, `Steeple  ${Math.round(steeple.distance)} m`);
    },
    setPrompt(text) {
      write('prompt', text, (value) => {
        prompt.hidden = !value;
        if (value) promptText.textContent = value;
      });
    },
    /** items: [{ id, label, note?, x, y }] in CSS pixels. Anything not listed is hidden. */
    setTags(items) {
      for (const [id, node] of tags) write(`tag:${id}:hidden`, !items.some((item) => item.id === id), (hidden) => { node.hidden = hidden; });
      for (const item of items) {
        let node = tags.get(item.id);
        if (!node) {
          node = document.createElement('div');
          node.className = 'tag caps';
          node.innerHTML = `<span>${item.label}</span>${item.note ? `<small>${item.note}</small>` : ''}`;
          tagLayer.appendChild(node);
          tags.set(item.id, node);
        }
        write(`tag:${item.id}:hidden`, false, (hidden) => { node.hidden = hidden; });
        write(`tag:${item.id}:at`, `${Math.round(item.x)}px, ${Math.round(item.y)}px`, (at) => { node.style.transform = `translate(${at}) translate(-50%, -100%)`; });
      }
    },
  };
}
