--!nonstrict
-- Input, view model, camera recoil and effects. Nothing here is trusted by the
-- server: it sends an aim direction and draws what the server tells it.

local ContextActionService = game:GetService("ContextActionService")
local Debris = game:GetService("Debris")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local Shared = ReplicatedStorage:WaitForChild("GunGameShared")
local GunConfig = require(Shared:WaitForChild("GunConfig"))
local GunModel = require(Shared:WaitForChild("GunModel"))
local Remotes = require(Shared:WaitForChild("Remotes"))

local Hud = require(script.Parent:WaitForChild("Hud"))

local player = Players.LocalPlayer
local camera = workspace.CurrentCamera

local fireRemote = Remotes.get("FireRequest")
local reloadRemote = Remotes.get("ReloadRequest")
local queueRemote = Remotes.get("QueueRequest")
local weaponStateRemote = Remotes.get("WeaponState")
local matchStateRemote = Remotes.get("MatchState")
local hitRemote = Remotes.get("HitConfirm")
local effectRemote = Remotes.get("FireEffect")

Hud.create()

local state = {
	tier = 1,
	ammo = 0,
	reloading = false,
	enabled = false,
	queued = false,
	playing = false,
	holding = false,
	lastShot = 0,
	viewModel = nil :: Model?,
	-- Recoil in two halves: `pending` is kick that has not been fed to the
	-- camera yet, `applied` is how far the camera is currently pushed off aim.
	-- Each frame a slice of pending goes in and a slice of applied comes back
	-- out, so the view rises fast and settles slowly and — crucially — always
	-- returns to where it started instead of drifting up the sky.
	pending = Vector2.zero,
	applied = Vector2.zero,
	sway = Vector2.zero,
}

local VIEW_OFFSET = CFrame.new(0.85, -0.75, -1.4)

local function clearViewModel()
	if state.viewModel then
		state.viewModel:Destroy()
		state.viewModel = nil
	end
end

local function buildViewModel(tier: number)
	clearViewModel()
	if not state.enabled then
		return
	end
	local model = GunModel.build(tier, 0.62)
	for _, d in ipairs(model:GetDescendants()) do
		if d:IsA("BasePart") then
			d.Anchored = true
			d.CanCollide = false
			d.CanQuery = false
			d.CanTouch = false
			d.CastShadow = false
			d.LocalTransparencyModifier = 0
		end
	end
	model.Parent = camera
	state.viewModel = model
end

local function updateViewModel()
	local model = state.viewModel
	if not model then
		return
	end
	local target = camera.CFrame
		* CFrame.Angles(math.rad(state.sway.Y), math.rad(state.sway.X), 0)
		* VIEW_OFFSET
	model:PivotTo(target)
end

local function applyRecoil(degrees: number)
	state.pending += Vector2.new((math.random() - 0.5) * degrees * 0.6, degrees)
end

local function tracer(from: Vector3, to: Vector3, color: Color3)
	local distance = (to - from).Magnitude
	if distance < 0.5 then
		return
	end
	local beam = Instance.new("Part")
	beam.Anchored = true
	beam.CanCollide = false
	beam.CanQuery = false
	beam.CanTouch = false
	beam.CastShadow = false
	beam.Material = Enum.Material.Neon
	beam.Color = color
	beam.Size = Vector3.new(0.12, 0.12, distance)
	beam.CFrame = CFrame.lookAt(from:Lerp(to, 0.5), to)
	beam.Parent = workspace
	Debris:AddItem(beam, 0.08)
end

local function muzzleFlash(at: Vector3, color: Color3)
	local flash = Instance.new("Part")
	flash.Anchored = true
	flash.CanCollide = false
	flash.CanQuery = false
	flash.CanTouch = false
	flash.CastShadow = false
	flash.Shape = Enum.PartType.Ball
	flash.Size = Vector3.new(0.7, 0.7, 0.7)
	flash.Material = Enum.Material.Neon
	flash.Color = color
	flash.Position = at
	flash.Parent = workspace
	local light = Instance.new("PointLight")
	light.Brightness = 4
	light.Range = 14
	light.Color = color
	light.Parent = flash
	Debris:AddItem(flash, 0.06)
end

