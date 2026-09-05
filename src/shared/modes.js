// Game modes.  The server reads these to drive round flow; the UI reads them
// for the browser, lobby and end-of-match screens.

export const MODES = {
  // Team Deathmatch is the economy mode: rounds, one life each, and a wallet
  // you spend between them. `economy` is what turns the buy menu on and takes
  // the loadout screen away — every other mode still uses the loadout you set
  // in the menu and respawns you when you die.
  tdm: {
    key: 'tdm', name: 'Team Deathmatch', short: 'TDM',
    desc: 'One life a round and a wallet between them. Buy, hold what you kept, wipe the other squad.',
    teams: true, respawn: false, rounds: true, economy: true,
    roundsToWin: 3, roundTimeSec: 150, freezeSec: 15,
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
};

export const MODE_LIST = Object.values(MODES);
export const DEFAULT_MODE = 'tdm';

/**
 * Playlists are what the Play screen actually offers. A playlist picks which
 * modes it may draw, how long a match runs, and — the part that matters —
 * whether bots are allowed to fill it at all. Quick Match and Standard are
 * player-only: they will wait for humans rather than pad the lobby out.
 */
/**
 * `maps` restricts a playlist to part of the rotation. A map that is too small
 * or too fast for a playlist's pace does not belong in it: the Airsoft Range
 * is a knife-fight box with no business in a first-to-three, and neither it
 * nor Willow Lane holds up over the length of a Standard match. Leave `maps`
 * off and the playlist gets the whole rotation.
 */
export const PLAYLISTS = {
  quickmatch: {
    key: 'quickmatch', name: 'QUICK MATCH',
    desc: 'Against real players only. Team Deathmatch or Elimination, first to 3.',
    modes: ['tdm', 'elimination'], roundsToWin: 3, bots: false, minPlayers: 8,
    maps: ['warehouse', 'suburb', 'refinery']
  },
  standard: {
    key: 'standard', name: 'STANDARD',
    desc: 'Against real players only. Team Deathmatch, first to 6.',
    modes: ['tdm'], roundsToWin: 6, bots: false, minPlayers: 8,
    maps: ['warehouse', 'refinery']
  },
  freeforall: {
    key: 'freeforall', name: 'FREE FOR ALL',
    desc: 'Everybody hostile. Fills with bots and real players alike.',
    modes: ['ffa'], roundsToWin: 3, bots: true, minPlayers: 1
  }
};

/**
 * The maps a playlist may pick from, intersected with what the mode allows.
 * Falls back to the mode's own list for anything not in a playlist (private
 * matches, the server browser, offline).
 */
export function mapsForPlaylist(playlistKey, modeKey, allMaps) {
  const pl = PLAYLISTS[playlistKey];
  if (!pl || !pl.maps) return allMaps;
  const allowed = allMaps.filter((m) => pl.maps.includes(m));
  return allowed.length ? allowed : allMaps;
}

export const PLAYLIST_LIST = Object.values(PLAYLISTS);

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
