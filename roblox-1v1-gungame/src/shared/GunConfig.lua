--!nonstrict
-- The gun ladder. One table, read by the server (damage, fire rate, ammo) and
-- by the client (model geometry, recoil, sounds), so the two can never
-- disagree about what a weapon is.
--
-- Order matters: this IS the gun-game progression. A kill moves you one step
-- down the list; running off the end of it wins the match.

export type Gun = {
	name: string,
	auto: boolean,
	damage: number,
	headMultiplier: number,
	rps: number,          -- rounds per second
	range: number,        -- studs
	spread: number,       -- degrees of cone at the muzzle
	pellets: number,
	magazine: number,
	reloadTime: number,
	recoil: number,       -- degrees of vertical kick per shot
	-- Blocky Pixel-Gun-style silhouette, built out of Parts. Sizes in studs.
	body: Vector3,
	barrel: Vector3,
	grip: Vector3,
	stock: Vector3?,
	sight: Vector3?,
	magPart: Vector3?,
	colors: { body: Color3, barrel: Color3, grip: Color3, accent: Color3 },
}

local function rgb(r: number, g: number, b: number): Color3
	return Color3.fromRGB(r, g, b)
end

local GunConfig = {}

GunConfig.Ladder = {
	{
		name = "Pocket Pistol",
		auto = false,
		damage = 26, headMultiplier = 2, rps = 5, range = 300,
		spread = 1.1, pellets = 1, magazine = 12, reloadTime = 1.1, recoil = 1.6,
		body = Vector3.new(0.5, 0.7, 1.3),
		barrel = Vector3.new(0.36, 0.36, 1.1),
		grip = Vector3.new(0.44, 0.9, 0.55),
		colors = { body = rgb(70, 78, 92), barrel = rgb(48, 54, 64), grip = rgb(38, 32, 30), accent = rgb(255, 190, 60) },
	},
	{
		name = "Buzz SMG",
		auto = true,
		damage = 15, headMultiplier = 1.7, rps = 12, range = 260,
		spread = 2.6, pellets = 1, magazine = 30, reloadTime = 1.6, recoil = 0.85,
		body = Vector3.new(0.55, 0.8, 2),
		barrel = Vector3.new(0.32, 0.32, 1.2),
		grip = Vector3.new(0.46, 1, 0.6),
		magPart = Vector3.new(0.4, 1.1, 0.5),
		stock = Vector3.new(0.4, 0.55, 0.9),
		colors = { body = rgb(58, 92, 120), barrel = rgb(40, 44, 52), grip = rgb(30, 30, 34), accent = rgb(120, 220, 255) },
	},
	{
		name = "Boxy Rifle",
		auto = true,
		damage = 24, headMultiplier = 1.9, rps = 8.5, range = 420,
		spread = 1.6, pellets = 1, magazine = 25, reloadTime = 2, recoil = 1.25,
		body = Vector3.new(0.6, 0.85, 2.6),
		barrel = Vector3.new(0.3, 0.3, 1.8),
		grip = Vector3.new(0.48, 1.05, 0.62),
		magPart = Vector3.new(0.44, 1.25, 0.6),
		stock = Vector3.new(0.45, 0.7, 1.2),
		sight = Vector3.new(0.28, 0.34, 0.5),
		colors = { body = rgb(86, 104, 68), barrel = rgb(44, 48, 44), grip = rgb(34, 30, 26), accent = rgb(180, 255, 120) },
	},
	{
		name = "Slab Shotgun",
		auto = false,
		damage = 13, headMultiplier = 1.4, rps = 1.4, range = 90,
		spread = 6.5, pellets = 8, magazine = 6, reloadTime = 2.6, recoil = 4,
		body = Vector3.new(0.7, 0.95, 2.4),
		barrel = Vector3.new(0.5, 0.5, 2.1),
		grip = Vector3.new(0.5, 1.05, 0.7),
		stock = Vector3.new(0.5, 0.85, 1.4),
		colors = { body = rgb(120, 72, 44), barrel = rgb(52, 44, 40), grip = rgb(78, 46, 28), accent = rgb(255, 140, 60) },
	},
	{
		name = "Longshot",
		auto = false,
		damage = 82, headMultiplier = 1.6, rps = 0.9, range = 900,
		spread = 0.15, pellets = 1, magazine = 5, reloadTime = 2.9, recoil = 6,
		body = Vector3.new(0.55, 0.8, 3),
		barrel = Vector3.new(0.28, 0.28, 3),
		grip = Vector3.new(0.46, 1, 0.6),
		magPart = Vector3.new(0.4, 0.9, 0.55),
		stock = Vector3.new(0.5, 0.9, 1.6),
		sight = Vector3.new(0.34, 0.44, 1.5),
		colors = { body = rgb(50, 54, 74), barrel = rgb(32, 34, 44), grip = rgb(28, 26, 32), accent = rgb(255, 90, 120) },
	},
	{
		name = "Golden Deagle",
		auto = false,
		damage = 100, headMultiplier = 1.5, rps = 2.2, range = 400,
		spread = 0.8, pellets = 1, magazine = 7, reloadTime = 1.7, recoil = 5,
		body = Vector3.new(0.55, 0.85, 1.7),
		barrel = Vector3.new(0.4, 0.42, 1.5),
		grip = Vector3.new(0.48, 1, 0.6),
		sight = Vector3.new(0.24, 0.26, 0.4),
		colors = { body = rgb(226, 178, 44), barrel = rgb(198, 148, 30), grip = rgb(46, 34, 20), accent = rgb(255, 246, 200) },
	},
}

GunConfig.LadderSize = #GunConfig.Ladder

function GunConfig.get(tier: number): Gun
	local gun = GunConfig.Ladder[math.clamp(tier, 1, GunConfig.LadderSize)]
	assert(gun, "no gun at tier " .. tostring(tier))
	return gun :: any
end

-- Tuning shared by both sides so predicted and authoritative shots line up.
GunConfig.Rules = {
	respawnDelay = 2.5,
	roundIntermission = 6,
	matchCountdown = 5,
	-- How far the server lets a client's claimed muzzle position sit from the
	-- character's head before it throws the shot away. Generous enough for
	-- animation and latency, tight enough that nobody shoots from across the map.
	maxMuzzleOffset = 12,
	-- Shots are timed on the server too; this is the slack allowed for jitter.
	fireRateGrace = 0.06,
}

return GunConfig
