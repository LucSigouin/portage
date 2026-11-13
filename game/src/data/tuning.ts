/**
 * Every tuning constant the simulation reads. Change numbers here, never in the
 * systems. The solvability test and the bot run are the proof that a change
 * still leaves the game finishable.
 */

const DAY_SECONDS = 24 * 60;

export const TUNING = {
  /** Fixed simulation step, seconds. */
  fixedStep: 1 / 60,
  /** Largest frame time `step` will catch up on, seconds. */
  maximumFrameSeconds: 0.25,

  time: {
    daySeconds: DAY_SECONDS,
    /** One in-game hour, in seconds. 24 hours = 24 real minutes. */
    hourSeconds: DAY_SECONDS / 24,
    startHour: 7,
    /** Night runs from nightStartHour to dawnHour: 8 of 24 hours. */
    nightStartHour: 22,
    dawnHour: 6,
    /** Sleep is allowed from this hour until dawn, or when tired. */
    sleepFromHour: 19,
    sleepWhenEnergyAtMost: 50,
    failSkipHours: 6,
  },

  difficultyDrainScale: { relaxed: 0.6, standard: 1.0 },

  survival: {
    /** Hunger empties in 2 days. */
    hungerPerSecond: 100 / (2 * DAY_SECONDS),
    /** Thirst empties in 1.25 days. */
    thirstPerSecond: 100 / (1.25 * DAY_SECONDS),
    exertionHungerMultiplier: 2.2,
    exertionThirstMultiplier: 1.8,
    sleepDrainMultiplier: 0.5,
    powerStrokeEnergyPerSecond: 1.0,
    runEnergyPerSecond: 1.0,
    bailEnergyPerSecond: 0.5,
    /** Exertion is refused below this, so effort alone never causes a fail. */
    minimumEnergyToExert: 5,
    restEnergyPerSecond: 0.6,
    lightActivityEnergyPerSecond: 0.12,
    fireWarmthEnergyPerSecond: 0.2,
    coldNightEnergyPerSecond: 0.1,
    stormEnergyPerSecond: 0.15,
    starvingEnergyCap: 40,
    starvingEnergyPerSecond: 0.2,
    failMeterValue: 50,
    lowMeterWarning: 25,
    /** Metres within which a fire, camp or lit lantern shelters the player. */
    shelterRange: 8,
  },

  canoe: {
    /**
     * Raised on 2026-11-12 from 2.2, 3.2 and 1.2: a friend of Luc's found the crossings far too long. Doubling
     * was tried first and broke two things, so these stop short of it: a power stroke on the long hull must stay
     * under `sailMaximumSpeed`, or the sail is worth nothing, and rough water must still stop a canoe that is
     * not fitted for it. `tests/canoe.test.ts` and `tests/gating.test.ts` hold both.
     */
    paddleSpeed: 3.2,
    powerStrokeSpeed: 4.2,
    backPaddleSpeed: 1.7,
    /** Every paddler after the strongest adds this share of their own stroke. Four paddlers: 1.75x. */
    extraPaddlerShare: 0.25,
    sailMaximumSpeed: 5,
    /** Speed closes on its target at this rate per second. */
    thrustResponse: 1.2,
    coastResponse: 0.5,
    turnRate: 0.9,
    rudderTurnRate: 1.35,
    /** Share of the turn rate left when standing still. */
    turnAtRestShare: 0.35,
    turnFullSpeed: 1.5,
    /** Sail drive per metre per second of wind. */
    sailDrivePerWind: 0.75,
    /** Without a rudder the sail only pulls downwind. */
    rudderReachShare: 0.45,
    /** With a rudder, the sail stalls inside this angle of dead upwind. */
    noGoAngle: Math.PI / 4,
    luffingDragSpeed: 0.3,
    /** Leeway from wind on the bare hull, share of wind speed. */
    windDriftShare: 0.015,
    bailPerSecond: 3,
    /**
     * Water gained per second per point of (roughness - stability). Raised from 3.5 with the paddle speeds
     * (2026-11-12), by the same share: rough water costs a paddler the same water for every metre as it did,
     * so it still stops a canoe that is not fitted for it.
     */
    floodPerSecondPerExcess: 5,
    rainPerSecond: 0.05,
    swampWarningLevel: 70,
    capsizeLevel: 100,
    /** Speed lost at a full water level, as a share. */
    waterloggedSpeedLoss: 0.35,
    baseStability: 1,
    /** How far from the hull the player can step ashore, metres. */
    disembarkReach: 3.5,
    boardRange: 3.2,
    /** Cargo and aboard stations can be used within this distance, metres. */
    accessRange: 8,
    buoyancyResponse: 6,
    fogTurnRate: 1.2,
    startWaterLevel: 60,
    rainCatcherSecondsPerWater: 45,
    fishingRigSecondsPerFish: 180,
    planterBerries: 3,
    planterRoots: 2,
  },

  foot: {
    walkSpeed: 2.6,
    runSpeed: 4.4,
    /**
     * How walking feels from the keys (Luc's list, line 11: "the character movement on land needs complete rework").
     * It was instant: full speed on the first step of 1/60 s, a dead stop, the figure snapped round in one step.
     * Speed gained per second when starting off or speeding up, m/s per second: a stand to a walk in 9 steps of the
     * rules (0.15 s), to a run in 15 (0.25 s).
     */
    acceleration: 18,
    /** Speed lost per second when the keys come up or a sharp turn slows the walk: a walk stands still in 5 steps (0.08 s, 9 cm), a run in 8 (0.13 s, 29 cm). */
    braking: 30,
    /**
     * How fast the figure turns to face the way the keys point, radians per second: 720 degrees a second, a right
     * angle in 8 steps (0.13 s), an about-face in 15 (0.25 s). The figure always walks the way it faces, so it never
     * slides sideways or backwards; a turn sharper than 60 degrees slows it (see `stepOnFoot`).
     */
    turnRate: 4 * Math.PI,
    /** A walker's half-width: how close their middle comes to a trunk, a rock or a wall (Luc's list, line 1). */
    bodyRadius: 0.3,
    /** Steepest climb, as rise over run (tan 40 degrees). */
    slopeLimit: 0.839,
    wadeDepth: 0.6,
    /**
     * The jump (Luc's list, Round 3: "character need to jump"). The feet leave the ground on the step the key
     * arrives, top out at `jumpHeight` metres after `jumpRiseSeconds` and are down again `jumpFallSeconds` later:
     * 16 steps up and 14 down, half a second in the air, the fall a little quicker than the rise. The height is for
     * the eye alone: a jumper goes only where a walker may (see `stepOnFoot`).
     */
    jumpHeight: 0.9,
    jumpRiseSeconds: 0.27,
    jumpFallSeconds: 0.23,
    /** After the feet touch down the knees give and straighten for this long. Drawn only: walking is not slowed. */
    jumpLandSeconds: 0.15,
    /** In the air: the share of the turn rate and of the acceleration that is left. The speed at take-off is kept. */
    jumpAirControl: 0.2,
    /** The key pressed again this late in a fall jumps again on landing, seconds. */
    jumpBufferSeconds: 0.1,
    nodeRange: 2.5,
    canoeNodeRange: 7,
    npcRange: 3.5,
    /** A camp reaches this far from its fire. */
    campRange: 8,
    /** And this far from each thing that stands in it (the bench, the lean-to, a bedroll): at one of them, you are in camp. */
    campLandmarkRange: 4,
    /** Largest standing depth when stepping out of the canoe, metres. */
    disembarkDepth: 0.5,
    /** The interact key offers "Use the bench" this close to a camp's stump bench, metres. */
    benchRange: 2.5,
    /** And this close to the workbench on the canoe's port deck, so the rest of the hull still offers boarding. */
    workbenchRange: 1.8,
  },

  nodes: {
    /**
     * Every scavenge action that refills comes back this long after it was used, seconds of the world clock (a real
     * second while playing; a night slept passes it too). Luc, 2026-11-13: "refills should be every 10 mins, for
     * everything except the nevers". It was 0.5 to 4 game days, set spot by spot. The nevers (message bottles,
     * caches, the sunken lockers, the Beacon lamp) are marked in `data/nodes.ts` and never come back.
     */
    refillSeconds: 10 * 60,
    /**
     * A wild tree, boulder or crag answers F this close, metres from its bark or stone (`sim/gathering.ts`): a step
     * from it. A spot's reach (`foot.nodeRange`) is from its middle, which a walker can stand on; a tree's is solid.
     */
    wildReach: 1.2,
  },

  inventory: {
    stackSize: 20,
    backpackSlots: 8,
  },

  world: {
    halfExtent: 1500,
    seabedDepth: 6,
    /** The underwater shelf reaches the seabed this far out, in island radii. */
    shelfWidth: 0.6,
    /** Roughness ramps up over this distance on the rough side of a boundary. */
    regionBlendMetres: 80,
    valleyWallSlope: 0.9,
    discoverRange: 260,
    bumpHeight: 0.35,
  },

  weather: {
    /** Seconds for a storm to build or fade. */
    stormRampSeconds: 45,
    stormWarningSeconds: 90,
    windEasePerSecond: 0.15,
    /** Radians per second the wind's bearing swings toward a new one. A full reversal takes about six seconds. */
    windTurnPerSecond: 0.5,
    firstWeatherSeconds: 420,
    /** Weather changes that must pass after a storm before the next can be rolled. */
    changesBetweenStorms: 3,
  },

  events: {
    /** Oldest events are dropped beyond this if the client never drains. */
    maximumQueued: 256,
  },
} as const;
