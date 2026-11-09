# The “Discovery” of Recoil Recovery Delay

- **Source:** https://cmdrcyrious.com/the-discovery-of-recoil-recovery-delay/
- **Saved:** 2026-11-09
- **Status:** live, HTTP 200
- **Raw HTML:** `raw/the-discovery-of-recoil-recovery-delay.html`
- **Extraction:** trafilatura

---

---
title: The “Discovery” of Recoil Recovery Delay | CMDRCyrious.com
author: CMDRCyrious
url: https://cmdrcyrious.com/the-discovery-of-recoil-recovery-delay/
hostname: cmdrcyrious.com
description: Recoil Recovery Delay is the delay before your crosshair starts returning to its original position after you have stopped firing, measured in milliseconds.
sitename: CMDRCyrious.com | Take your gaming Cyriously!
date: "2016-11-20"
categories: ['PlanetSide 2, guide, mechanics']
tags: ['guide', 'mechanics', "A Newbie's Experience", 'API', 'beginner', 'calculator', 'combat medic', 'comparison', 'construction system', 'guest post', 'heavy assault', 'highly technical', 'implant', 'infantry', 'infiltrator', 'Light Assault', 'LMG', 'loadout', 'mechancis', 'mechanic', 'New Conglomerate', 'NSX', 'PC Building', 'performance', 'repost', 'rocket launchers', 'SMG', 'stalker', 'suggestion', 'Terran Republic', 'tool', 'Vanu Sovreignty', 'Video', 'weapon', 'Weapon Calculator', 'XCOM 2']
fingerprint: e06d1f398af3cfa
---
For someone who considers himself a weapon mechanics guru, I’ve been woefully negligent. For a long time we had access to a peculiar statistic: **Recoil Recovery Delay**.

It can be pulled from [DBG API.](http://cmdrcyrious.com/weapon-stats/)

## What is Recoil Recovery Delay?

**Recoil Recovery Delay** is the delay before your crosshair starts returning to its original position after you have stopped firing, measured in milliseconds.

The speed of the crosshair movement depends on another statistic – **Recoil Decrease**, also known as **Recoil Recovery Rate**, measured in degrees per second.

Knowing these two statistics and **Vertical Recoil**, you can judge weapon’s affinity for tap firing and short bursting.

Using the old [weapon stats spreadsheet](https://docs.google.com/spreadsheets/d/1Or5LdB5WGntOIN6wPyvmziyBZLeZQW2AYHpkbK5rvoY/edit#gid=13) by /u/cheesecrackers as basis for my original research years ago, I’ve been led to believe that Recoil Recovery Delay is always equal to weapon’s **Refire Time** – time between shots, based on weapon’s **Rate of Fire**.

Turns out, it’s a little more complicated.

## How it works

The Recoil Recovery Delay values listed in DBG API – could be more correctly called “added” Recoil Recovery Delay. A shift, or an offset.

To calculate the true delay before the crosshair movement starts, you need to ***add*** listed Recoil Recovery Delay to weapon’s Refire Time.

`True Delay = Recoil Recovery Delay + Refire Time`

### Example

You fire a burst with [**T1 Cycler**](http://cmdrcyrious.com/planetside2/weapons/assault-rifles/#T1_Cycler). It has:

Recoil Recovery Delay: 80ms

Refire Time: 80ms

`True Delay = 80 + 80 = 160 ms = 0.16 seconds`

After final shot in the burst, 0.16 seconds will pass before the crosshair starts moving back.

You’ll notice that Recoil Recovery Delay in this case is equal to Refire Time, and it’s also true for many other weapons. This is probably what led cheesecrackers to believe that True Delay is equal to Refire Time. I guess he never ran a slow-mo tests to confirm it, and neither did I – until recently.

However, there are a lot of weapons which have Recoil Recovery Delay equal to zero, and the **[recent patch](https://forums.daybreakgames.com/ps2/index.php?threads/pc-hotfix-11-18.243591/)** even set negative Recoil Recovery Delay for some weapons.

And as an even crazier exception, Tomoe has increased Recoil Recovery Delay of 4 times the Refire Rate.

## What the November patch changed

Currently, Battle Rifles, Semi Auto Scout Rifles and Semi Auto Sniper Rifles have negative Recoil Recovery Delay.

|  | **Semi Auto Scout Rifles** | **Semi Auto Sniper Rifles** | **Battle Rifles** | 
| **Refire Time, ms** | 235 | 260 | 180 | 
| **Recoil Recovery Delay, ms** | -118 | -130 | -30 | 
| **True Delay, ms** | 117 | 130 | 150 | 
| **Recoil Recovery Rate,   degrees / sec** | 8 | 10 | 15 | 
| **Vertical Recoil, degrees** | 1 | 1.2 | 0.6 | 
| **Recoil Recovery Time per shot** | 0.125s | 0.12s | 0.04 | 

These Scout and Sniper rifles have True Delay of 0.5x the Refire Time, while most automatic weapons have True Delay of 2x Refire Time.

Unfortunately, at this time I lack the capacity to create a side by side video. But you can already guess that reduced Recoil Recovery Delay gives them unprecedented tap firing speed, as crosshair starts moving back almost instantly after the shot, without purpose-less-ly hanging in air.

This is less noticeable on Battle Rifles, however they have greater Recoil Recovery Rate, lesser Vertical Recoil and shorter Refire Time. They already excel at tap firing.

**Tomoe**‘s unique situation is described in [another article](http://cmdrcyrious.com/nsx-tomoe-highly-technical-weapon-guide/#Recoil).

## Closing Thoughts

Recoil Recovery Delay is an important statistics for judging weapon’s capability to burst fire, and it should be considered on equal grounds to Recoil Recovery Rate and Vertical Recoil.
