--!nonstrict
-- Entry point. Everything else is a module so it can be required in a test
-- place without booting a match.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("GunGameShared")
local Remotes = require(Shared:WaitForChild("Remotes"))

Remotes.createAll()

local WeaponService = require(script.Parent:WaitForChild("WeaponService"))
local MatchService = require(script.Parent:WaitForChild("MatchService"))

WeaponService.start()
MatchService.start()

print("[GunGame] 1v1 gun game ready")
