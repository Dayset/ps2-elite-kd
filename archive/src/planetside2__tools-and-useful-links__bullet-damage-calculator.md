# PlanetSide 2 Damage Calculator

- **Source (live):** https://cmdrcyrious.com/planetside2/tools-and-useful-links/bullet-damage-calculator/ — live copy returns HTTP 200 but its static HTML contains no article body (verified 2026-11-09); content below is from the Wayback Machine.
- **Source (archived):** https://web.archive.org/web/20250326145112/https://cmdrcyrious.com/planetside2/tools-and-useful-links/bullet-damage-calculator/
- **Snapshot date:** 20250326145112
- **Saved:** 2026-11-09
- **Raw HTML (archived):** `raw/wayback__planetside2__tools-and-useful-links__bullet-damage-calculator.html`
- **Raw HTML (live, empty body):** `raw/planetside2__tools-and-useful-links__bullet-damage-calculator.html`

---

---
title: Bullet Damage Calculator
author: Institoros
url: http://cmdrcyrious.com/planetside2/tools-and-useful-links/bullet-damage-calculator/
hostname: cmdrcyrious.com
description: Download hereThis Excel sheet will calculate bullet damage and other basic properties, such as DPS and TTK, as well as Bullet Damage Thresholds. >> Main download link <<Google mirror This sheet calculates BTK, ideal DPS and TTK three times:1) For bullet damage achieved at maximum damage
sitename: CMDRCyrious.com
date: "2016-04-25"
fingerprint: "462abe9e7929145d"
---
# Download here

This Excel sheet will calculate bullet damage and other basic properties, such as DPS and TTK, as well as Bullet Damage Thresholds.

##### [>> Main download link \<\<](http://cmdrcyrious.com/wp-content/uploads/2016/04/Bullet_Damage_Thresholds_v2.xlsm)

This sheet calculates BTK, ideal DPS and TTK three times:

1\) For bullet damage achieved at maximum damage range

2\) For bullet damage achieved at minimum damage range

3\) For damage achieved at range specified by you

Calculations are done independently for two weapons, and then compared to each other.

You can specify target’s health and damage modifier, which is useful if you want to calculate for headshots or nanoweave armor.

Additionally, you can press “Calculate Thresholds” button, and the sheet will automatically calculate bullet damage thresholds for you – find ranges, where the weapon starts to require an additional bullet to kill the target.

You can also press a “Draw Chart” button, and a comparative chart will be automatically created, showing the differences in weapons’ BTKs at different ranges.

# Applications

The damage model of a weapon can be inaccurate in certain situations. For example,

ACX-11: 200 @ 10m – 143 @ 80m.

BTKs on both ends are obvious: 5 @ 10m and 7 @ 80m.

But what about what happens in the middle? With this sheet, you can find out that BTK will change from 6 to 7 bullets at 52m already. So, in a sense, minimum damage range is actually 52m, not 80m.

Obviously, there are a lot of conditions: full health, only chest and arm hits, no nanoweave (similar threshold exists for nanoweave too, but at different range).

# How to use

**Important!**

First, open your Microsoft Excel. Then go to File -> Options -> Trust Center -> Trust Center Settings -> Macro Settings and check the box “enable all macros”. If you’re using a different version of Excel, just google how to “allow the Excel to run programs included with spreadsheets” in your version. You have to do this, otherwise you won’t be able to open the sheet.

Enter stats of one or two weapons in green boxes. You can take them from the game, your imagination or this [spreadsheet.](http://planetstats.net/data/weapons/)

If you want to calculate weapon’s bullet damage at a specific range, enter this range into the blue box.

Example:

![how to use calculate bullet damage](http://cmdrcyrious.com/wp-content/uploads/2016/04/zlw2t5-1024x231.jpg)

You can specify target’s base health. Common values are 900 for infiltrators, 1000 for other infantry and 2000 for MAX units.

You can also specify a damage multiplier. This is useful if you want to calculate for headshots or nanoweave armor / kinetic armor.

Headshot multipliers can be taken from the spreadsheet I linked above, but, as the rule of a thumb, headshot multiplier is 1.5x for shotguns, crossbow and T7 MCG, 2.1x for bolt action sniper rifles and 2x for other weapons.

Nanoweave Armor 5 blocks 20% of small arms damage, so enter 0.8 if you want to calculate for it.

Remember that headshots ignore nanoweave.

MAX units have 80% resistance to small arms fire, 87.5% for Kinetic Armor 5.

How to read “Calculate Thresholds” button output:

![how to use calculate bullet damage thresholds](http://cmdrcyrious.com/wp-content/uploads/2016/04/ev0y1e.jpg)

BTK stands for bullets-to-kill. This picture shows a weapon that has BTK of 7 at ranges from 0 to 15m, 8 for range of 16m to 33m, 9 for range of 34m to 48m and 10 for any range past 49m.

Video with examples

# Known issues

1\) If the value in the blue box is lower than Max Damage Range or higher than Min Damage Range, computations for Damage @ Range, BTK @ Range and TTK @ Range become screwed.

For example, you want to compare ACX-11 to T5 AMC at 70 meters.

ACX-11: 200 @ 10m – 143 @ 80m

T5 AMC: 143 @ 10m – 112 @ 60m

If you type \[70\] into the blue boxes for both ACX-11 and T5 AMC, computations for T5 AMC will be wrong.

Solution: don’t. You can expect T5 AMC to behave at 70 meters same as it does at 60 meters (can’t go below minimum damage). So enter 70 into the ACX-11’s blue box, and enter 60 into T5 AMC’s blue box.

2\) Sometimes “Draw Chart” function bugs out, and draws a mumbo-jumbo of colorful lines.

I haven’t quite figured out the reason for this.

Solution: Go to the “Temp” worksheet, press Ctrl+A, then Delete. This will wipe out its contents.

Then go to the main worksheet, save and exit the excel. After reopening the sheet file, everything should function normally. If it doesn’t, repeat the process.

I realize that this sheet is not as cool as [Axiom80’s Weapon Damage Analyzer](http://ps2model-axiom.rhcloud.com/), that has pretty graphs and all, but that thing is ***outdated***.

You input values into my sheet yourself, so it’ll never be outdated, as long as core weapon mechanics of PS2 stay the same.

## Recent Comments
