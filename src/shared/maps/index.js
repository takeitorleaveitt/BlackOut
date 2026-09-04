import { buildWarehouse } from './warehouse.js';
import { buildSuburb } from './suburb.js';
import { buildRefinery } from './refinery.js';
import { buildBlackwood } from './blackwood.js';
import { buildGarage } from './garage.js';
import { buildHighrise } from './highrise.js';
import { buildKillhouse } from './killhouse.js';
import { buildDistrict9 } from './district9.js';

const BUILDERS = {
  warehouse: buildWarehouse,
  suburb: buildSuburb,
  refinery: buildRefinery,
  blackwood: buildBlackwood,
  garage: buildGarage,
  highrise: buildHighrise,
  killhouse: buildKillhouse,
  district9: buildDistrict9
};

const cache = new Map();

/** Build (and memoise) a map by key. Same data on client and server. */
export function getMap(key) {
  if (cache.has(key)) return cache.get(key);
  const fn = BUILDERS[key] || BUILDERS.warehouse;
  const m = fn();
  cache.set(m.key, m);
  return m;
}

export const MAP_KEYS = Object.keys(BUILDERS);

/** Lightweight listing for menus (no geometry). */
export const MAP_INFO = MAP_KEYS.map((k) => {
  const m = getMap(k);
  return {
    key: m.key, name: m.name, subtitle: m.subtitle, desc: m.desc,
    size: m.size, compact: !!m.compact, sky: m.env.sky,
    brushCount: m.brushes.length, propCount: m.props.length
  };
});

export const ROTATION = ['warehouse', 'suburb', 'refinery', 'blackwood', 'garage', 'highrise'];
export const GUNFIGHT_MAPS = ['killhouse', 'suburb', 'garage'];
export const SIEGE_MAPS = ['district9'];

/**
 * Maps selectable for a mode.  Gunfight only ever uses the compact ones;
 * Siege and Quickplay are purpose-built for District 9 and have no other
 * map to rotate through; everything else may also be played on the
 * shoothouse.
 */
export function mapsForMode(modeKey) {
  if (modeKey === 'gunfight') return GUNFIGHT_MAPS;
  if (modeKey === 'siege' || modeKey === 'quickplay') return SIEGE_MAPS;
  return [...ROTATION, 'killhouse'];
}
