# PlanetSide 2 Weapon Simulator

- **Source:** https://cmdrcyrious.com/planetside-2-weapon-simulator/
- **Saved:** 2026-11-09
- **Status:** live, HTTP 200
- **Raw HTML:** `raw/planetside-2-weapon-simulator.html`
- **Extraction:** trafilatura

---

---
title: PlanetSide 2 Weapon Simulator | CMDRCyrious.com
author: CMDRCyrious
url: https://cmdrcyrious.com/planetside-2-weapon-simulator/
hostname: cmdrcyrious.com
description: Comprehensive tool for simulating PlanetSide 2 Weapon Mechanics, checking effects of attachments and comparing weapons to each other.
sitename: CMDRCyrious.com | Take your gaming Cyriously!
date: "2016-06-05"
categories: ['PlanetSide 2, calculator, mechanics, tool, Weapon Calculator']
tags: ['calculator', 'mechanics', 'tool', 'Weapon Calculator', "A Newbie's Experience", 'API', 'beginner', 'combat medic', 'comparison', 'construction system', 'guest post', 'guide', 'heavy assault', 'highly technical', 'implant', 'infantry', 'infiltrator', 'Light Assault', 'LMG', 'loadout', 'mechancis', 'mechanic', 'New Conglomerate', 'NSX', 'PC Building', 'performance', 'repost', 'rocket launchers', 'SMG', 'stalker', 'suggestion', 'Terran Republic', 'Vanu Sovreignty', 'Video', 'weapon', 'XCOM 2']
fingerprint: b40b9f506f9693e9
---
**This tool is outdated, use [Weapon Toolbox](http://cmdrcyrious.com/toolbox/) for up to date weapon stats.** 

This program is a standalone simulator of [PlanetSide 2 Weapon Mechanics](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/).

It can simulate Cone of Fire, bullet hits, recoil, analyze the effects of attachments on each weapon, and compare different weapons to each other.

This is a work in progress, so please [inform me](http://cmdrcyrious.com/contacts/) of any bugs or suggestions.

#### [**>> Download v1.7 PTS here \<\<**](http://cmdrcyrious.com/wp-content/uploads/2016/06/PS2-Weapon-Simulator-v1.7-PTS.zip)

**Known issue:** since it’s program in an archive, this might get flagged as potentially harmful. Windows Smart Screen and Avast have particular issues with it.

I assure you, no harm will come to your PC. Ignore the warnings. Use any [online virus scan](http://www.virustotal.com) if you don’t believe me.

![v1.6 main window](http://cmdrcyrious.com/wp-content/uploads/2016/06/v1.6-main-window-1024x950.jpg)


#### **New in the latest version:**

![pts](http://cmdrcyrious.com/wp-content/uploads/2016/06/PTS-1024x327.jpg)


Version 1.7 PTS includes changes from the 14/10/2016 [PTS patch](https://www.reddit.com/r/Planetside/comments/57818g/pts_patch_notes_10122016/) to damage and range. Recoil and CoF changes are not included.

# Instructions

Select Program Mode in the top right corner. Select a weapon from the list on the right. You can preview selected weapon’s stats in “Weapon Stats” module, and add attachments in “Attachments” module.

“Add to comparison” button copies currently selected weapons with all attachments. You can then select a different weapon or attachment combination.

“Weapon Stats” textbox only displays stats for currently selected weapon. To access stats of weapons copied for comparison, click “Get stats” button under weapon’s name and they will appear in a message box.

## Attachment restrictions

I hate when programs try to be smarter than the user, so I let you decide which attachments can be put on which weapons. If you don’t know which weapons can accept which attachments, you can check that in-game (preferable) or on [PS2 Wiki](http://planetside.wikia.com/wiki/Weapons) if you’re lazy.

Each weapon should be [properly affected](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/) by attachments, but there are a few notable points:

Extended Mags won’t do anything for weapons it’s not available for.

Some weapons come with attachments already installed. For example, MKV Suppressed comes with a pre-installed suppressor, so there’s no need to put a second suppressor on it.

Directive Shotguns in-game have Smart Choke equipped by default, but in the simulator, you will have to equip it yourself.

Slug Ammunition speed is predetermined as 300 m/s for all shotguns, even though slugs supposed to inherit the velocity of the shotgun, with Baron being the only exception.

## Simulation Mode

Simulation Mode allows you to test fire all selected weapons. Press Left Mouse Button or “Fire Fixed Burst” button to fire.

The program will simulate recoil and bullet hits in accordance with PlanetSide 2 Weapon Mechanics. Bullet drop and travel time are not accounted for. The recoil magnitude should be more or less up to scale with first person shooting in game.

Right Mouse Button toggles ADS. ADSing applies magnification from chosen optic, and lets the weapon use ADS CoFs.

Holding Middle Mouse Button will let you move the window around, and Mouse Wheel to zoom in and out. You can drag around recoil patterns using the blue circle in the bottom part as an anchor.

### Bullets to Kill Module

![Blackhand BTK](http://cmdrcyrious.com/wp-content/uploads/2016/06/Blackhand-BTK-300x238.jpg)


The simulator will automatically calculate the number of bullets required to kill a target at different ranges. Number in the brackets is time to kill (TTK).

You can specify target’s health and damage resistance in text boxes above. The “Legend” button will display a table to remind you which targets have what amount of health and damage resistance.

You can also specify the number of “Bonus Headshots” the target receives before BTK calculations. This is useful if you want to calculate the amount of bullets to kill a target after you open with a headshot.

### Draw Target toggle

![v1.5 drag target](http://cmdrcyrious.com/wp-content/uploads/2016/06/v1.5-drag-target.jpg)


Makes an enemy dummy target visible. You can drag and drop the target using the blue anchor at the bottom.

Target should be up to scale as if it’s 5m away from you in game. You can press W and S to move closer / away from the target.

Target scaling is zeroed at 5m, the more you away from it, the less accurate the scaling will be. But I did use my [Angular Size](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Angular_Size) research to get the target scaling as close to in-game as possible.

The “TTK Simulation” window will tell you the damage your weapon would do at that range.

### TTK Simulation Module

![v1.7 TTK simulation](http://cmdrcyrious.com/wp-content/uploads/2016/06/v1.7-TTK-simulation-1024x531.jpg)


This module is only visible when “Draw Target” is enabled.

My program cannot detect bullet hits, but you can do it manually by pressing “Head”, “Leg” and “Body” buttons.

The program will calculate damage you have dealt, and the remaining target health,

as well as how long it took to fire that amount of shots.

“Reset CoF” button will reset weapon’s CoF, and adjust “time elapsed” for the time

it would take to reset CoF in game.

**“Record Pattern”** mode is there for demonstration purposes.

Normally, the direction of Horizontal Recoil is chosen randomly. Record Pattern mode allows the user to choose the recoil direction with A and D keys.

This mode is only useful if you want to draw a specific recoil pattern to take a screenshot.

### Configuration Module

On the first launch, the program will create “settings.ini”. You can use “save” and “load” buttons to store your preferred configuration. To reset to factory defaults, just delete the “settings.ini”.

# To-Do

Already on my to-do list:

- Let user manually add weapons
- Add Recoil Simulation mode that will let the user control recoil with mouse
- Let the “Save configuration” button save selected weapons as well.
- add recoil pattern width and recoil per second calculations into weapon stats window, and calculated stat values (DPM, FSRM).
- add TTK graph mode
- add sorting by weapon class and faction to the weapon list
- add a way to automatically update weapon stats through census API or accept export from Toolbox
- add BTK thresholds to the left side of the bullet damage graph
- add BTK thresholds graph

# Changelog and archive

### [v1.0 – Initial Release](http://cmdrcyrious.com/wp-content/uploads/2016/06/PS2-Weapon-Simulator-v1.0.zip)

### [v1.1 – Bugfix](http://cmdrcyrious.com/wp-content/uploads/2016/06/PS2-Weapon-Calculator-v1.1.zip)

Fixed a bug with Decimal Symbol in different locales.

### [v1.2 – Function update](http://cmdrcyrious.com/wp-content/uploads/2016/06/PS2-Weapon-Simulator-v1.2.zip)

Users can now choose a firing stance. 

Added weapon comparison.

Recoil patterns can be dragged around using the small blue circle at the bottom.

Also updated the weapon database to include [velocity changes](https://forums.daybreakgames.com/ps2/index.php?threads/game-update-6-1.241005/).

### [v1.3 – Bugfix](http://cmdrcyrious.com/wp-content/uploads/2016/06/PS2-Weapon-Simulator-v1.3.zip)

Fixed a bug that prevented weapon stats from updating properly with HVA, SPA and Suppressor attachments.

### [v1.4 – Function update](http://cmdrcyrious.com/wp-content/uploads/2016/06/PS2-Weapon-Simulator-v1.4.zip)

Added an option to draw weapon damage graphs. 

Useful for comparing weapon damage at different ranges and with different attachments.

### [v1.5- Function update](http://cmdrcyrious.com/wp-content/uploads/2016/06/PS2-Weapon-Simulator-v1.5.zip)

Now the target from “Draw Target” option can be dragged and dropped using the blue anchor at the bottom of the target.

### [v1.5a – Function fix](http://cmdrcyrious.com/wp-content/uploads/2016/06/PS2-Weapon-Simulator-v1.5a.zip)

Now the drawn target scales relative to center mass.

### [v1.6 – Function update](http://cmdrcyrious.com/wp-content/uploads/2016/06/PS2-Weapon-Simulator-v1.6.zip)

Added “BTK Thresholds” window. It will calculate the amount of bullets needed for a

weapon to kill a target with specified health and resistance at different ranges.

### [v1.6A – Function update](http://cmdrcyrious.com/wp-content/uploads/2016/06/PS2-Weapon-Simulator-v1.6A.zip)

“BTK Thresholds” window will also display TTK.

### [v1.7 – Function update](http://cmdrcyrious.com/wp-content/uploads/2016/07/PS2-Weapon-Simulator-v1.7.zip)

Updated for the latest patch, and added “TTK Simulation” module.

### [v1.7 PTS – Database update](http://cmdrcyrious.com/wp-content/uploads/2016/06/PS2-Weapon-Simulator-v1.7-PTS.zip)

Updated for the latest [PTS patch](https://www.reddit.com/r/Planetside/comments/57818g/pts_patch_notes_10122016/) to highlight some weapon changes.

As a closing word, huge thanks to [/u/L33-the-3rd](http://www.reddit.com/user/L33-the-3rd) for formatting the [PS2 Weapon Database](http://planetstats.net/data/weapons/) into CSV for me.
