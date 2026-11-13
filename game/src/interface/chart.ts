/**
 * The valley's round chart, painted on a canvas: the map panel's (M) and the minimap's (top right).
 *
 * Ink & Wash, like the cards it sits on: the water a thin wash that deepens off the shore, the land a sage wash
 * going to stone up the valley walls, every shore in ink, two faint depth lines under the water like an old
 * chart's soundings, the borders between the waters dashed. What the crew has not seen stays paper, unmarked:
 * the chart is masked by the crew's fog, softened over half a fog cell at its edge.
 *
 * It is painted only when asked: the map when it opens, changes size or the crew sees more; the minimap when its
 * player moves a whole pixel or turns a whole degree, or a mark on it does. Nothing here runs on a clock, and
 * the minimap's chart slides in whole pixels, so its lines never shimmer as it moves.
 */
import './pings.css';
import type { ChartGeometry, ChartModel, ChartPingModel, InterfaceIntent, MinimapMarkModel, MinimapModel } from '../client/contracts.ts';

// The theme's tokens (theme.css), for a canvas that cannot read them by name.
const INK = '#2a2b33';
const PAPER = '#f3ebd9';
const RUST = '#b5553a';
/** Water: pale over the shallows, the theme's water over the deep. */
const WATER_PALE: Rgb = [178, 199, 203];
const WATER_DEEP: Rgb = [127, 158, 171];
/** Land: sage on the islands and the low shore, warm stone up the valley walls. */
const LAND_LOW: Rgb = [147, 168, 138];
const LAND_HIGH: Rgb = [181, 168, 138];

type Rgb = [number, number, number];

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const share = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return share * share * (3 - 2 * share);
};
const mix = (first: Rgb, second: Rgb, share: number): Rgb =>
  [first[0] + (second[0] - first[0]) * share, first[1] + (second[1] - first[1]) * share, first[2] + (second[2] - first[2]) * share];

/** Pixels a fog cell spans in the mask. Smooth enough to draw the edge as a soft line, small enough to make at once. */
export const FOG_MASK_SCALE = 4;

/** Weights of the blur that rounds the fog's steps: a binomial row, about one cell either way. */
const BLUR = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];

/** The cells, blurred across and down by `BLUR`. Off the grid counts as fog. */
function blurredCells(seen: Uint8Array, columns: number, rows: number): Float32Array {
  const across = new Float32Array(columns * rows);
  const reach = (BLUR.length - 1) / 2;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let sum = 0;
      for (let tap = -reach; tap <= reach; tap += 1) {
        const at = column + tap;
        if (at >= 0 && at < columns) sum += BLUR[tap + reach]! * seen[row * columns + at]!;
      }
      across[row * columns + column] = sum;
    }
  }
  const both = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let sum = 0;
      for (let tap = -reach; tap <= reach; tap += 1) {
        const at = row + tap;
        if (at >= 0 && at < rows) sum += BLUR[tap + reach]! * across[at * columns + column]!;
      }
      both[row * columns + column] = sum;
    }
  }
  return both;
}

/**
 * The fog as an alpha mask, `FOG_MASK_SCALE` pixels a cell: 255 over what the crew has seen, 0 over the rest, and
 * a soft edge between. The cells are blurred by about a cell, blended between their middles and eased about the
 * half-way line, so the edge follows the seen ground with its steps rounded off. Row by row from the north-west,
 * like the cells.
 */
export function fogMaskAlpha(seen: Uint8Array, columns: number, rows: number, scale = FOG_MASK_SCALE): Uint8ClampedArray {
  const width = columns * scale;
  const height = rows * scale;
  const alpha = new Uint8ClampedArray(width * height);
  const blurred = blurredCells(seen, columns, rows);
  const cell = (column: number, row: number): number =>
    (column < 0 || row < 0 || column >= columns || row >= rows ? 0 : blurred[row * columns + column]!);
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / scale - 0.5;
    const row = Math.floor(v);
    const down = v - row;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / scale - 0.5;
      const column = Math.floor(u);
      const across = u - column;
      const top = cell(column, row) * (1 - across) + cell(column + 1, row) * across;
      const bottom = cell(column, row + 1) * (1 - across) + cell(column + 1, row + 1) * across;
      alpha[y * width + x] = Math.round(255 * smoothstep(0.32, 0.68, top * (1 - down) + bottom * down));
    }
  }
  return alpha;
}

