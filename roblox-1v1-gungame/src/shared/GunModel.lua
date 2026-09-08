--!nonstrict
-- Builds a gun out of Parts at runtime, so the place needs no imported meshes.
-- The same builder makes the third-person model welded to a character's hand
-- and the first-person view model parented to the camera; only the scale and
-- the collision flags differ.

local GunConfig = require(script.Parent.GunConfig)

local GunModel = {}

local function block(parent: Instance, name: string, size: Vector3, color: Color3, material: Enum.Material?): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.Color = color
	p.Material = material or Enum.Material.SmoothPlastic
	p.Anchored = false
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.Massless = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

local function weld(root: BasePart, part: BasePart, offset: CFrame)
	part.CFrame = root.CFrame * offset
	local w = Instance.new("WeldConstraint")
	w.Part0 = root
	w.Part1 = part
	w.Parent = part
end

-- Local axes of a gun model: -Z points down the barrel, +Y is up.
function GunModel.build(tier: number, scale: number?): Model
	local gun = GunConfig.get(tier)
	local k = scale or 1
	local model = Instance.new("Model")
	model.Name = gun.name

	local handle = block(model, "Handle", gun.body * k, gun.colors.body)
	handle.Anchored = true -- callers unanchor once they have positioned it
	model.PrimaryPart = handle

	local barrelZ = -(gun.body.Z / 2 + gun.barrel.Z / 2) * k
	local barrel = block(model, "Barrel", gun.barrel * k, gun.colors.barrel, Enum.Material.Metal)
	weld(handle, barrel, CFrame.new(0, gun.body.Y * 0.12 * k, barrelZ))

	local grip = block(model, "Grip", gun.grip * k, gun.colors.grip)
	weld(handle, grip, CFrame.new(0, (-(gun.body.Y / 2 + gun.grip.Y / 2) + 0.1) * k, gun.body.Z * 0.22 * k)
		* CFrame.Angles(math.rad(-12), 0, 0))

	if gun.magPart then
		local mag = block(model, "Magazine", gun.magPart * k, gun.colors.grip)
		weld(handle, mag, CFrame.new(0, (-(gun.body.Y / 2 + gun.magPart.Y / 2) + 0.15) * k, -gun.body.Z * 0.05 * k))
	end

	if gun.stock then
		local stock = block(model, "Stock", gun.stock * k, gun.colors.body)
		weld(handle, stock, CFrame.new(0, -gun.body.Y * 0.05 * k, (gun.body.Z / 2 + gun.stock.Z / 2) * k))
	end

	if gun.sight then
		local sight = block(model, "Sight", gun.sight * k, gun.colors.accent, Enum.Material.Neon)
		weld(handle, sight, CFrame.new(0, (gun.body.Y / 2 + gun.sight.Y / 2) * k, -gun.body.Z * 0.15 * k))
	end

	-- A neon slab along the receiver so the tier reads at a glance across the arena.
	local stripe = block(model, "Stripe", Vector3.new(gun.body.X + 0.04, 0.12, gun.body.Z * 0.6) * k, gun.colors.accent, Enum.Material.Neon)
	weld(handle, stripe, CFrame.new(0, gun.body.Y * 0.28 * k, 0))

	local muzzle = Instance.new("Attachment")
	muzzle.Name = "Muzzle"
	muzzle.CFrame = CFrame.new(0, 0, -gun.barrel.Z * k / 2)
	muzzle.Parent = barrel

	return model
end

-- World position the barrel actually ends at, for tracers and flashes.
function GunModel.muzzlePosition(model: Model): Vector3
	local barrel = model:FindFirstChild("Barrel") :: BasePart?
	if barrel then
		local att = barrel:FindFirstChild("Muzzle") :: Attachment?
		if att then
			return att.WorldPosition
		end
	end
	local primary = model.PrimaryPart
	return primary and primary.Position or Vector3.zero
end

return GunModel
