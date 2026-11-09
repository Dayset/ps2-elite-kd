# PlanetSide 2 Sniper Rifles

- **Source (live):** https://cmdrcyrious.com/planetside2/weapons/sniper-rifles/ — live copy returns HTTP 200 but its static HTML contains no article body (verified 2026-11-09); content below is from the Wayback Machine.
- **Source (archived):** https://web.archive.org/web/20240417031904/https://cmdrcyrious.com/planetside2/weapons/sniper-rifles/
- **Snapshot date:** 20240417031904
- **Saved:** 2026-11-09
- **Raw HTML (archived):** `raw/wayback__planetside2__weapons__sniper-rifles.html`
- **Raw HTML (live, empty body):** `raw/planetside2__weapons__sniper-rifles.html`

---

---
title: Sniper Rifles
author: Institoros
url: http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/
hostname: cmdrcyrious.com
description: "In this guide you will find color-coded references to other guides and materials: Dark orange links to other guides or anchors within this guide Purple links to videos in pop-up viewboxes Blue links to images in pop-up viewboxes Intro Sniper Rifles are long range primary weapons,"
sitename: CMDRCyrious.com
date: "2016-04-26"
fingerprint: "9f04ed71c00684fb"
---
In this guide you will find color-coded references to other guides and materials:

