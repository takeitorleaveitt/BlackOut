--!nonstrict
-- Server-authoritative shooting. The client sends where it is aiming and
-- nothing else: the origin, the spread, the ammo count, the fire rate and the
-- damage all come from here, so a client that lies about them changes nothing.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("GunGameShared")
local GunConfig = require(Shared:WaitForChild("GunConfig"))
local GunModel = require(Shared:WaitForChild("GunModel"))
local Remotes = require(Shared:WaitForChild("Remotes"))

type State = {
	tier: number,
	ammo: number,
	reloading: boolean,
	reloadToken: number,
	lastShot: number,
	enabled: boolean,
	model: Model?,
}

local WeaponService = {}
WeaponService.states = {} :: { [Player]: State }

-- Set by MatchService; called as onKill(killer, victim) and onDamage(victim).
WeaponService.onKill = nil :: ((Player, Player) -> ())?

local fireRemote = Remotes.get("FireRequest")
local reloadRemote = Remotes.get("ReloadRequest")
local weaponStateRemote = Remotes.get("WeaponState")
local hitRemote = Remotes.get("HitConfirm")
local effectRemote = Remotes.get("FireEffect")

local function stateFor(player: Player): State
	local s = WeaponService.states[player]
	if not s then
		s = {
			tier = 1, ammo = GunConfig.get(1).magazine, reloading = false,
			reloadToken = 0, lastShot = 0, enabled = false, model = nil,
		}
		WeaponService.states[player] = s
	end
	return s
end

local function push(player: Player)
	local s = stateFor(player)
	weaponStateRemote:FireClient(player, s.tier, s.ammo, s.reloading, s.enabled)
end

local function attachModel(player: Player, tier: number)
	local s = stateFor(player)
	if s.model then
		s.model:Destroy()
		s.model = nil
	end
	local character = player.Character
	local hand = character and (character:FindFirstChild("RightHand") or character:FindFirstChild("Right Arm")) :: BasePart?
	if not (character and hand) then
		return
	end

	local model = GunModel.build(tier)
	local handle = model.PrimaryPart :: BasePart
	handle.CFrame = hand.CFrame * CFrame.new(0, -0.8, -0.6) * CFrame.Angles(0, math.rad(180), 0)
	handle.Anchored = false
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = hand
	weld.Part1 = handle
	weld.Parent = handle
	model.Parent = character
	s.model = model
end

function WeaponService.setTier(player: Player, tier: number)
	local s = stateFor(player)
	s.tier = math.clamp(tier, 1, GunConfig.LadderSize)
	s.ammo = GunConfig.get(s.tier).magazine
	s.reloading = false
	s.reloadToken += 1
	attachModel(player, s.tier)
	push(player)
end

function WeaponService.setEnabled(player: Player, enabled: boolean)
	local s = stateFor(player)
	s.enabled = enabled
	if not enabled and s.model then
		s.model:Destroy()
		s.model = nil
	end
	push(player)
end

function WeaponService.clear(player: Player)
	local s = WeaponService.states[player]
	if s and s.model then
		s.model:Destroy()
	end
	WeaponService.states[player] = nil
end

local function humanoidOf(player: Player): (Humanoid?, BasePart?)
	local character = player.Character
	if not character then
		return nil, nil
	end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	local head = character:FindFirstChild("Head") :: BasePart?
	if humanoid and humanoid.Health > 0 and head then
		return humanoid, head
	end
	return nil, nil
end

-- Cone of `degrees` around a unit direction. Uniform on the cap, not on the
-- square, so pellets do not clump in the corners of the spread.
local function jitter(direction: Vector3, degrees: number): Vector3
	if degrees <= 0 then
		return direction
	end
	local maxAngle = math.rad(degrees)
	local theta = math.acos(1 - math.random() * (1 - math.cos(maxAngle)))
	local phi = math.random() * math.pi * 2
	local up = math.abs(direction.Y) > 0.99 and Vector3.new(1, 0, 0) or Vector3.new(0, 1, 0)
	local right = direction:Cross(up).Unit
	local trueUp = right:Cross(direction).Unit
	return (direction * math.cos(theta)
		+ (right * math.cos(phi) + trueUp * math.sin(phi)) * math.sin(theta)).Unit