/** The colour and strength of the wash over one sample of ground. */
export function washAt(height: number): [number, number, number, number] {
  if (height < 0) {
    const depth = smoothstep(0, 6, -height);
    const [red, green, blue] = mix(WATER_PALE, WATER_DEEP, depth);
    return [red, green, blue, 0.42 + 0.3 * depth];
  }
  const [red, green, blue] = mix(LAND_LOW, LAND_HIGH, smoothstep(6, 40, height));
  return [red, green, blue, 0.82];
}

// --- What is made once and kept --------------------------------------------------------

const washes = new WeakMap<ChartGeometry, HTMLCanvasElement>();
const lines = new WeakMap<ChartGeometry, { shore: Path2D; depths: Path2D; regions: Path2D }>();
const masks = new WeakMap<Uint8Array, HTMLCanvasElement>();

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The washes of the whole chart, one pixel a sample. Drawn stretched: a wash is soft anyway, the ink is not. */
function washOf(geometry: ChartGeometry): HTMLCanvasElement {
  let canvas = washes.get(geometry);
  if (canvas) return canvas;
  canvas = canvasOf(geometry.samples, geometry.samples);
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(geometry.samples, geometry.samples);
  for (let index = 0; index < geometry.heights.length; index += 1) {
    const [red, green, blue, strength] = washAt(geometry.heights[index]!);
    image.data[index * 4] = red;
    image.data[index * 4 + 1] = green;
    image.data[index * 4 + 2] = blue;
    image.data[index * 4 + 3] = Math.round(strength * 255);
  }
  context.putImageData(image, 0, 0);
  washes.set(geometry, canvas);
  return canvas;
}

function pathOf(segments: Float32Array): Path2D {
  const path = new Path2D();
  for (let index = 0; index + 3 < segments.length; index += 4) {
    path.moveTo(segments[index]!, segments[index + 1]!);
    path.lineTo(segments[index + 2]!, segments[index + 3]!);
  }
  return path;
}

/** The chart's ink, in world metres: drawn under a transform, so it is sharp at any size. */
function linesOf(geometry: ChartGeometry): { shore: Path2D; depths: Path2D; regions: Path2D } {
  let found = lines.get(geometry);
  if (found) return found;
  const regions = new Path2D();
  for (const edge of geometry.regionEdges) {
    regions.moveTo(edge.minimumX, edge.z);
    regions.lineTo(edge.maximumX, edge.z);
  }
  found = { shore: pathOf(geometry.shore), depths: pathOf(geometry.depths), regions };
  lines.set(geometry, found);
  return found;
}

/** The fog mask for one record of the crew's chart. A new record is a new array: its mask is made once. */
function maskOf(geometry: ChartGeometry, seen: Uint8Array): HTMLCanvasElement {
  let canvas = masks.get(seen);
  if (canvas) return canvas;
  const { columns, rows } = geometry.fog;
  const alpha = fogMaskAlpha(seen, columns, rows);
  canvas = canvasOf(columns * FOG_MASK_SCALE, rows * FOG_MASK_SCALE);
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(canvas.width, canvas.height);
  for (let index = 0; index < alpha.length; index += 1) {
    image.data[index * 4 + 3] = alpha[index]!;
  }
  context.putImageData(image, 0, 0);
  masks.set(seen, canvas);
  return canvas;
}

// --- Painting -----------------------------------------------------------------------------

/** What part of the world a canvas shows: the world point at its middle, and its pixels per metre. */
export interface ChartView {
  middleX: number;
  middleZ: number;
  pixelsPerMetre: number;
  /** Device pixels to one CSS pixel: the pens are this much wider. */
  pixelRatio: number;
}

/** The world point to a canvas pixel. */
export function toCanvas(view: ChartView, size: number, x: number, z: number): [number, number] {
  return [size / 2 + (x - view.middleX) * view.pixelsPerMetre, size / 2 + (z - view.middleZ) * view.pixelsPerMetre];
}

/**
 * Paint the chart on a square canvas of `size` pixels, clipped to the circle in it. The canvas is left clear
 * where the fog lies, so the paper of the card under it shows.
 */
