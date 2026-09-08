--!nonstrict
-- Queue, 1v1 match, gun ladder. One arena means one live match at a time;
-- everyone else waits in the lobby and can watch the scoreboard.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("GunGameShared")
local GunConfig = require(Shared:WaitForChild("GunConfig"))
local Remotes = require(Shared:WaitForChild("Remotes"))

local Arena = require(script.Parent:WaitForChild("Arena"))
local WeaponService = require(script.Parent:WaitForChild("WeaponService"))

local matchStateRemote = Remotes.get("MatchState")
local queueRemote = Remotes.get("QueueRequest")

local MatchService = {}

local arena = nil :: any
local queue: { Player } = {}
local match: {
	players: { Player },
	tier: { [Player]: number },
	kills: { [Player]: number },
	phase: string,
	countdown: number,
	winner: Player?,
	generation: number,
}? = nil
local generation = 0

local function inQueue(player: Player): boolean
	return table.find(queue, player) ~= nil
end

local function isPlaying(player: Player): boolean
	return match ~= nil and table.find(match.players, player) ~= nil
end

local function broadcast()
	local payload = {
		phase = match and match.phase or "waiting",
		countdown = match and match.countdown or 0,
		queued = #queue,
		ladderSize = GunConfig.LadderSize,
		players = {},
		winner = match and match.winner and match.winner.Name or nil,
	}
	if match then
		for _, player in ipairs(match.players) do
			table.insert(payload.players, {
				name = player.Name,
				userId = player.UserId,
				tier = match.tier[player],
				gun = GunConfig.get(match.tier[player]).name,
				kills = match.kills[player],
			})
		end
	end
	matchStateRemote:FireAllClients(payload)
end

local function spawnAt(player: Player, cframe: CFrame)
	local character = player.Character
	if not character then
		player:LoadCharacter()
		character = player.Character or player.CharacterAdded:Wait()
	end
	character:PivotTo(cframe + Vector3.new(0, 3, 0))
end

local function sendToLobby(player: Player)
	WeaponService.setEnabled(player, false)
	player:LoadCharacter()
	task.defer(function()
		if player.Parent then
			spawnAt(player, arena.lobbySpawn)
		end
	end)
end

local function endMatch(winner: Player?)
	if not match then
		return
	end
	local finished = match
	finished.phase = "over"
	finished.winner = winner
	broadcast()

	for _, player in ipairs(finished.players) do
		WeaponService.setEnabled(player, false)
	end

	task.delay(GunConfig.Rules.roundIntermission, function()
		if match ~= finished then
			return
		end
		for _, player in ipairs(finished.players) do
			if player.Parent then
				sendToLobby(player)
			end
		end
		match = nil
		broadcast()
		MatchService.tryStart()
	end)
end

local function respawnFighter(player: Player, slot: number)
	local current = match
	if not current then
		return
	end
	local gen = current.generation
	task.delay(GunConfig.Rules.respawnDelay, function()
		if match ~= current or current.generation ~= gen or current.phase ~= "active" then
			return
		end
		if not player.Parent then
			return
		end
		player:LoadCharacter()
		task.defer(function()
			if match ~= current or not player.Parent then
				return
			end
			spawnAt(player, arena.spawns[slot])
			WeaponService.setTier(player, current.tier[player])
			WeaponService.setEnabled(player, true)
		end)
	end)
end

local function slotOf(player: Player): number
	return match and table.find(match.players, player) or 1
end

local function onKill(killer: Player, victim: Player)
	if not (match and match.phase == "active") then
		return
	end
	if not (isPlaying(killer) and isPlaying(victim)) then
		return
	end
	match.kills[killer] += 1
	local nextTier = match.tier[killer] + 1
	if nextTier > GunConfig.LadderSize then
		endMatch(killer)
		return
	end
	match.tier[killer] = nextTier
	WeaponService.setTier(killer, nextTier)
	respawnFighter(victim, slotOf(victim))
	broadcast()
end

function MatchService.tryStart()
	if match or #queue < 2 then
		broadcast()
		return
	end
	local a = table.remove(queue, 1) :: Player
	local b = table.remove(queue, 1) :: Player
	if not (a and a.Parent and b and b.Parent) then
		-- Somebody left between queueing and starting; put back whoever is still here.
		if a and a.Parent then table.insert(queue, 1, a) end
		if b and b.Parent then table.insert(queue, 1, b) end
		broadcast()
		return
	end

	generation += 1
	local current = {
		players = { a, b },
		tier = { [a] = 1, [b] = 1 },
		kills = { [a] = 0, [b] = 0 },
		phase = "countdown",
		countdown = GunConfig.Rules.matchCountdown,
		winner = nil,
		generation = generation,
	}
	match = current

	for slot, player in ipairs(current.players) do
		player:LoadCharacter()
		task.defer(function()
			if match ~= current or not player.Parent then
				return
			end
			spawnAt(player, arena.spawns[slot])
			WeaponService.setTier(player, 1)
			WeaponService.setEnabled(player, false)
		end)
	end

	task.spawn(function()
		while match == current and current.countdown > 0 do
			broadcast()
			task.wait(1)
			current.countdown -= 1
		end
		if match ~= current then
			return
		end
		current.phase = "active"
		for _, player in ipairs(current.players) do
			if player.Parent then
				WeaponService.setEnabled(player, true)
			end
		end
		broadcast()
	end)

	broadcast()
end

local function setQueued(player: Player, wants: boolean)
	if isPlaying(player) then
		return
	end
	if wants and not inQueue(player) then
		table.insert(queue, player)
	elseif not wants then
		local index = table.find(queue, player)
		if index then
			table.remove(queue, index)
		end
	end
	MatchService.tryStart()
	broadcast()
end

local function watchCharacter(player: Player, character: Model)
	local humanoid = character:WaitForChild("Humanoid") :: Humanoid
	humanoid.Died:Connect(function()
		if not isPlaying(player) then
			task.delay(GunConfig.Rules.respawnDelay, function()
				if player.Parent and not isPlaying(player) then
					sendToLobby(player)
				end
			end)
			return
		end
		-- A death nobody was credited for (a fall, the void) still costs a
		-- respawn but gives the opponent nothing.
		task.delay(0.1, function()
			local current = match
			if current and current.phase == "active" and player.Character == character then
				respawnFighter(player, slotOf(player))
			end
		end)
	end)
end

function MatchService.start()
	arena = Arena.build(Vector3.new(0, 0, 0))
	WeaponService.onKill = onKill

	Players.CharacterAutoLoads = false

	local function setup(player: Player)
		player.CharacterAdded:Connect(function(character)
			watchCharacter(player, character)
		end)
		sendToLobby(player)
		broadcast()
	end

	for _, player in ipairs(Players:GetPlayers()) do
		task.spawn(setup, player)
	end
	Players.PlayerAdded:Connect(setup)

	Players.PlayerRemoving:Connect(function(player)
		local index = table.find(queue, player)
		if index then
			table.remove(queue, index)
		end
		if match and isPlaying(player) then
			local other = match.players[1] == player and match.players[2] or match.players[1]
			endMatch(other.Parent and other or nil)
		end
		broadcast()
	end)

	queueRemote.OnServerEvent:Connect(function(player, wants)
		setQueued(player, wants == true)
	end)
end

return MatchService
