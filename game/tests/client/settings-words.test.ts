/**
 * Two labels in Settings say what their thing does now (the fix round after the master review of round 3,
 * finding 11): the B key opens more than the builder, and the camera's swing-back acts aboard only.
 */
import { describe, expect, it } from 'vitest';
import { CAMERA_TUNING } from '../../src/client/camera.ts';
import { reducePanels, createPanelState } from '../../src/client/panels.ts';
import { buildHowToPlayPanel } from '../../src/client/viewmodels/menus.ts';
import { bindingRows, settingsRows } from '../../src/client/viewmodels/settings.ts';
import { ACTION_LABELS, DEFAULT_KEY_BINDINGS, createDefaultSettings } from '../../src/settings/index.ts';

const settings = createDefaultSettings();

describe('Settings names the B key for what it opens now', () => {
  it('the builder and the stations, in the list of keys', () => {
    expect(DEFAULT_KEY_BINDINGS.canoeBuilder).toEqual(['KeyB']);
    expect(ACTION_LABELS.canoeBuilder).toBe('Canoe: builder and stations');
    const row = bindingRows(settings, null).find((entry) => entry.action === 'canoeBuilder')!;
    expect(row.label).toBe('Canoe: builder and stations');
    expect(row.label).not.toBe('Canoe builder');
    // How to Play says the same of the same key.
    const howTo = buildHowToPlayPanel(settings).sections.flatMap((section) => section.controls).find((control) => control.keys === 'B')!;
    expect(howTo.label).toContain('builder');
    expect(howTo.label).toContain('stations');
  });

  it('because B opens a station\'s menu afloat, where the builder cannot build', () => {
    // The panel the key toggles opens on a station when the boat has one and is afloat (`boatOpensOn`).
    const opened = reducePanels(createPanelState('game'), { type: 'toggle', panel: 'canoe_builder' }, { canoeBeached: false, boatOpensOn: 'firebox' });
    expect(opened.state.stack).toEqual(['canoe_builder']);
    expect(opened.state.boatTab).toBe('firebox');
  });
});

describe('the camera setting says where it acts', () => {
  it('aboard: on foot the camera never swings back by itself', () => {
    const row = settingsRows(settings, 'controls').find((entry) => entry.setting === 'controls.cameraAutoCentre')!;
    expect(row.label).toBe('Aboard: camera swings back behind the heading');
    expect(CAMERA_TUNING.canoe.recentreRate).toBeGreaterThan(0);
    expect(CAMERA_TUNING.foot.recentreRate).toBe(0);
  });
});
