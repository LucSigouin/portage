/**
 * Applies the URL switches to a running app. Loaded on demand, so the bot
 * and the staging code stay out of the normal game's first download.
 */
import { BOT_SEED, createBotDriver } from '../../bot/bot.ts';
import type { App } from '../app.ts';
import { subjectFromState } from '../camera.ts';
import type { DebugParameters } from './parameters.ts';
import { gameAtQuest, stageShot } from './staging.ts';

export function applyDebugParameters(app: App, parameters: DebugParameters): void {
  const session = app.session;
  const seed = parameters.seed ?? BOT_SEED;
  const lines: string[] = [];
  app.debugSource = () => lines;

  if (parameters.shot) {
    const shot = stageShot(parameters.shot, seed);
    if (shot.state) session.adoptGame(shot.state);
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
    session.adoptGame(gameAtQuest(seed, parameters.atQuest));
    lines.push(`started at quest ${parameters.atQuest}, seed ${seed}`);
  }

  if (parameters.bot) {
    if (!session.game) session.adoptGame(gameAtQuest(seed, 1));
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
