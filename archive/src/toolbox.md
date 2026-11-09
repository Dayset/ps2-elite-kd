# Iridar's Weapon Analysis Toolbox

- **Source:** https://cmdrcyrious.com/toolbox/
- **Saved:** 2026-11-09
- **Status:** live, HTTP 200
- **Raw HTML:** `raw/toolbox.html`
- **Extraction:** trafilatura

---

---
title: Iridar's Weapon Analysis Toolbox | CMDRCyrious.com
author: CMDRCyrious
url: https://cmdrcyrious.com/toolbox/
hostname: cmdrcyrious.com
description: This Excel Spreadsheet is a culmination of years of work on theorycrafting PlanetSide 2 weapon mechanics. It pulls weapon stats from DBG API.
sitename: CMDRCyrious.com | Take your gaming Cyriously!
date: "2016-12-07"
categories: ['PlanetSide 2, API, calculator, mechanics, tool']
tags: ['API', 'calculator', 'mechanics', 'tool', "A Newbie's Experience", 'beginner', 'combat medic', 'comparison', 'construction system', 'guest post', 'guide', 'heavy assault', 'highly technical', 'implant', 'infantry', 'infiltrator', 'Light Assault', 'LMG', 'loadout', 'mechancis', 'mechanic', 'New Conglomerate', 'NSX', 'PC Building', 'performance', 'repost', 'rocket launchers', 'SMG', 'stalker', 'suggestion', 'Terran Republic', 'Vanu Sovreignty', 'Video', 'weapon', 'Weapon Calculator', 'XCOM 2']
fingerprint: "3c198d307f422f3d"
---
*This video is outdated and doesn’t include many new features, but it explains the general purpose and spirit behind this tool.*

This Excel Spreadsheet is a culmination of years of work on theorycrafting PlanetSide 2 weapon mechanics. It uses Visual Basic macros to pull weapon stats from DBG API, to calculate damage and recoil statistics and draw graphs to visualize them.

This toolbox arms you with all necessary tools for comprehensive weapon analysis.

Current version: v6h

**Attention!** When you first open the toolbox, you will see a yellow bar with a security warning about macros. Click “Enable content” to allow the use of macros, or the Toolbox will not function.

# Structure

The Excel file has 9 pages:

