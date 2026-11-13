/**
 * World-anchored marks, drawn by the view over the finished sheet: island
 * names (the route ahead), a pennant on every landing, a tick over loot that
 * is ready, and survivors' names. Each is a small hand-drawn tag that stays
 * the same size on screen and is pinned to a point in the world.
 *
 * They are drawn after the pen and the paper, so they never get an outline
 * and never crawl: a mark only moves when its anchor or the camera does.
 */
import * as THREE from 'three';
import { PAL } from './b2/palette.js';

const INK = PAL.ink;
const FONT = 'italic 600 34px "Iowan Old Style", Georgia, "Times New Roman", serif';

interface Mark {
  sprite: THREE.Sprite;
  /** Width over height of the drawing. */
  aspect: number;
}

function textureFrom(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function spriteFrom(canvas: HTMLCanvasElement): Mark {
  const material = new THREE.SpriteMaterial({ map: textureFrom(canvas), depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 10;
  sprite.visible = false;
  return { sprite, aspect: canvas.width / canvas.height };
}

/** A name on a slip of paper, with a brushed underline. */
function nameTag(text: string): Mark {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  let width = 160;
  if (context) {
    context.font = FONT;
    width = Math.ceil(context.measureText(text).width) + 36;
  }
  canvas.width = width;
  canvas.height = 60;
  if (context) {
    // The slip: paper with a pen line round it that does not quite close.
    context.fillStyle = 'rgba(243, 235, 217, 0.88)';
    context.beginPath();
    context.moveTo(8, 6);
    context.quadraticCurveTo(width / 2, 2, width - 7, 7);
    context.quadraticCurveTo(width - 3, 30, width - 8, 53);
    context.quadraticCurveTo(width / 2, 57, 7, 52);
    context.quadraticCurveTo(4, 28, 8, 6);
    context.fill();
    context.strokeStyle = INK;
    context.lineWidth = 1.6;
    context.stroke();
    context.font = FONT;
    context.fillStyle = INK;
    context.textBaseline = 'middle';
    context.fillText(text, 18, 28);
    context.strokeStyle = PAL.rust;
    context.lineWidth = 2.4;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(18, 47);
    context.quadraticCurveTo(width / 2, 44, width - 20, 48);
    context.stroke();
  }
  return spriteFrom(canvas);
}

/** Loot: an ochre tick, pen-outlined, pointing down at what can be gathered. */
function lootTick(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 56;
  const context = canvas.getContext('2d');
  if (context) {
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(24, 52);
    context.quadraticCurveTo(9, 30, 7, 9);
    context.quadraticCurveTo(24, 16, 41, 8);
    context.quadraticCurveTo(38, 31, 24, 52);
    context.fillStyle = PAL.ochre;
    context.fill();
    context.strokeStyle = INK;
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = 'rgba(252, 249, 240, 0.7)';
    context.beginPath();
    context.ellipse(19, 20, 4, 6, -0.3, 0, Math.PI * 2);
    context.fill();
  }
  return canvas;
}

/** A landing: a rust pennant on a pole standing in a stroke of water. */
function landingPennant(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 80;
  const context = canvas.getContext('2d');
  if (context) {
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = PAL.inkBlue;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(8, 72);
    context.quadraticCurveTo(20, 66, 32, 72);
    context.quadraticCurveTo(44, 78, 56, 71);
    context.stroke();
    context.strokeStyle = INK;
    context.lineWidth = 3.4;
    context.beginPath();
    context.moveTo(24, 72);
    context.quadraticCurveTo(22, 40, 24, 6);
    context.stroke();
    context.beginPath();
    context.moveTo(25, 8);
    context.quadraticCurveTo(42, 12, 58, 20);
    context.quadraticCurveTo(42, 27, 25, 34);
    context.closePath();
    context.fillStyle = PAL.rust;
    context.fill();
    context.lineWidth = 2.6;
    context.stroke();
  }
  return canvas;
}

export interface Anchor { x: number; y: number; z: number }

interface NamedAnchor extends Anchor { text: string }

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
/** 1 between `near` and `far`, fading to 0 over `soften` metres outside them. */
const band = (distance: number, near: number, far: number, soften: number): number =>
  clamp01((distance - near) / soften + 1) * clamp01((far - distance) / soften + 1);

/** Share of the view's height each mark takes. */
const NAME_HEIGHT = 0.034;
const SURVIVOR_HEIGHT = 0.03;
const LANDING_HEIGHT = 0.05;
const LOOT_HEIGHT = 0.032;
const LOOT_POOL = 28;

export class Marks {
  /** Drawn over the finished sheet by post.js. */
  readonly scene = new THREE.Scene();
  private readonly islands: { mark: Mark; anchor: Anchor }[] = [];
  private readonly survivors: { mark: Mark; anchor: Anchor }[] = [];
  private readonly landings: { mark: Mark; anchor: Anchor }[] = [];
  private readonly loot: Mark[] = [];

  constructor(islands: NamedAnchor[], landings: Anchor[], survivors: NamedAnchor[]) {
    const add = (mark: Mark): Mark => {
      this.scene.add(mark.sprite);
      return mark;
    };
    for (const island of islands) this.islands.push({ mark: add(nameTag(island.text)), anchor: island });
    for (const survivor of survivors) this.survivors.push({ mark: add(nameTag(survivor.text)), anchor: survivor });
    const pennant = landingPennant();
    for (const landing of landings) this.landings.push({ mark: add(spriteFrom(pennant)), anchor: landing });
    const tick = lootTick();
    for (let index = 0; index < LOOT_POOL; index += 1) this.loot.push(add(spriteFrom(tick)));
  }

  private place(mark: Mark, anchor: Anchor, height: number, opacity: number, unit: number): void {
    const sprite = mark.sprite;
    sprite.visible = opacity > 0.02;
    if (!sprite.visible) return;
    sprite.position.set(anchor.x, anchor.y, anchor.z);
    sprite.scale.set(height * unit * mark.aspect, height * unit, 1);
    sprite.material.opacity = opacity;
  }

  /**
   * Place every mark. `subject` is the player, `afloat` whether they are in
   * the canoe, `ready` the loot in reach of the eye, nearest first. `names` is false inland: the island
   * names are then not drawn (they are for the route ahead, aboard and at the water's edge).
   */
  update(camera: THREE.PerspectiveCamera, subject: Anchor, afloat: boolean, ready: readonly Anchor[], show: boolean, names = true): void {
    // A sprite that ignores distance is sized as if one metre away: this turns a share of the view's height into that size.
    const unit = 2 * Math.tan((camera.fov * Math.PI) / 360);
    const from = camera.position;
    const distanceTo = (anchor: Anchor, origin: Anchor): number => Math.hypot(anchor.x - origin.x, anchor.y - origin.y, anchor.z - origin.z);
    for (const { mark, anchor } of this.islands) {
      const distance = distanceTo(anchor, from);
      this.place(mark, anchor, NAME_HEIGHT * (1.1 - 0.35 * clamp01(distance / 1500)), show && names ? band(distance, 90, 1400, 40) : 0, unit);
    }
    for (const { mark, anchor } of this.landings) {
      const distance = distanceTo(anchor, subject);
      this.place(mark, anchor, LANDING_HEIGHT, show && afloat ? band(distance, 9, 420, 6) : 0, unit);
    }
    for (const { mark, anchor } of this.survivors) {
      this.place(mark, anchor, SURVIVOR_HEIGHT, show ? band(distanceTo(anchor, subject), 0, 40, 6) : 0, unit);
    }
    this.loot.forEach((mark, index) => {
      const anchor = ready[index];
      if (!anchor || !show) mark.sprite.visible = false;
      else this.place(mark, anchor, LOOT_HEIGHT, band(distanceTo(anchor, subject), 0, afloat ? 70 : 45, 8), unit);
    });
  }

  dispose(): void {
    const maps = new Set<THREE.Texture>();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Sprite)) return;
      if (object.material.map) maps.add(object.material.map);
      object.material.dispose();
    });
    for (const map of maps) map.dispose();
  }
}
