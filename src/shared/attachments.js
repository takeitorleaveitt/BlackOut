// Attachments are pure stat deltas plus a model hint.  Multipliers are applied
// in resolveWeapon() so client prediction and server validation agree exactly.

export const ATTACHMENTS = {
  reddot: {
    key: 'reddot', name: 'MRDS Red Dot', slot: 'optic',
    desc: 'Fast unmagnified dot. Cleaner sight picture with a small ADS cost.',
    mods: { adsTime: 1.05, spreadAds: 0.88, adsFov: 0.86 }
  },
  holo: {
    key: 'holo', name: 'Holographic Sight', slot: 'optic',
    desc: 'Wider window and a ringed reticle. Slower to raise than the dot.',
    mods: { adsTime: 1.12, spreadAds: 0.82, adsFov: 0.80 }
  },
  suppressor: {
    key: 'suppressor', name: 'Suppressor', slot: 'muzzle',
    desc: 'Cuts report and hides muzzle flash. Costs a little muzzle velocity and damage at range.',
    mods: { damageMin: 0.92, muzzleVelocity: 0.94, recoilVert: 0.92, adsTime: 1.06, mobility: 0.98 },
    flags: { suppressed: true }
  },
  compensator: {
    key: 'compensator', name: 'Compensator', slot: 'muzzle',
    desc: 'Vents gas upward. Flattens vertical climb, louder and brighter at the muzzle.',
    mods: { recoilVert: 0.80, recoilHoriz: 1.10, mobility: 0.98 },
    flags: { loud: true }
  },
  grip: {
    key: 'grip', name: 'Vertical Grip', slot: 'under',
    desc: 'Tames horizontal wander and steadies sway. Slightly slower to bring up.',
    mods: { recoilHoriz: 0.74, sway: 0.80, adsTime: 1.04, spreadMove: 0.92 }
  },
  flashlight: {
    key: 'flashlight', name: 'Weapon Light', slot: 'under',
    desc: 'Lights up dark interiors and gives your position away to everyone in the room.',
    mods: {}, flags: { light: true }
  },
  laser: {
    key: 'laser', name: 'Laser Module', slot: 'side',
    desc: 'Tightens hipfire considerably. The beam is visible to enemies.',
    mods: { spreadHip: 0.68 }, flags: { laser: true }
  }
};

export const OPTIC_KEYS = ['reddot', 'holo'];

/**
 * Apply an attachment list to a base weapon, returning a resolved copy.
 * Only one attachment per slot is honoured (later entries win).
 */
export function resolveWeapon(base, attachKeys = []) {
  const w = { ...base, recoil: { ...base.recoil }, sway: { ...base.sway }, flags: {} };
  const bySlot = new Map();
  for (const k of attachKeys) {
    const a = ATTACHMENTS[k];
    if (!a) continue;
    if (!base.attachments.includes(k)) continue;
    bySlot.set(a.slot, a);
  }
  w.attached = [...bySlot.values()].map((a) => a.key);
  for (const a of bySlot.values()) {
    const m = a.mods || {};
    if (m.damageMin) w.damageMin *= m.damageMin;
    if (m.muzzleVelocity) w.muzzleVelocity *= m.muzzleVelocity;
    if (m.adsTime) w.adsTime *= m.adsTime;
    if (m.adsFov) w.adsFov *= m.adsFov;
    if (m.spreadAds) w.spreadAds *= m.spreadAds;
    if (m.spreadHip) w.spreadHip *= m.spreadHip;
    if (m.spreadMove) w.spreadMove *= m.spreadMove;
    if (m.recoilVert) w.recoil.vert *= m.recoilVert;
    if (m.recoilHoriz) w.recoil.horiz *= m.recoilHoriz;
    if (m.sway) w.sway.amp *= m.sway;
    if (m.mobility) w.mobility *= m.mobility;
    Object.assign(w.flags, a.flags || {});
  }
  return w;
}

export function attachmentsFor(weapon) {
  return weapon.attachments.map((k) => ATTACHMENTS[k]).filter(Boolean);
}
