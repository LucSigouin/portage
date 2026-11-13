/**
 * The lobby's canoe preview, as markup: a frame the picture is laid in and one line under it.
 * Pure, like every view. The picture itself is not in the model: `preview-host.ts` draws it once and lays its
 * canvas in the frame.
 */
import type { LobbyPreviewModel } from '../client/preview.ts';
import { h } from './dom.ts';
import type { ViewNode } from './dom.ts';

export function previewView(preview: LobbyPreviewModel): ViewNode {
  return h('figure.pv', { key: 'preview', class: `pv-${preview.kind}` },
    h('div.pv-sketch', { key: 'sketch', role: 'img', 'aria-label': preview.label }),
    h('figcaption.pv-caption', null, preview.caption));
}
