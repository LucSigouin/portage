/**
 * Save a flat icon as a see-through PNG. The icon is drawn by the page's own style sheet, so a copy of it
 * outside the page would lose its pen and its washes. This copies each element's computed look onto the
 * element itself, then draws the result.
 */

const PROPERTIES = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity'];

function inlineLook(from: Element, to: Element): void {
  const computed = getComputedStyle(from);
  const target = to as SVGElement;
  for (const property of PROPERTIES) target.style.setProperty(property, computed.getPropertyValue(property));
  const children = from.children;
  for (let at = 0; at < children.length; at += 1) inlineLook(children[at], to.children[at]);
}

/** The icon on a transparent square, `size` pixels a side. */
export async function rasterizeIcon(svg: SVGSVGElement, size: number): Promise<Blob | null> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  inlineLook(svg, copy);
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(size));
  copy.setAttribute('height', String(size));
  copy.removeAttribute('class');
  copy.style.overflow = 'visible';
  const markup = new XMLSerializer().serializeToString(copy);
  const source = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The icon could not be drawn to a picture.'));
      image.src = source;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    (canvas.getContext('2d') as CanvasRenderingContext2D).drawImage(image, 0, 0, size, size);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    URL.revokeObjectURL(source);
  }
}
