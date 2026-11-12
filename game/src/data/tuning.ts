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
    paddleSpeed: 2.2,
    powerStrokeSpeed: 3.2,
    backPaddleSpeed: 1.2,
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
    /** Water gained per second per point of (roughness - stability). */
    floodPerSecondPerExcess: 3.5,
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
    /** Steepest climb, as rise over run (tan 40 degrees). */
    slopeLimit: 0.839,
    wadeDepth: 0.6,
    nodeRange: 2.5,
    canoeNodeRange: 7,
    npcRange: 3.5,
    campRange: 8,
    /** Largest standing depth when stepping out of the canoe, metres. */
    disembarkDepth: 0.5,
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
