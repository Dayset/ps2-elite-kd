# NSX Tomoe: Highly Technical Weapon Guide

- **Source:** https://cmdrcyrious.com/nsx-tomoe-highly-technical-weapon-guide/
- **Saved:** 2026-11-09
- **Status:** live, HTTP 200
- **Raw HTML:** `raw/nsx-tomoe-highly-technical-weapon-guide.html`
- **Extraction:** trafilatura

---

---
title: "NSX Tomoe: Highly Technical Weapon Guide | CMDRCyrious.com"
author: CMDRCyrious
url: https://cmdrcyrious.com/nsx-tomoe-highly-technical-weapon-guide/
hostname: cmdrcyrious.com
description: NSX Tomoe is a new cross faction fully automatic Scout Rifle, available only to Infiltrator class. It focuses on headshot kills at close to medium range.
sitename: CMDRCyrious.com | Take your gaming Cyriously!
date: "2016-11-19"
categories: ['PlanetSide 2, guide, highly technical, mechanics']
tags: ['guide', 'highly technical', 'mechanics', "A Newbie's Experience", 'API', 'beginner', 'calculator', 'combat medic', 'comparison', 'construction system', 'guest post', 'heavy assault', 'implant', 'infantry', 'infiltrator', 'Light Assault', 'LMG', 'loadout', 'mechancis', 'mechanic', 'New Conglomerate', 'NSX', 'PC Building', 'performance', 'repost', 'rocket launchers', 'SMG', 'stalker', 'suggestion', 'Terran Republic', 'tool', 'Vanu Sovreignty', 'Video', 'weapon', 'Weapon Calculator', 'XCOM 2']
fingerprint: "3e500bc80b6aff5a"
---
**NSX Tomoe** – named after [Tomoe Gozen](https://www.tofugu.com/japan/tomoe-gozen/) – is a fully automatic Scout Rifle, available to Infiltrators of all factions.

It focuses on quick kills with headshots at close to medium range, and has a unique combination of traits: no damage degradation and increased headshot damage multiplier, low recoil and high rate of fire.

Limited magazine size means you are likely to have only one engagement per reload.

Tomoe bridges the gap between traditional automatic Scout Rifles, that engage enemies with automatic fire at medium range, and semi auto Scout Rifles, that go all-or-nothing on headshots.

# Stats

![NSX Tomoe stats](http://cmdrcyrious.com/wp-content/uploads/2016/11/Tomoe-stats-1.png)


## Damage output

**Damage per Second:** 1400

**Damage per Magazine:** 2464

These are rather low values. However, since Tomoe has no damage degradation, it doesn’t lose any performance as range increases.

**Headshot Damage Multiplier:** 2.5x

This is one of Tomoe’s main selling points: it does 280 damage on a headshot, which means 4 headshot kill against a generic infantry target.

Average reload speed and a lot of spare ammunition.

## [Bullets to Kill](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#BTK_Thresholds) and [Time to Kill](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Fire_Rate)

While Tomoe is clearly built around getting as many headshots as possible, it should be possible to kill any enemy with bodyshots. However, it will take a disproportionately more time, and low Damage per Magazine will give you little margin for error.

**You should go for bodyshots only:**

**Against weakened, distracted or unaware enemies.** Being able to cloak should give you plenty of opportunities to pick your engagements.

**When you’re massively out of range and can’t hit the tiny head.** Tomoe’s low recoil and no damage degradation make it possible to reach out to quite distant targets

**When you can’t hit the head, because the enemy is moving in an unpredictable and erratic manner.** Though in cases like that it may be better to not engage at all.

Tables below contain the BTK and TTK values. Since Tomoe has no damage degradation, they are true for any distance.

### Headshots

| **Description** | **Effective Health   (headshots)** | **Bullets to Kill    (Time to Kill, seconds)** | 
| **Default** | 1000 ( **400**) | **4 (0.24)** | 
| **Aux. Shield** | 1050 ( **420**) |  | 
| **Heavy Assaults** |  |  | 
| **NMG** | 1437 ( **575**) | **6 (0.4)** | 
| **NMG + Aux.Shield** | 1487 ( **595**) |  | 
| **Resist** | 1538 ( **616**) |  | 
| **Resist + Aux.Shield** | 1750 ( **647**) |  | 


### Bodyshots

| **Description** | **Effective Health**  | **Bullets to Kill    (Time to Kill, seconds)** | 
| **Default** | 1000 | **9 (0.64)** | 
| **Nanoweave Armor** | 1250 | **12 (0.88)** | 
| **Heavy Assaults** |  |  | 
| **NMG** | 1438 | **13 (0.96)** | 
| **Resist** | 1538 | **14 (1.04)** | 
| **NMG + Nanoweave** | 1798 | **17 (1.28)** | 


## [Cone of Fire and Bloom](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Hip_Accuracy_and_Aim_Accuracy__Cone_of_Fire)

![tomoe-cofs](http://cmdrcyrious.com/wp-content/uploads/2016/11/Tomoe-CoFs.png)


### Hip Fire CoFs

Tomoe’s starting hip fire CoFs are bad, and the huge Bloom of 0.4 means whatever hip fire accuracy you have is only going to last for a few first shots, and then rapidly spiral out of control. Unless you’re in melee range, forget hip fire even exists for Tomoe.

### ADS CoFs

Tomoe’s ADS CoFs are nothing special when compared to other precision weapons, but it sufficiently accurate in general terms.

Notice that you get an accuracy boost for both crouching and staying stationary, and as an Infiltrator, you should take advantage of it.

ADS Bloom of 0.05 is somewhat high for such small damage per shot, so it’s recommended to not straight up magdump, and instead fire in bursts of 4-6 rounds, unless the target is very close.

That said, it is comparable to many weapons that deal 112 ***minimum*** damage per shot.

### Advanced CoF Mechanics

Starting Still CoF: 0.1

Starting Moving CoF: 0.3

Bloom per Shot: 0.05

From these statistics, and using Rule 2 of [Advanced CoF Mechanics](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Advanced_Information), we can say that you only get an accuracy boost for staying stationary during your first 4 shots.

After 4 shots, you can start moving at no accuracy penalty.

This knowledge is extremely situational, because at closer ranges you’d want to engage while moving, always. And at longer ranges, you wouldn’t want to fire more than 4-5 round in a burst.

## [Recoil](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Recoil_Mechanics)

As pulled from DBG API by [planetstats](http://planetstats.net/data/weapons/?id=804252), here are Tomoe’s recoil stats:

| **Statistic** | **Stock** | **w/ Attachments** | **Attachment** | 
| **Vertical Recoil** | 0.25 | 0.21 | Compensator (-15%) | 
| **Recoil Angle** | -3.0 / 3.0 | -0.225 / 0.225 | Forward Grip (-25%) | 
| **Horizontal Recoil** | 0.14 / 0.14 | 0.105 / 0.105 | Forward Grip (-25%) | 
| **Horizontal Recoil Tolerance** | 0.4 | 0.3 | Forward Grip (-25%) | 
| **First Shot Recoil Multiplier** | 2.0x |  |  | 
| **Refire Time** | 0.08s |  |  | 
| **Recoil Decrease** | 6 |  |  | 
| **Recoil Recovery Delay** | **0.32s** |  |  | 


### Analysis

| **Statistic** | **Stock** | **w/ Attachments** | **Attachment** | 
| **Vertical Recoil per Second** | 3.125 | 2.625 | Compensator (-15%) | 
| **Recoil Angle** | Negligible |  |  | 
| **Average Horizontal Deviation** | 0.115 | 0.087 | Forward Grip (-25%) | 
| **Max. Horizontal Deviation** | 0.28 | 0.21 | Forward Grip (-25%) | 
| **Max. Num. of horizontal kicks** | 2 |  |  | 
| **Refire Time** | 0.08s |  |  | 
| **Recoil Recovery Delay** | **0.32s** |  |  | 
| **True Recoil Recovery Delay** | **0.40s** |  |  | 
| **Recoil Recovery Time per Shot** | 0.041 | 0.035 | Compensator (-15%) | 


![Tomoe's Recoil Pattern](http://cmdrcyrious.com/wp-content/uploads/2016/11/tomoe-pattern.jpg)

Tomoe’s Recoil Pattern

Tomoe has silky smooth and stable recoil pattern. It is not noticeable at close range. At long range, it gives you the ability to easily take out stationary enemies.

Tomoe has a very unusual quality: super long **Recoil Recovery Delay**.

After your last shot in a burst, whole 0.4 seconds will pass before crosshair starts returning into its original position.

And the low **Recoil Decrease** ensure it will take its sweet time while doing so.

Believe it or not, this is actually a good thing. Tomoe engages enemies in 2-4 bursts per magazine, and **the long Recoil Recovery Delay gives you time to reset Cone of Fire and readjust your aim between bursts without any forced crosshair movement.**

![Tomoe's Horizontal Recoil Pattern](http://cmdrcyrious.com/wp-content/uploads/2016/11/Tomoe-recoil.jpg)

Stock

![Tomoe's Horizontal Recoil Pattern with FG](http://cmdrcyrious.com/wp-content/uploads/2016/11/Tomoe-FG-recoil.jpg)

Forward Grip

## Effective Range

Tomoe should be adequately effective up to 30m or so, but after that you are likely to have problems engaging moving targets.

Additionally, ADSing for headshots in close quarters can be very challenging, and with Tomoe’s hip fire being so terrible, you should make all effort to stay outdoors, and away from CQC in general.

However, extremely skilled players can find great success in taking Tomoe in aggressive close quarters, and enjoy quick headshot kills without using a bolt action rifle.

### **Going outside Effective Range**

Super small magazine size and average projectile velocity of 520 m/s will make engaging moving and aware targets challenging, even when you can afford to sit still and fire in short bursts for a prolonged amount of time.

However, very low recoil and lack of damage degradation give you the ability to kill ***stationary*** enemies with a few short bursts even at very long ranges.

In theory, Tomoe’s maximum range is limited only by user skill, since there is no damage degradation, and crouching CoFs are nearly equal to zero.

# Attachments

## [Scope](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Scopes)

Tomoe’s optimal range is within 10 to 30m bracket, and headshots are your primary goal.

With that in mind, I recommend to use a **1x** or **2x reflex scope**.

Stronger magnification can make it inconvenient to aim at targets within 10-20m, and limit your field of vision too much.

## Rail

You are faced with a choice between **[Forward Grip](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Forward_Grip_Advanced_Forward_Grip)** (-25% horizontal recoil) and **[Extended Mags](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Extended_Magazine)** (+2 rounds per mag).

Arguments can be made for both.

Damage per mag *is* one of Tomoe’s biggest issues, and horizontal recoil *is* pretty great by default. Having a couple of extra rounds makes going into Long Reload less likely, which can be important in aggressive CQC setting.

However, Ex. Mags’ benefit is very small, which makes Forward Grip a better choice for most players. Ideally, you want to engage enemies outdoors, at medium range, and you need all the accuracy you can get to hit those headshots more reliably.

## Barrel

Tomoe has access to **[Flash Suppressor](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Flash_Suppressor)**, **[Suppressor](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Suppressor)** and **[Compensator](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Compensator)**.

All three are viable, as long as you keep their upsides and downsides in mind.

Suppressor may be of special interest, as it will not affect Tomoe’s damage in any way, only the velocity.

But, personally, I recommend the **Compensator**.

Tomoe’s hip fire is already beyond terrible.

As an infiltrator, you don’t care that much about increasing minimap detection range from 40m to 75m. While it can give away your position to enemies outside your effective range, you can use cloak to prevent them from engaging on you without closing in first.

Tomoe’s performance depends on accuracy very much, and you really want smoother recoil for more convenience.

# Recommended [Infiltrator](http://cmdrcyrious.com/planetside2/classes/infiltrator/) Loadout

## [Cloak Type](http://cmdrcyrious.com/planetside2/classes/infiltrator/#Ability_Cloaking)

Tomoe has limited effective range, but you will still be mainly participating in open field combat. So you will often need to move into position before engaging, and you will need the increased cloak time of **Hunter cloaking**.

This will work well with reserved, engage-in-ideal-conditions playstyle, but if you do have the skill to consistently hit ADS headshots at close range, you will find better success with **Nano Armor Cloaking** and more aggressive playstyle.

## [Suit Slot](http://cmdrcyrious.com/planetside2/equipment/suit-slots/)

**[Nanoweave](http://cmdrcyrious.com/planetside2/equipment/suit-slots/#Nanoweave_Armor)** is recommended.

In case you mess up and fail to kill the enemy within one magazine – and it’s easy to mess up with Tomoe – you will need some defenses, to survive long enough to reload or whip out your sidearm.

You will not always have the opportunity to just hide into cover and vanish – too close for that.

Using the Tomoe may often leave you exposed for a prolonged amount of time, while you’re burst firing at an enemy. It’s not like a bolt action rifle, where you make one shot and immediately recloak. So Nanoweave will help you survive if someone’s shooting your way.

## Grenade

 [**EMP**](http://cmdrcyrious.com/planetside2/classes/infiltrator/#Utility_Items) is the recommended choice. The sheer versatility of this grenade cannot be overstated, even if there is no particular synergy with the Tomoe. You’ll be using it mainly to delete enemy Motion Spotters.

## Tool and Utility

Motion Spotter and Anti-Personnel Mines make a great combination with Tomoe. You can deploy a Motion Spotter and throw a couple of mines around. The Motion Spotter will show up on enemy minimap, and attract them to destroy it, giving you opportunities to ambush them. Mines can ensure you won’t be flanked, and that Motion Spotter is going to last a while.

This is perfect for outdoors skirmishing.

The rest of the loadout is up to preference.

# Optimal engagement

As you may have constructed by now, you want to engage enemies with Tomoe within 10 to 30m, from a cloaked stationary position, and fire in 4-6 round bursts at enemy’s head, making your best effort to keep the crosshair on target.

**Tip**: when engaging from behind, be aware that enemy will play a “being hit in the head from the back” animation, forcing enemy to bend forward, and actually hiding the head from you for a moment.

When engaging an enemy in the back, you already have an advantage, so it may be better to go for bodyshots.

## “Optimal” is not everything

Tomoe is weak in head to head fights, unless you massively outskill the enemy. Stay away from closed spaces and always keep the enemy at an arm’s length.

If you do need to close in, whipping out a sidearm may be a good idea, as at least it can hip fire accurately.

It’s usually not a good idea to engage enemies at long range, unless you can do so safely, or the enemy is staying stationary, in which case Tomoe can be used almost like a sniper rifle.

# Closing thoughts

Tomoe’s competition are other full auto scout rifles and NS-7, which can be used in the same capacity.

All of them already require very good accuracy and proper engagements, and they already kill one enemy per reload at most.

Tomoe just acknowledges and embraces these traits, and pushes them to the extreme. It kills in the same 4 headshots as other full auto scout rifles, but has better accuracy and recoil, and higher Rate of Fire.

Tomoe challenges you to go for headshots and rewards them immensely. However, as soon as you try to go for something suboptimal, like bodyshots against HA or – god forbid – hip firing, you’re gonna regret it instantly.

When paired up with sufficient skill, Tomoe can be very strong and versatile.

However, if you’re already good at clicking heads, you may as well use a CQC BASR and have 0 TTK and more kills per reload.

Tomoe very much requires both aiming and positioning skills, as well as awareness and judgement – when and how to engage.

Overall, it’s an interesting weapon, but a very steep skill requirements makes it something that 90% of infiltrator players would not enjoy using.

## Weapon’s problems

Tomoe has two recurring issues:

1. Low Damage Per Magazine. This is a constant issue when dealing with hardened or evasive targets beyond certain distance.
2. Weak in 5-10m range segment, especially in head to head engagements.

These issues combined require you to keep enemies in a “sweet spot” distance, where they are not too far, and not too close. Tomoe’s main competition, the conventional automatic Scout Rifles, don’t have to deal with these issues to the same extent.

They have better hip fire, so they work better in CQC, and they have much more DPM, so they can actually kill enemies through bodyshots. In a theoretical scenario, where the user can land 100% headshots, Tomoe wins every time, but reality is rarely so bright.

## Mustarde’s thoughts

(no link to source because it’s a PM)

*I auraxiumed Tomoe on all 3 factions. It’s a CQC monster, and has the DPM to be useful in mid range. You don’t need the highest skill level to use it, however it still requires headshots to be competitive, otherwise you will lose out in CQC.*

*Due to its no damage falloff and accurate high ROF, at mid-long range it probably is comparable or better than most LMG/AR/carbines out there, but automatics aren’t really supposed to be competitive beyond 70m or so.*

*I’d say it’s slightly better than SOAS / Stalker / Artemis at this point, but depends on the user having good aim and headshot accuracy. I burst it in 4-5 round taps beyond 15m.*

**Mustarde’s  Loadout:** Nano Armor Cloaking, Nanoweave Armor, Recon Darts, EMP grenades, Med Kits.

*Because it is such a CQC reliant weapon, I have found greater success with the nano-armor cloak, which gives me 100 shield back plus lets me escape and survive dicey encounters. That plus nanoweave let’s me get in people’s faces and splooge the Tomoe mag and escape for reloading.*

*The hunter cloak works too, obviously, with a different and more conservative style. But I still think the NAC is a powerful option. If you expect to be taking any fire, it’s really worth considering. It makes you on-par with other classes which is huge in 1v1’s, especially with a gun that often forces you to face off against others.*

*With a bolt action, you usually don’t get shot much for that single headshot, so I don’t rely on NAC at all, even when using a 4x BASR. But for scouts and now SMG’s, I’m fully on the NAC train, after years of using Hunter cloaking. I’ve seen a very noticeable improvement in performance with it.*

## Adding Tomoe into Weapon Simulator

If you want to add NSX Tomoe into my [Weapon Simulator](http://cmdrcyrious.com/planetside-2-weapon-simulator/), add this string to the end of the **Stats.csv** file, which you can open with Windows Notepad:

`804252,NSX Tomoe,NS,Scout Rifle,112,10,112,20,1.5,80,1,0.55s / 0.64s / 0.64s,,-,22,286,2900,2100,0.5,0.4,0.05,3.25,2.75,3.75,5,2.75,0.1,0.03,0.3,0.06,-3,3,0.25,0.14,0.14,0.4,2,6,Auto,0`

The guide is now concluded, feel free to comment or ask questions below.
