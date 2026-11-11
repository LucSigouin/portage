import type { DialogueNode, DialogueOption, NpcDefinition, NpcId, QuestId, QuestStatus } from './types.ts';

const node = (id: string, text: string, options: DialogueOption[]): DialogueNode => ({ id, text, options });

const nodes = (list: DialogueNode[]): Record<string, DialogueNode> =>
  Object.fromEntries(list.map((entry) => [entry.id, entry]));

const whenQuest = (questId: QuestId, ...statuses: QuestStatus[]) => ({ quests: [{ questId, statuses }] });

const goodbye = (text: string): DialogueOption => ({ text, next: null });

const ODILE: NpcDefinition = {
  id: 'odile',
  name: 'Odile',
  description: 'Kept the orchard for fifty years and sees no reason to stop.',
  iconId: 'npc_odile',
  islandId: 'orchard_hill',
  spot: { along: 0.18, across: 0.22 },
  entries: [
    { condition: { notFlags: ['odile_gave_welcome'] }, nodeId: 'meet' },
    { nodeId: 'hub' },
  ],
  nodes: nodes([
    node('meet',
      'Well. A canoe. I counted nine boats go north the first week and none come back, so you will forgive me for staring. Sit. You look like you have been eating cattails.',
      [{
        text: 'I have been eating cattails.',
        next: 'welcome',
        effects: [{ type: 'set_flag', flag: 'odile_gave_welcome' }, { type: 'give_items', items: [{ itemId: 'apple', count: 4 }] }],
      }]),
    node('welcome',
      'Then take these. Russets. Ugly, but they keep. The good fruit is up in the crowns where I cannot get at it any more.',
      [{ text: 'Thank you.', next: 'hub' }]),
    node('hub',
      'The trees do not know the valley is gone. They flower, they set, they drop. Somebody ought to be here for it.',
      [
        { text: 'Why did you stay?', next: 'stay' },
        { text: 'What do you know about the Beacon?', next: 'beacon' },
        { text: 'Can I help with the orchard?', next: 'windfall_offer', condition: whenQuest('odile_windfall', 'available') },
        {
          text: 'I brought your apples.', next: 'windfall_done', condition: whenQuest('odile_windfall', 'ready'),
          effects: [{ type: 'turn_in_quest', questId: 'odile_windfall' }],
        },
        { text: 'Those empty jars on the sill?', next: 'sweet_offer', condition: whenQuest('odile_something_sweet', 'available') },
        {
          text: 'Two jars of jam, as asked.', next: 'sweet_done', condition: whenQuest('odile_something_sweet', 'ready'),
          effects: [{ type: 'turn_in_quest', questId: 'odile_something_sweet' }],
        },
        { text: 'Could your seeds grow on a boat?', next: 'garden_offer', condition: whenQuest('odile_garden_afloat', 'available') },
        {
          text: 'The planter is built. Come and see.', next: 'garden_done', condition: whenQuest('odile_garden_afloat', 'ready'),
          effects: [{ type: 'turn_in_quest', questId: 'odile_garden_afloat' }],
        },
        goodbye('I should get back on the water.'),
      ]),
    node('stay',
      'My husband planted the north rows. My daughter was born in that house. When the water came up I carried the seed tins to the attic and found I had nowhere else I wanted to carry them.',
      [{ text: 'That is a reason.', next: 'hub' }]),
    node('beacon',
      'The radio mast on High Ridge. It had a lamp for the float planes, bright enough to read by down here. If it burned again, anyone left in these hills would know which way to walk. Nobody has gone up. The Fog sits on that end of the valley like a lid.',
      [{ text: 'Somebody should go up.', next: 'hub' }]),
    node('windfall_offer',
      'You can climb, I suppose. Six apples from the high branches and I will find you something from the seed tins. Jars too. I have more jars than sense.',
      [
        { text: 'Six apples. Done.', next: 'hub', effects: [{ type: 'accept_quest', questId: 'odile_windfall' }] },
        { text: 'Another time.', next: 'hub' },
      ]),
    node('windfall_done',
      'Look at that. Not a bruise. Here, seed for whatever you can make grow, and jars for whatever you can make keep.',
      [{ text: 'Glad to help.', next: 'hub' }]),
    node('sweet_offer',
      'Empty since the spring. I used to put up forty jars a summer. Berries, a fire, a jar and patience. Bring me two and I will know someone still has the knack.',
      [
        { text: 'Two jars of jam. I will try.', next: 'hub', effects: [{ type: 'accept_quest', questId: 'odile_something_sweet' }] },
        { text: 'Not just now.', next: 'hub' },
      ]),
    node('sweet_done',
      'Set properly, too. You did not rush it. Take the spare jars, and the good cloth from the linen press. I am not making curtains.',
      [{ text: 'It will be a sail before long.', next: 'hub' }]),
    node('garden_offer',
      'Earth is earth. A box, some clay in the bottom so it holds water, and seed. Build one on that boat of yours and I will sleep easier knowing the line carries on.',
      [
        { text: 'I will build a planter.', next: 'hub', effects: [{ type: 'accept_quest', questId: 'odile_garden_afloat' }] },
        { text: 'When I have the deck for it.', next: 'hub' },
      ]),
    node('garden_done',
      'A garden that goes where it likes. My mother would have had words. Here, more seed, and apple rings for the trip.',
      [{ text: 'I will look after them.', next: 'hub' }]),
  ]),
};

