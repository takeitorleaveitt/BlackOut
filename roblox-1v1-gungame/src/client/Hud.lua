--!nonstrict
-- All the on-screen furniture: crosshair, ammo, ladder progress, scoreboard,
-- queue prompt, hitmarker. Built in code so the place needs no StarterGui setup.

local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")

local Hud = {}

local player = Players.LocalPlayer

local function label(parent: Instance, name: string, text: string, size: UDim2, position: UDim2, textSize: number): TextLabel
	local l = Instance.new("TextLabel")
	l.Name = name
	l.BackgroundTransparency = 1
	l.Size = size
	l.Position = position
	l.Font = Enum.Font.GothamBold
	l.TextSize = textSize
	l.TextColor3 = Color3.fromRGB(255, 255, 255)
	l.TextStrokeTransparency = 0.4
	l.Text = text
	l.Parent = parent
	return l
end

function Hud.create()
	local gui = Instance.new("ScreenGui")
	gui.Name = "GunGameHud"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui.Parent = player:WaitForChild("PlayerGui")

	-- Crosshair: four ticks, no centre dot, so a distant target is not hidden.
	local cross = Instance.new("Frame")
	cross.Name = "Crosshair"
	cross.BackgroundTransparency = 1
	cross.Size = UDim2.fromOffset(40, 40)
	cross.Position = UDim2.new(0.5, -20, 0.5, -20)
	cross.Parent = gui
	for _, spec in ipairs({
		{ n = "Up", s = UDim2.fromOffset(2, 10), p = UDim2.new(0.5, -1, 0, 0) },
		{ n = "Down", s = UDim2.fromOffset(2, 10), p = UDim2.new(0.5, -1, 1, -10) },
		{ n = "Left", s = UDim2.fromOffset(10, 2), p = UDim2.new(0, 0, 0.5, -1) },
		{ n = "Right", s = UDim2.fromOffset(10, 2), p = UDim2.new(1, -10, 0.5, -1) },
	}) do
		local tick = Instance.new("Frame")
		tick.Name = spec.n
		tick.Size = spec.s
		tick.Position = spec.p
		tick.BorderSizePixel = 0
		tick.BackgroundColor3 = Color3.fromRGB(240, 240, 240)
		tick.Parent = cross
	end

	local hitmarker = Instance.new("TextLabel")
	hitmarker.Name = "Hitmarker"
	hitmarker.BackgroundTransparency = 1
	hitmarker.Size = UDim2.fromOffset(60, 60)
	hitmarker.Position = UDim2.new(0.5, -30, 0.5, -30)
	hitmarker.Font = Enum.Font.GothamBold
	hitmarker.TextSize = 34
	hitmarker.Text = "✕"
	hitmarker.TextTransparency = 1
	hitmarker.TextColor3 = Color3.fromRGB(255, 90, 90)
	hitmarker.Parent = gui

	local ammo = label(gui, "Ammo", "-- / --", UDim2.fromOffset(320, 46), UDim2.new(1, -350, 1, -90), 34)
	ammo.TextXAlignment = Enum.TextXAlignment.Right

	local gun = label(gui, "Gun", "", UDim2.fromOffset(320, 26), UDim2.new(1, -350, 1, -118), 20)
	gun.TextXAlignment = Enum.TextXAlignment.Right
	gun.TextColor3 = Color3.fromRGB(200, 210, 230)

	local banner = label(gui, "Banner", "", UDim2.new(1, 0, 0, 50), UDim2.new(0, 0, 0.16, 0), 40)

	local sub = label(gui, "Sub", "", UDim2.new(1, 0, 0, 28), UDim2.new(0, 0, 0.16, 52), 20)
	sub.TextColor3 = Color3.fromRGB(190, 200, 220)

	local board = Instance.new("Frame")
	board.Name = "Scoreboard"
	board.Size = UDim2.fromOffset(360, 96)
	board.Position = UDim2.new(0.5, -180, 0, 16)
	board.BackgroundColor3 = Color3.fromRGB(12, 14, 20)
	board.BackgroundTransparency = 0.35
	board.BorderSizePixel = 0
	board.Parent = gui
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 8)
	corner.Parent = board

	local rows = {}
	for i = 1, 2 do
		local row = label(board, "Row" .. i, "", UDim2.new(1, -20, 0, 30), UDim2.new(0, 10, 0, 8 + (i - 1) * 34), 20)
		row.TextXAlignment = Enum.TextXAlignment.Left
		rows[i] = row
	end

	local prompt = label(gui, "Prompt", "[E] Join the queue", UDim2.new(1, 0, 0, 30), UDim2.new(0, 0, 1, -50), 22)
	prompt.TextColor3 = Color3.fromRGB(255, 220, 120)

	Hud.gui = gui
	Hud.ammo = ammo
	Hud.gunLabel = gun
	Hud.banner = banner
	Hud.sub = sub
	Hud.rows = rows
	Hud.board = board
	Hud.prompt = prompt
	Hud.hitmarker = hitmarker
	Hud.crosshair = cross
	return gui
