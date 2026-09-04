// Siege operator roster.
//
// Each operator is a fixed weapon loadout (still customisable with
// attachments, same as any other loadout) plus a small player-model accent
// tint. Operators are picked fresh every round during the freeze/pick phase
// — there is no persistent "unlock" state, just a per-round choice, and a
// team can't have two players on the same operator in the same round.

export const OPERATORS = [
  // --- Blue (ALPHA) -------------------------------------------------------
  {
    key: 'sentinel', team: 1, name: 'Sentinel', role: 'Assault',
    desc: 'Balanced carbine, steady in any engagement.',
    primary: 'm4a1', secondary: 'glock17', accent: 0x5da0e0
  },
  {
    key: 'bastion', team: 1, name: 'Bastion', role: 'Marksman',
    desc: 'Battle rifle. Two-shot lethality at range, punishes peeking.',
    primary: 'scarh', secondary: 'glock17', accent: 0x7ec9a3
  },
  {
    key: 'breach', team: 1, name: 'Breach', role: 'Entry',
    desc: 'Pump shotgun. Devastating through a doorway, useless past it.',
    primary: 'm870', secondary: 'glock17', accent: 0xe0a85d
  },
  {
    key: 'vantage', team: 1, name: 'Vantage', role: 'Pistol',
    desc: 'Runs a hand cannon as a primary. One or two hits end most fights.',
    primary: 'deagle', secondary: 'glock17', accent: 0xd6d6d6
  },
  {
    key: 'recon', team: 1, name: 'Recon', role: 'Pistol',
    desc: 'Light and fast, trades rifle stopping power for mobility.',
    primary: 'deagle', secondary: 'glock17', accent: 0x9a7fe0
  },
  // --- Tan (BRAVO) ---------------------------------------------------------
  {
    key: 'raider', team: 2, name: 'Raider', role: 'Assault',
    desc: 'Hard-hitting rifle with a violent climb — controlled bursts reward.',
    primary: 'ak74', secondary: 'glock17', accent: 0xd67a4a
  },
  {
    key: 'havoc', team: 2, name: 'Havoc', role: 'CQB',
    desc: 'Roller-delayed SMG. Almost no muzzle rise, built for indoors.',
    primary: 'mp5', secondary: 'glock17', accent: 0xd6c15d
  },
  {
    key: 'ram', team: 2, name: 'Ram', role: 'Entry',
    desc: 'Pump shotgun. Devastating through a doorway, useless past it.',
    primary: 'm870', secondary: 'glock17', accent: 0xc0522f
  },
  {
    key: 'ghost', team: 2, name: 'Ghost', role: 'Pistol',
    desc: 'Runs a hand cannon as a primary. One or two hits end most fights.',
    primary: 'deagle', secondary: 'glock17', accent: 0x5f6a70
  },
  {
    key: 'viper', team: 2, name: 'Viper', role: 'Pistol',
    desc: 'Light and fast, trades rifle stopping power for mobility.',
    primary: 'deagle', secondary: 'glock17', accent: 0x6fae5a
  }
];

export const OPERATOR_BY_KEY = Object.fromEntries(OPERATORS.map((o) => [o.key, o]));
export const OPERATORS_FOR_TEAM = (team) => OPERATORS.filter((o) => o.team === team);
