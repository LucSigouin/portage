/**
 * Applies the URL switches to a running app. Loaded on demand, so the bot
 * and the staging code stay out of the normal game's first download.
 */
import { BOT_SEED, createBotDriver } from '../../bot/bot.ts';
import type { App } from '../app.ts';
import { subjectFromState } from '../camera.ts';
import type { DebugParameters } from './parameters.ts';
import { addIdleCrew, gameAtQuest, stageShot } from './staging.ts';

// `?perf=1`: the performance readout rides in this chunk. A second on-demand chunk would make the bundler
// split the game's data out of the first download, and every normal game would then fetch one file more.
export { runPerfReadout } from '../perf/readout.ts';

export function applyDebugParameters(app: App, parameters: DebugParameters): void {
  const session = app.session;
  const seed = parameters.seed ?? BOT_SEED;
  const lines: string[] = [];
  app.debugSource = () => lines;
  // New games from the lobby get the same crew.
  session.crewSize = parameters.crew;

  if (parameters.shot) {
    const shot = stageShot(parameters.shot, seed);
    if (shot.state) session.adoptGame(addIdleCrew(shot.state, parameters.crew));
    if (shot.panel) session.handleIntent({ type: 'open_panel', panel: shot.panel });
    if (shot.state) {
      // Run one frame so the camera snaps behind the subject, then place it.
      app.frame(0);
      const subject = subjectFromState(shot.state, session.lastInput);
      if (shot.camera) {
        app.camera.setOrbit({
          yaw: subject.heading + (shot.camera.yawOffset ?? 0), pitch: shot.camera.pitch, distance: shot.camera.distance,
        });
      }
      session.frozen = !parameters.live;
    }
    lines.push(`shot: ${parameters.shot}${!shot.state ? '' : parameters.live ? ' (live)' : ' (held still)'}`);
    return;
  }

  if (parameters.atQuest !== null) {
    session.adoptGame(addIdleCrew(gameAtQuest(seed, parameters.atQuest), parameters.crew));
    lines.push(`started at quest ${parameters.atQuest}, seed ${seed}`);
  } else if ((parameters.crew > 1 || parameters.host !== null) && !parameters.bot) {
    // `?crew=N` or `?host=ROOM` alone: straight into a new game, with the crew aboard.
    session.adoptGame(addIdleCrew(gameAtQuest(seed, 1), parameters.crew));
  }
  if (parameters.host !== null) lines.push(`hosting room ${parameters.host}`);
  if (parameters.join !== null) lines.push(`joining room ${parameters.join}`);
  if (parameters.crew > 1) lines.push(`crew of ${parameters.crew}: ${parameters.crew - 1} idle`);

  if (parameters.bot) {
    if (!session.game) session.adoptGame(addIdleCrew(gameAtQuest(seed, 1), parameters.crew));
    const game = session.game;
    if (!game) return;
    let lastAction = 'starting';
    const driver = createBotDriver(game, {
      // The bot sends commands through the session, the same door the keyboard and the UI use.
      dispatch: (command) => session.dispatch(command, true),
      log: (line) => {
        lastAction = line.trim().replace(/^[\d.]+\s+/, '');
      },
    });
    session.attachDriver(driver);
    app.debugSource = () => {
      const minutes = (game.playedSeconds / 60).toFixed(1);
      if (!driver.finished) return [`bot x${session.timeScale}: ${lastAction}`, `${minutes} min played, seed ${seed}`];
      const ending = driver.stoppedBecause ? `stopped: ${driver.stoppedBecause}` : game.flags.beacon_lit ? 'finished: Beacon lit' : 'finished';
      return [`bot ${ending}`, `${minutes} min played, ${game.statistics.fails} fails, seed ${seed}`];
    };
  }
  session.timeScale = parameters.speed;
}
