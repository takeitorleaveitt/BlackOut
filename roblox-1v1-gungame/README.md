# Blocky 1v1 Gun Game (Roblox)

A Pixel-Gun-flavoured 1v1 duel mode for Roblox. Two players queue up, drop into
a symmetric arena, and climb a ladder of six blocky guns — every kill hands the
killer the next gun, and whoever shoots their way off the end of the ladder wins.

Nothing here needs an asset upload: the guns and the map are built out of Parts
at runtime, so a fresh baseplate place is enough.

## Layout

| Path | Goes to | What it does |
| --- | --- | --- |
| `src/shared/GunConfig.lua` | `ReplicatedStorage.GunGameShared` | The gun ladder: stats, geometry, colours, shared tuning. |
| `src/shared/GunModel.lua` | ″ | Builds a gun out of Parts (world model and view model). |
| `src/shared/Remotes.lua` | ″ | The remote-event names, created server-side, awaited client-side. |
| `src/server/Main.server.lua` | `ServerScriptService.GunGameServer` | Entry point. |
| `src/server/Arena.lua` | ″ | The map, from a written-down footprint table. |
| `src/server/MatchService.lua` | ″ | Queue, countdown, rounds, the gun ladder, respawns. |
| `src/server/WeaponService.lua` | ″ | Authoritative firing: ammo, fire rate, spread, raycasts, damage. |
| `src/client/Client.client.lua` | `StarterPlayer.StarterPlayerScripts.GunGameClient` | Input, view model, recoil, tracers. |
| `src/client/Hud.lua` | ″ | Crosshair, ammo, scoreboard, hitmarker, queue prompt. |

## Installing

**With Rojo** (recommended):

```
rojo serve default.project.json
```

then connect from the Rojo plugin in Studio.

**By hand in Studio**, if you would rather not install anything — the names
matter, the scripts find each other by name:

1. In `ReplicatedStorage`, make a `Folder` called `GunGameShared`. Put three
   `ModuleScript`s in it named `GunConfig`, `GunModel`, `Remotes`, and paste in
   the matching files.
2. In `ServerScriptService`, make a `Folder` called `GunGameServer`. Add
   `ModuleScript`s named `Arena`, `MatchService`, `WeaponService`, and a
   `Script` named `Main` (that is `Main.server.lua`).
3. In `StarterPlayer > StarterPlayerScripts`, make a `Folder` called
   `GunGameClient`. Add a `ModuleScript` named `Hud` and a `LocalScript` named
   `Client` (that is `Client.client.lua`).
4. Press Play. Nothing else needs configuring — the arena builds itself and
   `CharacterAutoLoads` is turned off by the server.

Test with two players: **Test → Clients and Servers → 2 players**, or publish
and open the place twice.

## Playing

| Input | Does |
| --- | --- |
| `E` | Join / leave the queue |
| Mouse 1 | Fire (held down for the automatic guns) |
| `R` | Reload |

Two queued players start a match: five-second countdown, then the arena is live.
First to work through all six guns wins; the match ends, everyone goes back to
the lobby island above the map, and the next pair is pulled off the queue.

## The gun ladder

1. **Pocket Pistol** — semi, 26 dmg, 2× on heads.
2. **Buzz SMG** — 12 rounds/s, sprays.
3. **Boxy Rifle** — automatic, the all-rounder.
4. **Slab Shotgun** — 8 pellets, 90-stud range, brutal up close.
5. **Longshot** — 82 dmg, near-zero spread, 0.9 shots/s.
6. **Golden Deagle** — one shot, one kill, and the last rung.

## How it is put together

- **The server owns every shot.** The client sends an aim direction and nothing
  else. Damage, spread, fire rate, ammo and the ray itself all come from
  `WeaponService`, and the shot always originates at the server's copy of the
  shooter's head. A client that claims a muzzle more than 12 studs from that
  head has the shot dropped.
- **The client predicts nothing it cannot take back.** It draws its own muzzle
  flash and applies its own recoil immediately (both cosmetic), but ammo,
  reloads and hit confirmation are echoed back from the server.
- **Recoil returns to zero.** The camera kick is split into a pending half and
  an applied half; every frame a slice goes in and a slice comes back out, so
  the view rises fast, settles slowly, and never drifts.
- **The map is a table, not a feel.** `Arena.lua` lists every brush as a
  footprint with an explicit floor height, and the cover is written once and
  mirrored, so neither spawn gets the better side.

## Tuning

Everything worth changing is at the top of `GunConfig.lua`. Adding a rung to the
ladder is a new entry in `GunConfig.Ladder` — the HUD, progression and win
condition all read `GunConfig.LadderSize`, so nothing else needs touching.
`GunConfig.Rules` holds the respawn delay, countdown and intermission.