- **[Dark orange links to other guides or anchors within this guide](http://cmdrcyrious.com/planetside2/classes/infiltrator/)**
- [**Purple links to videos in pop-up viewboxes**](https://www.youtube.com/watch?v=AGz9FTnIHcs)
- [**Blue links to images in pop-up viewboxes**](http://cmdrcyrious.com/wp-content/uploads/2016/06/20111118_4ec6f04249c20.jpg)

# Intro

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/half-cloaked-sniper-shot-1024x572.jpg)

This picture is photoshopped

Sniper Rifles are long range primary weapons, exclusive to Infiltrators. Most Sniper Rifles fit into one of these two categories:

**Semi Auto Sniper Rifles (SASR).** These fast firing rifles can take rapid follow-up shots, but require two headshots to kill most enemies.

**Bolt Action Sniper Rifles (BASR).** These rifles are much more powerful, and can potentially kill in one headshot, but they need to be rechambered between shots, which significantly reduces overall rate of fire.

*Do not be confused by [**SAS-R**](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#SAS-R), which is an NC BASR.* 

While all Sniper Rifles are fully capable of killing enemies with bodyshots, it often takes too long, giving the enemy a lot of time to take cover, and for enemy snipers to countersnipe you. Firing several shots in a row also broadcasts your position to other nearby enemies.

So both Sniper Rifle types focus on getting headshots, and killing enemies with as few shots as possible.

By default, **TR** and **VS** infiltrators use [**99SV**](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#99SV) and [**VA39 Spectre**](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#VA39_Spectre) semi auto rifles respectively, **NC** infiltrators use [**NC-14 Bolt Driver**](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#NC14_Bolt_Driver).

Similarly to **[Shotguns](http://cmdrcyrious.com/planetside2/weapons/shotguns/)**, differences between Sniper Rifles of different factions are mostly cosmetic, with the exception of **[Empire Specific](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#Empire_Specific_Sniper_Rifles)** and **[Semi Auto](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#Semi_Auto_Sniper_Rifles)** sniper rifles.

Compared to other precision weapons, like **[Scout](http://cmdrcyrious.com/planetside2/weapons/scout-rifles/)** and **[Battle Rifles](http://cmdrcyrious.com/battle-rifles/)**, Sniper Rifles deal more damage per shot, but have bad moving accuracy, and in most cases require the user to be stationary while shooting.

# Sniper Rifle Mechanics

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/Sniper-Rifle-Blueprint-1-1024x426.png)


Sniper Rifles follow the same **[Weapon Mechanics](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/)** as other weapons.

## Scope Sway

Rifles with 6x-12x magnification scopes have **Scope Sway**; whenever you Aim Down Sights, your crosshair will float around a certain area.

**All Sniper Rifles with sway have the same amount of Scope Sway.** As far as we know, it is constant, across all scopes and all situations. Naturally, higher magnification scopes will magnify Scope Sway, the same way they magnify recoil.

## Holding Breath

Players can hold “Hold Breath” key (default “shift”) to almost completely suppress Scope Sway. **[Target Focus](http://cmdrcyrious.com/planetside2/equipment/implants/#Target_Focus)** Implant can increase the amount of time you can Hold Breath.

Additionally, “long range” Semi Auto Sniper Rifles have access to a free **Ballistics Computer** attachment, which completely removes Sway on all scopes.

Capacity: 1

Initial Cost: 0.1

Drain Rate: 0.25 per second

Recharge Delay: 1 second

Recharge Rate: 0.25 per second

Penalty: 3 seconds

Penalty Sway Multiplier: 3x

*Huge thanks to **[/u/shaql](https://www.reddit.com/user/shaql)** for providing these numbers, datamined from the client.*

**Mechanics:** your character has a fixed “lung capacity”. When you start Holding Breath, you instantly pay an Initial Cost of 1/10th of your Capacity. Then your Capacity starts draining at the listed Drain Rate.

Target Focus implant reduces this Drain Rate by 0.15/ 0.1538 / 0.1591 / 0.1667 / 0.1875 depending on rank.

When you release the Hold Breath key, after a 1 second Recharge Delay, your Capacity will fully recharge over 4 seconds.

If you Hold Breath for too long and fully deplete your Capacity, you will suffer 3x stronger Scope Sway for 3 seconds, and you will not be able to Hold Breath again during the Penalty.

However, this Penalty has no effect on Recharging mechanics, so you will restore some of your Capacity during the Penalty, and you will be able to Hold Breath again as soon as Penalty is over.

| Target Focus Rank | 0 | 1 | 2 | 3 | 4 | 5 | 
| Hold Breath Duration, sec | 3.6 | 9 | 9.35 | 9.9 | 10.8 | 14.4 | 

As you can see, even the Rank 1 of Target Focus provides a huge benefit, and should be enough for most snipers. Upgrading the implant doesn’t really provide a noticeable boost until the final rank.

\[/spoiler\]
## Bullet Drop

Bullets in PlanetSide 2 are affected by Gravity:

- Most primary weapons: 11.25
- Sniper Rifles: 7.5 (33% less)
- VS Semi Auto Sniper Rifles and Phaseshift: 0

### Ballistic Table

Ballistic Table helps to compensate for bullet drop while doing long range sniping, especially with a Suppressor.

A ballistic table contains the distance to the target, and a number of mildots that you have to raise your aim by in order to compensate for drop.

Here’s an (outdated) example table for *Suppressed*[**RAMS .50**](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#RAMS_50) using 10X scope.

| **Distance, m** | **Drop, mildots** | **Infantry Height, mildots** | 
| 100 | 1.25 | 5 | 
| 150 | 2 | 3.5 | 
| 200 | 2.5 | 3 | 
| 250 | 3 | 2.5 | 


![](http://cmdrcyrious.com/wp-content/uploads/2016/04/ballistic-table-e1498665596314.png) This table also includes the number of mildots in a full-height infantry target. You can use it to measure the distance to the target, or you can use

[**Sweeper HUD**](http://cmdrcyrious.com/planetside2/equipment/implants/#Sweeper_HUD) implant for that purpose.

You can go to [**VR Training**](http://cmdrcyrious.com/planetside2/starter-guide/#VR_Training), write a ballistic table on a piece of paper and then pin it to the monitor with a sticker.

### Ballistic Crosshair Overlay

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/550msSniperBallistic.png)

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/sniper-rifle-ballistic-crosshair-overlay.png)

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/ballistic-tip-1-1.png)

This is an alternative to a Ballistic Table. **[This example crosshair](http://cmdrcyrious.com/wp-content/uploads/2016/04/550msSniperBallistic.png)** is configured for:

- 6x zoom and 550 m/s projectile velocity Sniper Rifles, such as [**Long Range Semi-Auto Sniper Rifles**](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#Long_Range) and [**Tier 2 Bolt Action Rifles**](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#Tier_2_8211_Medium_Range).
- 1920 x 1080 resolution.
- **[Vertical FoV](http://cmdrcyrious.com/planetside2/performance-guide/#Vertical_Field_of_View)** of 74 degrees.

Markings on the left show the height of standard infantry target at 200m and 250m. Use them to measure distance to the target, and then use the couples of dots below the crosshair to compensate for bullet drop. [**Video demonstration**](https://www.youtube.com/watch?v=WmUbSzW-h6I). [**Download link**](http://cmdrcyrious.com/wp-content/uploads/2016/04/550msSniperBallistic.png).

There are no markings for closer range, because within 150m these rifles are mostly point and click. This makes Ballistic Crosshair Overlay mostly pointless, because most of the “useful” sniping is done within that distance.

To use it you will have to install [**Recursion Stat Tracker**](http://cmdrcyrious.com/planetside2/performance-guide/#Custom_crosshair_overlay) with a Crosshair Overlay module. In case you’re wondering, this is completely legit and you will not get banned for using it.

This particular example is mostly just proof of concept. It will not work for players with other Vertical FoV or resolution, or for a rifle with a different Zoom or Projectile Velocity.

If you’d like to use a Ballistic Crosshair Overlay, you would probably have to create your own, using a bit of Photoshop and a few screenshots.

## [Field of View](http://cmdrcyrious.com/planetside2/performance-guide/#Vertical_Field_of_View)

Having the right FoV settings is especially important for snipers.

- With lower FoV, enemies will occupy more space on your screen, making it easier to land headshots at long range.
- WIth higher FoV, you will see more of the game world on your screen, which can allow for better situational awareness in CQC sniping.

## Increased Headshot Damage Multiplier

Weapons usually deal increased damage when hitting the head:

- Most primary weapons: 2x
- Bolt Action Sniper Rifles: 2.1x
- Phaseshift in “bolt action” mode: 2.2x

## Increased Fire Detect Range

When you fire an unsuppressed weapon, your position is **[highlighted as a dot](http://cmdrcyrious.com/planetside2/beginner-guides/map-and-minimap/#Minimap)** on the minimap of all enemies within this Fire Detect Range:

- Most primary weapons: 40m.
- Sniper Rifles: 100m.
- Directive Sniper Rifles: 150m.
- TRAP-M1: 40m

## Increased Tracer Visibility

Sniper Rifles have more visible tracers than other firearms. They are thicker, and linger for longer.

## Increased Scope In Time

Scope In Time is the time it takes for a weapon to transition from Hip Firing to Aiming Down Sights.

- Most primary weapons: 0.15 seconds
- Rifles with 6x-12x magnification scopes: 0.3 seconds.
- “Close range” sniper rifles that use 1x-4x scopes: 0.2 seconds.

Additionally, while scoping into high magnification overlay scopes, you will have a temporary blackout, and there will be a short animation with crosshair moving in. Overall, it takes about extra 30-50ms.

These values refer only to weapon animation, **[Cone of Fire Mechanics](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Hip_Accuracy_and_Aim_Accuracy__Cone_of_Fire)** are a separate issue.

## Additional Forward Grip Benefit

In addition to its usual effects, **[Forward Grip](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Forward_Grip_Advanced_Forward_Grip)** reduces Vertical Recoil by 15% for all Sniper Rifles, except **TRAP-M1**.  Forward Grip bears a 0.1 second Equip Time penalty for all Sniper Rifles.


# Semi Auto Sniper Rifles

**VS** Semi Auto Sniper Rifles do not have bullet drop.

## Long Range

### 99SV

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/99SV.png)


### Gauss SPR

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/Gauss-SPR.png)


### VA39 Spectre

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/VA39-Spectre.png)


These are classic “long range” semi auto sniper rifles with access to 6x through 12x overlay sniper scopes. They can take rapid follow-up shots, and are more effective at killing enemies with body shots than most other sniper rifles.

They have exclusive access to **Ballistics Computer** – a rail attachment that completely removes Scope Sway on all scopes. Unlocked and equipped by default.
![Ballistics Computer](http://cmdrcyrious.com/wp-content/uploads/2016/04/Ballistics-Computer.png)


**VS** Semi Auto Sniper Rifles have no bullet drop and slightly higher velocity, and they do slightly more damage within 100m, but less damage at 100m+.

All Semi Auto Sniper Rifles kill standard targets in 2 headshots at all ranges, so the damage difference mostly applies to sniping Heavy Assaults, or hitting bodyshots.

**99SV** and **Spectre** are the starting weapons for **TR** and **VS** Infiltrators, respectively.

**Unlock cost:** 325 
![Certification Points](http://cmdrcyrious.com/wp-content/uploads/2016/04/2u70d9j.png) or 250

![Daybreak Cash](http://cmdrcyrious.com/wp-content/uploads/2016/04/14250ep.png)


#### 99SV and Gauss SPR

Damage: 400 @ 50m – 334 @ 150m

Rate of Fire: 231 RPM

Velocity: 550 m/s

Reload Time: 2.125 / 2.975 sec

Ammo: 10 / 70

Headshot Damage Multiplier: 2x

Minimap Detect Range: 100m

ADS Movespeed Multiplier: 0.5x

Equip / Unequip Time: 0.85 / 0.25 sec

ADS Time To / From: 0.3 / 0.15 sec

Projectile Lifespan / Gravity: 1.5 / 7.5

Hip CoFs: 5.5 / 6 / 6 / 6.5 / 0.8

ADS CoFs: 0 / 0.2 / 0 / 0.55 / 0.15

**Max ADS CoF while standing still or crouching still:** 0.15

**CoF Recovery Rate while standing still or crouching still:** 100

Vertical Recoil: 1.2

First Shot Recoil Multiplier: 1x

Recoil Angle: 6 / 15

Horizontal Recoil: 0.1 / 0.2

Horizontal Recoil Tolerance: 0.2

Recoil Recovery Delay: -130

Recoil Recovery Rate: 10

**Attachments:** Suppressor, Darklight Flashlight, Forward Grip, Ballistics Computer

### VA39 Spectre

Damage: 400 @ 50m – 260 @ 200m

Velocity: 570 m/s

Projectile Lifespan / Gravity: 1.25 / 0

### Bullets to Kill

- BS = Bodyshot
- HS = Headshot
- X + 1 = X Headshots + 1 Bodyshot

|  | **Infantry** | **Full Nano** | **NMG HA + Nano** | **Resist HA** | 
| **TR and NC Rfiles** | 3 BS: all 2 HS: all 1 + 1: all | 4 BS: all 2 HS: all 1 + 1: \<115m | 5 BS: \<112m 2 HS: \<112m 2 + 1: 112m+ | 4 BS: \<73m 2 HS: \<73m 2 + 1: 74m+ | 
| **VS Rifle** | 3 BS: \<121m 2 HS: all 1 + 1: \<122m | 4 BS: \<143m 2HS: all 1 + 1: \<95m | 5 BS: \<93m 6 BS: 94 – 157m 2 HS: \<93m 2 + 1: 94 – 157m | 4 BS: \<66m 4 BS: 67 – 149m 2 HS: \<66m 2 + 1: 67 – 149m | 


To boil this information down to a memorable form:

Semi Auto Rifles kill infantry in 2 headshots at all ranges, and in 1 headshot and 1 bodyshot within \~100m. Heavy Assaults require an extra headshot.

## Close Range

### KSR-35

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/KSR-35.png)


### Impetus

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/Impetus.png)


### Phantom

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/Phantom-VA23.png)


These “close range” variants are mostly similar to their “long range” brethren. The main difference is that “close range” variants sacrifice damage at range and the ability to take rapid follow up shots to gain access to low-zoom scopes without any scope sway: iron sights, 1x, 2x, 3.4x and 4x reflex scopes, but not HS/NV scope.

They also have shorter Scope In Time (0.2 seconds versus 0.3), but slightly worse recoil properties and lower velocity.

**Unlock cost:** 650 ![Certification Points](http://cmdrcyrious.com/wp-content/uploads/2016/04/2u70d9j.png) or 499

![Daybreak Cash](http://cmdrcyrious.com/wp-content/uploads/2016/04/14250ep.png)


\[spoiler title=”Detailed Stats”\]

#### KSR-35 and Impetus

Damage: 400 @ 10 – 334 @ 85

Rate of Fire: 231 (effective 200)

Velocity: **500 m/s**

Reload Time: 2.125 / 2.975 sec

Ammo: 10 / 70

Headshot Damage Multiplier: 2x

Minimap Detect Range: 100m

ADS Movespeed Multiplier: 0.5x

Equip / Unequip Time: 0.85 / 0.25 sec

ADS Time To / From: **0.2** / 0.15 sec

Projectile Lifespan / Gravity: 1.5 / 7.5

Hip CoFs: 5.5 / 6 / 6 / 6.5 / 0.8

ADS CoFs: 0 / 0.2 / 0 / 0.55 / 0.8

Vertical Recoil: **1.3**

First Shot Recoil Multiplier: 1x

Recoil Angle: **-15** / 15

Horizontal Recoil: 0.1 / 0.2

Horizontal Recoil Tolerance: 0.2

Recoil Recovery Delay: -130

Recoil Recovery Rate: 10

**Attachments:** Suppressor, Darklight Flashlight, Forward Grip

#### Phantom

Damage: 400 @ 8 – 260 @ 200

Velocity: **525 m/s**

Projectile Lifespan / Gravity: 1,25 / 0

### Bullets to Kill

- BS = Bodyshot
- HS = Headshot
- X + 1 = X Headshots + 1 Bodyshot

|  | **Infantry** | **Full Nano** | **NMG HA + Nano** | **Resist HA** | 
| **TR and NC Rfiles** | 3 BS: all 2 HS: all 1 + 1: all | 4 BS: all 2 HS: all 1 + 1: \<59m | 5 BS: \<56m 2 HS: \<56m 2 + 1: 57m+ | 5 BS: all 3 HS: all 2 + 1: \<53m | 
| **VS Rifle** | 3 BS: \<98m 2 HS: all 1 + 1: \<98m | 4 BS: \<127m 2HS: all 1 + 1: \<66m | 5 BS: \<63m 6 BS: 64 – 145m 2 HS: \<63m 2 + 1: 64 – 145m | 5 BS: \<99m 6 BS: 100 – 175m 3 HS: \<175m 2 + 1: \<59m | 


To boil this information down to a memorable form:

Semi Auto Rifles kill infantry in 2 headshots at all ranges, and in 1 headshot and 1 bodyshot within \~50m. Heavy Assaults require an extra headshot.

## SASR Mechanics

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/SASR-mechanics-1024x576.png)


### Tap Firing Issues

**Tap Firing** refers to the technique of firing single shots while letting the crosshair fully recenter before each shot.

Given proper timing, Tap Firing provides good accuracy and optimal damage output. Weapon’s affinity for Tap Firing is determined by its **[Recentering Speed](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Recentering_Time_for_Tap_Firing)**.

Good Tap Firing skills are generally important for using any semi-auto weapon, but Semi Auto Sniper Rifles also ***have a big and unique issue*** related to overzealous Tap Firing.

SARS are among the few weapons with **negative [Recoil Recovery Delay](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Recoil_Recovery_Delay)**, and they fully Recenter ***before*** the Refire Time is over – before you can take another shot. Especially if you use them with a Forward Grip, which reduces Vertical Recoil for sniper rifles, and thus reduces the time the weapon needs to recover recoil.

However, unlike Recoil, **Cone of Fire** does not start recovering until Refire Time is over.

![](http://cmdrcyrious.com/wp-content/uploads/2018/06/99SV-timeline.png)


So if you fire as soon as you can, you will fire before Cone of Fire recovers, and you will be more likely to miss.

|  | **Can fire again by** | **CoF Recovers by** | **Recoil Recovers by** | **/w Forward Grip** | 
| **Long Range SASR** | 0.26 sec | 0.2615 | 0.251 | 0.233 | 
| **Close Range SASR** | 0.26 sec | 0.3 | 0.261 | 0.241 | 


For both SASR, recoil recovery *finishes* before CoF recovery *starts*, even without Forward Grip. One could argue that Forward Grip provides an extra moment to correct the crosshair placement between shots, but the difference of \~0.02 seconds is imperceptible to the eye.

**Effectively, Forward Grips is useless for SASR.**

These issues are less apparent for “long range” SASR, as they reset CoF very quickly.

# Bolt Action Sniper Rifles

**VS** Bolt Action Rifles **have** bullet drop.

Each faction has a large selection of Bolt Action Rifles. They all have slightly different stats, with main differences in reload time, velocity, bolt chamber time, and the distance at which they can kill an enemy in one headshot.

**Bolt Action Rifles are identical between factions.**

These stats are identical for all BASR across all factions, with the exception of Directive Sniper Rifles.

Refire Time: 170ms

Headshot Damage Multiplier: 2.1x

Minimap Detect Range: 100m

ADS Movespeed Multiplier: 0.5x

Equip / Unequip Time: 0.85 / 0.25 sec

Projectile Lifespan / Gravity: 1.5 / 7.5

Vertical Recoil: 0.4

First Shot Recoil Multiplier: 1x

Recoil Angle: 0 / 0

Horizontal Recoil: 0.1 / 0.1

Horizontal Recoil Tolerance: 0.2

Recoil Recovery Delay: 0

Recoil Recovery Rate: 5

**Attachments:** Suppressor, Darklight Flashlight, Forward Grip, Straight-Pull Bolt

**Close Range, Medium Range, Long Range**

Hip CoFs: 4,5 / 5 / 5 / 6 / 1

ADS CoFs: 0 / 0,2 / 0 / 0,55 / 1

**Extreme Range**

Hip CoFs: 5 / 5,5 / 5,5 / 6,5 / 1

ADS CoFs: 0 / 0,2 / 0 / 0,55 / 1

#### BASR Damage Comparison

![BASR damage comparison](http://cmdrcyrious.com/wp-content/uploads/2016/04/BASR-damage-comparison-1024x440.png)

Click to enlarge

## Tier 1 – Close Range

### TSAR-42

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/TSAR-42.png)


### SAS-R

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/SAS-R.png)


### Ghost

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/Ghost.png)


**Time Between Shots:** 1100 + 170 = 1.27 seconds

OHK Range: 200m

Damage: 700 @ 10 – 400 @ 265

Velocity: 500 m/s

Reload Time: 2.8 / 4 sec

Ammo: 5 / 40

Scope In Time: 0.2 seconds

Scope Selection: 1x through 4x

The weapon of choice for [**Close Quarters Sniping**](http://cmdrcyrious.com/close-range-sniping-guide-by-davregis/).

**Unlock cost:** 650 ![Certification Points](http://cmdrcyrious.com/wp-content/uploads/2016/04/2u70d9j.png) or 499

![Daybreak Cash](http://cmdrcyrious.com/wp-content/uploads/2016/04/14250ep.png)


## Tier 2 – Medium Range

### M-77B

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/M77-B.png)


### NC14 Bolt Driver

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/NC14-Bolt-Driver.png)


### XM98

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/XM98.png)


**Time Between Shots:** 1225 + 170 = 1.395 seconds

OHK Range: 250m

Damage: 650 @ 10 – 400 @ 350

Velocity: 550 m/s

Reload Time: 2.8 / 4 sec

Ammo: 5 / 40

Scope In Time: 0.3 seconds

Scope Selection: 6x through 12x

These are the most versatile Bolt Action rifles. They have a great balance of stats – almost as fast as Close Range rifles, almost as effective at range as Long Range rifles. They’re also dirt cheap.

Most of the “useful” sniping is usually done within 150m or so, and these rifles are arguably the best choice for that range segment.

Comparatively low projectile velocity will require you to deliberately compensate for projectile drop when going for targets outside 150m.

**Bolt Driver** is the starting Infiltrator weapon for **NC**.

**Unlock Cost:** 325 
![Certification Points](http://cmdrcyrious.com/wp-content/uploads/2016/04/2u70d9j.png) or 250

![Daybreak Cash](http://cmdrcyrious.com/wp-content/uploads/2016/04/14250ep.png)


## Tier 2 – Long Range

### SR-7

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/SR-7.png)


### LA80

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/LA80.png)


### V10

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/V10.png)


**Time Between Shots:** 1395 + 170 = 1.565 seconds

OHK Range: 250m

Damage: 650 @ 10 – 400 @ 350

Velocity: 600 m/s

Reload Time: 3.1 / 4.7 sec

Ammo: 8 / 48

Scope In Time: 0.3 seconds

Scope Selection: 6x through 12x

These rifles take longer to rechamber and reload, but they gain increased velocity and magazine size.

**Unlock cost:** 1000 
![Certification Points](http://cmdrcyrious.com/wp-content/uploads/2016/04/2u70d9j.png) or 699

![Daybreak Cash](http://cmdrcyrious.com/wp-content/uploads/2016/04/14250ep.png)


## Tier 3 – Extreme Range

### RAMS .50

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/RAMS-.50M.png)


### EM4 Longshot

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/EM4-Longshot.png)


### Parallax VX3

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/Parallax-VX3.png)


**Time Between Shots:** 1500 + 170 = 1.670 seconds

OHK Range: 300m

Damage: 700 @ 10 – 400 @ 400

Velocity: 650 m/s

Reload Time: 4.2 / 5.575 sec

Ammo: 5 / 40

Scope In Time: 0.3 seconds

Scope Selection: 6x through 12x

These rifles have the highest projectile velocity among conventional Bolt Action rifles, as well as the highest OHK Range, but they take the longest to rechamber and reload.

Superior velocity means you don’t have to compensate for Projectile Drop within 200m or so, basically making these rifles “point and click”.

When sniping targets at 250m+, take an extra second to properly Hold Breath and compensate for Scope Sway, because at those ranges even suppressed Scope Sway can mess with your crosshair placement.

**Unlock cost:** 1000 
![Certification Points](http://cmdrcyrious.com/wp-content/uploads/2016/04/2u70d9j.png) or 699

![Daybreak Cash](http://cmdrcyrious.com/wp-content/uploads/2016/04/14250ep.png)


## BASR Mechanics

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/BASR-mechanics2.png)


### Bodyshots

BASR can kill full Nanoweave infantry with 2x Bodyshots within:

- Tier 1: 73m
- Tier 2: 44m
- Tier 3: 107m

So if the target is being particularly evasive, and you can’t land a headshot, it may be better to go for easier bodyshots.

### [Melee Combo](http://cmdrcyrious.com/planetside2/weapons/melee-weapons/#Melee_Combo)

All BASR can reliably kill a standard infantry unit with a **[melee combo](http://cmdrcyrious.com/planetside2/weapons/melee-weapons/#Melee_Combo)**, and it can be an effective way of disposing enemies that managed to close the distance with you.

An enemy with full Nanoweave + Aux. Shield will be able to survive a melee combo from a Tier 2 BASR, but it should be a rare combination.

Try to develop a habit of equipping a sidearm right after a melee combo. Recovering and rechambering a BASR after a melee combo is going to take more than two seconds, and it’s better to do that ***after*** you make sure there are no enemies around.

Alternatively, you can use **[this trick](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Melee_Interactions_with_Pump_Action_and_Bolt_Action_Weapons)** to quick melee after a shot during the chamber animation.

### Sidearm Combo

When faced with an enemy at close range, it’s a common technique to land an “easy” bodyshot, and then finish off the enemy with a sidearm.

### Bolt Action Chamber Time

The Bolt Chamber Time shown on [**in-game weapon stat sheet**](http://cmdrcyrious.com/wp-content/uploads/2016/04/chamber-time-stat-sheet.png) doesn’t tell the whole story. You can learn more about it **[here](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Bolt_Action_and_Pump_Action_Weapons)**, or just use the values provided in this guide.

### Straight Pull Bolt

Normally, you can’t rechamber your rifle while Aiming Down Sights, and you have to always leave ADS to let rechamber animation begin. You will not be able to ADS during rechambering.

![Straight Pull Bolt](http://cmdrcyrious.com/wp-content/uploads/2016/04/icon_weaponAttachment_common_Boltaction001_128.png)


**![Supercooled Coil](http://cmdrcyrious.com/wp-content/uploads/2016/04/Supercooled-Coil.png)Straight Pull Bolt** attachment allows you to start rechambering the rifle as soon as Refire Time is over, and enables you to enter and leave ADS at any time during rechambering.

**VS** version of this attachment is called **Supercooled Coil**.

This significantly increases your effective Rate of Fire, as you don’t have to sit through Scope In Time after each shot. However, this can potentially lead to developing bad habits, such as tunnel visioning, so remember to often break ADS during rechambering to take a look around.

### Quick-scoping

Normally, a Bolt Action Rifle with a 6x+ scope is a liability at a distance between 3m and 6m. Hip fire is still too bad, and high magnification makes it very inconvenient to ADS, not to mention that ADSing itself takes more than 0.3 seconds.

The standard procedure is to close the distance and go for a **[melee combo](http://cmdrcyrious.com/planetside2/weapons/melee-weapons/#Melee_Combo)**, or a hip fire headshot at nearly melee range, but it’s not always possible. Equipping a sidearm also takes half a second, and you might be dead by then.

**Quick-scoping** gives you another combat option in that situation. It relies on the fact that Cone of Fire Reduction starts as soon as you begin ADSing, and takes roughly as long. So by the time you would fully complete ADS animation, you would have 100% accuracy. However, you don’t need 100% accuracy to hit a shot on a target within 3-5m.

A skilled player with impeccable timing can fire an “accurate enough” shots ***during*** ADS animation, before the crosshair becomes visible.

To perform this trick you have to fire about \~0.2 seconds after you start Aiming Down Sights. You can release ADS key right after you click fire.

- This trick benefits a lot from having **[Crosshair Overlay](http://cmdrcyrious.com/planetside2/performance-guide/#Custom_crosshair_overlay)**.

The optimal amount of time to be holding ADS before firing depends on whether you’re going for a headshot or a bodyshot. Headshots require tighter CoF, so you have to give it more time to shrink.

Another factor is whether you were moving or stationary when you started ADSing. If you were standing still, your hip fire CoF was a bit smaller, so it would take a bit less time to reduce to the size you need.

\[spoiler title=”Super advanced quick scoping mechanics”\]

Let’s use **M-77B** as an example.

`Scope In Time: 0.3 seconds`

`Sprinting CoF: 6 degrees`

`Standing Moving Hip CoF: 6 degrees`

`Sprint Recovery: 0.3 seconds`

`Standing Still CoF: 4.5`

`ADS Standing Moving CoF: 0.55`

`ADS Standing Sill CoF: 0`

`When switching stances, Cone of Fire reduces by 20 degrees per second.` 

A hypothetical scenario. You’re sprinting about your business, but suddenly an enemy pops up right in front of you.

You stop sprinting and stand still, using your hip fire crosshair to aim at enemy’s head. After 0.3 seconds of Sprint Recovery Time, you will be able to fire, and your Cone of Fire will start transitioning from 6 degrees to 4.5 degree of Standing Still Hip.

This process will take additional (6 – 4.5) / 20 = 1.5 / 20 = 0.075 seconds.

Then you start Aiming Down Sights, and your Cone of Fire will begin reducing from 4.5 to 0 over 0.225 seconds.

But the enemy is at very close range, and you can fire before Cone of Fire fully resets. Within 5m, infantry head hitbox has **[angular size](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Calculated_Angular_Size)** of \~1.7 degrees. Let’s round this to 1.5 degrees.

So you need to reduce your CoF from 4.5 to 1.5 degrees. This will take (4.5 – 1.5) / 20 = 3 / 20 = 0.15 seconds.

So you can fire 0.15 seconds after you started Aiming Down Sights, essentially halfway through your ADS animation. As long as the enemy is close enough, and you properly aim at the center of his head, you should hit the headshot.

However, keep in mind that you also have to stand still 0.3 + 0.075 seconds after you stopped sprinting.

If you ADS while moving, right as you come out of sprint, you will have to hold your ADS animation for extra 0.075 seconds, or 0.225 seconds total.

\[/spoiler\]

Quick-scoping is not advised when going for a headshot on a full health enemy player. This has a lot of potential to fail, and even when done in 100% optimal way, you’re shaving off roughly a tenth of a second.

Quick-scoping is much more viable when going for a bodyshot to finish off an already wounded enemy. Then you don’t have to hold ADS for nearly as long to get an accurate enough shot, and you have much more margin for error.

You can see Mustarde doing a bit of quick scoping in [**this video**](https://www.youtube.com/watch?v=eZWtFMSj-c0).


# Empire Specific Sniper Rifles

## TRAP-M1

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/13755.png)


\[spoiler title=”Weapon Stats”\]

Damage: 184 @ 15 – 167 @ 85

Headshot Damage Multiplier: 2x

Projectile Velocity: 600 m/s

Reload Time: 2.315 / 3.25

Ammo: 21 / 189

Hip CoFs: 3 / 3.5 / 3.5 / 4

ADS CoFs: 0 / 0.17 / 0 / 0.25

Minimap Detect Range: 40

ADS Movespeed Multiplier: 0.5x

Equip / Unequip Time: 0.85 / 0.25

ADS Time To / From: 0.15 / 0.15

Projectile Lifespan / Gravity: 1.5 / 7.5

Recoil Recovery Delay: 0

Recoil Recovery Rate: 6

**2x Burst Mode**

Burst Rate of Fire: 750

Time between bursts: 0.25 sec

Overall Rate of Fire: 480

Vertical Recoil: 0.4

First Shot Recoil Multiplier: 0.75x

Recoil Angle: 0 / 0

Horizontal Recoil: 0.1 / 0.1

Horizontal Recoil Tolerance: 0.15

Hip CoF Bloom: 0.12

ADS CoF Bloom: 0.06

**3x Burst Mode**

Burst Rate of Fire: 652 

Time between bursts: 0.276 sec

Overall Rate of Fire: 652

Vertical Recoil: 0.5

First Shot Recoil Multiplier: 0.8x

Recoil Angle: 0 / 0

Horizontal Recoil: 0.175 / 0.175

Horizontal Recoil Tolerance: 0.4375

Hip CoF Bloom: 0.14

ADS CoF Bloom: 0.07

**Attachments:** Suppressor, Laser Sight, Darklight Flashlight, Forward Grip

**Optics:** Iron Sights Default, HS/NV, 1x Reflex through 4x, 6x Overlay.

TRAP-M1 is classified as a Sniper Rifle, but functionally it is a burst fire Scout Rifle. TRAP has two fire modes: 3 round and 2 round bursts.

2x burst has less recoil and CoF Bloom, and is intended for longer ranges than 3x burst. As other sniper rifles, TRAP has poor hip fire.

TRAP-M1 spent a lot of time in underpowered state, so it accumulated a lot bad faith with the community, often being called a “trap purchase”. However, the weapon has received a trickle of buffs over the years, and now is in a pretty good shape.

Taking advantage of full rate of fire takes a bit of getting used to, but allows for a surprisingly high damage output even with bodyshots. The unusual damage model of 184 – 167 makes this weapon very consistent over range, and you can always switch to 2x burst mode when you need accuracy over firepower.

## AF-8 RailJack

![AF-8 Railjack](http://cmdrcyrious.com/wp-content/uploads/2016/04/13752.png)


\[spoiler title=”Weapon Stats”\]

Damage: 750 @ 10 – 450 @ 400

Headshot Damage Multiplier: 2.1x

Kills in one headshot within \~364m.

Fire Delay: 0.2 sec

Time Between Shots: 1.7 + 0.1 = 1.8 sec

Velocity: 850 m/s

Reload Time: 4.1 / 5.1

Ammo: 4 / 40

Minimap Detect Range: 100

ADS Movespeed Multiplier: 0.5x

Equip / Unequip Time: 0.85 / 0.25

ADS Time To / From: 0.3 / 0.15

Projectile Lifespan / Gravity: 1.5 / 7.5

Hip CoFs: 5 / 5.5 / 5.5 / 6.5 / 1

ADS CoFs: 0 / 0.2 / 0 / 0.55 / 1

Vertical Recoil: 0.4

Recoil Angle: 0 / 0

Horizontal Recoil: 0 / 0

Horizontal Recoil Tolerance: 0.2

Recoil Recovery Delay: 0

Recoil Recovery Rate: 5

**Attachments:** Suppressor, Darklight Flashlight, Straight-Pull Bolt

**Optics:** 6x Default, M7 Optics (7x). A-Eight (8x). IO-10 (10x). IO-12 (12x)

One of the few true railguns in NC arsenal, Railjack is ***the*** hardest hitting bolt action rifle, and has the highest projectile velocity of any infantry weapon in the game.

As always, there’s a catch: Railjack has a 0.2 second firing delay between trigger pull and the actual shot, which makes it somewhat tricky to use, because you still need to adjust aim for target movement during those 0.2 seconds.

If we include firing delay into bullet travel time, a bullet from [**EM4 Longshot**](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#EM4_Longshot) will reach the target within 552m faster than a bullet from Railjack. So in order to benefit from its higher velocity, you ***have*** to be compensating for target movement during the fire delay. Otherwise, Longshot is objectively a better weapon.

**Tip:** you can bind “Fire” to your keyboard, so you can fire the Railjack without having to click the mouse. This should make it easier to keep tracking the target with the mouse during those 0.2 seconds.

Due to firing delay, RailJack is the easiest rifle to **[quick-scope](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#Quick-scoping)** with. With other rifles, you need to have very precise timing. RailJack’s firing delay does it for you. Simply click ADS, then immediately click fire, and your shot will have a nearly perfect accuracy, without having to ADS all the way.

This is excellenty demonstrated in [**this video**](https://youtu.be/Ag-pYBW3pLY).

## Phaseshift VX-S

![Phaseshift VX-S](http://cmdrcyrious.com/wp-content/uploads/2016/04/13758.png)


\[spoiler title=”Weapon Stats”\]

**Heat Capacity**: 1000

**Heat Recovery Delay after firing**: 0.7 sec or 1 sec

**Heat Recovery Rate**: 500 per second

**Overheat Penalty**: 1 sec

**Refire Time:** 0.326 sec (184 RPM)

Projectile Velocity: 550 m/s

Hip CoFs: 5.5 / 6 / 6 / 6.5 / 1

ADS CoFs: 0 / 0.2 / 0 / 0.55 / 1

Minimap Detect Range: 100

ADS Movespeed Multiplier: 0.5x

Equip / Unequip Time: 0.85 / 0.25

ADS Time To / From: 0.3 / 0.15

Projectile Lifespan / Gravity: 1.25 / 0

Recoil Angle: 6 / 15

Horizontal Recoil: 0.1 / 0.2

Horizontal Recoil Tolerance: 0.2

Recoil Recovery Rate: 15

Recoil Recovery Acceleration: 0.3

**Semi Auto Fire Mode**

Damage: 400 @ 10m – 334 @ 85m

Headshot Damage Multiplier: 2x

Kills in 2 headshots at all ranges.

**Heat Per Shot**: 190

Vertical Recoil: 1.2

Recoil Recovery Delay: -150 ms

**Bolt Action Fire Mode**

Damage: 550 @ 10m – 400 @ 400m

Headshot Damage Multiplier: 2.2x

Kills in one headshot within \~257m.

**Heat Per Shot**: 800

Vertical Recoil: 4.5

Recoil Recovery Delay: 0

**Attachments:** Suppressor, Darklight Flashlight, Forward Grip

**Optics:** 6x Default, TSO (7x). TriGon-8 (8x). Mach-10 (10x). Mach-12 (12x)

Embracing adaptability and versatility, Phaseshift can switch between “semi auto” and “bolt action” fire modes, though in reality the “bolt action” mode is just a more powerful semi auto mode.

In semi-auto fire mode, Phaseshift has similar performance to a **[TR / NC “long range” SASR](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#Long_Range)**, though it can fire only 6 shots before overheating.

In “bolt action” fire mode, Phaseshift has much more recoil, but kills standard infantry in one headshot within \~257m, and you can make two back to back shots, potentially killing two targets under a second (**[example](https://gfycat.com/ConstantGraveAmericanlobster)**).

It is highly recommended to use Phaseshift with a **[Forward Grip](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#AdditionalForward_Grip_Benefit)**, as it reduces the high Vertical Recoil of “bolt action” mode.

Both fire modes don’t have any bullet drop, which effectively makes Phaseshift the only OHK-capable weapon without bullet drop. This makes it an interesting choice for a Suppressor, which reduces velocity to 467 m/s and OHK Range to \~240m.

Phaseshift also uses **heat mechanic** instead of ammunition. It doesn’t require reloading, and effectively has infinite ammo, but it needs to cool down between shots. Mechanics:

Firing accumulates heat. The amount of accumulated **Heat Per Shot** depends on the fire mode. When you stop firing, after a **Heat Recovery Delay,** the weapon starts bleeding off the heat at a **Heat Recovery Rate**.

There is only so much heat the weapon can accumulate at once, equal to **Heat Capacity.** If you overheat your weapon, the weapon will suffer an **Overheat Penalty** before it can start cooling down, and you will not be able to fire again until the weapon fully cools down.


# Directive Sniper Rifles

### Bighorn .50M

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/Bighorn-.50M.png)


### The Moonshoot

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/The-Moonshot.png)


### Parsec VX3-A

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/Parsec-VX3-A.png)


**Time Between Shots:** 1.5 + 0.17 = 1.67 seconds

OHK Range: 250m

Damage: 750 @ 10 – 400 @ 325

Velocity: 680 m/s

Reload Time: 3.86 / 5 sec

Ammo: 5 / 40

Vertical Recoil: 0.3

Hip CoFs: 5.5 / 6.25 / 6 / 6.75 / 1

Minimap Detect Range: 150m

The only way to obtain one of these sniper rifles is to complete the auraxium level of Sniper Rifle Directives.

The Directive Sniper Rifles have a unique combination of attachments: special HVA, Compensator and Straight Pull Bolt.

They can be treated as a variant of Extreme Range BASR. Directive Rifles have higher velocity than any conventional BASR, and they deal the most damage within 150m. However, they have increased Fire Detection Range, as well as shorter OHK Range.

# Cross-faction Rifles

## NSX Daimyo

| DIRECT DAMAGE | 225 @ 10m – 175 @ 350m | 
| RATE OF FIRE | 180 RPM | 
| VELOCITY | 600 m/s | 
| AMMO | 3 / 30 | 
| RELOAD TIME | 2.2 sec / 3 sec | 
| UNLOCK COST | 1000 ![Certification Points](http://cmdrcyrious.com/wp-content/uploads/2016/04/2u70d9j.png) or 799 ![Daybreak Cash](http://cmdrcyrious.com/wp-content/uploads/2016/04/14250ep.png) | 

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/NSX-Daimyo-1-e1507411948451.png)


Semi-Auto

Hip CoFs: 4.5 / 5 / 5 / 6 / 1

ADS CoFs: 0 / 0.2 / 0 / 0.55 / 1

**Headshot Damage Multiplier: 5x**

Minimap Detect Range: 100m

ADS Movespeed Multiplier: 0.5x

Equip / Unequip Time: 0.85 sec / 0.25 sec

ADS Time To / From: 0.2sec / 0.15 sec

Projectile Lifespan / Gravity: 1.5 / 7.5

Vertical Recoil: 0.8

First Shot Recoil Multiplier: 1x

Recoil Angle: 0 / 0

Horizontal Recoil: 0.1 / 0.1

Horizontal Recoil Tolerance: 0.2

Recoil Recovery Delay: 90

Recoil Recovery Rate: 8

**Attachments:** Darklight Flashlight, Extended Magazine, Suppressor, Weighted Receiver

**Optics:** DV6 (6x), Seer-6 (6x), Quadra (4x), Octal (8x), Deca (10x), DoDec (12x), Hepta (7X)

**NSX Daimyo** is a rather unique semi auto sniper rifle. It deals low damage to body, but thanks to Headshot Damage Multiplier of 5x, it is capable of killing infantry in one headshot within 180m.

Landing a headshot is pretty much the only way to kill with this weapon; it simply doesn’t have enough damage per mag to kill even one infantryman with bodyshots.

On the other hand, if you ***can*** land headshots, Daimyo lets you take 3-4 potentially lethal shots in a period of time where a BASR would be able to make 2 shots at most. Daimyo has the most immediate killing potential of any sniper rifle.

However, even if you are capable of consistently landing headshots on multiple enemies back to back, there are other considerations:

- Daimyo cannot kill deployables in one shot.
- Leveraging Daimyo’s advantage over a bolt action rifle means firing several shots without recloaking inbetween, which is potentially dangerous.
- Daimyo has more projectile drop than other sniper rifles with the same velocity. **[This is intentional](https://www.reddit.com/r/Planetside/comments/8q0797/dayimos_muzzle_velocity_is_incorrect/e0fs3ox/)**.

Daimyo is most effective in the range bracket between 20m and 100m, and it directly competes with **[Tier 1 “Close Range” BASR](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#Tier_1_8211_Close_Range)**. Compared to them, Daimyo has a set of other disadvantages.

- Tier 1 BASR can kill NMG / Adrenaline HAs within 22m. Daimyo cannot kill any shielded Heavy Assault in one shot.
- An accidental bodyshot with a BASR can be often converted to a kill with a second bodyshot. Daimyo is limited to headshots as the only option.
- When suddenly confronted by an enemy at extremely close range, a Tier 1 BASR can go for a bodyshot, and then finish off the enemy with a quick melee strike or a few sidearm shots. *With the Daimyo it’s either headshot or I should have already had my pistol out. (c) [**AnuErebus**](https://www.reddit.com/r/Planetside/comments/74xtz7/can_we_talk_about_daimyo/do1ydzz/)*

The weird combination of relatively high velocity and strong bullet drop is often brought up as Daimyo’s greatest downside, but at the moment it’s not clear whether this amount of drop is intentional, because based on its stats, it should have exactly the same drop and velocity as Tier 3 BASR.

While Daimyo [**can be spammed more or less effectively**](https://youtu.be/m134Naz5Ex4?t=26), perhaps you should treat it simply as a rifle that lets you take another shot if you miss. You still should recloak often for the sake of survivability.

Due to inconvenient drop, Daimyo is most effective when you are fighting against enemies on flat ground, so you don’t have to adjust for drop against every new target. Like other NSX weapons, Daimyo seems to be especially effective in one specific scenario, and mediocre in all other scenarios. It’s an interesting and unusual, polarizing weapon, but if you’re looking for tried and true, consider using a Tier 1 BASR instead.

In addition to the standard Darklight Flashlight, Daimyo has access to a couple of other rail attachments:

![Weighted Receiver](http://cmdrcyrious.com/wp-content/uploads/2016/04/Weighted-Receiver-e1507414531233.png)

**Weighted Receiver**– makes you pinpoint accurate while ADSing and moving, but reduces ADS Movement Speed Multiplier to 0.33x, so you basically slow down to a crawl while aiming.

![Extended Mags Faven](http://cmdrcyrious.com/wp-content/uploads/2016/04/icon_Weapons_Common_FavenWeapons_Attachments_RifleClip001_256x128-e1507414510935.png)

**Extended Mags**– increases magazine size by 1 round. This is the recommended choice.

# Anti Materiel Rifles

## NS-AM7 Archer

| DIRECT DAMAGE | 400 @ 25m – 200 @ 200m | 
| INDIRECT DAMAGE | 100 @ 1m – 25 @ 3m | 
| TIME BETWEEN SHOTS | 1.5 + 0.25 = 1.75 sec | 
| VELOCITY | 525 m/s | 
| AMMO | 5 / 30 | 
| RELOAD TIME | 3.0 sec / 4.25 sec | 
| UNLOCK COST | 1000 ![Certification Points](http://cmdrcyrious.com/wp-content/uploads/2016/04/2u70d9j.png) or 799 ![Daybreak Cash](http://cmdrcyrious.com/wp-content/uploads/2016/04/14250ep.png) | 

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/NS-AM7-Archer.png)


Bolt-Action

Direct Damage Type: 40 – Anti-Material Rifle

Indirect Damage Type: 6 – Common Explosion.

Indirect Damage Arming Distance: 25m

Refire Time: 0.25 sec

Chamber Time: 1.5 sec

Rate of Fire: \~34 RPM

Velocity: 525 m/s

Ammo: 5 / 30

Reload Time: 3 sec / 4.25 sec

Hip CoFs: 1.5 / 2.75 / 2 / 3.25

ADS CoFs: 0.05 / 0.15 / 0.05 / 0.25

Headshot Damage Multiplier: 2x

Minimap Detect Range: 150m

ADS Movespeed Multiplier: 0.75x

Equip / Unequip Time: 1 sec / 0.5 sec

ADS Time To / From: 0.15sec / 0.15 sec

Projectile Lifespan / Gravity: 1.5 / 7.5

**Attachments:** Darklight Flashlight, Straight-Pull Bolt, Laser Sight

**Optics:** Quadra (4x), Hepta (7X), Octal (8x), Deca (10x), DoDec (12x)

Archer is a special rifle, available only to **[Engineers](http://cmdrcyrious.com/planetside2/classes/engineer/)**. It is weak against infantry, but capable of dealing high damage to MAXes and minor damage to armored vehicles. If Archer’s bullet travels more than 25m, it will deal splash damage in a small area.

Archer has surprisingly good Hip Fire accuracy, which can be useful against targets at close range. Archer also has 0.75x ADS Movement Speed Multiplier.

Since archer takes up the primary weapon slot, and it’s not effective against infantry, Archer Engineers have to rely on **[sidearms](http://cmdrcyrious.com/planetside2/weapons/sidearms/)** for infantry combat.

You can use the **[Toolbox](http://cmdrcyrious.com/toolbox/)** to calculate Archer’s damage to different vehicles.

## NS-AM8 Shortbow

| DIRECT DAMAGE | 400 @ 25m – 200 @ 150m | 
| INDIRECT DAMAGE | 100 @ 1m – 25 @ 3m | 
| TIME BETWEEN SHOTS | 1.5 + 0.25 = 1.75 sec | 
| VELOCITY | 525 m/s | 
| AMMO | 3 / 36 | 
| RELOAD TIME | 2.8 sec / 3.65 sec | 

Bolt-Action
![NS-AM8 Shortbow](http://cmdrcyrious.com/wp-content/uploads/2018/10/Shortbow-300x101.png)


Direct Damage Type: 40 – Anti-Material Rifle

Indirect Damage Type: 6 – Common Explosion.

Indirect Damage Arming Distance: 25m

Refire Time: 0.25 sec

Chamber Time: 1.5 sec

Rate of Fire: \~34 RPM

Hip CoFs: 1.5 / 2.75 / 2 / 3.25

ADS CoFs: 0.05 / 0.15 / 0.05 / 0.25

Headshot Damage Multiplier: 2x

Minimap Detect Range: 150m

ADS Movespeed Multiplier: 0.75x

Equip / Unequip Time: 0.8 sec / 0.4 sec

ADS Time To / From: 0.15sec / 0.15 sec

Projectile Lifespan / Gravity: 1.5 / 7.5

**Attachments:** Laser Sight, Comfort Grip

**Optics:** CCLR (1x), NiCO XR (2x)

**NS-AM8 Shorbow** is one of the possible item rewards for winning a **[Critical Mass Alert](http://cmdrcyrious.com/planetside2/critical-mass-alerts/)**, this is the only way to obtain it. You must already own NS-AM7 Archer in order to be eligible for this loot reward.

Shortbow is a variant of the **NS-AM7 Archer** with the following differences:

- Smaller magazine.
- Faster reload.
- Uses 1x or 2x optics.
- Has shorter **[Equip and Unequip Times](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Equip_time)**, as well as access to **[Comfort Grip](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Comfort_Grip)**.

The latter would be the main reason to use Shortbow over Archer; it’s a weapon that you quickly pull out to deal with a MAX at close range, and then just as quickly put back.

# Gameplay Tips

*This video by Wrel does an excellent job of covering basics of Sniping.*

*A bit more advanced video by Cyrious Gaming.*

Sniping seems very simple on the surface. And indeed, there is nothing particularly hard about using a Bolt Action Rifle to headshot a stationary enemy within 100m. Hold Breath, point and click, collect certs.

However, this shallow approach won’t get you very far. Bad snipers constantly get counter sniped, and struggle to kill anyone important, and are generally useless to their faction.

## Choosing a Position

This topic is well-covered in Wrel’s video above, but to re-iterate, you want to find a flanking position to a mass of enemy players.

You need a piece of cover that you can hide behind while reloading and recharging cloak. This can be a rock, a tree, a hill, a pile of boxes, etc.

Ideally, you want to be on the high ground, as it makes you less noticeable, harder to reach, and gives you a better view.

Getting into a good position might require some [**Parkour**](http://cmdrcyrious.com/parkour-guide/) skills or a **[Wraith Flash](http://cmdrcyrious.com/planetside2/vehicles/#Flash)**. A disposable  **[Valkyrie](http://cmdrcyrious.com/planetside2/vehicles/#Valkyrie)** or **Ejection Seat [ESF](http://cmdrcyrious.com/planetside2/vehicles/#Empire-specific_Fighters)** are also popular ways of getting into a position.

## Looking for Targets

In real life snipers, always work in pairs, and have a partner to designate targets for them. In Planetside, you’re on your own. Here are some places where you can find targets to snipe:

- **Near spawns** – Sunderers, spawn tubes. Do not shoot. Freshly respawned players have invincibility, and even if you kill, they’re gonna respawn a few seconds later anyway.
- **Choke points** – enemies involved in a cover-based firefight with your allies near any door, corridor, bridge, narrow passing. Even between player made structures and parked vehicles.
- **Cover** – places where the enemy hides, repairs, heals, goes AFK, has tea parties. That includes vehicles running for cover. If they are running – that means repair. That means mostly stationary Engineer heads.
- **Windows** – easy targets since they have to stay still to shoot through a window.
- **Landing pads** – favorite spots for Engineers behind turrets and snipers.
- **Phalanx Turrets** – Engineers like to repair them and snipers like to hide around them. **Fun fact:** At certain distance turrets don’t render so you can shoot through them. It’s a bug exploit. Don’t make it your life goal.
- **Trees, Rocks, Corners** – Think of the best places you would hide if you were going to snipe.
- **Terminals** – Do not hesitate to shoot the heads before they disappear in the vehicle.
- **Enemy Explosives** – People like to leave mines in weird places.


## Being Useful

Obviously, you won’t be contesting any points while sniping from a hill. As a Sniper, your power lies in the ability to kill any infantry target within hundreds of meters. So that’s what you must be doing: thinning out enemy numbers by killing enemies that your allies can’t reach.

**Especially:**

- Counter-snipe enemy snipers. Pay attention to their tracers and try to catch them out of cloak.
- Assassinate enemy Medics and Engineers behind turrets.
- Interrupt Heavy Assaults who are lining up Rocket Launcher shots.
- Harass enemy Light Assaults, who are trying to flank from high ground.
- Snipe enemy deployables, such as Shield Recharging Fields and Spawn Beacons.

Even distracting enemies and forcing them to take cover against you is a form of oppression, and can be enough to turn the tides in your favor.

Pay constant and conscious attention to what you are doing and how effective you are. If you’re sitting among allies, and just snipe whoever shows their face, then you’re not solving the chokepoint, ***you are*** the chokepoint.

## Rhythm

Sniping is all about the **rhythm:**

1. Cloak and move out of cover
2. Pre-aim at a target
3. Hold Breath
4. Correct Aim and Decloak
5. Stand still and shoot to kill
6. Cloak and Move, while taking a look at the Minimap and around your character.
7. Repeat.

Enemy snipers are by far the biggest threat to you. To avoid getting counter-sniped, you have to get in the ***rhythm***. You only want to be decloaked and stationary for as long as it takes to fire off a shot.

**You have to be stationary while shooting**, because Sniper Rifles have poor moving accuracy, and will struggle to hit a headshot on an enemy outside 20m.

Right after a shot, you want to cloak and move, even if just a little bit. If you don’t move, an enemy sniper might just send a shot to where he last seen your head, and snipe you out of cloak.

Make sure to always move a few meters in a **random** direction. An experienced or a lucky sniper might adjust for your movement, and snipe you out of cloak ***even after*** you moved (!).

## Protecting Flanks

Remember to take a look around once in a while, and pay attention to the minimap. After enemy snipers, your second biggest threat is enemy Light Assaults, who can and will hunt you down.

Don’t let them catch you off guard. If you see an enemy approaching, and he’s too close to be sniped, you can still get an advantage: cloak and crouchmove into a better position, and open fire with your sidearm on enemy’s back.

Always keep an ear out and ***listen***.

Most of snipers play like they are AFK, looking down the scope. They can be spotted/taunted, I can cloak and activate a power knife multiple times without them paying any attention.


Be careful about spotting enemies. Your voice will **[give away your position](http://cmdrcyrious.com/planetside2/beginner-guides/how-to-survive/#Sound)**, making you much easier to find if someone’s already looking for you.

## [EMP](http://cmdrcyrious.com/planetside2/classes/infiltrator/#EMP_Grenades) Combo

You can throw an EMP to about 40 meters out, and affected standard infantry will die from one SASR headshot or one BASR bodyshot.

## [Sidearm](http://cmdrcyrious.com/planetside2/weapons/sidearms/) Love

Being comfortable with your sidearm of choice really pays off for a sniper. It will be your go-to weapon in most close quarters situations, and you really should invest your skill and resources into it.

You may want to steal a page or two from **[Stalkers’ book](http://cmdrcyrious.com/stalker-infiltrator-guide/)**.

## Hold Breath Management

It is highly recommended to use **[Target Focus](http://cmdrcyrious.com/planetside2/equipment/implants/#Target_Focus)** implant while sniping, as it trivializes Hold Breath Management, and gives you much more *breathing room* while lining up shots.

When using a Bolt Action Rifle, remember to release Hold Breath key while the weapon is rechambering. This way you can squeeze in several shots even without Target Focus implant.

## Muscle Memory

“Muscle memory” refers to leading moving targets and compensating for bullet drop on the subconscious level, without having to think about it. This ability develops naturally, but it takes a while.

The velocity difference between Sniper Rifles is enough to throw off your muscle memory, so if you are serious about sniping, it is highly recommended to **stick with one rifle and one scope**, unless you’re doing Directives.

## Drag-shooting

**See: *[Drag Shots](http://cmdrcyrious.com/planetside2/weapons/gunplay-guide/#Drag_Shots).***

## Close Quarters Sniping

Refer to **[this guide](http://cmdrcyrious.com/close-range-sniping-guide-by-davregis/)** by Davregis.

# Sniper’s Loadout

## [Hunter Cloaking](http://cmdrcyrious.com/planetside2/classes/infiltrator/#Hunter_Cloaking) vs [NAC](http://cmdrcyrious.com/planetside2/classes/infiltrator/#Nano-Armor_Cloaking)

Hunter Cloaking is the default choice, as it guarantees a lot of uptime, gives you freedom of movement when moving into a sniping nest, and has a quick recharge.

Nano Armor Cloaking has been used in the past by some very successful infiltrators, as it significantly increases survival chances in a sniping duel, and almost removes any chance of being sniped out of cloak.

However, short duration and long recharge would make NAC impractical for most players.

## [Recon Device](http://cmdrcyrious.com/planetside2/classes/infiltrator/#Recon_Detection_Device) vs [Motion Spotter](http://cmdrcyrious.com/planetside2/classes/infiltrator/#Motion_Spotter)

**Recon Device** if you want to support your allies with Recon from a safe distance. However, it runs out of darts quickly, and massively benefits from running **[Ammo Printer](http://cmdrcyrious.com/planetside2/equipment/implants/#Ammo_Printer)** implant. It also requires quite a lot of upgrades to become truly useful.

**Motion Spotter** if you want to protect yourself from being flanked. Great longevity and effectiveness even at lower ranks.

## [Suit Slot](http://cmdrcyrious.com/planetside2/equipment/suit-slots/)

**[Flak Armor](http://cmdrcyrious.com/planetside2/equipment/suit-slots/#Flak_Armor)** can be surprisingly useful, as it is not uncommon for snipers to come under vehicle fire.

[**Nanoweave Armor.**](http://cmdrcyrious.com/planetside2/equipment/suit-slots/#Nanoweave_Armor) Gives you an edge in case you get flanked. Increases your survival chances in ranged duels against automatic weapons and non-infiltrator enemies.  Mostly useful for Close and Medium range sniping.

**[Advanced Shield Capacitor.](http://cmdrcyrious.com/planetside2/equipment/suit-slots/#Advanced_Shield_Capacitor)** Reduces downtime if you get injured. Arguable usefulness, because a headshot from an enemy sniper will kill you even if you’re at full health, and if you take a bodyshot, you will take some health damage as well, and would have to eat a Med Kit just to benefit from ASC.

And as a Sniper, you should always have free access to a piece of cover to let you regenerate shields in peace.

[**Adrenaline Pump.**](http://cmdrcyrious.com/planetside2/equipment/suit-slots/#Adrenaline_Pump) Makes you faster while getting into position, but does nothing for you once you arrive.

[**Ammunition Belt.**](http://cmdrcyrious.com/planetside2/equipment/suit-slots/#Ammunition_Belt) Can be useful for experienced snipers, who legitimately run out of ammo once they find a good position. [**Ammo Printer**](http://cmdrcyrious.com/planetside2/equipment/implants/#Ammo_Printer) Implant makes this obsolete, though.

## Utility Slot

Normally you would run **[Med Kits](http://cmdrcyrious.com/planetside2/equipment/utility-items/med-kits-and-restoration-kits/)**, but **[AP Mines](http://cmdrcyrious.com/planetside2/equipment/utility-items/anti-personnel-mines/)** can also be useful in certain situations. If your sniping nest has limited approach paths, you can place mines to protect your flanks.

While doing a bit more aggressive infiltrating, **VS** and **NC** mines can be combined with EMP Grenades for [**devastating multikills**](https://www.youtube.com/watch?v=4JjLhQFBEHE&feature=youtu.be&t=160).

## [Implants](http://cmdrcyrious.com/planetside2/equipment/implants/)

### Recommended

- [**Battle Hardened**](http://cmdrcyrious.com/planetside2/equipment/implants/#Battle_Hardened) is crucial when sniping from amidst allies, you cannot afford to miss critical shots due to screenshake.
- [**Target Focus.**](http://cmdrcyrious.com/planetside2/equipment/implants/#Target_Focus) Enough said about it.

### Honorable Mentions

- [**Ammo Printer.**](http://cmdrcyrious.com/planetside2/equipment/implants/#Ammo_Printer) Solves ammo issues, and provides a steady supply of Recon Darts and Motion Spotters.
- [**Regeneration.**](http://cmdrcyrious.com/planetside2/equipment/implants/#Regeneration) A convenient way of restoring health if you’re not running Med Kits.
- [**Catlike 5.**](http://cmdrcyrious.com/planetside2/equipment/implants/#Catlike) Invaluable in getting to good positions, and makes it easier to escape or fight back if you get flanked.

## Recent Comments