export function paintChart(context: CanvasRenderingContext2D, size: number, chart: ChartModel, view: ChartView): void {
  const { geometry } = chart;
  const scale = view.pixelsPerMetre;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.clearRect(0, 0, size, size);
  context.save();
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  context.clip();

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const [washX, washY] = toCanvas(view, size, geometry.minimumX - geometry.sampleMetres / 2, geometry.minimumZ - geometry.sampleMetres / 2);
  const washSide = geometry.samples * geometry.sampleMetres * scale;
  context.drawImage(washOf(geometry), washX, washY, washSide, washSide);

  // The ink, in world metres.
  const { shore, depths, regions } = linesOf(geometry);
  context.setTransform(scale, 0, 0, scale, size / 2 - view.middleX * scale, size / 2 - view.middleZ * scale);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = 'rgba(70, 104, 118, 0.45)';
  context.lineWidth = (0.7 * view.pixelRatio) / scale;
  context.stroke(depths);
  context.strokeStyle = 'rgba(42, 43, 51, 0.5)';
  context.lineWidth = (0.9 * view.pixelRatio) / scale;
  context.setLineDash([(5 * view.pixelRatio) / scale, (4 * view.pixelRatio) / scale]);
  context.stroke(regions);
  context.setLineDash([]);
  context.strokeStyle = INK;
  context.lineWidth = (1.25 * view.pixelRatio) / scale;
  context.stroke(shore);

  // The fog: keep what the crew has seen, and nothing else.
  if (!chart.fullChart) {
    const fog = geometry.fog;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'destination-in';
    const [maskX, maskY] = toCanvas(view, size, fog.minimumX, fog.minimumZ);
    context.drawImage(maskOf(geometry, chart.seen), maskX, maskY, fog.columns * fog.cellMetres * scale, fog.rows * fog.cellMetres * scale);
    context.globalCompositeOperation = 'source-over';
  }
  context.restore();
  context.setTransform(1, 0, 0, 1, 0, 0);
}

// --- The minimap ----------------------------------------------------------------------------

/** Pixels between the rim and a mark pinned to it. */
const RIM_INSET = 9;

/**
 * Where a mark goes on the minimap, in canvas pixels. A mark past the rim is pinned to it, at its bearing from
 * the middle, so it still says which way.
 */
export function minimapPlace(view: ChartView, size: number, x: number, z: number): { x: number; y: number; pinned: boolean } {
  const [px, py] = toCanvas(view, size, x, z);
  const middle = size / 2;
  const reach = middle - RIM_INSET * view.pixelRatio;
  const distance = Math.hypot(px - middle, py - middle);
  if (distance <= reach) return { x: Math.round(px), y: Math.round(py), pinned: false };
  return {
    x: Math.round(middle + ((px - middle) / distance) * reach),
    y: Math.round(middle + ((py - middle) / distance) * reach),
    pinned: true,
  };
}

/**
 * The minimap's view of the world: its player at the middle, snapped to a whole pixel so the chart under them
 * slides in whole pixels.
 */
export function minimapView(model: MinimapModel, size: number, pixelRatio: number): ChartView {
  const pixelsPerMetre = size / 2 / model.radiusMetres;
  return {
    middleX: Math.round(model.x * pixelsPerMetre) / pixelsPerMetre,
    middleZ: Math.round(model.z * pixelsPerMetre) / pixelsPerMetre,
    pixelsPerMetre,
    pixelRatio,
  };
}

/**
 * Everything the minimap's picture depends on, as one string: when it is the same, the picture is the same, and
 * nothing is drawn. Whole pixels and whole degrees only, so standing still, or drifting under a pixel, draws nothing.
 */
export function minimapKey(model: MinimapModel, size: number, pixelRatio: number, pings: readonly ChartPingModel[] = []): string {
  const view = minimapView(model, size, pixelRatio);
  let key = `${size}|${pixelRatio}|${Math.round(view.middleX * view.pixelsPerMetre)}|${Math.round(view.middleZ * view.pixelsPerMetre)}|${model.headingDegrees}`;
  for (const mark of model.marks) {
    const place = minimapPlace(view, size, mark.x, mark.z);
    key += `|${mark.kind}${mark.color}@${place.x},${place.y}`;
  }
  for (const ping of pings) {
    const place = minimapPlace(view, size, ping.x, ping.z);
    key += `|ping${ping.color}@${place.x},${place.y}`;
  }
  return key;
}

