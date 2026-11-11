/**
 * Portage audio engine: the single public entry point.
 *
 * Every sound is synthesised with WebAudio. There are no audio files and no
 * libraries. The engine reads the rules engine's state and events; it never
 * owns rules and never touches the state.
 *
 * ## Using it
 *
 * ```ts
 * const audio = createAudioEngine();
 * audio.setVolumes(settings.audio);
 * audio.setScene('lobby');
 * // on the first click or key press (browsers refuse sound before a gesture):
 * await audio.unlock();
 * // every frame, in game:
 * step(state, input, frameSeconds);
 * audio.handleEvents(drainEvents(state));
 * audio.update(state, frameSeconds);
 * // from the UI:
 * audio.playInterface('click');
 * ```
 *
 * ## Contract
 *
 * - Before `unlock`, where WebAudio is missing, and after `dispose`, every
 *   method is a safe no-op. Volumes and the scene set before `unlock` are kept
 *   and applied when it runs. Events sent before `unlock` are dropped.
 * - `unlock` may be called on every gesture. It builds the graph once and
 *   resumes the context if the browser suspended it.
 * - `handleEvents` then `update`, each once per frame, in either order. The
 *   few cues that need more than the event (which action a scavenge is using)
 *   read the state last given to `update`, which the game mutates in place.
 * - `update` reads the state through the rules engine's selectors and its
 *   world functions. It never mutates it.
 * - The context is suspended while the page is hidden and after `suspend()`,
 *   and resumes when both are lifted.
 * - `dispose` stops every source, disconnects every node, closes the context
 *   and removes its listeners. A disposed engine stays silent for good.
 *
 * ## Mix
 *
 * Four buses into a master: music, effects, ambience, and interface sounds,
 * which ride the effects volume but skip the scene trim so menus stay audible
 * when paused. Volumes are 0 to 1 and squared into gain, so half-way on the
 * slider sounds like half. After the master come a gentle limiter and a soft
 * clipper whose curve tops out at 0.93 of full scale: the output cannot clip.
 * One small generated reverb is shared by every bus. Every gain change glides.
 * Voices are capped per bus (music 28, effects 20, ambience 18, interface 6);
 * when a bus is full the least important voice is faded out, and a repeat of
 * the same cue inside its minimum interval is dropped, so a burst of events
 * collapses instead of stacking.
 *
 * Scenes set the balance and the music: `lobby` (theme, calm water behind
 * it), `game`, `paused` (world turned down, music kept), `credits`.
 *
 * ## Continuous layers (follow `update`)
 *
 * | Layer | Follows |
 * |---|---|
 * | Water lapping, wavelets | Water roughness where the player is; quieter up the hill |
 * | Wind, whistle, wind in the pines | Wind speed; the pines only near land |
 * | Rain | Raining, heavier in a storm |
 * | Storm bed, distant thunder | Storm level |
 * | Hull wash, paddle strokes | Canoe speed; strokes while paddled, faster on a power stroke |
 * | Slosh, bilge glops | Water in the hull, when near the canoe |
 * | Fire roar, crackle | A fire station or the firebox in reach |
 * | Day birds | Daylight, busiest at dawn; fewer in rain, fog and far from land |
 * | Crickets | Night, near land, dry |
 * | Loon calls | Dusk and night over open water, now and then |
 * | Fog hush | Fog weather or the Fog region: the whole ambience closes down |
 * | Footsteps | Distance walked; a run is louder, wading splashes |
 * | Bailing | `canoe.bailing`, in rhythm while held. A scavenge is one press and one hit, from its `harvest_started` event |
 *
 * The state carries no input, so "is the canoe being paddled" is read off the
 * hull speed: a coasting hull loses half its speed per second, a paddled one
 * holds it. Under sail only a power stroke counts. See `deriveLayerInputs`.
 *
 * ## One-shots (follow `handleEvents`)
 *
 * `EVENT_CUES` in `cues.ts` maps every `GameEvent` type to a cue, keyed by
 * type so the compiler proves none is forgotten. `weather_changed`,
 * `rewards_pending` and `autosave_requested` are silent on purpose; the
 * reasons are beside them in the table. Scavenging sounds are chosen by node
 * type (chop, pry, rummage, pick, splash) and coloured by material. Crafting
 * sounds are chosen by station.
 *
 * ## Music
 *
 * Generative and sparse: overlapping pad breaths drifting between a few
 * chords, and short phrases drawn from written cells that are transposed,
 * inverted, cut short or stretched each time, so nothing loops. The lobby has
 * a theme that is stated plainly every few phrases. In game the region sets
 * the mode (Shallows D mixolydian, Reach E dorian, Narrows B aeolian, Fog
 * F sharp phrygian), the hour sets pace and colour (plucked by day, bowed at
 * dusk, glassy and rare at night), rain and fog darken it, and a storm thins
 * it to almost nothing. `game_completed` plays a 26 second finale, after
 * which the current scene's music resumes. Music ducks while a conversation
 * is open and under important one-shots.
 *
 * ## Judging it
 *
 * `http://localhost:5220/audio-lab.html` (dev server) has a button for every
 * cue, sliders for everything the layers follow, and a self-test that renders
 * each sound offline and tables its peak level.
 */
import { createEngineCore } from './engine.ts';
import type { AudioEngine, AudioEngineOptions } from './engine.ts';

export type { AudioEngine, AudioEngineOptions, AudioScene, AudioVolumes } from './engine.ts';
export type { InterfaceSound } from './interface-sounds.ts';

/**
 * Make an audio engine. It is silent and holds no audio resources until
 * `unlock()` is called from a user gesture.
 *
 * `contextFactory` replaces the browser's `AudioContext`, for tests and
 * offline rendering.
 */
export function createAudioEngine(options: AudioEngineOptions = {}): AudioEngine {
  const core = createEngineCore({ contextFactory: options.contextFactory });
  return {
    unlock: core.unlock,
    setVolumes: core.setVolumes,
    handleEvents: core.handleEvents,
    update: core.update,
    playInterface: core.playInterface,
    setScene: core.setScene,
    suspend: core.suspend,
    resume: core.resume,
    dispose: core.dispose,
  };
}
