// Lobby, settings, how-to, credits and pause. Plain DOM, styled by theme.css.
import { logoSvg } from './logo.js';

const slider = (key, label, value, min = 0, max = 100, unit = '%', note = '') => ({ type: 'slider', key, label, value, min, max, unit, note });
const toggle = (key, label, value, note = '') => ({ type: 'toggle', key, label, value, note });
const select = (key, label, options, value = 0, note = '') => ({ type: 'select', key, label, options, value, note });
const bind = (key, label, primary, alternate = '') => ({ type: 'bind', key, label, value: primary, alternate });

const TABS = {
  Audio: [
    ['Mix', [
      slider('master', 'Master volume', 80),
      slider('music', 'Music', 55),
      slider('ambience', 'Ambience', 70, 0, 100, '%', 'water, wind, loons'),
      slider('effects', 'Effects', 75),
      slider('paddler', 'Paddler', 40, 0, 100, '%', 'breath and effort'),
    ]],
    ['Output', [
      select('device', 'Output device', ['System default', 'Headphones', 'Speakers']),
      select('range', 'Dynamic range', ['Night, narrow', 'Standard', 'Wide'], 1),
      toggle('muteBackground', 'Mute when in the background', true),
    ]],
  ],
  Graphics: [
    ['Display', [
      select('window', 'Window mode', ['Borderless', 'Fullscreen', 'Windowed']),
      slider('resolution', 'Resolution scale', 100, 50, 150, '%'),
      select('frameCap', 'Frame cap', ['30', '60', '120', 'Uncapped'], 1),
      toggle('vsync', 'V-sync', true),
    ]],
    ['Blue hour', [
      slider('fog', 'Mist', 100, 40, 160, '%', 'how soon the valley fades'),
      toggle('reflections', 'Water reflections', true),
      slider('bloom', 'Lantern bloom', 62, 0, 120, '%'),
      toggle('motes', 'Fireflies and embers', true),
      slider('fov', 'Field of view', 38, 30, 60, '°'),
      toggle('fps', 'Show frame rate', false),
    ]],
  ],
  Controls: [
    ['Canoe', [
      bind('forward', 'Paddle forward', 'W', '↑'),
      bind('back', 'Back-paddle', 'S', '↓'),
      bind('left', 'Steer left', 'A', '←'),
      bind('right', 'Steer right', 'D', '→'),
    ]],
    ['On foot and tools', [
      bind('interact', 'Land, pick up, use', 'E'),
      bind('lantern', 'Raise lantern', 'F'),
      bind('craft', 'Open workbench or pack', 'Tab'),
    ]],
    ['Camera', [
      slider('sensitivity', 'Orbit sensitivity', 50),
      toggle('invertY', 'Invert vertical orbit', false),
    ]],
  ],
  Gameplay: [
    ['Survival', [
      select('difficulty', 'Pace', ['Gentle', 'Standard', 'Lean'], 1, 'how fast needs fall'),
      toggle('meters', 'Hunger, thirst and energy', true),
      toggle('autoBail', 'Bail automatically when idle', false),
      slider('leak', 'Leak rate', 100, 50, 150, '%'),
    ]],
    ['Guidance', [
      toggle('hints', 'Tutorial hints', true),
      toggle('landmarks', 'Landmarks on the compass', true),
      toggle('glints', 'Glint on things you can take', true),
      select('units', 'Units', ['Metric', 'Imperial']),
      select('autosave', 'Autosave', ['Every landing', 'Every 5 minutes', 'Off']),
    ]],
  ],
  Accessibility: [
    ['Reading', [
      slider('uiScale', 'Interface size', 100, 80, 130, '%'),
      toggle('contrast', 'High-contrast HUD', false),
      select('subtitles', 'Subtitles', ['Off', 'Small', 'Medium', 'Large'], 2),
      select('colour', 'Colour filter', ['None', 'Protanopia', 'Deuteranopia', 'Tritanopia']),
    ]],
    ['Comfort', [
      toggle('sway', 'Reduce camera sway', false),
      toggle('flashes', 'Soften flickering lights', false),
      toggle('holdPaddle', 'Tap to keep paddling', false, 'instead of holding the key'),
      slider('night', 'Dusk brightness', 100, 80, 140, '%'),
    ]],
  ],
};

