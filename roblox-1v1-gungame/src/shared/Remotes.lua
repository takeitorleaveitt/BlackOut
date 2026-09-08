--!nonstrict
-- One folder of remotes, created by whichever side gets there first on the
-- server and waited for on the client. Named in one place so a typo is a
-- missing key rather than a silently dead event.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local NAMES = {
	-- client -> server
	"FireRequest",     -- (origin: Vector3, direction: Vector3, shotId: number)
	"ReloadRequest",   -- ()
	"QueueRequest",    -- (wantsQueue: boolean)
	-- server -> client
	"WeaponState",     -- (tier, ammo, reloading, reloadEndsAt)
	"MatchState",      -- (state table for the HUD)
	"HitConfirm",      -- (damage: number, wasHeadshot: boolean, killed: boolean)
	"FireEffect",      -- (shooter: Player, from: Vector3, to: Vector3, tier: number)
}

local Remotes = {}

local function container(): Folder
	local existing = ReplicatedStorage:FindFirstChild("GunGameRemotes")
	if existing then
		return existing :: Folder
	end
	if RunService:IsServer() then
		local folder = Instance.new("Folder")
		folder.Name = "GunGameRemotes"
		folder.Parent = ReplicatedStorage
		return folder
	end
	return ReplicatedStorage:WaitForChild("GunGameRemotes") :: Folder
end

function Remotes.get(name: string): RemoteEvent
	local folder = container()
	local found = folder:FindFirstChild(name)
	if found then
		return found :: RemoteEvent
	end
	assert(table.find(NAMES, name), "unknown remote: " .. name)
	if RunService:IsServer() then
		local remote = Instance.new("RemoteEvent")
		remote.Name = name
		remote.Parent = folder
		return remote
	end
	return folder:WaitForChild(name) :: RemoteEvent
end

-- The server calls this once at boot so the client never races a missing event.
function Remotes.createAll()
	for _, name in ipairs(NAMES) do
		Remotes.get(name)
	end
end

return Remotes