// --- Pings ------------------------------------------------------------------------------------

/**
 * A ping's mark: a glint, a four-pointed star taller than it is wide, in its player's colour with an ink line
 * round it. Half its height, half its width and its waist, in CSS pixels.
 */
export const PING_MARK = { tall: 10.5, wide: 6, waist: 2.1 } as const;

/** A click this near a ping's mark, in CSS pixels, is a click on the mark: it takes the ping down. */
export const PING_GRAB = 12;

function pingPath(context: CanvasRenderingContext2D, x: number, y: number, unit: number): void {
  const tall = PING_MARK.tall * unit;
  const wide = PING_MARK.wide * unit;
  const waist = PING_MARK.waist * unit;
  context.beginPath();
  context.moveTo(x, y - tall);
  context.lineTo(x + waist, y - waist);
  context.lineTo(x + wide, y);
  context.lineTo(x + waist, y + waist);
  context.lineTo(x, y + tall);
  context.lineTo(x - waist, y + waist);
  context.lineTo(x - wide, y);
  context.lineTo(x - waist, y - waist);
  context.closePath();
}

/** Draw a ping's mark at each place, in canvas pixels. `unit` is device pixels to a CSS pixel. */
export function paintPingMarks(context: CanvasRenderingContext2D, places: readonly { x: number; y: number; color: string }[], unit: number): void {
  context.lineJoin = 'round';
  for (const place of places) {
    pingPath(context, place.x, place.y, unit);
    context.fillStyle = place.color || PAPER;
    context.fill();
    context.strokeStyle = INK;
    context.lineWidth = 1.3 * unit;
    context.stroke();
    // An ink dot on the spot itself.
    context.beginPath();
    context.arc(place.x, place.y, 1.1 * unit, 0, Math.PI * 2);
    context.fillStyle = INK;
    context.fill();
  }
}

/** The map panel's view of the world: the whole chart, its middle at the canvas's. */
export function mapChartView(geometry: ChartGeometry, size: number, pixelRatio: number): ChartView {
  return {
    middleX: geometry.minimumX + geometry.sideMetres / 2,
    middleZ: geometry.minimumZ + geometry.sideMetres / 2,
    pixelsPerMetre: size / geometry.sideMetres,
    pixelRatio,
  };
}

/**
 * What a click on the map panel's chart asks for. `x`, `y` are from the chart's top left corner and `size` is its
 * side, all in the same pixels; `grab` is how near a mark counts as on it.
 * - Off the round chart: nothing.
 * - On a ping's mark (the nearest, when two are close): take that ping down.
 * - Anywhere else: mark that very spot, to the metre. Islands and landmarks pull nothing toward them, and the fog
 *   hides nothing from a click.
 */
export function chartClick(
  geometry: ChartGeometry, pings: readonly ChartPingModel[], size: number, x: number, y: number, grab = PING_GRAB,
): InterfaceIntent | null {
  if (!(size > 0) || Math.hypot(x - size / 2, y - size / 2) > size / 2) return null;
  const view = mapChartView(geometry, size, 1);
  let nearest: ChartPingModel | null = null;
  let nearestDistance = grab;
  for (const ping of pings) {
    const [px, py] = toCanvas(view, size, ping.x, ping.z);
    const distance = Math.hypot(px - x, py - y);
    if (distance <= nearestDistance) {
      nearest = ping;
      nearestDistance = distance;
    }
  }
  if (nearest) return { type: 'command', command: { type: 'clear_ping', playerId: nearest.playerId } };
  return {
    type: 'command',
    command: {
      type: 'ping',
      x: Math.round(view.middleX + (x - size / 2) / view.pixelsPerMetre),
      z: Math.round(view.middleZ + (y - size / 2) / view.pixelsPerMetre),
    },
  };
}

