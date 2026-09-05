// Round economy for Team Deathmatch.
//
// Counter-Strike's loop, minus the bomb: you start a match with a wallet,
// spend it between rounds, and what you are carrying when the round ends is
// what you start the next one with — unless you died, in which case you are
// back to a pistol and a knife. Money is the only reason a round you have
// already lost still matters.
//
// Shared with the server, which is the authority on every number here: the
// client draws the buy menu, the server decides whether you can afford it.

export const START_MONEY = 1000;
export const MAX_MONEY = 16000;
export const KILL_REWARD = 500;

// Losing a round still pays, or a team that goes down early never recovers.
export const ROUND_WIN_REWARD = 3000;
export const ROUND_LOSS_REWARD = 1400;

// What you keep when you die: the free pistol and the blade, nothing else.
export const DEFAULT_PRIMARY = null;
export const DEFAULT_SECONDARY = 'glock17';

export const WEAPON_PRICE = {
  // pistols
  glock17: 450,
  deagle: 700,
  // sub-machine guns
  mp7: 1000,
  mp5: 1500,
  // rifles
  m4a1: 2400,
  ak74: 2500,
  scarh: 3000,
  // heavy
  m870: 1800,
  m40: 2700,
  // never for sale — everyone always has one
  knife: 0
};

export const ATTACHMENT_PRICE = {
  holo: 150,
  compensator: 100,
  reddot: 0,
  scope: 0,
  suppressor: 0,
  grip: 0,
  flashlight: 0,
  laser: 0
};

export const priceOf = (weaponKey) => WEAPON_PRICE[weaponKey] ?? 0;
export const attachmentPrice = (key) => ATTACHMENT_PRICE[key] ?? 0;

/** Total cost of a weapon plus everything hung off it. */
export function loadoutCost(weaponKey, attachments = []) {
  let total = priceOf(weaponKey);
  for (const a of attachments) total += attachmentPrice(a);
  return total;
}

export const clampMoney = (v) => Math.max(0, Math.min(MAX_MONEY, Math.round(v)));

/**
 * The buy menu's columns, in the order they are numbered on screen.
 * `slot` says which loadout slot a purchase fills.
 */
export const BUY_CATEGORIES = [
  { key: 'pistols', name: 'Pistols', slot: 'secondary', items: ['glock17', 'deagle'] },
  { key: 'smg', name: 'Mid-Tier', slot: 'primary', items: ['mp7', 'mp5', 'm870'] },
  { key: 'rifles', name: 'Rifles', slot: 'primary', items: ['m4a1', 'ak74', 'scarh', 'm40'] },
  { key: 'gear', name: 'Attachments', slot: 'attachment', items: ['holo', 'compensator', 'reddot', 'scope', 'suppressor', 'grip', 'laser', 'flashlight'] }
];
