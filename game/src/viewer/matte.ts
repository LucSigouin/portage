/**
 * See-through pictures without touching the game's shaders. The same frame is drawn twice, once on black and once
 * on white. A pixel the thing covers fully is the same in both; a pixel it does not cover follows the background;
 * a soft edge lies between. So how far a pixel moves between the two says how much of it is background:
 * alpha = 1 - (white - black) / 255, and the colour is the black frame divided by that alpha.
 * Paper grain is turned off for both frames, because grain multiplies the background and the thing alike.
 */

/** Fill `out` (RGBA, straight alpha) from a frame on black and the same frame on white. All three arrays are the same length. */
export function matte(onBlack: Uint8ClampedArray, onWhite: Uint8ClampedArray, out: Uint8ClampedArray): void {
  for (let at = 0; at < onBlack.length; at += 4) {
    const spread = (onWhite[at] - onBlack[at] + (onWhite[at + 1] - onBlack[at + 1]) + (onWhite[at + 2] - onBlack[at + 2])) / (3 * 255);
    const alpha = Math.min(1, Math.max(0, 1 - spread));
    if (alpha < 0.004) {
      out[at] = 0;
      out[at + 1] = 0;
      out[at + 2] = 0;
      out[at + 3] = 0;
      continue;
    }
    out[at] = onBlack[at] / alpha;
    out[at + 1] = onBlack[at + 1] / alpha;
    out[at + 2] = onBlack[at + 2] / alpha;
    out[at + 3] = Math.round(alpha * 255);
  }
}
