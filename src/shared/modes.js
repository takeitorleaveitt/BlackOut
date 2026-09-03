// Game modes.  The server reads these to drive round flow; the UI reads them
// for the browser, lobby and end-of-match screens.

export const MODES = {
  tdm: {
    key: 'tdm', name: 'Team Deathmatch', short: 'TDM',
    desc: 'Two squads, shared ticket pool. First team to the score limit takes it.',
    teams: true, respawn: true, rounds: false,
    scoreLimit: 75, timeLimitSec: 600, maxPlayers: 12, minPlayers: 2,
    friendlyFireDefault: false
  },
  ffa: {
    key: 'ffa', name: 'Free For All', short: 'FFA',
    desc: 'Everybody is hostile. No friendlies, no callouts, no help.',
    teams: false, respawn: true, rounds: false,
    scoreLimit: 30, timeLimitSec: 600, maxPlayers: 10, minPlayers: 2,
    friendlyFireDefault: true
  },
  elimination: {
    key: 'elimination', name: 'Elimination', short: 'ELIM',
    desc: 'One life each round. Wipe the other team or hold out until the clock dies.',
    teams: true, respawn: false, rounds: true,
    roundsToWin: 7, roundTimeSec: 150, freezeSec: 6, maxPlayers: 10, minPlayers: 2,
    friendlyFireDefault: true
  },
  snd: {
    key: 'snd', name: 'Search & Destroy', short: 'S&D',
    desc: 'Attackers carry the charge to A or B. Defenders hold, or cut the wires in time.',
    teams: true, respawn: false, rounds: true, objective: true,
    roundsToWin: 7, roundTimeSec: 165, freezeSec: 8, bombTimerSec: 45,
    plantTimeSec: 4.0, defuseTimeSec: 7.0, maxPlayers: 10, minPlayers: 2,
    friendlyFireDefault: true, switchSidesAt: 6
  },
  gunfight: {
    key: 'gunfight', name: 'Gunfight', short: 'GF',
    desc: 'Two on two, identical randomised kit, tiny arena. Rounds end fast.',
    teams: true, respawn: false, rounds: true, randomLoadout: true,
    roundsToWin: 6, roundTimeSec: 40, freezeSec: 4, maxPlayers: 4, minPlayers: 2,
    friendlyFireDefault: true, compactMaps: true
  }
};

export const MODE_LIST = Object.values(MODES);
export const DEFAULT_MODE = 'tdm';

export const REGIONS = [
  { key: 'eu-west', name: 'EU West', city: 'Frankfurt' },
  { key: 'eu-north', name: 'EU North', city: 'Stockholm' },
  { key: 'na-east', name: 'NA East', city: 'Ashburn' },
  { key: 'na-west', name: 'NA West', city: 'Los Angeles' },
  { key: 'sa-east', name: 'SA East', city: 'São Paulo' },
  { key: 'ap-se', name: 'Asia Pacific', city: 'Singapore' },
  { key: 'ap-ne', name: 'Asia North East', city: 'Tokyo' },
  { key: 'oce', name: 'Oceania', city: 'Sydney' }
];
