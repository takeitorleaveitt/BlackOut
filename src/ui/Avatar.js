// Operator portraits.
//
// There are two: a blue-kitted operator and a tan-kitted one. Which one you
// wear is picked once per day and is stable for that whole day, so it feels
// like a rotating loadout rather than a random flicker every time the menu
// redraws. The pick is seeded from the account so two people on the same day
// do not necessarily match.

export const AVATARS = {
  blue: {
    key: 'blue', name: 'BLUE TEAM KIT',
    skin: '#c79a72', skinShade: '#a87c58',
    kit: '#2b4a6b', kitDark: '#1b2f45', kitLight: '#3c6a93',
    visor: '#7fd0ff', trim: '#57b6ff'
  },
  tan: {
    key: 'tan', name: 'DESERT KIT',
    skin: '#d8ab84', skinShade: '#b98a63',
    kit: '#8a7550', kitDark: '#5c4d33', kitLight: '#a89066',
    visor: '#ffd79a', trim: '#e0b070'
  }
};

/** Stable 32-bit hash of a string. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** YYYY-MM-DD in local time — the unit the portrait rotates on. */
export function dayStamp(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Today's portrait for a given account seed. Same seed and same day always
 * give the same answer; the next day flips a coin again.
 */
export function avatarForDay(seed = 0, date = new Date()) {
  return hash(`${seed}:${dayStamp(date)}`) % 2 === 0 ? AVATARS.blue : AVATARS.tan;
}

/** Portrait for someone else — stable per callsign, since we can't see their
 *  account seed. */
export function avatarForName(name) {
  return hash(String(name || '?')) % 2 === 0 ? AVATARS.blue : AVATARS.tan;
}

/**
 * Blocky operator bust as inline SVG, drawn in the same flat-shaded style as
 * the player models. `size` is the square edge in pixels.
 */
export function avatarSvg(av, size = 72) {
  const a = av || AVATARS.blue;
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" style="display:block">
  <rect width="64" height="64" fill="#0a0e12"/>
  <rect x="0" y="0" width="64" height="64" fill="url(#g-${a.key})" opacity="0.5"/>
  <defs>
    <linearGradient id="g-${a.key}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${a.kitDark}" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#05070a" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <!-- shoulders / plate carrier -->
  <rect x="8"  y="46" width="48" height="18" fill="${a.kitDark}"/>
  <rect x="14" y="46" width="36" height="18" fill="${a.kit}"/>
  <rect x="24" y="46" width="16" height="18" fill="${a.kitLight}"/>
  <rect x="27" y="50" width="10" height="3"  fill="${a.kitDark}"/>
  <rect x="27" y="56" width="10" height="3"  fill="${a.kitDark}"/>
  <!-- neck -->
  <rect x="27" y="41" width="10" height="7" fill="${a.skinShade}"/>
  <!-- balaclava / head -->
  <rect x="19" y="14" width="26" height="30" fill="${a.kitDark}"/>
  <rect x="21" y="16" width="22" height="26" fill="${a.kit}"/>
  <!-- exposed face strip -->
  <rect x="23" y="26" width="18" height="8" fill="${a.skin}"/>
  <rect x="23" y="32" width="18" height="2" fill="${a.skinShade}"/>
  <!-- goggles -->
  <rect x="19" y="23" width="26" height="7" fill="#10161c"/>
  <rect x="22" y="24" width="8"  height="5" fill="${a.visor}" opacity="0.92"/>
  <rect x="34" y="24" width="8"  height="5" fill="${a.visor}" opacity="0.92"/>
  <!-- helmet -->
  <rect x="17" y="9"  width="30" height="11" fill="${a.kitLight}"/>
  <rect x="17" y="17" width="30" height="3"  fill="${a.kitDark}"/>
  <rect x="15" y="12" width="4"  height="8"  fill="${a.kitDark}"/>
  <rect x="45" y="12" width="4"  height="8"  fill="${a.kitDark}"/>
  <!-- unit flash -->
  <rect x="41" y="49" width="9" height="6" fill="${a.trim}" opacity="0.85"/>
</svg>`;
}
