import type { BottleDefinition, BottleId } from './types.ts';

const bottle = (number: number, name: string, text: string): BottleDefinition => {
  const id = `bottle_${String(number).padStart(2, '0')}` as BottleId;
  return { id, name, text, iconId: 'item_message_bottle' };
};

const BOTTLE_LIST: BottleDefinition[] = [
  bottle(1, 'Day three',
    'Day 3. Water is over the mailbox. Dad says it will crest by Friday. I am putting one of these in every morning so somebody knows we were here. If you find this, the knoll behind our place stays dry. There is a fire ring.'),
  bottle(2, 'To whoever has the green canoe',
    'To whoever has the green canoe: it leaks along both seams. Spruce gum and birch bark, cooked black. My grandfather fixed it that way every spring and it lasted him forty years.'),
  bottle(3, 'Shopping list',
    'Things I should have taken: the hatchet (left in the attic, the big cabin). The good rope. The cat. The cat came anyway.'),
  bottle(4, 'From the orchard',
    'O. says she is staying with the trees and will not be argued with. I have left her the canning jars and my share of the sugar. If you pass, take her something. She will pretend not to want it.'),
  bottle(5, 'Six bells',
    'There is a bell ringing somewhere north. Six times at what I think is morning. I am going to paddle toward it. If the bell stops, do not follow me.'),
  bottle(6, 'Weather notes',
    'Notes for the next fool. The sky goes the colour of slate a good while before a storm lands. That is your warning. Beach the boat and sit it out. I did not, once. Lost half of everything.'),
  bottle(7, 'Wire',
    'The line crew left their spool on the ridge when the towers went dark. Cable enough to lift a truck. I could not carry it. Maybe you have a wrench and a stronger back.'),
  bottle(8, 'Herons',
    'Counted eleven herons in the marsh today. They stand where the fish are. If you have a rod, stand where the herons are.'),
  bottle(9, 'The Narrows',
    'Tried the Narrows with one float. The water stands up in there and comes over the side faster than you can throw it out. Two floats. Write that on your arm.'),
  bottle(10, 'Past the dam',
    'I went into the Fog four times. Each time I held the bow dead north and each time I came out by the dam with the sun on the wrong side. You cannot steer by what you cannot see. Bring a light. Bring something that hears.'),
];

export const BOTTLES: Record<BottleId, BottleDefinition> = Object.fromEntries(
  BOTTLE_LIST.map((definition) => [definition.id, definition]),
) as Record<BottleId, BottleDefinition>;

export const BOTTLE_IDS: BottleId[] = BOTTLE_LIST.map((definition) => definition.id);
