/**
 * The lobby's canoe preview as markup: a frame for the picture and one line under it, beside the menu. And a
 * lobby with no preview is the lobby as it always was.
 */
import { describe, expect, it } from 'vitest';
import { previewModel, starterSubject } from '../../src/client/preview.ts';
import { buildLobbyModel } from '../../src/client/viewmodels/index.ts';
import { collectIntents, collectText } from '../../src/interface/dom.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import { previewView } from '../../src/interface/preview.ts';
import { lobbyView } from '../../src/interface/views.ts';

const find = (nodes: ViewNode[], classes: string): ViewNode[] =>
  nodes.flatMap((node) => [...(node.classes.split(' ').includes(classes) ? [node] : []), ...find(node.children, classes)]);

describe('the lobby view', () => {
  const preview = { kind: 'save' as const, caption: 'Ribbed canoe, day 3, 50 min played', label: 'Your canoe in slot 1: Ribbed canoe, day 3, 50 min played' };

  it('with a preview: one frame for the picture and one line under it, after the menu, in the lobby column', () => {
    const [column] = lobbyView({ ...buildLobbyModel([], null), preview });
    const figures = find([column], 'pv');
    expect(figures).toHaveLength(1);
    expect(column.children.at(-1)).toBe(figures[0]);
    expect(column.children.at(-2)!.classes).toContain('iw-menu');
    const [figure] = figures;
    expect(figure.tag).toBe('figure');
    expect(figure.key).toBe('preview');
    expect(figure.classes).toContain('pv-save');
    // The frame: empty in the view (the picture is laid in it on the page), named for a reader who cannot see it.
    const [sketch] = find([figure], 'pv-sketch');
    expect(sketch.children).toEqual([]);
    expect(sketch.html).toBeNull();
    expect(sketch.attributes).toMatchObject({ role: 'img', 'aria-label': preview.label });
    // One line, and it is the model's.
    const captions = find([figure], 'pv-caption');
    expect(captions).toHaveLength(1);
    expect(collectText(captions)).toBe('Ribbed canoe, day 3, 50 min played');
    // Nothing in it can be pressed.
    expect(collectIntents([figure])).toEqual([]);
  });

  it('the starter canoe says "Your canoe awaits"', () => {
    const figure = previewView(previewModel(starterSubject()));
    expect(figure.classes).toContain('pv-starter');
    expect(collectText([figure])).toBe('Your canoe awaits');
  });

  it('with no preview (a broken save, a picture that could not be drawn): the lobby as it always was', () => {
    const plain = buildLobbyModel([], null);
    for (const lobby of [plain, { ...plain, preview: null }, { ...plain, preview: undefined }]) {
      const [column] = lobbyView(lobby);
      expect(find([column], 'pv')).toEqual([]);
      expect(column.children.map((child) => child.classes)).toEqual(['iw-logo-row', 'iw-tagline', 'iw-menu']);
    }
    // The preview adds nothing to the menu and takes nothing from it.
    const texts = (lobby: Parameters<typeof lobbyView>[0]): string => collectText(find(lobbyView(lobby), 'iw-menu'));
    expect(texts({ ...plain, preview })).toBe(texts(plain));
    expect(collectIntents(lobbyView({ ...plain, preview }))).toEqual(collectIntents(lobbyView(plain)));
  });
});