end

function Hud.setWeapon(gunName: string, ammoCount: number, magazine: number, reloading: boolean, enabled: boolean)
	Hud.crosshair.Visible = enabled
	Hud.ammo.Visible = enabled
	Hud.gunLabel.Visible = enabled
	if not enabled then
		return
	end
	Hud.gunLabel.Text = gunName
	if reloading then
		Hud.ammo.Text = "RELOADING"
		Hud.ammo.TextColor3 = Color3.fromRGB(255, 190, 90)
	else
		Hud.ammo.Text = string.format("%d / %d", ammoCount, magazine)
		Hud.ammo.TextColor3 = ammoCount == 0 and Color3.fromRGB(255, 110, 110) or Color3.fromRGB(255, 255, 255)
	end
end

function Hud.setMatch(state: any)
	local phase = state.phase
	if phase == "waiting" then
		Hud.board.Visible = false
		Hud.banner.Text = ""
		Hud.sub.Text = string.format("%d in the queue — need 2", state.queued)
	else
		Hud.board.Visible = true
		for i, row in ipairs(Hud.rows) do
			local entry = state.players[i]
			if entry then
				row.Visible = true
				row.Text = string.format("%s  ·  %d/%d  ·  %s", entry.name, entry.tier, state.ladderSize, entry.gun)
				row.TextColor3 = entry.name == Players.LocalPlayer.Name
					and Color3.fromRGB(140, 220, 255)
					or Color3.fromRGB(235, 235, 235)
			else
				row.Visible = false
			end
		end
		if phase == "countdown" then
			Hud.banner.Text = tostring(state.countdown)
			Hud.sub.Text = "Get ready"
		elseif phase == "active" then
			Hud.banner.Text = ""
			Hud.sub.Text = ""
		elseif phase == "over" then
			Hud.banner.Text = state.winner and (state.winner .. " wins") or "Match over"
			Hud.sub.Text = "Next match shortly"
		end
	end
end

function Hud.setQueued(queued: boolean, playing: boolean)
	if playing then
		Hud.prompt.Text = ""
	elseif queued then
		Hud.prompt.Text = "[E] Leave the queue — waiting for an opponent"
	else
		Hud.prompt.Text = "[E] Join the queue"
	end
end

function Hud.flashHit(killed: boolean)
	Hud.hitmarker.TextColor3 = killed and Color3.fromRGB(255, 220, 90) or Color3.fromRGB(255, 90, 90)
	Hud.hitmarker.TextTransparency = 0
	Hud.hitmarker.TextSize = killed and 46 or 34
	TweenService:Create(Hud.hitmarker, TweenInfo.new(0.28), { TextTransparency = 1 }):Play()
end

return Hud
