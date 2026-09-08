--!nonstrict
-- The map, built from a written-down footprint table rather than by eye.
-- Every brush below is {name, centre x, centre y (bottom of the box), centre z,
-- size x, size y, size z}; y is the FLOOR height of the brush, so a wall never
-- ends up half-sunk because someone forgot to add half its height.
--
-- Arena is 96 x 96 studs, walled, mirror-symmetric about z = 0 so neither
-- spawn has the better cover. Lobby sits 300 studs above it, out of sight.

local ARENA_HALF = 48
local WALL_HEIGHT = 24

type Brush = { name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: Color3?, material: Enum.Material? }

local GREY = Color3.fromRGB(96, 100, 108)
local DARK = Color3.fromRGB(58, 62, 70)
local CRATE = Color3.fromRGB(140, 104, 62)
local ACCENT_A = Color3.fromRGB(90, 170, 255)
local ACCENT_B = Color3.fromRGB(255, 110, 110)

-- Cover, mirrored: each entry is written once for +z and reflected to -z.
local HALF_COVER: { Brush } = {
	{ name = "CrateA", x = -18, y = 0, z = 14, sx = 8, sy = 6, sz = 8, color = CRATE },
	{ name = "CrateB", x = 0, y = 0, z = 22, sx = 12, sy = 5, sz = 6, color = CRATE },
	{ name = "CrateC", x = 20, y = 0, z = 12, sx = 6, sy = 9, sz = 6, color = DARK },
	{ name = "WallA", x = -30, y = 0, z = 30, sx = 3, sy = 12, sz = 20, color = GREY },
	{ name = "WallB", x = 30, y = 0, z = 32, sx = 20, sy = 12, sz = 3, color = GREY },
	{ name = "Ledge", x = 0, y = 9, z = 36, sx = 26, sy = 1.5, sz = 10, color = DARK },
	{ name = "Ramp", x = 12, y = 0, z = 40, sx = 6, sy = 9, sz = 6, color = DARK },
}

-- Centre-line pieces, on the axis of symmetry.
local CENTRE: { Brush } = {
	{ name = "Pillar1", x = -12, y = 0, z = 0, sx = 5, sy = 16, sz = 5, color = GREY },
	{ name = "Pillar2", x = 12, y = 0, z = 0, sx = 5, sy = 16, sz = 5, color = GREY },
	{ name = "MidBlock", x = 0, y = 0, z = 0, sx = 10, sy = 4, sz = 10, color = DARK },
}

local Arena = {}

local function part(brush: Brush, parent: Instance, origin: Vector3): Part
	local p = Instance.new("Part")
	p.Name = brush.name
	p.Anchored = true
	p.Size = Vector3.new(brush.sx, brush.sy, brush.sz)
	p.Position = origin + Vector3.new(brush.x, brush.y + brush.sy / 2, brush.z)
	p.Color = brush.color or GREY
	p.Material = brush.material or Enum.Material.Concrete
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

local function pad(parent: Instance, name: string, position: Vector3, color: Color3): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Anchored = true
	p.Size = Vector3.new(8, 1, 8)
	p.Position = position
	p.Color = color
	p.Material = Enum.Material.Neon
	p.Parent = parent
	return p
end

export type Built = {
	folder: Folder,
	spawns: { CFrame },      -- one per player slot, facing the centre
	lobbySpawn: CFrame,
}

function Arena.build(origin: Vector3?): Built
	local o = origin or Vector3.zero
	local existing = workspace:FindFirstChild("GunGameArena")
	if existing then
		existing:Destroy()
	end

	local folder = Instance.new("Folder")
	folder.Name = "GunGameArena"
	folder.Parent = workspace

	local floor = Instance.new("Part")
	floor.Name = "Floor"
	floor.Anchored = true
	floor.Size = Vector3.new(ARENA_HALF * 2, 2, ARENA_HALF * 2)
	floor.Position = o + Vector3.new(0, -1, 0)
	floor.Color = Color3.fromRGB(74, 78, 84)
	floor.Material = Enum.Material.Slate
	floor.Parent = folder

	local walls: { Brush } = {
		{ name = "WallNorth", x = 0, y = 0, z = -ARENA_HALF, sx = ARENA_HALF * 2, sy = WALL_HEIGHT, sz = 2 },
		{ name = "WallSouth", x = 0, y = 0, z = ARENA_HALF, sx = ARENA_HALF * 2, sy = WALL_HEIGHT, sz = 2 },
		{ name = "WallEast", x = ARENA_HALF, y = 0, z = 0, sx = 2, sy = WALL_HEIGHT, sz = ARENA_HALF * 2 },
		{ name = "WallWest", x = -ARENA_HALF, y = 0, z = 0, sx = 2, sy = WALL_HEIGHT, sz = ARENA_HALF * 2 },
	}
	for _, brush in ipairs(walls) do
		part(brush, folder, o)
	end

	for _, brush in ipairs(CENTRE) do
		part(brush, folder, o)
	end
	for _, brush in ipairs(HALF_COVER) do
		part(brush, folder, o)
		local mirrored: Brush = table.clone(brush)
		mirrored.name = brush.name .. "_M"
		mirrored.z = -brush.z
		mirrored.x = -brush.x
		part(mirrored, folder, o)
	end

	local aPos = o + Vector3.new(0, 1, ARENA_HALF - 8)
	local bPos = o + Vector3.new(0, 1, -(ARENA_HALF - 8))
	pad(folder, "SpawnA", aPos, ACCENT_A)
	pad(folder, "SpawnB", bPos, ACCENT_B)

	-- Lobby: a plain island well above the arena, with no line of sight to it.
	local lobby = Instance.new("Part")
	lobby.Name = "LobbyFloor"
	lobby.Anchored = true
	lobby.Size = Vector3.new(48, 2, 48)
	lobby.Position = o + Vector3.new(0, 300, 0)
	lobby.Color = Color3.fromRGB(40, 44, 56)
	lobby.Material = Enum.Material.Metal
	lobby.Parent = folder

	-- Four thin walls, not one box: a solid box on the lobby floor would bury
	-- anyone who spawned inside it.
	for _, spec in ipairs({
		{ name = "LobbyRailN", offset = Vector3.new(0, 3, -25), size = Vector3.new(50, 6, 1) },
		{ name = "LobbyRailS", offset = Vector3.new(0, 3, 25), size = Vector3.new(50, 6, 1) },
		{ name = "LobbyRailE", offset = Vector3.new(25, 3, 0), size = Vector3.new(1, 6, 50) },
		{ name = "LobbyRailW", offset = Vector3.new(-25, 3, 0), size = Vector3.new(1, 6, 50) },
	}) do
		local rail = Instance.new("Part")
		rail.Name = spec.name
		rail.Anchored = true
		rail.Size = spec.size
		rail.Position = lobby.Position + spec.offset
		rail.Transparency = 0.75
		rail.Color = ACCENT_A
		rail.Material = Enum.Material.ForceField
		rail.Parent = folder
	end

	return {
		folder = folder,
		spawns = {
			CFrame.lookAt(aPos + Vector3.new(0, 4, 0), Vector3.new(o.X, aPos.Y + 4, o.Z)),
			CFrame.lookAt(bPos + Vector3.new(0, 4, 0), Vector3.new(o.X, bPos.Y + 4, o.Z)),
		},
		lobbySpawn = CFrame.new(lobby.Position + Vector3.new(0, 5, 0)),
	}
end

return Arena
