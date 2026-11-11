/**
 * Paper, made once at start and never again: the tooth of the sheet as a small
 * tiled image, and the torn edge of the lobby page as a clip outline. Both come
 * from a fixed seed, so they are the same on every load and never move.
 */

/** A repeatable random number source, 0 to 1. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** The tooth of the paper: a 256-pixel tile, as a `data:` address. */
export function paperTexture(): string {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const random = seededRandom(1234567);
  const image = context.createImageData(size, size);
  for (let pixel = 0; pixel < size * size; pixel += 1) {
    const noise = (random() + random() + random()) / 3;
    const value = noise > 0.5 ? 255 : 30;
    image.data[pixel * 4] = value;
    image.data[pixel * 4 + 1] = value - 8;
    image.data[pixel * 4 + 2] = value - 30;
    image.data[pixel * 4 + 3] = Math.abs(noise - 0.5) * 2 * 46;
  }
  context.putImageData(image, 0, 0);
  context.strokeStyle = 'rgba(90,70,40,0.07)';
  context.lineWidth = 0.6;
  for (let fibre = 0; fibre < 60; fibre += 1) {
    const x = random() * size;
    const y = random() * size;
    const angle = random() * Math.PI * 2;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(angle) * 9, y + Math.sin(angle) * 9);
    context.stroke();
  }
  return canvas.toDataURL('image/png');
}

/** The lobby page: a sheet down the left of the screen with a torn right edge, as a CSS `polygon()`. */
export function tornPageOutline(): string {
  const random = seededRandom(20261111);
  const steps = 46;
  const points: string[] = ['0% 0%'];
  let edge = 92;
  for (let step = 0; step <= steps; step += 1) {
    // A slow wander with small bites out of it, like paper torn against a ruler.
    edge = Math.max(84, Math.min(99, edge + (random() - 0.5) * 5));
    const bite = random() < 0.3 ? random() * 3 : 0;
    points.push(`${(edge - bite).toFixed(2)}% ${((step / steps) * 100).toFixed(2)}%`);
  }
  points.push('0% 100%');
  return `polygon(${points.join(', ')})`;
}
