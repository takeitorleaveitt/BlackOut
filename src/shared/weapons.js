// The seven firearms.  Every field here changes how the gun *feels*, not just
// how much damage it does: recoil shape, bullet speed, handling weight, sway
// frequency, ADS speed, spread growth/recovery and audio character all differ.
//
// Recoil patterns are authored as an explicit sequence of [horizontal, vertical]
// multipliers so each weapon climbs a recognisable path (the AK's hard right
// hook, the M4's tight vertical then left drift, the MP7's fast scatter...).

export const SLOT = { PRIMARY: 'primary', SECONDARY: 'secondary', MELEE: 'melee' };

function pattern(str) {
  // compact authoring: "h,v h,v h,v" -> [[h,v],...]
  return str.trim().split(/\s+/).map((p) => p.split(',').map(Number));
}

export const WEAPONS = [
  {
    id: 0,
    key: 'm4a1',
    name: 'M4A1',
    fullName: 'M4A1 Carbine',
    caliber: '5.56x45mm NATO',
    class: 'Assault Rifle',
    slot: SLOT.PRIMARY,
    desc: 'Balanced 5.56 carbine. Controllable vertical climb, fast handling, forgiving at every range.',
    damage: 31, damageMin: 21, falloffStart: 26, falloffEnd: 62,
    rpm: 800, auto: true, burst: 0,
    muzzleVelocity: 880, dropScale: 1.0,
    magSize: 30, reserve: 180,
    reloadTactical: 2.10, reloadEmpty: 2.85, drawTime: 0.62, holsterTime: 0.42,
    adsTime: 0.235, adsFov: 0.62,
    spreadHip: 2.35, spreadAds: 0.19, spreadMove: 2.1, spreadJump: 4.2,
    spreadPerShot: 0.30, spreadMax: 5.2, spreadRecover: 5.4,
    recoil: {
      vert: 0.0122, horiz: 0.0044, recovery: 7.6, viewKick: 1.0, camShake: 0.62,
      firstShotMult: 1.22, kickBack: 0.052,
      pattern: pattern('0,1 0.05,1 -0.05,1 0.12,0.95 -0.2,0.92 -0.35,0.86 -0.5,0.8 -0.55,0.74 -0.4,0.7 -0.15,0.68 0.2,0.66 0.5,0.65 0.65,0.63 0.55,0.62 0.3,0.6 -0.05,0.6 -0.4,0.58 -0.6,0.57 -0.55,0.56 -0.3,0.55')
    },
    weight: 3.4, mobility: 0.96, adsMobility: 0.55,
    sway: { amp: 1.0, freq: 1.0, inertia: 1.0 },
    penetration: 0.72, pellets: 1, pelletSpread: 0,
    audio: { punch: 92, body: 320, crack: 3400, tail: 0.44, level: 0.95, tone: 0.55 },
    model: { barrel: 0.40, receiver: 0.30, stock: 'collapsible', handguard: 'quad', mag: 'stanag', tint: 0x2b2c2e, accent: 0x3a3c3f },
    attachments: ['reddot', 'holo', 'suppressor', 'compensator', 'grip', 'flashlight', 'laser']
  },
  {
    id: 1,
    key: 'ak74',
    name: 'AK-74',
    fullName: 'AK-74',
    caliber: '5.45x39mm',
    class: 'Assault Rifle',
    slot: SLOT.PRIMARY,
    desc: 'Heavier rifle with a violent right-hand climb. Hits harder than the M4 but punishes long bursts.',
    damage: 36, damageMin: 25, falloffStart: 24, falloffEnd: 58,
    rpm: 650, auto: true, burst: 0,
    muzzleVelocity: 900, dropScale: 1.05,
    magSize: 30, reserve: 150,
    reloadTactical: 2.45, reloadEmpty: 3.20, drawTime: 0.74, holsterTime: 0.50,
    adsTime: 0.285, adsFov: 0.64,
    spreadHip: 2.9, spreadAds: 0.22, spreadMove: 2.3, spreadJump: 4.8,
    spreadPerShot: 0.40, spreadMax: 6.0, spreadRecover: 4.6,
    recoil: {
      vert: 0.0168, horiz: 0.0092, recovery: 6.2, viewKick: 1.28, camShake: 0.92,
      firstShotMult: 1.15, kickBack: 0.075,
      pattern: pattern('0,1 0.15,1.02 0.3,1 0.5,0.96 0.72,0.92 0.9,0.88 1.0,0.84 0.95,0.8 0.8,0.76 0.55,0.74 0.2,0.72 -0.2,0.7 -0.55,0.68 -0.8,0.66 -0.95,0.65 -0.85,0.64 -0.6,0.63 -0.25,0.62 0.15,0.61 0.5,0.6')
    },
    weight: 4.1, mobility: 0.92, adsMobility: 0.50,
    sway: { amp: 1.28, freq: 0.84, inertia: 1.32 },
    penetration: 0.80, pellets: 1, pelletSpread: 0,
    audio: { punch: 74, body: 250, crack: 2900, tail: 0.52, level: 1.05, tone: 0.40 },
    model: { barrel: 0.42, receiver: 0.32, stock: 'fixed', handguard: 'wood', mag: 'curved', tint: 0x2a2622, accent: 0x5a3a1e },
    attachments: ['reddot', 'holo', 'suppressor', 'compensator', 'grip', 'flashlight', 'laser']
  },
  {
    id: 2,
    key: 'mp5',
    name: 'MP5',
    fullName: 'MP5A3',
    caliber: '9x19mm Parabellum',
    class: 'Submachine Gun',
    slot: SLOT.PRIMARY,
    desc: 'Roller-delayed 9mm. Almost no muzzle rise, superb indoors, falls off hard past 25 metres.',
    damage: 27, damageMin: 14, falloffStart: 16, falloffEnd: 40,
    rpm: 800, auto: true, burst: 0,
    muzzleVelocity: 400, dropScale: 1.25,
    magSize: 30, reserve: 180,
    reloadTactical: 2.05, reloadEmpty: 2.70, drawTime: 0.52, holsterTime: 0.36,
    adsTime: 0.195, adsFov: 0.72,
    spreadHip: 2.05, spreadAds: 0.26, spreadMove: 1.55, spreadJump: 3.4,
    spreadPerShot: 0.24, spreadMax: 4.4, spreadRecover: 6.6,
    recoil: {
      vert: 0.0078, horiz: 0.0038, recovery: 9.2, viewKick: 0.72, camShake: 0.42,
      firstShotMult: 1.05, kickBack: 0.034,
      pattern: pattern('0,1 -0.08,0.98 -0.18,0.94 -0.3,0.9 -0.35,0.86 -0.28,0.82 -0.1,0.8 0.15,0.78 0.35,0.76 0.45,0.74 0.4,0.72 0.25,0.7 0.0,0.68 -0.25,0.67 -0.4,0.66 -0.45,0.65 -0.3,0.64 -0.05,0.63 0.2,0.62 0.35,0.61')
    },
    weight: 2.8, mobility: 1.02, adsMobility: 0.66,
    sway: { amp: 0.82, freq: 1.18, inertia: 0.78 },
    penetration: 0.42, pellets: 1, pelletSpread: 0,
    audio: { punch: 118, body: 400, crack: 2200, tail: 0.30, level: 0.80, tone: 0.68 },
    model: { barrel: 0.24, receiver: 0.28, stock: 'retractable', handguard: 'tri', mag: 'straight', tint: 0x232426, accent: 0x2e3033 },
    attachments: ['reddot', 'holo', 'suppressor', 'compensator', 'grip', 'flashlight', 'laser']
  },
  {
    id: 3,
    key: 'mp7',
    name: 'MP7',
    fullName: 'MP7A1',
    caliber: '4.6x30mm',
    class: 'Personal Defence Weapon',
    slot: SLOT.PRIMARY,
    desc: 'Extremely high cyclic rate and near-pistol mobility. Light rounds scatter fast but defeat soft cover.',
    damage: 23, damageMin: 13, falloffStart: 18, falloffEnd: 42,
    rpm: 950, auto: true, burst: 0,
    muzzleVelocity: 725, dropScale: 1.15,
    magSize: 40, reserve: 200,
    reloadTactical: 1.90, reloadEmpty: 2.45, drawTime: 0.44, holsterTime: 0.30,
    adsTime: 0.175, adsFov: 0.74,
    spreadHip: 2.20, spreadAds: 0.30, spreadMove: 1.35, spreadJump: 3.0,
    spreadPerShot: 0.27, spreadMax: 4.9, spreadRecover: 7.4,
    recoil: {
      vert: 0.0070, horiz: 0.0062, recovery: 10.4, viewKick: 0.66, camShake: 0.38,
      firstShotMult: 1.0, kickBack: 0.028,
      pattern: pattern('0,1 0.2,0.96 -0.25,0.92 0.35,0.88 -0.4,0.85 0.5,0.82 -0.55,0.8 0.6,0.78 -0.5,0.76 0.45,0.74 -0.6,0.72 0.55,0.7 -0.35,0.69 0.4,0.68 -0.5,0.67 0.6,0.66 -0.45,0.65 0.3,0.64 -0.55,0.63 0.5,0.62')
    },
    weight: 2.1, mobility: 1.06, adsMobility: 0.72,
    sway: { amp: 0.70, freq: 1.34, inertia: 0.64 },
    penetration: 0.58, pellets: 1, pelletSpread: 0,
    audio: { punch: 140, body: 470, crack: 3900, tail: 0.24, level: 0.74, tone: 0.80 },
    model: { barrel: 0.18, receiver: 0.24, stock: 'stub', handguard: 'polymer', mag: 'short', tint: 0x1f2022, accent: 0x2a2c2e },
    attachments: ['reddot', 'holo', 'suppressor', 'compensator', 'grip', 'flashlight', 'laser']
  },
  {
    id: 4,
    key: 'm870',
    name: 'M870',
    fullName: 'Remington 870',
    caliber: '12 Gauge 00 Buck',
    class: 'Pump-Action Shotgun',
    slot: SLOT.PRIMARY,
    desc: 'Nine pellets of buckshot. Devastating inside a room, useless across a car park. Shell-by-shell reload.',
    damage: 15, damageMin: 3, falloffStart: 7, falloffEnd: 21,
    rpm: 72, auto: false, burst: 0, pumpTime: 0.72,
    muzzleVelocity: 400, dropScale: 1.6,
    magSize: 7, reserve: 42,
    reloadTactical: 0.58, reloadEmpty: 0.58, shellReload: true, reloadStart: 0.55, reloadEnd: 0.42,
    drawTime: 0.80, holsterTime: 0.55,
    adsTime: 0.310, adsFov: 0.80,
    spreadHip: 1.2, spreadAds: 0.5, spreadMove: 1.0, spreadJump: 2.0,
    spreadPerShot: 0.0, spreadMax: 1.6, spreadRecover: 3.0,
    recoil: {
      vert: 0.0520, horiz: 0.0140, recovery: 4.2, viewKick: 2.6, camShake: 2.1,
      firstShotMult: 1.0, kickBack: 0.185,
      pattern: pattern('0,1 0.4,1 -0.4,1 0.3,1 -0.3,1 0.5,1 -0.5,1')
    },
    weight: 3.9, mobility: 0.90, adsMobility: 0.52,
    sway: { amp: 1.20, freq: 0.78, inertia: 1.24 },
    penetration: 0.22, pellets: 9, pelletSpread: 2.6,
    audio: { punch: 58, body: 190, crack: 1800, tail: 0.66, level: 1.25, tone: 0.28 },
    model: { barrel: 0.50, receiver: 0.30, stock: 'wood', handguard: 'pump', mag: 'tube', tint: 0x24211d, accent: 0x4a3320 },
    attachments: ['reddot', 'holo', 'flashlight', 'laser']
  },
  {
    id: 5,
    key: 'glock17',
    name: 'Glock 17',
    fullName: 'Glock 17 Gen4',
    caliber: '9x19mm Parabellum',
    class: 'Semi-Auto Pistol',
    slot: SLOT.SECONDARY,
    desc: 'Fast to draw, fast to reload, always there when the primary runs dry.',
    damage: 28, damageMin: 16, falloffStart: 14, falloffEnd: 38,
    rpm: 420, auto: false, burst: 0,
    muzzleVelocity: 375, dropScale: 1.3,
    magSize: 17, reserve: 68,
    reloadTactical: 1.55, reloadEmpty: 2.10, drawTime: 0.34, holsterTime: 0.24,
    adsTime: 0.165, adsFov: 0.80,
    spreadHip: 1.9, spreadAds: 0.30, spreadMove: 1.4, spreadJump: 3.2,
    spreadPerShot: 0.42, spreadMax: 4.2, spreadRecover: 8.0,
    recoil: {
      vert: 0.0150, horiz: 0.0060, recovery: 11.0, viewKick: 1.05, camShake: 0.55,
      firstShotMult: 1.0, kickBack: 0.048,
      pattern: pattern('0,1 0.2,0.98 -0.2,0.96 0.25,0.94 -0.3,0.92 0.35,0.9 -0.25,0.9')
    },
    weight: 0.9, mobility: 1.10, adsMobility: 0.82,
    sway: { amp: 0.58, freq: 1.5, inertia: 0.5 },
    penetration: 0.34, pellets: 1, pelletSpread: 0,
    audio: { punch: 132, body: 440, crack: 2000, tail: 0.26, level: 0.78, tone: 0.72 },
    model: { barrel: 0.11, receiver: 0.18, stock: 'none', handguard: 'none', mag: 'pistol', tint: 0x1c1d1f, accent: 0x272829 },
    attachments: ['reddot', 'suppressor', 'flashlight', 'laser']
  },
  {
    id: 7,
    key: 'deagle',
    name: 'Desert Eagle',
    fullName: 'Desert Eagle Mark XIX',
    caliber: '.50 Action Express',
    class: 'Semi-Auto Pistol',
    slot: SLOT.SECONDARY,
    desc: 'Oversized hand cannon. One or two hits end most fights, but the slide is heavy and the mag is short.',
    damage: 58, damageMin: 40, falloffStart: 20, falloffEnd: 50,
    rpm: 220, auto: false, burst: 0,
    muzzleVelocity: 470, dropScale: 1.15,
    magSize: 7, reserve: 35,
    reloadTactical: 1.95, reloadEmpty: 2.55, drawTime: 0.46, holsterTime: 0.32,
    adsTime: 0.230, adsFov: 0.78,
    spreadHip: 2.6, spreadAds: 0.34, spreadMove: 2.0, spreadJump: 4.0,
    spreadPerShot: 0.55, spreadMax: 4.6, spreadRecover: 6.4,
    recoil: {
      vert: 0.0340, horiz: 0.0130, recovery: 6.4, viewKick: 1.9, camShake: 1.1,
      firstShotMult: 1.0, kickBack: 0.095,
      pattern: pattern('0,1 0.3,1 -0.35,1 0.4,1 -0.3,1 0.35,1 -0.25,1')
    },
    weight: 1.4, mobility: 1.03, adsMobility: 0.74,
    sway: { amp: 0.74, freq: 1.28, inertia: 0.66 },
    penetration: 0.5, pellets: 1, pelletSpread: 0,
    audio: { punch: 96, body: 360, crack: 2400, tail: 0.42, level: 1.1, tone: 0.5 },
    model: { barrel: 0.16, receiver: 0.20, stock: 'none', handguard: 'none', mag: 'pistol', tint: 0x4a4e52, accent: 0x2b2e31 },
    attachments: ['reddot', 'flashlight', 'laser']
  },
  {
    id: 6,
    key: 'scarh',
    name: 'SCAR-H',
    fullName: 'SCAR-H CQC',
    caliber: '7.62x51mm NATO',
    class: 'Battle Rifle',
    slot: SLOT.PRIMARY,
    desc: '7.62 battle rifle. Two-shot lethality and it will shoot through most walls, but it fights you every trigger pull.',
    damage: 45, damageMin: 34, falloffStart: 34, falloffEnd: 80,
    rpm: 560, auto: true, burst: 0,
    muzzleVelocity: 780, dropScale: 0.92,
    magSize: 20, reserve: 120,
    reloadTactical: 2.55, reloadEmpty: 3.40, drawTime: 0.86, holsterTime: 0.58,
    adsTime: 0.330, adsFov: 0.58,
    spreadHip: 3.2, spreadAds: 0.16, spreadMove: 2.6, spreadJump: 5.4,
    spreadPerShot: 0.52, spreadMax: 6.6, spreadRecover: 4.0,
    recoil: {
      vert: 0.0215, horiz: 0.0105, recovery: 5.4, viewKick: 1.62, camShake: 1.25,
      firstShotMult: 1.30, kickBack: 0.098,
      pattern: pattern('0,1 -0.2,1.05 0.25,1.0 -0.45,0.96 0.6,0.92 -0.7,0.88 0.85,0.86 -0.9,0.84 0.75,0.82 -0.6,0.8 0.4,0.78 -0.3,0.77 0.55,0.76 -0.75,0.75 0.9,0.74 -0.8,0.73 0.5,0.72 -0.35,0.71 0.6,0.70 -0.7,0.69')
    },
    weight: 4.6, mobility: 0.88, adsMobility: 0.46,
    sway: { amp: 1.42, freq: 0.72, inertia: 1.48 },
    penetration: 0.95, pellets: 1, pelletSpread: 0,
    audio: { punch: 62, body: 210, crack: 2600, tail: 0.60, level: 1.18, tone: 0.32 },
    model: { barrel: 0.44, receiver: 0.34, stock: 'folding', handguard: 'rail', mag: 'battle', tint: 0x3b3a2e, accent: 0x4a4838 },
    attachments: ['reddot', 'holo', 'suppressor', 'compensator', 'grip', 'flashlight', 'laser']
  },
  {
    id: 8,
    key: 'knife',
    name: 'Combat Knife',
    fullName: 'Fixed-Blade Combat Knife',
    caliber: 'Melee',
    class: 'Melee',
    slot: SLOT.MELEE,
    desc: 'Always on you regardless of loadout. A clean stab at knife range drops anyone in one hit.',
    melee: true,
    // damageMin=0 and a falloff that closes over a few centimetres past
    // falloffStart turns the shared range-falloff math into a hard melee-range
    // cutoff: full lethal damage up close, nothing at all past knife reach.
    // damage is well above MAX_HEALTH (100) even through the weakest
    // (leg, x0.72) hit-zone multiplier so a stab kills from full health from
    // any angle, not just center-mass.
    damage: 200, damageMin: 0, falloffStart: 1.4, falloffEnd: 1.6,
    rpm: 110, auto: false, burst: 0,
    muzzleVelocity: 260, dropScale: 0,
    magSize: 1, reserve: 1,
    reloadTactical: 0.01, reloadEmpty: 0.01, drawTime: 0.22, holsterTime: 0.16,
    adsTime: 0.12, adsFov: 1.0,
    spreadHip: 0, spreadAds: 0, spreadMove: 0, spreadJump: 0,
    spreadPerShot: 0, spreadMax: 0, spreadRecover: 20,
    recoil: {
      vert: 0, horiz: 0, recovery: 20, viewKick: 0, camShake: 0,
      firstShotMult: 1, kickBack: 0,
      pattern: pattern('0,0')
    },
    weight: 0.6, mobility: 1.16, adsMobility: 1.0,
    sway: { amp: 0.9, freq: 1.6, inertia: 0.6 },
    penetration: 0, pellets: 1, pelletSpread: 0,
    audio: { punch: 0, body: 0, crack: 0, tail: 0, level: 0, tone: 0 },
    model: { barrel: 0.02, receiver: 0.05, stock: 'none', handguard: 'none', mag: 'none', tint: 0x555a5e, accent: 0x8a8f94 },
    attachments: []
  }
];

export const WEAPON_BY_KEY = Object.fromEntries(WEAPONS.map((w) => [w.key, w]));
export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
export const PRIMARIES = WEAPONS.filter((w) => w.slot === SLOT.PRIMARY);
export const SECONDARIES = WEAPONS.filter((w) => w.slot === SLOT.SECONDARY);

export const fireInterval = (w) => 60 / w.rpm;

/** Damage after range falloff (metres travelled). */
export function damageAtRange(w, dist) {
  if (dist <= w.falloffStart) return w.damage;
  if (dist >= w.falloffEnd) return w.damageMin;
  const t = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return w.damage + (w.damageMin - w.damage) * t;
}

/** Recoil step for shot index `n` (0-based within the burst). */
export function recoilStep(w, n) {
  const p = w.recoil.pattern;
  const e = p[Math.min(n, p.length - 1)];
  const first = n === 0 ? w.recoil.firstShotMult : 1;
  return {
    h: e[0] * w.recoil.horiz * first,
    v: e[1] * w.recoil.vert * first
  };
}