const WREN: NpcDefinition = {
  id: 'wren',
  name: 'Wren',
  description: 'Rings the hours from the steeple so the valley still has a clock.',
  iconId: 'npc_wren',
  islandId: 'steeple_rock',
  spot: { along: -0.12, across: 0.5 },
  entries: [
    { condition: { notFlags: ['wren_taught_sailcloth'] }, nodeId: 'meet' },
    { nodeId: 'hub' },
  ],
  nodes: nodes([
    node('meet',
      'You came across the Reach in that? With one float? I watched you the whole way and rang the bell twice for luck. You want a sail. Paddling this water is how people get tired, and tired is how people get wet.',
      [{
        text: 'Can you show me how to make one?',
        next: 'taught',
        effects: [
          { type: 'set_flag', flag: 'wren_taught_sailcloth' },
          { type: 'set_flag', flag: 'wren_gave_cloth' },
          { type: 'give_items', items: [{ itemId: 'cloth', count: 4 }] },
        ],
      }]),
    node('taught',
      'Three widths of cloth, laid double. Cattail fiber for thread, flat seam, pulled tight enough to hum. Do it at a bench or you will sew it to your knee. Here, the vestry curtains. They were only keeping the dust company.',
      [{ text: 'A flat seam. Got it.', next: 'hub' }]),
    node('hub',
      'Six bells, all is well. Or well enough.',
      [
        { text: 'Why keep ringing?', next: 'ringing' },
        { text: 'What is north of here?', next: 'north' },
        { text: 'That bell rope looks rough.', next: 'rope_offer', condition: whenQuest('wren_bell_rope', 'available') },
        {
          text: 'Four lengths of rope for the bell.', next: 'rope_done', condition: whenQuest('wren_bell_rope', 'ready'),
          effects: [{ type: 'turn_in_quest', questId: 'wren_bell_rope' }],
        },
        goodbye('Fair winds, Wren.'),
      ]),
    node('ringing',
      'Because a bell carries four miles over water. If one person on one roof hears it and thinks, somebody is keeping time, then it is worth the stairs. You heard it. So there.',
      [{ text: 'I did hear it.', next: 'hub' }]),
    node('north',
      'Scrapyard Bar, west side. Tink lives there under a tarp and can build anything except a tidy pile. Past her the valley squeezes into the Narrows. The water stands up in there. One float will not do. And past the dam, the Fog. I have watched boats row into it and row back out an hour later swearing they never turned.',
      [{ text: 'So I need a light. And something to steer by.', next: 'hub' }]),
    node('rope_offer',
      'It is down to three strands and a prayer. If it parts, the valley loses its clock. Four lengths of good rope and I can splice a new one. I have a pennant you can fly for it. Red. You will be seen.',
      [
        { text: 'Four lengths. I will bring them.', next: 'hub', effects: [{ type: 'accept_quest', questId: 'wren_bell_rope' }] },
        { text: 'When I can spare it.', next: 'hub' },
      ]),
    node('rope_done',
      'Good hard lay, too. Listen to that tomorrow, it will ring clean. The pennant is yours. Fly it off the stern so I can pick you out.',
      [{ text: 'I will fly it.', next: 'hub' }]),
  ]),
};