for (const groups of Object.values(TABS)) for (const [, items] of groups) for (const item of items) item.initial = item.value;

const noteHtml = (note) => (note ? `<small>${note}</small>` : '');

function controlHtml(item) {
  if (item.type === 'slider') {
    const fill = ((item.value - item.min) / (item.max - item.min)) * 100;
    return `<input class="slider" type="range" min="${item.min}" max="${item.max}" value="${item.value}" data-key="${item.key}" data-unit="${item.unit}" style="--fill:${fill}%" aria-label="${item.label}"><span class="value caps">${item.value}${item.unit}</span>`;
  }
  if (item.type === 'toggle') {
    return `<button class="toggle caps" data-key="${item.key}" aria-pressed="${item.value}" aria-label="${item.label}"><span>${item.value ? 'On' : 'Off'}</span><i></i></button>`;
  }
  if (item.type === 'select') {
    const options = item.options.map((option, i) => `<li class="${i === item.value ? 'on' : ''}" data-index="${i}">${option}</li>`).join('');
    return `<div class="select" data-key="${item.key}"><button aria-label="${item.label}"><span>${item.options[item.value]}</span></button><ul hidden>${options}</ul></div>`;
  }
  return `${item.alternate ? `<button class="bind alt" data-key="${item.key}-alt">${item.alternate}</button>` : ''}<button class="bind" data-key="${item.key}">${item.value}</button>`;
}

const tabHtml = (name) => TABS[name].map(([group, items]) => `
  <div class="group-label caps">${group}</div>
  ${items.map((item) => `<div class="row"><div class="row-label">${item.label}${noteHtml(item.note)}</div><div class="control">${controlHtml(item)}</div></div>`).join('')}`).join('');

const menuHtml = (items) => items.map(([id, label, note], i) => `<button class="menu-item${i === 0 ? ' on' : ''}" data-action="${id}">${label}${note ? `<span class="note">${note}</span>` : ''}</button>`).join('');

const KEY_NAMES = { ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Control: 'Ctrl' };