![](http://cmdrcyrious.com/wp-content/uploads/2016/12/pages-1.png)


Each page fulfills its own, clearly defined function, but some of the pages can transfer data to each other.

Pages contain cells of different color:

![soft-orange](http://cmdrcyrious.com/wp-content/uploads/2016/12/soft-orange.jpg) Soft orange cells. These cells store automatically imported weapons stats, and they also accept manual input. You can edit them without fear of breaking anything.


![light-grey](http://cmdrcyrious.com/wp-content/uploads/2016/12/light-grey.jpg) Light grey cells contain calculations and references to other cells,

**do not edit** grey cells, or you will break the tool’s functionality.

![pale-yellow](http://cmdrcyrious.com/wp-content/uploads/2016/12/pale-yellow.jpg) Pale yellow cells store values for configuration, and you may need to edit them in specific situations.


![Toolbox chosen cell](http://cmdrcyrious.com/wp-content/uploads/2016/12/chosen-cell.jpg) Light green filling indicates that this cell’s value has been selected, likely by double clicking.


![Toolbox tooltip](http://cmdrcyrious.com/wp-content/uploads/2016/12/tooltip-1.jpg) Small red triangles in the corner of a cell indicate a tooltip. Put your mouse over the cell to display the tooltip.


**Note:** Toolbox’s calculations always assume worst case scenario: weapon damage is rounded down and target health is rounded up.

## Stats Page

![Toolbox stats page](http://cmdrcyrious.com/wp-content/uploads/2016/12/stats.jpg)


This huge table has stats of all known primary and secondary infantry weapons. Normally you don’t work with this table itself, and only use it to export stats into other pages:

**Double click or right click** on any weapon to copy its stats into soft orange cells on other pages.

Other functions:

**Double click on Item ID** of the weapon to open a [API query](http://cmdrcyrious.com/weapon-stats/#Full_Query) for that weapon in your default browser.

The Toolbox is not perfect, and may sometimes pull wrong stats, or fail to pull stats at all. There is no substitute for looking at a query with your own eyes.

**Select a weapon and click “Export 1” button.** A window with exported weapon’s stats  and attachment list will show.

### Pulling stats and adding new weapons

The **Pull Stats** button will initiate a download of weapon stats from DBG API, using **[API queries](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Where_to_get_weapon_stats)** for each Item ID in the first column. When a new weapon is released, simply insert its **Item ID** to the end of the list, and its stats will be downloaded as well.

If you don’t know weapon’s Item ID, you can find it out **[this way](http://cmdrcyrious.com/weapon-stats/#How_to_find_out_weapon8217s_Item_ID)**,  or simply copy-paste it from Attachments Page.

![add-new-weapons](http://cmdrcyrious.com/wp-content/uploads/2016/12/add-new-weapons.png)


Keep in mind that “Name” column is not downloaded, and you will have to fill it manually for any new weapon releases.

The “Date” field near the “pull stats” button stores the date when stats were last downloaded. Normally, you should re-download stats only after a patch that changed something.

## Damage Page

![damage toolbox page](http://cmdrcyrious.com/wp-content/uploads/2016/12/damage-1.jpg)


This page serves to analyze weapon damage at different ranges and/or with different attachments. You can compare two weapons at the same time.

On “Stats” page, **double click** on a weapon to export its stats for the first weapon, and **right click** for the second weapon.

You can add attachments to weapons by clicking corresponding Check Boxes. If the weapon doesn’t have a certain attachment, you will be informed with a pop up window, but you can’t see whether weapon has access to an attachment on this page without clicking the Check Box.

The calculations for Minimum and Maximum damage ranges are self-explanatory. To calculate weapon’s damage stats at certain range, enter it into soft orange Range cell.

Both weapons are analyzed against the same target, which you can configure this way:

### Target Settings

![](http://cmdrcyrious.com/wp-content/uploads/2016/12/target-config.png)


Below the Health block, there are reference tables for Health, Nanoweave Armor and Kinetic Armor. **Double click** on Health or Damage Multiplier value to automatically apply it.

Both weapons have Headshot Damage Multiplier listed. You can **double click** on its value to apply it to the Damage Multiplier.

Since both weapons fire at the same target, and damage multiplier is tied to the target, it may be inconvenient to compare headshot properties of two weapons with different headshot multipliers.

The most common way to analyze a weapon is to look at its performance against the default target with 1000 HP and against a Full Nanoweave target with 1250 Effective HP, so these are the default parameters, and statistics for standard Full Nano target are calculated automatically.

### BTK Thresholds

![Toolbox BTK Thresholds](http://cmdrcyrious.com/wp-content/uploads/2016/12/thresholds.jpg)


The “Calculate Thresholds” button will calculate [**BTK Thresholds**](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#BTK_Thresholds) for both weapons.

For example, the results on the picture above read as:

Gauss Rifle kills in 6 shots at 0m to 10m, and in 7 shots at 11m+.

“Draw Graph” button will also recalculate Thresholds and then draw a comparative graph.

## Recoil Page

![](http://cmdrcyrious.com/wp-content/uploads/2016/12/recoil-page-1024x402.png)


This page serves to analyze weapons’ recoil properties.

On the “Stats” page, **double click** on the weapon’s name will import its stats to the left position, and the **right click** to the right position.

Click **Calculate Stability** to calculate [**Average and Maximum horizontal Deviations**](http://cmdrcyrious.com/highly-technical-how-to-analyze-a-weapon/#Stability) and to update Probability Distribution Graph.

The Visual Basic macro fires a virtual gun in bursts with listed “Burst Length” for the amount of times, listed in “Simulations” cell, and then averages out the results.

“Average Deviation” is the average distance of the crosshair from the burst’s starting crosshair position. The lower it is, the better is the weapon’s horizontal recoil.

“Graph Scale H” refers to the maximum Horizontal Recoil value, visible on the graph. The default value of 0.7 is fine for most cases, but depending on how good / bad the weapon’s horizontal recoil is, you may need to increase or decrease this value to see the graph in necessary detail.

Vertical Recoil module is self explanatory, you’re mostly interested in Vertical Recoil per Second. For the purposes of vertical recoil, it’s better to have high RoF and low vertical recoil per shot, to ensure nice and soft, consistent pull.

FSRM value is listed mostly for your reference, it doesn’t participate in any calculations.

The **Average Deviations** listed in Recoil Angle block show how much a weapon is affected by [**Recoil Angle Variance**](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Recoil_Angle). They basically show you the size of the yellow area:

![Serpent Recoil Pattern](http://cmdrcyrious.com/wp-content/uploads/2016/04/6jhgkh.jpg)

Serpent’s recoil pattern – not included with the Toolbox

## Cone of Fire Page

![](http://cmdrcyrious.com/wp-content/uploads/2016/12/cof-page-1024x624.png)


This page displays weapon’s Cone of Fire in different stances and shows how it is affected by various attachments.

For now, this page has limited functionality due to **[Angular Size research fiasco](https://www.reddit.com/r/Planetside/comments/6z5uax/results_of_the_testing_related_to_my_angular_size/)**. At this moment, the CoF Page will calculate weapon’s CoF Size after a certain amount of shots, necessary to kill the specified target at different ranges.

However, without a way to calculate weapon’s accuracy at that range, it is more or less pointless.

The CoF Page will also calculate a more useful statistic: **Cone of Fire Bloom per Point of Damage Done**. This statistic with an extra long name ties weapon’s damage output to accuracy loss, which allows you to objectively determine which weapon requires more burst firing, even with perfect accuracy, and regardless of weapon’s RoF or DPS.

You can combine weapon’s starting CoFs and CoF Bloom PPD to make an educated guess which weapon will be more accurate at range, and which weapon will require more burst firing.

## Built In Resistances Page

![](http://cmdrcyrious.com/wp-content/uploads/2016/12/BuiltInResistancesPage-1024x362.png)


Most units have built-in resistances and weaknesses to some of the Damage Types. This page can download these values from DBG API. To do so, double click on the Profile Name of the unit in the left list.

Keep in mind that this page is also used for inner calculations of the Resistances Page, so the values you pull may be automatically overridden.

At the top left, you can click “Pull Profiles” button to pull Profile IDs and Profile Names for all units in PS2. You may need to do this if a new vehicle or class is added to the game. You can also scrub the API for deployable items, such as Spitfire Turrets and Hardlight Barriers, as well as misc items, such as Infantry Terminals.

## Resistances Page

![](http://cmdrcyrious.com/wp-content/uploads/2016/12/resistances3-1024x419.png)


This page allows you to calculate weapon damage against vehicles, taking into account their [**Health, Armor** and **Resistances**](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Health_Armor_and_Resistances) to specific damage types.

It also lets you apply **additional defensive certifications** to the vehicle. The damage is calculated for all different directions.

This is one of the more complicated pages, and it requires a connection to the Internet in order to function. [A video demonstration with a couple of examples.](https://vimeo.com/233738859)

**1) Select the weapon category, and then the weapon** from the lists on the upper left. Weapon’s stats for its default firemode will be automatically imported from the API. You can change the weapon’s **firemode** in the respective listbox. This can be necessary for some of the weapons, like the **[GODSAW](http://cmdrcyrious.com/planetside2/weapons/lmgs/#NC6A_GODSAW)**.

Each weapon has fields for **Direct** and [**Indirect Damage**](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Indirect_Damage). You can specify the **distance to the target** for Direct Damage, and **distance to the explosion** for Indirect Damage in the orange **Range** boxes on the lower left:

![resistances range](http://cmdrcyrious.com/wp-content/uploads/2016/12/resistances-range.png)


**2) Select the target unit** from the list in the middle by *double clicking* on its name. Unit’s Health will be copy pasted from the listed, and unit’s Armor and Resistance to the selected weapon will be imported from the API.

Keep in mind that API does not contain unit health values. Health values in the toolbox were acquired by in-game testing, and in case of a patch that affects vehicle health values, values in the Toolbox will have to be adjusted manually.

Direct Damage, Indirect Damage, as well as hits to kill will be automatically calculated and displayed on the target’s “doll”.

![](http://cmdrcyrious.com/wp-content/uploads/2016/12/resistance-legend.png)


Each side of the target has five values associated with it:

- **Armor** reduces all incoming damage from this direction by a certain percent. In game, only vehicle’s orientation relative to the damage source is important. It doesn’t matter which part of the vehicle you’re hitting, only your position relative to the vehicle.
- **Direct Damage** is dealt on direct hits.
- **Indirect Damage** is dealt on direct and indirect hits, though most of armored vehicles are immune to most Indirect Damage sources.
- The amount of hits required to destroy the vehicle with specified Direct OR Indirect Damage is also listed. Keep in mind that these damage sources are not added together. So if the unit takes damage from both Direct and Indirect Damage, you will have to calculate the required amount of hits manually.

When you import the target unit by double clicking on its name, the list on the upper right will update with some of the vehicle’s defensive certifications. Double click on the certification name to add it to the vehicle.

When a defensive certification has several ranks, you only have to click on the rank you wish to add. E.g. when you wish to make calculations for Composite Armor 4, you don’t have to double click on Composite Armor 1-2-3 before that.

Weapon-Target Resistance values will update from the API whenever you change the weapon or the target unit.

You can also manually edit all values in orange boxes to analyze theoretical scenarios. Do not edit the grey boxes, or you will break the tool’s functionality.

**Additional Functions:**

For both Direct and Indirect Damage, you can double click the cell with damage value to apply it to the target and subtract it from target’s health. This is convenient when you wish to calculate damage from several sources.

**Example:** you want to find out how much Rocklet Rifle hits it takes to destroy a Lightning in the rear armor after one brick of C4. **Video demonstration.**

For both Direct and Indirect Damage Types, you can click a “**Find Weapons with that Damage Type**” button. The toolbox will find all weapons that use that Damage Type, and put them into Weapon Name listbox.

Keep in mind that not everything is perfectly represented in the API. For example, AV Grenades use the same Damage Resist Type as Rocket Launchers, but you will not see AV Grenades in the list if you search for that Damage Type.

You can click “**Export List**“, and a pop-up window will show, and you will be able to copy from it.

Note there are two “**Find Weapons with that Damage Type**” buttons,  one for Direct Damage, and one for Indirect Damage.

There are also two self-descriptive buttons **“Find Units with Resistances to that Damage Type”**. When clicked, the toolbox will provide you with a list of units, with the amount or resistance specified in brackets. You can export that list in a similar fashion.

If you have doubts whether the Toolbox correctly displays the Resistance relationship between your current target and weapon, you can click “**Refresh Resistances**” to make sure. You may want to do this if you manually change weapon’s Damage Resist Type for an experiment’s sake.

Sometimes, the listboxes on this page will bug out, and won’t let you scroll down to the final element in the list. Blame Excel. You can temporarily fix this issue by clicking the “**Fix Listboxes**” button.

![toolbox damage per minute DPM](http://cmdrcyrious.com/wp-content/uploads/2016/12/DPM.png)


For both Direct and Indirect Damage, the Toolbox will **calculate Damage Per Minute (DPM)**. It will take Reload speed and Refire Time into account.

To get correct DPM numbers, you often have to manually edit some of the orange cells:

- For tank cannons and other vehicle weapons, you should apply a **Reload Speed Upgrade**. Maximum value is usually 10%, but check in-game descriptions to be sure.
- For Rocket Launchers, **Lock-on Time and Charge Time ([Lancer](http://cmdrcyrious.com/rocket-launchers/#Lancer_VS22)) are not calculated**, so you’ll have to manually add them into Reload Time. Lancer’s charge damage is not available in the API either, so you’ll have to change Direct Damage manually as well.
- DPM calculations don’t yet take into account “shotgun” weapons, such as [**NSX Masamune**](http://cmdrcyrious.com/rocket-launchers/#NSX_Masamune). Speaking of Masamune, it has an **[edgy reload mechanic](https://www.reddit.com/r/Planetside/comments/7nd2gd/why_is_the_annihilator_taken_over_the_es_lockons/ds10q99/)** in ADS mode.

## Implants Page

![](http://cmdrcyrious.com/wp-content/uploads/2016/12/Implants-Page.png)


This page will perform calculations for **[Implants](http://cmdrcyrious.com/planetside2/equipment/implants/)**. In order to function it requires statistical data on implant drop chances, such as **[this spreadsheet by RegulusMagnus](https://www.reddit.com/r/Planetside/comments/97slxw/pts_new_implant_drop_rates/e4akaec/)**. It is normally acquired by purchasing a ton of Deluxe Packs and Recycler on the **[Public Test Server](http://launch.daybreakgames.com/installer/PS2_Test_setup.exe)**, and writing down how many of each thing have you gotten.

Enter the data in orange boxes. **Group Size** column refers to number of implants in each rarity group. E.g. how many exceptional implants are there in total.

Then enter how many of Deluxe Packs and/or Recyclers you “buy”, and the spreadsheet will calculate how much will it cost, how many implants you will receive, what is their ISO-4 value, what are the chances that at least one of the dropped implants will belong to a certain rarity group, and what are the chances of getting a specific implant you want.


**Known issues:**

- Sometimes an error pops up when reaching out to the API. Just try again whatever you were doing.
- Resist Shield does not work yet. If you wish to make an analysis for the Resist Shield, simply add 35% Resistance to orange cells on the lower left.
- The tool does not fully support charge up weapons, such as [**Lancer**](http://cmdrcyrious.com/rocket-launchers/#Lancer_VS22). You have to manually multiply the damage.
- It will not calculate weapon’s TTK.
- It will not take into account [**rocket launcher indirect damage scaling**](http://cmdrcyrious.com/rocket-launchers/#Indirect_Damage_Hidden_Distance_Scaling).
- Weapons’ faction isn’t always determined correctly.
- Damage values of Explosive Bolts, Typhoon Rocklets, Anti-Vehicle Grenades, C4 and Tank Mines are not accessible in the API. I have discovered their more or less precise damage values by in-game testing, and then hardcoded those values in the Toolbox. They will have to be manually updated if a patch changes them.
- Damage for the Underbarrel Grenade Launcher is available in the API, but it’s formatted differently, so it was easier to hardcode its damage as well.
- Other explosives, like Frag Grenades and Sticky Grenades simply do not work (yet). They could potentially get hardcoded as well.

## Attachments Page

![attachments toolbox page](http://cmdrcyrious.com/wp-content/uploads/2016/12/attachments-1024x293.jpg)


This page stores a table with known effects of known attachments on all weapons. When you add attachments to weapons on other pages, this is where their effects are taken from.

To update the table, click “**Pull Attachments**“. A VBA Script will pull **Names** and **Item IDs** for all weapons from weapon categories on **Categories Page**, and then pull attachment data for them.

You can also **double click on weapon’s name** to open a JSON query for that weapon’s attachment list. This may be necessary if a weapon has access to atypical attachment, since the table is formatted only for known effects of known attachments.

## Categories Page

![](http://cmdrcyrious.com/wp-content/uploads/2016/12/categories-page-1024x431.png)


This page has two functions. On the left, there is a list of weapon categories. The “Attachments” page will use this list to pull attachments for all weapons in these categories.

You can click “Pull Categories” to download a full list of Item Categories from the API, but then you will have to manually clean it up, and remove everything except infantry weapons, so the Attachments Page doesn’t get overloaded.

On the right, there is a similar list of weapon categories. For each weapon category there is a list of weapons in that category. This list is used by the “Resistances” page. To update this list, click “Pull Categories”, clean up the downloaded list, then copy paste it to the right and click “Pull Weapons”. Save, close and reopen the Toolbox so that changes take effect on the Resistances Page.

## Temp Page

This is a temporary page for storing calculations results. You don’t need to interact with this page at all.

# Changelog and To-Do

v1 – initial release.

v2 – added CoF import functionality and reworked Cone of Fire page. Special thanks to [FISU](https://www.reddit.com/r/Planetside/comments/5h49v2/tool_release_weapon_analysis_toolbox_pulls_stats/day1vw5/). Weapon names also update when you add attachments.

v2a – added the ability to double click on weapon’s Item ID to open JSON queries.

v2b – Pull Stats will also pull Falling CoF (for flying / jumping with Carbines). Falling CoF will also be imported into Cone of Fire page. Also fixed a bug that any value of 1 character long was not pulled from the API.

v3 – The toolbox will now also pull ADS movespeed multiplier and other missing stats. Fixed several issues, minor improvements.

v3a – Fixed a Reload Time export.

v3b – Added the button to pull information about weapon’s projectiles.

v4a – Added functionality to download exact effects of weapon attachments and apply them to weapons.

v4c – Cleaned up unnecessary code in order for the Toolbox to work with 64 bit version of Excel. Also fixed a minor bug with HVA on Damage page.

v4d – Downloaded weapon and attachment stats for latest patch, including NSX Tanto.

v4c – Cleaned up unnecessary code in order for the Toolbox to work with 64 bit version of Excel. Again.

v4f – Stripped most of the functionality of the CoF Page, because it was based on the [wrong Angular Size research](https://www.reddit.com/r/Planetside/comments/6z5uax/results_of_the_testing_related_to_my_angular_size/). Added “CoF Bloom Per Point of Damage Done” instead. Also updated weapon stats for the latest patch.

v5 – Added a second weapon to the Recoil Page. Added brand new “Resistances” page to calculate weapon damage to vehicles.

v5a – Resistance Page will now correctly display and apply Composite Armor to air units.

v5b – added infantry and MAX defensive certifications.

v6 – added Built In Resistances Page. Reworked Resistances page, now it has increased performance and works completely differently behind the scenes, with more precision.

v6b – fixed a minor bug, removed remnants of unused code causing errors on some PCs.

v6c – fixed a minor bug related to resistances not updating properly. Fixed Blockade Armor not adding bonus HP.

v6d – hardcoded a few more weapons: UBGL, Explosive Bolts, Typhoon Rocklets. Added Engineer’s turrets. Added some more functionality to the Resistances page.

v6e – added damage-per-minute calculations to Resistances page. This feature was not thoroughly tested, so treat it as a beta.

v6f – added new weapons.

v6g – added new weapons (Flash / Doku BRs)

## To Do

~~Determine if BASR time between shots = chamber time.~~ [Done.](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#Bolt_Action_Chamber_Time)

Overall weapon rating based on multigon square calculations.

CoF / RoF probability distribution to determine weapon consistency (done in alpha)

Reword the horizontal recoil probability distribution graph to be more accurate