function markPath(context: CanvasRenderingContext2D, mark: MinimapMarkModel, x: number, y: number, unit: number): void {
  context.beginPath();
  if (mark.kind === 'crew') {
    context.arc(x, y, 3.6 * unit, 0, Math.PI * 2);
  } else if (mark.kind === 'canoe') {
    // A hull seen from above, bow north.
    context.moveTo(x, y - 6 * unit);
    context.quadraticCurveTo(x + 3 * unit, y, x, y + 6 * unit);
    context.quadraticCurveTo(x - 3 * unit, y, x, y - 6 * unit);
  } else {
    // A flag on its pole, the pole's foot on the place.
    context.moveTo(x, y);
    context.lineTo(x, y - 11 * unit);
    context.lineTo(x + 7 * unit, y - 8.5 * unit);
    context.lineTo(x, y - 6 * unit);
  }
}

/** Paint the whole minimap: the chart round its player, the marks, and the player's arrow at the middle. */
export function paintMinimap(context: CanvasRenderingContext2D, size: number, chart: ChartModel, model: MinimapModel, pixelRatio: number): void {
  const view = minimapView(model, size, pixelRatio);
  paintChart(context, size, chart, view);
  const unit = pixelRatio;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  // The canoe first, then the quests, then the crew on top: a crewmate is never hidden.
  for (const kind of ['canoe', 'quest', 'crew'] as const) {
    for (const mark of model.marks) {
      if (mark.kind !== kind) continue;
      const place = minimapPlace(view, size, mark.x, mark.z);
      markPath(context, mark, place.x, place.y, unit);
      context.fillStyle = mark.kind === 'crew' ? mark.color || PAPER : RUST;
      context.fill();
      context.strokeStyle = INK;
      context.lineWidth = 1.2 * unit;
      context.stroke();
    }
  }
  // The crew's pings, each where it is, or on the rim at its bearing when it is past it.
  paintPingMarks(context, chart.pings.map((ping) => ({ ...minimapPlace(view, size, ping.x, ping.z), color: ping.color })), unit);
  // The player: an arrow at the middle, pointing the way they face. North is always up.
  const middle = size / 2;
  context.save();
  context.translate(middle, middle);
  context.rotate((model.headingDegrees * Math.PI) / 180);
  context.beginPath();
  context.moveTo(0, -7.5 * unit);
  context.lineTo(5 * unit, 5.5 * unit);
  context.lineTo(0, 3 * unit);
  context.lineTo(-5 * unit, 5.5 * unit);
  context.closePath();
  context.fillStyle = RUST;
  context.fill();
  context.strokeStyle = INK;
  context.lineWidth = 1.3 * unit;
  context.stroke();
  context.restore();
}

/**
 * The minimap card: a round paper card in the top-right corner holding the canvas, with N written at the top.
 * `update` paints only when the picture would change (`minimapKey`) or the chart's record of the fog did.
 */
export class MinimapCard {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly observer: ResizeObserver | null = null;
  private size = 0;
  private pixelRatio = 1;
  private key = '';
  private seen: Uint8Array | null = null;
  private fullChart: boolean | null = null;
  private model: MinimapModel | null = null;
  private chart: ChartModel | null = null;

  // (A click on the minimap does nothing: it is too small to aim a ping with. The map panel takes the clicks.)
  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'iw-minimap iw-paper';
    this.element.setAttribute('role', 'img');
    this.element.setAttribute('aria-label', 'Minimap, north up');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'iw-minimap-chart';
    const north = document.createElement('b');
    north.className = 'iw-minimap-north';
    north.textContent = 'N';
    this.element.append(this.canvas, north);
    parent.appendChild(this.element);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.measure());
      this.observer.observe(this.canvas);
    }
  }

  /** Read the canvas's size from the page, after it changed: never on a frame of its own. */
  private measure(): void {
    const pixelRatio = window.devicePixelRatio || 1;
    const size = Math.round(this.canvas.clientWidth * pixelRatio);
    if (size === this.size && pixelRatio === this.pixelRatio) return;
    this.size = size;
    this.pixelRatio = pixelRatio;
    this.canvas.width = size;
    this.canvas.height = size;
    this.key = '';
    if (this.model && this.chart) this.update(this.model, this.chart);
  }

  update(model: MinimapModel, chart: ChartModel): void {
    this.model = model;
    this.chart = chart;
    if (this.size === 0) return;
    const key = minimapKey(model, this.size, this.pixelRatio, chart.pings);
    if (key === this.key && chart.seen === this.seen && chart.fullChart === this.fullChart) return;
    this.key = key;
    this.seen = chart.seen;
    this.fullChart = chart.fullChart;
    const context = this.canvas.getContext('2d');
    if (context) paintMinimap(context, this.size, chart, model, this.pixelRatio);
  }

  dispose(): void {
    this.observer?.disconnect();
    this.element.remove();
  }
}