export function createMenus(root, handlers) {
  const lobby = document.createElement('div');
  lobby.className = 'lobby';
  lobby.innerHTML = `
    <div>
      <div class="logo">${logoSvg()}</div>
      <p class="tagline serif">A flooded valley. A leaky canoe. Bolt on a life.</p>
      <nav class="menu" data-menu="lobby">${menuHtml([
        ['continue', 'Continue', 'Day 14, the granite knoll'],
        ['new', 'New Game'],
        ['settings', 'Settings'],
        ['howto', 'How to Play'],
        ['credits', 'Credits'],
      ])}</nav>
    </div>
    <div class="lobby-foot caps">
      <span>Prototype 0.1 &nbsp;·&nbsp; Art round one &nbsp;·&nbsp; Blue Hour</span>
      <span class="keys"><span><span class="keycap">↑</span><span class="keycap">↓</span>Select</span><span><span class="keycap">↵</span>Confirm</span></span>
    </div>`;

  const pause = document.createElement('div');
  pause.className = 'pause';
  pause.hidden = true;
  pause.innerHTML = `
    <div class="panel pause-card">
      <div class="caps amber">Paused</div>
      <h2>The valley waits</h2>
      <p class="where serif">Day 14, dusk. Off the granite knoll.</p>
      <nav class="menu" data-menu="pause">${menuHtml([['resume', 'Resume'], ['settings', 'Settings'], ['quit', 'Quit to lobby']])}</nav>
      <div class="save caps"><span>Autosaved</span><span>2 min ago</span></div>
    </div>`;

  const settings = document.createElement('section');
  settings.className = 'panel settings';
  settings.hidden = true;
  settings.innerHTML = `
    <header class="panel-head"><h2>Settings</h2><button class="panel-close caps" data-action="close"><span class="keycap">Esc</span>Close</button></header>
    <nav class="tabs">${Object.keys(TABS).map((name) => `<button class="tab caps" data-tab="${name}">${name}</button>`).join('')}</nav>
    <div class="tab-body"></div>
    <footer class="panel-foot"><button class="btn quiet caps" data-action="defaults">Restore defaults</button><span class="serif">Changes apply as you make them.</span><button class="btn primary caps" data-action="close">Done</button></footer>`;

  const howto = document.createElement('section');
  howto.className = 'panel sheet';
  howto.hidden = true;
  howto.innerHTML = `
    <header class="panel-head"><h2>How to play</h2><button class="panel-close caps" data-action="close"><span class="keycap">Esc</span>Close</button></header>
    <div class="sheet-body">
      <div><h3 class="caps">Paddle</h3><p>The valley is water now. Cross it stroke by stroke and mind the swell.</p><div class="keyline"><span class="keycap">W</span><span class="keycap">S</span>paddle &nbsp; <span class="keycap">A</span><span class="keycap">D</span>steer</div></div>
      <div><h3 class="caps">Land</h3><p>Nose in at any shore. Whatever carries an amber glint is yours to take.</p><div class="keyline"><span class="keycap">E</span>land, pick up, use</div></div>
      <div><h3 class="caps">Mend</h3><p>The hull leaks. Spruce gum and birch bark will hold it. Bail until then.</p><div class="keyline"><span class="keycap">4</span>bailing can</div></div>
      <div><h3 class="caps">Bolt on</h3><p>Every find becomes part of the boat: floats, a mast, a stove, a roof.</p><div class="keyline"><span class="keycap">U</span>swap canoe in this build</div></div>
      <div><h3 class="caps">Look</h3><p>Drag to look around the canoe. Follow the lamp and the far steeple.</p><div class="keyline"><span class="keycap">Drag</span>orbit the camera</div></div>
      <div><h3 class="caps">Keep well</h3><p>Eat, drink and rest. Nothing out here hunts you but the cold.</p><div class="keyline"><span class="keycap">Esc</span>pause</div></div>
    </div>`;

  const credits = document.createElement('section');
  credits.className = 'panel sheet';
  credits.hidden = true;
  credits.innerHTML = `
    <header class="panel-head"><h2>Credits</h2><button class="panel-close caps" data-action="close"><span class="keycap">Esc</span>Close</button></header>
    <div class="sheet-body credits-body">
      <div class="credit"><span class="caps">Game</span><span>Luc Sigouin</span></div>
      <div class="credit"><span class="caps">Art direction</span><span>Variant C, Blue Hour</span></div>
      <div class="credit"><span class="caps">Every mesh and texture</span><span>Drawn in code, no asset files</span></div>
      <div class="credit"><span class="caps">Rendering</span><span>three.js</span></div>
      <div class="credit"><span class="caps">Type</span><span>Jost and Cormorant Garamond</span></div>
      <div class="credit"><span class="caps">Thanks</span><span>The Shield, at dusk</span></div>
    </div>`;

  root.append(lobby, pause, settings, howto, credits);

  const panels = { settings, howto, credits };
  const tabBody = settings.querySelector('.tab-body');
  let openPanel = null, listening = null;

  const setTab = (name) => {
    for (const tab of settings.querySelectorAll('.tab')) tab.classList.toggle('on', tab.dataset.tab === name);
    tabBody.innerHTML = tabHtml(name);
    tabBody.scrollTop = 0;
  };
  const find = (key) => {
    for (const groups of Object.values(TABS)) for (const [, items] of groups) for (const item of items) if (item.key === key) return item;
    return null;
  };
  const focusItem = (menu, index) => {
    const items = [...menu.querySelectorAll('.menu-item')];
    items.forEach((item, i) => item.classList.toggle('on', i === (index + items.length) % items.length));
  };
  const focusedIndex = (menu) => [...menu.querySelectorAll('.menu-item')].findIndex((item) => item.classList.contains('on'));
  const activeMenu = () => (openPanel ? null : !pause.hidden ? pause.querySelector('.menu') : !lobby.hidden ? lobby.querySelector('.menu') : null);

  const api = {
    get panel() { return openPanel; },
    showLobby(show) { lobby.hidden = !show; },
    showPause(show) {
      pause.hidden = !show;
      root.classList.toggle('in-pause', show);
      if (show) focusItem(pause.querySelector('.menu'), 0);
    },
    open(name, tab = 'Audio') {
      api.close();
      openPanel = name;
      panels[name].hidden = false;
      root.classList.add('panel-open');
      if (name === 'settings') setTab(tab);
      const menu = !pause.hidden ? pause : lobby;
      menu.querySelectorAll('.menu-item').forEach((item) => item.classList.toggle('on', item.dataset.action === name));
      pause.firstElementChild.hidden = !pause.hidden; // the card steps aside for the panel
    },
    close() {
      if (!openPanel) return;
      panels[openPanel].hidden = true;
      root.classList.remove('panel-open');
      openPanel = null;
      listening = null;
      pause.firstElementChild.hidden = false;
    },
    /** Returns true when the key was used by a menu. */
    key(event) {
      if (listening) {
        event.preventDefault();
        const name = KEY_NAMES[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key);
        listening.textContent = name;
        listening.classList.remove('listening');
        listening = null;
        return true;
      }
      if (event.key === 'Escape' && openPanel) {
        api.close();
        return true;
      }
      const menu = activeMenu();
      if (!menu) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        focusItem(menu, focusedIndex(menu) + (event.key === 'ArrowDown' ? 1 : -1));
        return true;
      }
      if (event.key === 'Enter') {
        menu.querySelectorAll('.menu-item')[Math.max(focusedIndex(menu), 0)].click();
        return true;
      }
      return false;
    },
  };

  root.addEventListener('pointerover', (event) => {
    const item = event.target.closest('.menu-item');
    if (item && !openPanel) item.parentElement.querySelectorAll('.menu-item').forEach((other) => other.classList.toggle('on', other === item));
  });

  root.addEventListener('click', (event) => {
    const target = event.target;
    const action = target.closest('[data-action]')?.dataset.action;
    if (action === 'close') return api.close();
    if (action === 'settings') return api.open('settings', 'Audio');
    if (action === 'howto' || action === 'credits') return api.open(action);
    if (action === 'defaults') {
      const name = settings.querySelector('.tab.on').dataset.tab;
      for (const [, items] of TABS[name]) {
        for (const item of items) {
          item.value = item.initial;
          if (item.type !== 'bind') handlers.onSetting(item.key, item.type === 'select' ? item.options[item.value] : item.value);
        }
      }
      return setTab(name);
    }
    if (action) {
      api.close();
      return handlers.onAction(action);
    }
    const tab = target.closest('.tab');
    if (tab) return setTab(tab.dataset.tab);

    const openSelect = settings.querySelector('.select.open');
    const selectBox = target.closest('.select');
    if (openSelect && openSelect !== selectBox) {
      openSelect.classList.remove('open');
      openSelect.querySelector('ul').hidden = true;
    }
    if (selectBox) {
      const option = target.closest('li');
      const list = selectBox.querySelector('ul');
      if (option) {
        const item = find(selectBox.dataset.key);
        item.value = Number(option.dataset.index);
        selectBox.querySelector('button span').textContent = item.options[item.value];
        list.querySelectorAll('li').forEach((other) => other.classList.toggle('on', other === option));
        handlers.onSetting(item.key, item.options[item.value]);
      }
      const show = option ? false : list.hidden;
      list.hidden = !show;
      selectBox.classList.toggle('open', show);
      return undefined;
    }
    const toggleButton = target.closest('.toggle');
    if (toggleButton) {
      const item = find(toggleButton.dataset.key);
      item.value = !item.value;
      toggleButton.setAttribute('aria-pressed', item.value);
      toggleButton.querySelector('span').textContent = item.value ? 'On' : 'Off';
      return handlers.onSetting(item.key, item.value);
    }
    const bindButton = target.closest('.bind');
    if (bindButton) {
      settings.querySelectorAll('.bind.listening').forEach((other) => other.classList.remove('listening'));
      bindButton.classList.add('listening');
      bindButton.textContent = 'Press…';
      listening = bindButton;
    }
    return undefined;
  });

  root.addEventListener('input', (event) => {
    const input = event.target.closest('.slider');
    if (!input) return;
    const item = find(input.dataset.key);
    item.value = Number(input.value);
    input.style.setProperty('--fill', `${((item.value - item.min) / (item.max - item.min)) * 100}%`);
    input.nextElementSibling.textContent = `${item.value}${input.dataset.unit}`;
    handlers.onSetting(item.key, item.value);
  });

  return api;
}
