import { buildWarehouse } from './warehouse.js';
import { buildSuburb } from './suburb.js';
import { buildRefinery } from './refinery.js';
import { buildKillhouse } from './killhouse.js';

const BUILDERS = {
  warehouse: buildWarehouse,
  suburb: buildSuburb,
  refinery: buildRefinery,
  killhouse: buildKillhouse
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

export const ROTATION = ['warehouse', 'suburb', 'refinery', 'killhouse'];

/** Maps selectable for a mode. Every mode may use the whole rotation. */
export function mapsForMode() {
  return [...ROTATION];
}
