/**
 * The page's state and its address. The address holds the chosen thing, the answers to its questions, the view,
 * the ground and the background and the light, so a pasted link reopens the same picture. Pure: no DOM.
 */
import type { Background, View } from './stage.ts';
import type { Light } from './light.ts';
import type { Options } from './types.ts';

export type ViewName = 'home' | 'front' | 'side' | 'top' | 'paddle' | 'free';
export const VIEW_NAMES: ViewName[] = ['home', 'front', 'side', 'top', 'paddle', 'free'];
export const BACKGROUNDS: Background[] = ['paper', 'checker', 'dark'];
export const LIGHTS: Light[] = ['day', 'night'];

export interface ViewerState {
  /** Entry id, `group/key`. */
  thing: string;
  options: Options;
  view: ViewName;
  /** The camera when `view` is `free` (set by dragging, zooming or the keys). */
  free: View | null;
  background: Background;
  grid: boolean;
  light: Light;
}

export const RESERVED = ['thing', 'view', 'yaw', 'pitch', 'dist', 'aim', 'bg', 'grid', 'light'];

const round = (value: number, places: number): string => String(Number(value.toFixed(places)));

/** The address (the part after `?`) for a state. Defaults are left out. */
export function toQuery(state: ViewerState, optionDefaults: Options): string {
  const query = new URLSearchParams();
  query.set('thing', state.thing);
  for (const [key, value] of Object.entries(state.options)) if (value !== optionDefaults[key]) query.set(key, value);
  if (state.view !== 'home') query.set('view', state.view);
  if (state.view === 'free' && state.free) {
    query.set('yaw', round(state.free.yaw, 1));
    query.set('pitch', round(state.free.pitch, 1));
    query.set('dist', round(state.free.distance, 3));
    if (state.free.aim === 'paddle') query.set('aim', 'paddle');
  }
  if (state.background !== 'paper') query.set('bg', state.background);
  if (!state.grid) query.set('grid', '0');
  if (state.light !== 'day') query.set('light', state.light);
  return query.toString();
}

const number = (text: string | null): number | null => {
  if (text === null || text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

/** Read an address. Anything it does not make sense of takes the default. Choices are checked against the entry later. */
export function fromQuery(search: string, firstThing: string): ViewerState {
  const query = new URLSearchParams(search);
  const options: Options = {};
  for (const [key, value] of query) if (!RESERVED.includes(key)) options[key] = value;
  const named = query.get('view') as ViewName | null;
  const yaw = number(query.get('yaw'));
  const pitch = number(query.get('pitch'));
  const distance = number(query.get('dist'));
  const hasFree = yaw !== null && pitch !== null && distance !== null && distance > 0;
  const view: ViewName = named && VIEW_NAMES.includes(named) && (named !== 'free' || hasFree) ? named : hasFree ? 'free' : 'home';
  const background = query.get('bg') as Background | null;
  const light = query.get('light') as Light | null;
  return {
    thing: query.get('thing') || firstThing,
    options,
    view,
    free: hasFree ? { yaw: yaw as number, pitch: pitch as number, distance: distance as number, aim: query.get('aim') === 'paddle' ? 'paddle' : 'centre' } : null,
    background: background && BACKGROUNDS.includes(background) ? background : 'paper',
    grid: query.get('grid') !== '0',
    light: light && LIGHTS.includes(light) ? light : 'day',
  };
}