local function tryFire()
	if not state.enabled or state.reloading then
		return
	end
	local gun = GunConfig.get(state.tier)
	local now = os.clock()
	if now - state.lastShot < 1 / gun.rps then
		return
	end
	if state.ammo <= 0 then
		reloadRemote:FireServer()
		return
	end
	state.lastShot = now

	local origin = camera.CFrame.Position
	local direction = camera.CFrame.LookVector
	fireRemote:FireServer(origin, direction)

	applyRecoil(gun.recoil)
	local model = state.viewModel
	if model then
		muzzleFlash(GunModel.muzzlePosition(model), gun.colors.accent)
	end
end

-- Input -----------------------------------------------------------------

ContextActionService:BindAction("GunGameFire", function(_, inputState)
	if inputState == Enum.UserInputState.Begin then
		state.holding = true
		tryFire()
	elseif inputState == Enum.UserInputState.End then
		state.holding = false
	end
	return Enum.ContextActionResult.Pass
end, true, Enum.UserInputType.MouseButton1, Enum.UserInputType.Touch)

ContextActionService:BindAction("GunGameReload", function(_, inputState)
	if inputState == Enum.UserInputState.Begin then
		reloadRemote:FireServer()
	end
	return Enum.ContextActionResult.Pass
end, true, Enum.KeyCode.R, Enum.KeyCode.ButtonX)

ContextActionService:BindAction("GunGameQueue", function(_, inputState)
	if inputState == Enum.UserInputState.Begin and not state.playing then
		state.queued = not state.queued
		queueRemote:FireServer(state.queued)
		Hud.setQueued(state.queued, state.playing)
	end
	return Enum.ContextActionResult.Pass
end, true, Enum.KeyCode.E, Enum.KeyCode.ButtonY)

-- Server messages -------------------------------------------------------

weaponStateRemote.OnClientEvent:Connect(function(tier, ammo, reloading, enabled)
	local tierChanged = tier ~= state.tier
	local enabledChanged = enabled ~= state.enabled
	state.tier, state.ammo, state.reloading, state.enabled = tier, ammo, reloading, enabled

	local gun = GunConfig.get(tier)
	Hud.setWeapon(gun.name, ammo, gun.magazine, reloading, enabled)

	if enabledChanged or tierChanged then
		if enabled then
			buildViewModel(tier)
		else
			clearViewModel()
		end
	end

	local humanoid = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid.CameraMode = enabled and Enum.CameraMode.LockFirstPerson or Enum.CameraMode.Classic
	end
end)

matchStateRemote.OnClientEvent:Connect(function(payload)
	state.playing = false
	for _, entry in ipairs(payload.players) do
		if entry.userId == player.UserId then
			state.playing = true
		end
	end
	if state.playing then
		state.queued = false
	end
	Hud.setMatch(payload)
	Hud.setQueued(state.queued, state.playing)
end)

hitRemote.OnClientEvent:Connect(function(_damage, _wasHeadshot, killed)
	Hud.flashHit(killed == true)
end)

effectRemote.OnClientEvent:Connect(function(shooter, from, to, tier)
	local gun = GunConfig.get(tier)
	local start = from
	if shooter == player and state.viewModel then
		-- Draw our own tracer from the view model's barrel, not from the
		-- server's head-height origin, or it looks like it comes out of an eye.
		start = GunModel.muzzlePosition(state.viewModel)
	else
		muzzleFlash(from, gun.colors.accent)
	end
	tracer(start, to, gun.colors.accent)
end)

-- Per-frame -------------------------------------------------------------

RunService.RenderStepped:Connect(function(dt)
	if state.holding and state.enabled then
		local gun = GunConfig.get(state.tier)
		if gun.auto then
			tryFire()
		end
	end

	if state.pending.Magnitude > 0.0001 or state.applied.Magnitude > 0.0001 then
		local push = state.pending * math.clamp(dt * 22, 0, 1)
		local recover = state.applied * math.clamp(dt * 6, 0, 1)
		state.pending -= push
		state.applied += push - recover
		local delta = push - recover
		camera.CFrame = camera.CFrame * CFrame.Angles(math.rad(delta.Y), math.rad(-delta.X), 0)
	end

	local mouseDelta = UserInputService:GetMouseDelta()
	state.sway = state.sway:Lerp(Vector2.new(
		math.clamp(-mouseDelta.X * 0.06, -4, 4),
		math.clamp(mouseDelta.Y * 0.06, -4, 4)
	), math.clamp(dt * 10, 0, 1))

	updateViewModel()
end)

Hud.setQueued(false, false)
