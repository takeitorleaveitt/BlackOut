# BLACKOUT PROTOCOL

A browser-based tactical first-person shooter with a BODYCAM-style visual
presentation, authoritative WebSocket multiplayer, seven fully modelled
firearms, and six original maps. Built with Three.js (WebGL2) on the client
and a Node/`ws` authoritative server. No downloaded textures or audio —
every material, weapon model, and sound effect is generated procedurally at
runtime.

## Quick start

```bash
npm install

# Development (client on :5173, game server on :8787, proxied together)
npm run dev

# Production
npm run build
npm start          # builds if needed, then serves dist/ + the game server on :8787
```

Open `http://localhost:5173` (dev) or `http://localhost:8787` (prod build).
The site boots straight into the main menu — no page reloads between menu,
lobby, and match.

## What's here

- **Bodycam camera rig** — the camera is simulated as a device strapped to
  the operator's chest, not a floating eye: positional/rotational lag behind
  aim, walk/sprint bob, landing dips, recoil impulses, and hit reactions all
  compose in `src/player/CameraRig.js`. Post-processing
  (`src/render/passes/BodycamShader.js`) adds scanlines, compression
  artifacts, bloom, exposure and vignette — every one toggleable in
  Settings → Bodycam for low-end hardware.
- **Nine weapons**, each with a unique procedural 3D model, recoil pattern,
  fire rate, reload choreography, sound profile and handling feel:
  M4A1, AK-74, MP5, MP7, SCAR-H, M870 (pump shotgun with pellet spread),
  Glock 17, Desert Eagle, and a combat knife with its own slash, backstab
  and inspect. Defined in `src/shared/weapons.js`; attachments (red dot,
  holographic, suppressor, compensator, grip, light, laser) resolve into
  real stat deltas in `src/shared/attachments.js`, and each gun remembers
  its own fitting when you switch away and back.
- **Real ballistics** — bullets travel with velocity and drop, penetrate
  thin materials at a cost, and resolve per-body-zone damage (head/torso/
  arms/legs) against a lag-compensated hit history on the server
  (`src/shared/ballistics.js`, `src/shared/sim/MatchSim.js`).
- **Four maps**: District 9 (warehouse), Willow Lane (suburb), Refinery,
  and Killhouse (a compact shoothouse). All built from one small
  level-authoring DSL (`src/shared/maps/kit.js`) so the exact same
  brush/prop data drives both the renderer and the server's collision
  world — no separate art pass, no desync risk.
- **Four game modes**: Team Deathmatch, Free For All, Elimination, and
  Search & Destroy (plant/defuse), served through three playlists — Quick
  Match and Standard are real players only and hold in matchmaking until
  eight have arrived, while Free For All will fill with bots.
- **Account, profile and squads** — a local level/XP record with per-playlist
  K/D (`src/core/Account.js`), a daily-rotating operator portrait
  (`src/ui/Avatar.js`), and a four-slot squad that travels with you into
  matchmaking and private rooms. Squads are server-owned: only the leader
  deploys, and everyone else is pulled into the same room behind them.
  Abandoning a Standard match carries an escalating leave penalty.
- **Authoritative multiplayer** over WebSocket (`server/`): server-side
  movement simulation, lag-compensated shot validation, quick match, a live
  server browser, and private rooms with shareable 6-character codes. Bots
  fill empty seats and react to gunfire, damage, and line of sight.
- **Procedural audio** (`src/audio/`) — every gunshot, footstep, impact,
  reload click and ambience bed is synthesized in WebAudio from the
  weapon/material's spectral profile, convolved through a reverb impulse
  that matches whatever space the listener is standing in.

## Project layout

```
src/
  shared/        movement, physics, ballistics, weapons, maps, protocol —
                 imported by both the browser client and the Node server
                 so gameplay is defined exactly once
  core/          engine bootstrap, input, settings, perf, object pooling
  render/        post-FX chain, procedural textures/materials/props, sky
  maps/          turns shared map data into renderable geometry
  weapons/       view-model animation, weapon state machine, 3D models
  player/        camera rig, local prediction, remote interpolation
  audio/         WebAudio synthesis + spatial engine
  net/           WebSocket client (+ an offline LocalNet with the same API
                 for Training mode)
  ui/            screen manager, main menu, operator card + squad panel,
                 server browser, loadout, settings, lobby, matchmaking
  game/          HUD
server/          authoritative Node server: rooms, matchmaking, WebSocket
                 protocol handling
```

## Notes

- Settings, loadout (including per-weapon attachments), account record and
  friends list persist to `localStorage`.
- Everything the first match needs — map data, surface textures, weapon and
  operator models, shader programs, and every menu screen's DOM — is built
  on the loading screen rather than the first time it is used.
- Training mode runs the identical `MatchSim` the server uses, so bot
  behavior and hit detection are consistent whether you're offline or in a
  live match.