/**
 * The map panel's chart: the canvas the panel's view puts under its names and marks. It is painted when a new
 * one appears (the map opened), when it changes size, and when the crew's fog, the map table or a ping changes.
 *
 * A click on the chart marks that spot for the crew, or takes down the ping whose mark was clicked (`chartClick`).
 */
export class MapChart {
  private canvas: HTMLCanvasElement | null = null;
  private observer: ResizeObserver | null = null;
  private size = 0;
  private pixelRatio = 1;
  private seen: Uint8Array | null = null;
  private fullChart: boolean | null = null;
  private pings: readonly ChartPingModel[] | null = null;
  private chart: ChartModel | null = null;
  /** The round card the canvas lies on: the clicks are heard there, so one on a name or a mark over the chart counts too. */
  private card: HTMLElement | null = null;
  private emit: (intent: InterfaceIntent) => void = () => {};
  private readonly onClick = (event: MouseEvent): void => {
    const { canvas, chart } = this;
    if (!canvas || !chart || event.button !== 0) return;
    const box = canvas.getBoundingClientRect();
    const intent = chartClick(chart.geometry, chart.pings, box.width, event.clientX - box.left, event.clientY - box.top);
    if (intent) this.emit(intent);
  };

  /** Where the chart's clicks go: the interface's own way of sending an intent to the game. */
  listen(emit: (intent: InterfaceIntent) => void): void {
    this.emit = emit;
  }

  /** Call after the panel is drawn, with the panel's element (or null when the map is not open). */
  follow(holder: HTMLElement | null, chart: ChartModel | null): void {
    const canvas = holder?.querySelector<HTMLCanvasElement>('canvas.iw-chart-canvas') ?? null;
    this.chart = chart;
    if (canvas !== this.canvas) {
      this.observer?.disconnect();
      this.observer = null;
      this.card?.removeEventListener('click', this.onClick);
      this.card = canvas?.parentElement ?? null;
      this.card?.addEventListener('click', this.onClick);
      this.card?.setAttribute('title', 'Click to mark a spot for the crew. Click a mark to take it down.');
      this.canvas = canvas;
      this.size = 0;
      this.seen = null;
      if (canvas && typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(() => this.measure());
        this.observer.observe(canvas);
      }
    }
    this.paint();
  }

  private measure(): void {
    if (!this.canvas) return;
    const pixelRatio = window.devicePixelRatio || 1;
    const size = Math.round(this.canvas.clientWidth * pixelRatio);
    if (size === this.size && pixelRatio === this.pixelRatio) return;
    this.size = size;
    this.pixelRatio = pixelRatio;
    this.canvas.width = size;
    this.canvas.height = size;
    this.seen = null;
    this.paint();
  }

  private paint(): void {
    const { canvas, chart } = this;
    if (!canvas || !chart || this.size === 0) return;
    if (chart.seen === this.seen && chart.fullChart === this.fullChart && chart.pings === this.pings) return;
    this.seen = chart.seen;
    this.fullChart = chart.fullChart;
    this.pings = chart.pings;
    const context = canvas.getContext('2d');
    if (!context) return;
    const view = mapChartView(chart.geometry, this.size, this.pixelRatio);
    paintChart(context, this.size, chart, view);
    // The pings last, over the fog: a spot nobody has seen can be marked, and its mark shows.
    paintPingMarks(context, chart.pings.map((ping) => {
      const [x, y] = toCanvas(view, this.size, ping.x, ping.z);
      return { x: Math.round(x), y: Math.round(y), color: ping.color };
    }), this.pixelRatio);
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.card?.removeEventListener('click', this.onClick);
    this.card = null;
    this.canvas = null;
  }
}
