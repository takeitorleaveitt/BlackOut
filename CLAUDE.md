# BLACKOUT PROTOCOL

A browser tactical FPS: Three.js client, Node/WebSocket server, and a shared
simulation in `src/shared/` that both run so the client can predict and the
server stays authoritative.

## Standing rules

### Bump the version by 0.01 on every update

Every update that ships raises the main-menu version by **0.01**:
1.46 → 1.47 → 1.48, and so on. (The step was 0.05 up to 1.45.)

Edit `VERSION_HUNDREDTHS` in `src/shared/version.js` and nothing else — add 1.
Both the menu badge and the corner version tag are derived from it, so they
cannot fall out of step. It is an integer of hundredths rather than a float
because repeatedly adding a hundredth to a float drifts (1.45 + 0.01 + 0.01 is
1.4700000000000002 in binary floating point, and the menu would print that).

## Layout

- `src/shared/` — the simulation both sides run: movement, ballistics, weapons,
  maps, the nav grid, the economy, the protocol. Anything in here has to behave
  identically on the client and the server.
- `src/` (everything else) — the client: renderer, view model, audio, UI.
- `server/` — rooms, matchmaking, bots.

## Things this codebase gets wrong repeatedly

Worth reading before changing the simulation.

- **Reconciliation replay idempotence.** Anything `stepMovement` accumulates
  that is not restored gets applied twice when the client replays inputs. This
  has caused a double-height jump and a mobility desync that read as
  rubber-banding.
- **Truthiness swallowing legitimate zeros.** `null >= 0` is true; a slot index
  of 0 is falsy. Both have shipped bugs here.
- **Geometry placed by eye.** Every map fault so far — a staircase through a
  storage tank, a railing across the top of its own flight, a garage a metre
  off the house down an alley too narrow to walk — came from placing brushes by
  eye instead of against a written-down footprint table. Write the table first.
- **Doorways narrower than about 1.8 m.** The nav grid samples on a 0.9 m
  lattice and needs a body's width of clearance either side of a sample, so a
  narrow door is passable or not depending on where the lattice falls. Willow
  Lane's whole interior was unreachable because of 1.15 m doors.
- **Test harnesses that lie.** Headless Chromium runs at two or three frames a
  second, so anything measured against wall-clock time there is noise — drive
  the state machine directly instead. Vite's dev server hands a probe's dynamic
  `import()` a *separate* module instance, so module-level caches look empty.
  And a flood fill from arbitrary seeds does not prove mutual reachability; a
  forward BFS from the start node does.
