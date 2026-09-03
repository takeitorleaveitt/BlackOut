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
  (`src/render/passes/BodycamShader.js`) adds fisheye distortion, chromatic
  aberration, film grain, scanlines/compression artifacts, bloom, motion
  blur, exposure and vignette — every one toggleable in Settings → Bodycam
  for low-end hardware.
- **Seven weapons**, each with a unique procedural 3D model, recoil pattern,
  fire rate, reload choreography, sound profile and handling feel:
  M4A1, AK-74, MP5, MP7, M870 (pump shotgun with pellet spread), Glock 17,
  SCAR-H. Defined in `src/shared/weapons.js`; attachments (optics,
  suppressor, compensator, grip, light, laser) resolve into real stat deltas
  in `src/shared/attachments.js`.
- **Real ballistics** — bullets travel with velocity and drop, penetrate
  thin materials at a cost, and resolve per-body-zone damage (head/torso/
  arms/legs) against a lag-compensated hit history on the server
  (`src/shared/ballistics.js`, `src/shared/sim/MatchSim.js`).
- **Six maps + a compact shoothouse**: District 9 (warehouse), Willow Lane
  (suburb), Refinery, Blackwood (night forest compound), Sublevel 3
  (parking garage), Meridian (destroyed office), and Killhouse (Gunfight).
  All built from one small level-authoring DSL (`src/shared/maps/kit.js`)
  so the exact same brush/prop data drives both the renderer and the
  server's collision world — no separate art pass, no desync risk.
- **Five game modes**: Team Deathmatch, Free For All, Elimination, Search &
  Destroy (plant/defuse), Gunfight (2v2, randomized kit, compact maps).
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
  ui/            screen manager, main menu, server browser, loadout,
                 settings, lobby
  game/          HUD
server/          authoritative Node server: rooms, matchmaking, WebSocket
                 protocol handling
```

## Notes

- Settings, loadout, and friends list persist to `localStorage`.
- Training mode runs the identical `MatchSim` the server uses, so bot
  behavior and hit detection are consistent whether you're offline or in a
  live match.