end

local function characterOf(instance: Instance): (Player?, Humanoid?)
	local model = instance:FindFirstAncestorOfClass("Model")
	while model do
		local humanoid = model:FindFirstChildOfClass("Humanoid")
		if humanoid then
			return Players:GetPlayerFromCharacter(model), humanoid
		end
		model = model:FindFirstAncestorOfClass("Model")
	end
	return nil, nil
end

local function startReload(player: Player)
	local s = stateFor(player)
	local gun = GunConfig.get(s.tier)
	if s.reloading or s.ammo >= gun.magazine or not s.enabled then
		return
	end
	s.reloading = true
	s.reloadToken += 1
	local token = s.reloadToken
	push(player)
	task.delay(gun.reloadTime, function()
		local now = WeaponService.states[player]
		if not now or now.reloadToken ~= token or not now.reloading then
			return
		end
		now.reloading = false
		now.ammo = GunConfig.get(now.tier).magazine
		push(player)
	end)
end

local function onFire(player: Player, origin: unknown, direction: unknown)
	if typeof(origin) ~= "Vector3" or typeof(direction) ~= "Vector3" then
		return
	end
	local s = stateFor(player)
	if not s.enabled or s.reloading then
		return
	end

	local humanoid, head = humanoidOf(player)
	if not (humanoid and head) then
		return
	end

	local gun = GunConfig.get(s.tier)
	local now = os.clock()
	if now - s.lastShot < (1 / gun.rps) - GunConfig.Rules.fireRateGrace then
		return
	end
	if s.ammo <= 0 then
		startReload(player)
		return
	end
	s.lastShot = now
	s.ammo -= 1

	-- The shot always leaves the server's idea of the player's head. The
	-- client's origin is only used to check it is not shooting from orbit.
	if (origin - head.Position).Magnitude > GunConfig.Rules.maxMuzzleOffset then
		push(player)
		return
	end
	if direction.Magnitude < 0.001 then
		push(player)
		return
	end
	local aim = direction.Unit
	local from = head.Position + aim * 1.2

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { player.Character :: Instance }
	params.IgnoreWater = true

	local damageByPlayer: { [Player]: { amount: number, head: boolean } } = {}
	local lastEnd = from + aim * gun.range

	for _ = 1, gun.pellets do
		local pelletDir = jitter(aim, gun.spread)
		local result = workspace:Raycast(from, pelletDir * gun.range, params)
		local hitAt = result and result.Position or (from + pelletDir * gun.range)
		lastEnd = hitAt
		if result then
			local victim, victimHumanoid = characterOf(result.Instance)
			if victim and victimHumanoid and victimHumanoid.Health > 0 and victim ~= player then
				local isHead = result.Instance.Name == "Head"
				local amount = isHead and gun.damage * gun.headMultiplier or gun.damage
				local entry = damageByPlayer[victim] or { amount = 0, head = false }
				entry.amount += amount
				entry.head = entry.head or isHead
				damageByPlayer[victim] = entry
			end
		end
	end

	effectRemote:FireAllClients(player, from, lastEnd, s.tier)

	for victim, entry in pairs(damageByPlayer) do
		local victimHumanoid = victim.Character and victim.Character:FindFirstChildOfClass("Humanoid")
		if victimHumanoid and victimHumanoid.Health > 0 then
			local killed = entry.amount >= victimHumanoid.Health
			victimHumanoid:TakeDamage(entry.amount)
			hitRemote:FireClient(player, entry.amount, entry.head, killed)
			if killed and WeaponService.onKill then
				(WeaponService.onKill :: any)(player, victim)
			end
		end
	end

	push(player)
end

function WeaponService.start()
	fireRemote.OnServerEvent:Connect(function(player, origin, direction)
		local ok, err = pcall(onFire, player, origin, direction)
		if not ok then
			warn("[GunGame] fire failed for " .. player.Name .. ": " .. tostring(err))
		end
	end)
	reloadRemote.OnServerEvent:Connect(function(player)
		startReload(player)
	end)
	Players.PlayerRemoving:Connect(WeaponService.clear)
end

return WeaponService
