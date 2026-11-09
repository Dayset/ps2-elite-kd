# NSX Yumi: Highly Technical Weapon Guide

- **Source (live):** https://cmdrcyrious.com/nsx-yumi-highly-technical-weapon-guide/ — live copy returns HTTP 200 but its static HTML contains no article body (verified 2026-11-09); content below is from the Wayback Machine.
- **Source (archived):** http://web.archive.org/web/20240716033858/http://cmdrcyrious.com/nsx-yumi-highly-technical-weapon-guide/
- **Snapshot date:** 20240716033858
- **Saved:** 2026-11-09
- **Raw HTML (archived):** `raw/wayback__nsx-yumi-highly-technical-weapon-guide.html`
- **Raw HTML (live, empty body):** `raw/nsx-yumi-highly-technical-weapon-guide.html`

---

---
title: "NSX Yumi: Highly Technical Weapon Guide"
author: CMDRCyrious
url: http://cmdrcyrious.com/nsx-yumi-highly-technical-weapon-guide/
hostname: cmdrcyrious.com
description: NSX Yumi is an assault rifle, available only to Combat Medic class. It fires in fast and accurate bursts of 5 rounds, but with a short delay before each burst. Yumi is an excellent weapon for medium and long range combat, and it gives a huge advantage when firing first, more so than any other autom
sitename: CMDRCyrious.com
date: "2017-04-28"
categories: ['PlanetSide 2, guide, highly technical, mechanics, NSX, weapon']
tags: ['guide', 'highly technical', 'mechanics', 'NSX', 'weapon', "A Newbie's Experience", 'API', 'beginner', 'calculator', 'combat medic', 'comparison', 'construction system', 'guest post', 'heavy assault', 'implant', 'infantry', 'infiltrator', 'Light Assault', 'LMG', 'loadout', 'mechancis', 'mechanic', 'New Conglomerate', 'PC Building', 'performance', 'repost', 'rocket launchers', 'SMG', 'stalker', 'suggestion', 'Terran Republic', 'tool', 'Vanu Sovreignty', 'Video', 'Weapon Calculator', 'XCOM 2']
fingerprint: be19d779c126b0cf
---
**NSX Yumi** is an assault rifle, available only to **[Combat Medic](http://cmdrcyrious.com/planetside2/classes/combat-medic/)** class. It fires in fast and accurate bursts of 5 rounds, but with a short delay before each burst.

Yumi is an excellent weapon for medium and long range combat, and it gives a huge advantage when firing first, more so than any other automatic weapon. But the burst delay makes the weapon a little bad in direct confrontation, especially if the enemy engages you first in close quarters.

Playing with Yumi is like playing with any slow and accurate ranged Assault Rifle – you will have to stick to cover, be ready to disengage if you get shot and avoid rushing head-first.

![](http://cmdrcyrious.com/wp-content/uploads/2017/04/NSX-Yumi-1024x490.jpg)


Using the Yumi is the hard way to teach a player to look for good engagements; the strict requirement on accuracy and firing delay will force the user to always aim down sights and aim properly before opening fire.

On the other hand, Yumi is a weapon that plays itself. Unlike other **[burst weapons](https://www.youtube.com/watch?v=OP979guPeNI)**, which are basically automatic weapons in disguise, Yumi doesn’t allow any Cone of Fire management, and barely requires recoil compensation.

Yumi is predominantly a medium+ range support weapon. If you ever wanted a designated marksman rifle for a medic – this is it.

Yumi was released in underpowered state, and was significantly buffed in **[Apr 27th, 2017 patch](https://forums.daybreakgames.com/ps2/index.php?threads/pc-hotfix-4-27.245654/)** and [**Oct 19th, 2017 patch**](https://forums.daybreakgames.com/ps2/index.php?threads/pc-game-update-10-19-nanite-of-the-living-dead.247496/), and now that this weapon is actually viable, let’s take a deeper look.

# Stats

![NSX Yumi](http://cmdrcyrious.com/wp-content/uploads/2017/04/Weapons_Common_FavenWeapons_AssaultRifle001Loaded_256x128.png)


\[spoiler title=”Detailed stats”\]

Damage: 167 @ 10 – 125 @ 90

Firing Delay: 0.25 seconds

Burst Rate of Fire: 1000

Rounds Per Minute: \~545

Velocity: 580 m/s

Reload Time: 1.8 sec / 2.45 sec

Ammo: 30 / 210

Hip CoFs: 2 / 2.25 / 2.5 / 3 / 0.12

ADS CoFs: 0.03 / 0.15 / 0.03 / 0.15 / 0.05

Headshot Damage Multiplier: 2x

Minimap Detect Range: 40

**ADS Movespeed Multiplier: 0.5x**

Equip / Unequip Time: 0.65 sec / 0.25 sec

ADS Time To / From: 0.15 sec / 0.15 sec

Projectile Lifespan / Gravity: 1.5 sec / 11.25

Vertical Recoil: 0.22

First Shot Recoil Multiplier: **0x**

Recoil Angle: 5 / 5

Horizontal Recoil: 0.12 / 0.12

Horizontal Recoil Tolerance: 0.2 (up to 1 kick)

Refire Time: 250 ms (for the purposes of recoil recovery delay)

~~Recoil Recovery Delay: 50 ms~~

Recoil Recovery Rate: 16

# Mechanics

![](http://cmdrcyrious.com/wp-content/uploads/2017/04/NSX-Yumi-blueprint-1024x486.jpg)


After you press the trigger, there is a 0.25 second firing delay. Then it takes a 0.24 seconds to fire off a 5 round burst, with 60 ms refire time between shots. For comparison, **[AF-4 Cyclone](http://cmdrcyrious.com/af-4-cyclone-highly-technical-weapon-guide/)** has 92 ms refire time.

![NSX Yumi timeline](http://cmdrcyrious.com/wp-content/uploads/2017/04/NSX-Yumi-timeline-1.jpg)


As with a semi-auto weapon, you can queue the next burst right after you start charging the current burst. Click-release-click-hold until the next burst starts charging. This technique is explained in detail **[here](http://cmdrcyrious.com/planetside2/weapons/gunplay-guide/#Firing_semi-auto_weapons_faster)**.

If you press the trigger without Aiming Down Sights, you will not be able to Aim Down Sights until the weapon finishes firing.

Similarly, if you press the trigger while ADSing, you will not be able to leave ADS, even if you jump. **This is actually one of the biggest turn-offs of this weapon**, because when you click to fire, you essentially commit your next 0.55 seconds to firing, and this can be a problem if you get attacked by another enemy during this time.

## Melee Combo

Yumi’s fixed burstfire mode gives it an interesting mechanical quirk. You can click to start charging the burst, and then perform a quick melee attack *while* the weapon is firing. This makes Yumi surprisingly scary in close quarters, because even if only 4 out of 5 shots hit, a knife strike will still reliably kill standard infantry through nanoweave.

## Damage

![NSX Yumi Damage](http://cmdrcyrious.com/wp-content/uploads/2017/04/NSX-Yumi-Damage-1024x278.png)

Click to enlarge

**Rate of Fire during a burst:** 1000 RPM

**DPS during a burst:** 2783 to 2083 depending on distance.

**Overall Rate of Fire:** \~545 RPM **Overall DPS:** 1516 to 1135, depending on distance.

Yumi fires off the burst at the highest rate of fire among all primary weapons, and therefore has the highest non-shotgun DPS. Burst delay significantly reduces overall rate of fire, reducing overall DPS to be on the level of a 167 @ 550 RPM weapon.

| **Description** | **Effective Health** | **Bullets to Kill** |  |  |  |  | 
|  |  | **6** | **7** | **8** | **9** | **10** | 
| **Default**   | 1000 | 0 – 10 | 11 – 55 | 56+ |  |  | 
| **Nanoweave**  | 1250 |  |  | 0 – 29 | 30 – 63 | 64+ | 


With perfect accuracy and bodyshots, Yumi will require two bursts against a full health target. Heavy Assaults will require an extra burst at most. It is possible to one-burst a target if several shots hit the head.

Overall, assuming good, but not perfect accuracy, you should expect 2-3 burst kills against standard enemies, and 3-4 bursts against Heavy Assaults.

Finally, one burst + one quick knife swing will reliably kill standard infantry, though it’s not an easy combo to hit against an aware player.

## Recoil

![](http://cmdrcyrious.com/wp-content/uploads/2017/04/NSX-Yumi-recoil-pattern-new.png)

![](http://cmdrcyrious.com/wp-content/uploads/2017/04/NSX-Yumi-recoil-pattern-new-2.png)


|  | **Stock** | **With Attachment** |   | 
| Vertical Recoil during Burst, per sec | **\~3.6** | **\~3.1** | Compensator | 
| First Shot Multiplier (Recoil) | **0x** | **0x** |  | 
| Average Horizontal Deviation | **0.057** | **0.043** | Forward Grip | 
| Maximum Horizontal Deviation | **0.12** | **0.09** |  | 
| Recoil Angle | **5** | **3.75** |  | 
| Recoil Recovery True Delay | **0.31** |  | – | 
| Burst Recoil Recovery Time | **0.079** | **0.065** | Both | 


Yumi is the only weapon to feature a zero First Shot Recoil Multiplier, meaning **it has no vertical recoil for the first shot**. The first shot is still subjected to Horizontal Recoil, though.

Yumi has one of the lowest values for Vertical Recoil, though extremely high rate of fire still creates a **noticeable vertical pull during the burst**. You can’t start compensating recoil on reaction, because the burst will be over before you can react.

Yumi has very little Horizontal Recoil for its damage profile, and a negligible recoil angle to the right.

**Recoil Recovery** finishes before you can start the next burst.

## Accuracy

**ADS CoFs:** 0.03 / 0.15 / 0.03 / 0.15 / 0.05

Yumi has very small Cones of Fire in all stances, and reduced Cone of Fire Bloom. Most 167 damage weapons have CoF Bloom of 0.06.

It’s worth noting that Yumi doesn’t get any bonus accuracy for crouching.

Overall, it’s safe to say that Yumi features one of the longest effective ranges among Assault Rifles. And even ranged monsters like **Reaper DMR** cannot compete with Yumi’s moving accuracy and low Bloom.

**Hip CoFs:** 2 / 2.25 / 2.5 / 3 / 0.12

Yumi has standard hip fire accuracy for an assault rifle. It can be surprisingly effective in a pinch, but don’t expect any miracles, especially if you use Compensator.

# Attachments

## [Optics](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Scopes)

Yumi has access to a variety of reflex scopes from 1x to 3.4x, and **[HS/NV scope](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#HSNV_IRNV_scope)**. As always, the choice will depend only on your personal preference.

![](http://cmdrcyrious.com/wp-content/uploads/2017/04/05-reflex-sight.jpg) A low magnification scope makes it feel like the weapon has no recoil at all, and it allows a wider field of view, which can be crucial while you are busy tunnel visioning in one direction and firing off several bursts – Yumi has a long exposure time.


![](http://cmdrcyrious.com/wp-content/uploads/2017/04/02-6x-scope-or-34cant-remember.jpg) On the other hand, a higher magnification scope gives a clearer sight of the target, allowing for more deliberate accuracy. It can also help identify targets at longer ranges before you even open fire.


When in doubt – start with 2x Reflex, and see whether you need more or less magnification.

## [Barrel](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Barrel_Attachments)

Yumi has access to **[Flash Suppressor](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Flash_Suppressor)** and **[Compensator](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Compensator)**. Both are viable, depending on playstyle and intended application.

- Flash Suppressor will make you less noticeable, which is crucial in ranged combat.
- Compensator will increase ranged accuracy and make it easier to get headshots.

## [Rail](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Rail_Attachments)

![](http://cmdrcyrious.com/wp-content/uploads/2017/04/06-FW-grip.jpg)


Yumi has access to **[Extended Mags](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Extended_Magazine)** (+5 rounds), **[Forward Grip](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Forward_Grip_Advanced_Forward_Grip)**, **[Darklight Flashlight](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Darklight_Flashlight)** and **[Underbarrel Smoke](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Underbarrel_Smoke_Grenade_Launcher_UBSGL)** and **[Grenade Launchers](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Underbarrel_Grenade_Launcher_UBGL)**.

Yumi is a rare case of a ranged weapon where Forward Grip is not mandatory. Yumi already has very little horizontal recoil, and at ranges where you would benefit from the Forward Grip, Yumi already gets weaker due to Cone of Fire Bloom and damage degradation.

![](http://cmdrcyrious.com/wp-content/uploads/2017/04/WeaponAttachment_Common_GrenadeLauncher_001_LOD0_128x64.png) Yumi’s underbarrel attachments are similar to those of other weapons.


**Underbarrel Grenade Launcher** offers a great way to increase utility, versatility and firepower. It can damage vehicles, finish off players behind cover, and even OHK if you manage to get a direct hit. UBGL was never a bad attachment to have. It has just two problems: it is usually available on crappy weapons, or weapons that greatly benefit from other rail attachments.

Yumi doesn’t have any of those problems, so it is a prime candidate for using UBGL.

## [Ammo](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Ammo)

Yumi has access to **[SPA](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Soft_Point_Ammo)** and **[HVA](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#High_Velocity_Ammunition_HVA)**.

![](http://cmdrcyrious.com/wp-content/uploads/2017/04/01-Regular-universal-mag.jpg)


SPA is better within 35m and gives maximum benefit of +1.8% damage at 15m.

HVA is better at 35m+ and gives maximum benefit of +6.4% damage at 90m.

*If you’re interested in a more in-depth analysis of ammo types, /u/DrSwov has a **[reddit post](https://www.reddit.com/r/Planetside/comments/682snq/yumi_changes_numbers_for_vets/)** with TTK numbers against different targets.*

## Recommended Attachments

There are many viable attachment combinations with Yumi. If you know what you’re doing, you should be able to easily figure out the best build for yourself.

If you need some help to get started, here is an example of a cookie-cutter build:

- **2x Reflex**
- **Flash Suppressor**
- **High Velocity Ammo**
- **Underbarrel Grenade Launcher**
- **[Battle Hardened](http://cmdrcyrious.com/planetside2/equipment/implants/#Battle_Hardened) Implant**

The goal behind this loadout is to give you the most versatility and combat options, without being overly specialized in any particular area.

# Gameplay Tips

NSX Yumi is way more versatile than it may seem on the first look. The burst mechanic spices things up a bit, but you quickly get used to it, and for most intents and purposes, you simply get a gun that shoots half the time, and charges up the other half.

Use the burst delay to your advantage, and take aim properly while the gun is charging up.

Yumi has surprisingly decent performance from the hip, but you should still invest in a powerful **[sidearm](http://cmdrcyrious.com/planetside2/weapons/sidearms/)** for close encounters, and get comfortable with it. If you get engaged while healing or reviving, the sidearm will be your go-to weapon, not the Yumi.

Being unable to fire single shots is definitely limiting, because you can’t tap-fire snipe engies behind turrets or deployables.

Yumi is excellent at range out of the box, without any performance-enhancing attachments, so it can be used with any attachment combination and still be viable.

The burst mechanic certainly gives advantage to firing first, but it’s not like you automatically lose if you get engaged on. Dodging enemy fire and hip firing, or ADSing and going for headshots are both viable ways of fighting back, depending on situation.

Don’t spend too much time firing at targets at super long range, you’re unlikely to kill them before they make it to cover, and every moment you spend outside cover increases the chances of getting sniped.

In extreme close quarters, consider switching to a sidearm, if you’re good with it. You can also “pre charge” a burst as you round the corner, though it requires good timing, and you have to already know where the enemy is.

# Conclusion

Yumi is an interesting and worthy addition, both to NSX lineup and Assault Rifles in general. Not everyone will like it, but everyone can use it. Unlike most other NSX weapons, Yumi doesn’t have a steep skill requirement.

- Give Yumi to a PS2 newbie with some FPS experience, and he will be able to participate in ranged combat, even though he knows nothing about CoF and recoil management.
- Give Yumi to a hardened veteran with excellent accuracy, and most enemies will die before they realize they’re getting damaged.

Yumi is a welcome respite from super-niche weapons, though the delayed burst mechanic seems a little out of place on Medic, and would make more sense on Light Assault or Infiltrator, in my opinion.

If you’re thinking about purchasing the Yumi, it is strongly recommended you trial it, and use it in actual combat for the whole 30 minutes.

## Answering critique

The whole premise of Yumi being a “garbage” weapon is based on a 0.25 second burst delay, which is not a big deal, unless you get shot as soon as the engagement starts. This just means Yumi user has to be a little more thoughtful about engagements he’s taking, nothing more.

Ignoring the burst delay, Yumi is basically an incredibly accurate 167 @ 550 AR with nearly no recoil and automatic CoF reset. I wouldn’t say that’s bad.


# Adding Yumi into Weapon Simulator

If you want to add NSX Yumi into my **[Weapon Simulator](http://cmdrcyrious.com/planetside-2-weapon-simulator/)**, add this string to the end of the **Stats.csv** file, which you can open with Windows Notepad:

`804246,NSX Yumi,NS,Assault Rifle,167,10,125,90,1,60,1,0.48s / 0.56s / 0.56s,580,-,30,210,3550,2755,0.5,0.12,0.05,2,1.5,2.5,5,2,0.03,0.03,0.15,0.15,5,5,0.29,0.12,0.12,0.4,0,16,Auto,0`

`804246,NSX Yumi SPA,NS,Assault Rifle,167,15,125,90,1,60,1,0.48s / 0.56s / 0.56s,551,-,30,210,3550,2755,0.5,0.12,0.05,2,1.5,2.5,5,2,0.03,0.03,0.15,0.15,5,5,0.29,0.12,0.12,0.4,0,16,Auto,0`

`804246,NSX Yumi HVA,NS,Assault Rifle,167,8,125,110,1,60,1,0.48s / 0.56s / 0.56s,609,-,30,210,3550,2755,0.5,0.12,0.05,2,1.5,2.5,5,2,0.03,0.03,0.15,0.15,5,5,0.29,0.12,0.12,0.4,0,16,Auto,0`


Keep in mind that it won’t properly simulate Yumi’s burst mechanics.

Thank you for Great ps2 weapon articles
