// The build's version, in one place so the menu badge and the version tag in
// the corner can never disagree with each other.
//
// THE RULE: every update that ships bumps this by 0.01. 1.45, 1.46, 1.47.
// (It was 0.05 up to 1.45.) Change VERSION_HUNDREDTHS and nothing else — both
// strings below are derived from it, so they cannot drift apart, and the bump
// is `+ 1`.
//
// It is an INTEGER of hundredths rather than a float on purpose. Repeatedly
// adding a hundredth to a float drifts: 1.45 + 0.01 + 0.01 is
// 1.4700000000000002 in binary floating point, and the menu would print that
// verbatim. Dividing an integer by 100 always renders as the short decimal
// you expect — 1.46, 1.5, 1.7 — with no trailing zero to trim.
const VERSION_HUNDREDTHS = 150;

const N = VERSION_HUNDREDTHS / 100;

export const GAME_VERSION = `${N}.0`;
export const GAME_VERSION_LABEL = `Version ${N} Beta`;
