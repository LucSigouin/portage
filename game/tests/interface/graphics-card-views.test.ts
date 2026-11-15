/**
 * The graphics card note as the interface draws it, without a DOM: the same slip on the main menu and on the join
 * card, every word of it, no button on it, nothing when there is no note, and nothing in its styles that moves.
 */
import { describe, expect, it } from 'vitest';
import type { GameInterface, InterfaceModel } from '../../src/client/contracts.ts';
import type { CrewView } from '../../src/client/crewlobby.ts';
import { buildCrewJoinPanel, buildLobbyModel } from '../../src/client/viewmodels/index.ts';
import type { PanelModel } from '../../src/client/viewmodels/index.ts';
import { buildGraphicsCardNote } from '../../src/client/viewmodels/graphicscard.ts';
import type { GraphicsCardFacts } from '../../src/client/viewmodels/graphicscard.ts';
import { collectIntents, collectText } from '../../src/interface/dom.ts';
import type { ViewNode } from '../../src/interface/dom.ts';
import { graphicsCardNoteView, withGraphicsCardWarning } from '../../src/interface/graphics-card.ts';
import { lobbyView, panelView } from '../../src/interface/views.ts';

// The project has no Node type definitions, so the file reader is loaded by name at run time.
const fileSystemModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fileSystemModule) as { readFileSync: (path: URL, encoding: 'utf8') => string };

const facts = (change: Partial<GraphicsCardFacts> = {}): GraphicsCardFacts => ({
  rendererName: 'Google SwiftShader', userAgent: 'Mozilla/5.0 Chrome/142.0.0.0 Safari/537.36', forced: null, staged: false, driven: false, ...change,
});
const note = buildGraphicsCardNote(facts())!;
const crew: CrewView = {
  name: 'Luc', code: '', inGame: false,
  host: { phase: 'idle', code: '', link: '', guests: 0, failure: null, copied: false },
  join: { phase: 'idle', problem: null, leave: null, hostHere: true },
};
const frame = { title: 'Join a crew', close: { label: 'Close', intent: { type: 'close_panel' as const }, enabled: true, note: null } };
const joinCard = (graphicsCard: typeof note | null): ViewNode[] => panelView({ ...frame, ...buildCrewJoinPanel(crew), graphicsCard } as PanelModel);
const menu = (graphicsCard: typeof note | null): ViewNode[] => lobbyView({ ...buildLobbyModel([], null, crew), graphicsCard });

function find(nodes: ViewNode[], test: (node: ViewNode) => boolean, into: ViewNode[] = []): ViewNode[] {
  for (const node of nodes) {
    if (test(node)) into.push(node);
    find(node.children, test, into);
  }
  return into;
}
const slips = (nodes: ViewNode[]): ViewNode[] => find(nodes, (node) => node.classes.split(' ').includes('iw-card-note'));

describe('the graphics card note on the page', () => {
  it('is one slip with every word of the note, and no button', () => {
    const slip = graphicsCardNoteView(note)!;
    expect(slip.tag).toBe('aside');
    expect(slip.attributes).toMatchObject({ role: 'note' });
    const text = collectText([slip]);
    for (const words of [note.title, ...note.lines]) expect(text).toContain(words);
    expect(collectIntents([slip])).toEqual([]);
    expect(find([slip], (node) => node.tag === 'button' || node.tag === 'a')).toEqual([]);
    expect(graphicsCardNoteView(null)).toBeNull();
    expect(graphicsCardNoteView(undefined)).toBeNull();
  });

  it('stands on the main menu beside the column, not in it, so it pushes no entry', () => {
    const nodes = menu(note);
    expect(slips(nodes)).toHaveLength(1);
    expect(nodes.map((node) => node.classes)).toEqual(['iw-lobby-col', 'iw-card-note']);
    expect(collectText(nodes)).toContain(note.title);
    // The menu's own entries are as they were.
    expect(collectIntents(nodes)).toEqual(collectIntents(menu(null)));
  });

  it('lies in the join card, above its buttons', () => {
    const nodes = joinCard(note);
    expect(slips(nodes)).toHaveLength(1);
    const body = find(nodes, (node) => node.classes.split(' ').includes('iw-body'))[0]!;
    expect(slips([body])).toHaveLength(1);
    expect(collectText(nodes)).toContain(note.lines.at(-1)!);
    expect(collectIntents(nodes)).toEqual(collectIntents(joinCard(null)));
  });

  it('is on neither when there is no note: the screens are as they were', () => {
    expect(slips(menu(null))).toEqual([]);
    expect(slips(joinCard(null))).toEqual([]);
    expect(menu(null).map((node) => node.classes)).toEqual(['iw-lobby-col']);
    expect(lobbyView(buildLobbyModel([], null, crew)).map((node) => node.classes)).toEqual(['iw-lobby-col']);
  });
});

describe('the interface, wrapped', () => {
  const lobbyFrame = (): InterfaceModel => ({ screen: 'lobby', lobby: buildLobbyModel([], null, crew), panel: null }) as unknown as InterfaceModel;
  function wrapped(read: () => GraphicsCardFacts): { seen: InterfaceModel[]; update(model: InterfaceModel): void } {
    const seen: InterfaceModel[] = [];
    const inner: GameInterface = { mount: () => undefined, update: (model) => void seen.push(model), dispose: () => undefined };
    const hosted = withGraphicsCardWarning(inner, read);
    return { seen, update: (model) => hosted.update(model) };
  }

  it('asks who draws once, at the first frame, and adds the note to every frame of the menu', () => {
    let asks = 0;
    const page = wrapped(() => { asks += 1; return facts(); });
    expect(asks).toBe(0);
    page.update(lobbyFrame());
    page.update(lobbyFrame());
    expect(asks).toBe(1);
    expect(page.seen.map((model) => model.lobby!.graphicsCard?.title)).toEqual([note.title, note.title]);
  });

  it('hands every frame on untouched on a real card', () => {
    const page = wrapped(() => facts({ rendererName: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)' }));
    const given = lobbyFrame();
    page.update(given);
    expect(page.seen[0]).toBe(given);
  });
});

describe('the note\'s styles', () => {
  const css = readFileSync(new URL('../../src/interface/graphics-card.css', import.meta.url), 'utf8');
  it('never move: no animation, no transition, no transform', () => {
    expect(css).not.toMatch(/animation|transition|transform|@keyframes|opacity/);
  });
  it('are in the game\'s own colours and faces, with no colour of their own', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
    for (const token of ['--iw-paper-bright', '--iw-ink', '--iw-rust-deep', '--iw-serif', '--iw-hand']) expect(css).toContain(`var(${token})`);
  });
  it('pin the menu\'s note clear of the menu\'s page and hide it behind an open card', () => {
    expect(css).toMatch(/\.iw-lobby > \.iw-card-note \{[^}]*position: absolute;[^}]*max-width: calc\(100vw - max\(42\.2vw, 7\.4vw \+ 33rem\)/);
    expect(css).toMatch(/\.iw-lobby\.iw-dim > \.iw-card-note \{\s*display: none;/);
  });
});