const TINK: NpcDefinition = {
  id: 'tink',
  name: 'Tink',
  description: 'Sorts the scrapyard one bolt at a time and has a use for all of it.',
  iconId: 'npc_tink',
  islandId: 'scrapyard_bar',
  spot: { along: 0.25, across: -0.1 },
  entries: [
    { condition: { notFlags: ['tink_gave_wrench'] }, nodeId: 'meet' },
    { nodeId: 'hub' },
  ],
  nodes: nodes([
    node('meet',
      'Do not step on the left pile, that is the good pile. You are the one Wren has been ringing about. Sail up already? Then you are after something harder. Go on.',
      [{
        text: 'Wren says boats come back out of the Fog. I want to go through.',
        next: 'wrench',
        effects: [{ type: 'set_flag', flag: 'tink_gave_wrench' }, { type: 'give_items', items: [{ itemId: 'wrench', count: 1 }] }],
      }]),
    node('wrench',
      'Then you need to hear where you are going. The Beacon mast still ticks out a carrier, I get it on a fork some nights. A crystal set would hold it. Coil from a motor, a battery, wire, and a galena crystal. The only crystal I know of is in the signal hut at the far end of the Truss Bridge. Walk the deck, do not paddle it. Take my spare wrench. The forge is yours to use, mind the left pile.',
      [{ text: 'Coil, battery, wire, crystal.', next: 'hub' }]),
    node('hub',
      'Everything here was something. Most of it can be something again.',
      [
        { text: 'How did you end up here?', next: 'here' },
        { text: 'Tell me about the radio again.', next: 'radio' },
        { text: 'Could I have a forge of my own?', next: 'hot_offer', condition: whenQuest('tink_hot_work', 'available') },
        {
          text: 'Charcoal and scrap, as agreed.', next: 'hot_done', condition: whenQuest('tink_hot_work', 'ready'),
          effects: [{ type: 'turn_in_quest', questId: 'tink_hot_work' }],
        },
        { text: 'What is under those buoys by the bridge?', next: 'lifting_offer', condition: whenQuest('tink_heavy_lifting', 'available') },
        {
          text: 'The winch works. I hauled one up.', next: 'lifting_done', condition: whenQuest('tink_heavy_lifting', 'ready'),
          effects: [{ type: 'turn_in_quest', questId: 'tink_heavy_lifting' }],
        },
        goodbye('Back to it, then.'),
      ]),
    node('here',
      'I ran the yard before. When the water came the yard floated off in pieces and fetched up on this bar, so I followed my inventory. Nobody else was going to sort it.',
      [{ text: 'Fair enough.', next: 'hub' }]),
    node('radio',
      'Long hull first, a set needs a dry shack on the stern. Coil from any motor with the wrench. Battery from a generator or a tractor. Wire is everywhere. The crystal is the hard one: signal hut, north end of the bridge deck, door rusted shut. Bring a bar.',
      [{ text: 'Long hull, then the shack.', next: 'hub' }]),
    node('hot_offer',
      'My old bellows are hanging on the crane. I will part with them for fuel and stock: four charcoal, six scrap. Then stone and clay on your starboard deck and you are a blacksmith.',
      [
        { text: 'Four charcoal, six scrap. Deal.', next: 'hub', effects: [{ type: 'accept_quest', questId: 'tink_hot_work' }] },
        { text: 'Let me think about it.', next: 'hub' },
      ]),
    node('hot_done',
      'That will see me through the month. Bellows are yours. Oil the leather or I will hear about it.',
      [{ text: 'I will oil the leather.', next: 'hub' }]),
    node('lifting_offer',
      'Boats. Four that I know of, sunk with their lockers shut. I tied the floats on myself and never had the arm to lift them. Build a winch on that long bow, bring one up, and show me. I have been carving something for whoever manages it.',
      [
        { text: 'A winch. I will show you.', next: 'hub', effects: [{ type: 'accept_quest', questId: 'tink_heavy_lifting' }] },
        { text: 'One thing at a time.', next: 'hub' },
      ]),
    node('lifting_done',
      'Ha! Straight up, no fouling. Here. Cedar, took me the winter. A loon, because they are the only ones who came through all this without complaining.',
      [{ text: 'She goes on the bow.', next: 'hub' }]),
  ]),
};

export const NPCS: Record<NpcId, NpcDefinition> = { odile: ODILE, wren: WREN, tink: TINK };

export const NPC_IDS: NpcId[] = ['odile', 'wren', 'tink'];
