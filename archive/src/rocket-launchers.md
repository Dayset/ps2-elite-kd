# PlanetSide 2 Rocket Launchers

- **Source (live):** https://cmdrcyrious.com/rocket-launchers/ — live copy returns HTTP 200 but its static HTML contains no article body (verified 2026-11-09); content below is from the Wayback Machine.
- **Source (archived):** https://web.archive.org/web/20230519103542/https://cmdrcyrious.com/rocket-launchers/
- **Snapshot date:** 20230519103542
- **Saved:** 2026-11-09
- **Raw HTML (archived):** `raw/wayback__rocket-launchers.html`
- **Raw HTML (live, empty body):** `raw/rocket-launchers.html`

---

---
title: Rocket Launchers
author: CMDRCyrious
url: http://cmdrcyrious.com/rocket-launchers/
hostname: cmdrcyrious.com
description: Rocket Launchers in PlanetSide 2 can be used by Heavy Assault class, and count as their tool. They deal moderate damage to all targets. There is a large variety of launchers; some of them deal increased damage, others can lock on to ground vehicles or aircraft, or use laser guided or even TV-guided
sitename: CMDRCyrious.com
date: "2017-03-26"
categories: ['PlanetSide 2, guide, heavy assault, mechanics, NSX, rocket launchers']
tags: ['guide', 'heavy assault', 'mechanics', 'NSX', 'rocket launchers', "A Newbie's Experience", 'API', 'beginner', 'calculator', 'combat medic', 'comparison', 'construction system', 'guest post', 'highly technical', 'implant', 'infantry', 'infiltrator', 'Light Assault', 'LMG', 'loadout', 'mechancis', 'mechanic', 'New Conglomerate', 'PC Building', 'performance', 'repost', 'SMG', 'stalker', 'suggestion', 'Terran Republic', 'tool', 'Vanu Sovreignty', 'Video', 'weapon', 'Weapon Calculator', 'XCOM 2']
fingerprint: "3f3e7f3ecb126599"
---
![](http://cmdrcyrious.com/wp-content/uploads/2016/04/20130313035308a0df77pgcd6jh4dd.jpg)


Rocket Launchers in PlanetSide 2 can be used by **[Heavy Assault](http://cmdrcyrious.com/planetside2/classes/heavy-assault/)** class, and count as their tool. They deal moderate damage to all targets. There is a large variety of launchers; some of them deal increased damage, others can lock on to ground vehicles or aircraft, or use laser guided or even TV-guided systems.

Most vehicles require quite a few rocket launcher hits to take down.

Launchers deal mediocre damage to vehicles in most situations. Pairing them with another player or damage type works best. Finding these opportunities or working in teams will greatly enhance your effectiveness with whatever launcher you use.


Normally, a single Heavy Assault with a Rocket Launcher is only a nuisance. In order for him to represent any real threat, the vehicle must be already damaged, distracted or otherwise vulnerable, and the Heavy Assault himself requires cover and freedom of movement.

# Rocket Launcher Mechanics

Rocket Launchers follow the same **[Weapon Mechanics](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/)** as other weapons.

Most Rocket Launchers deal **Direct** and **Indirect Damage**. You can think of it as “piercing effect” and “explosive effect”.

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/AT-HEAT.jpg)


## Direct Damage

The Direct Damage of all launchers uses the same [**Damage Resist Type**](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Resistances) 34 – Infantry Rockets. Therefore, all rocket launchers can be directly compared to each other.

- Infantry, MAXes and ground vehicles have no built-in resistances against that Damage Type. Therefore, they will take that damage directly to their **[Health](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Health)**.
  - Rockets do not deal increased damage on headshots.
- Aircraft, especially ESFs, take bonus damage from this Damage Type.

**You can calculate weapon damage to vehicles using the [Toolbox](http://cmdrcyrious.com/toolbox/).**

## Indirect Damage

Rocket Launchers that have Indirect Damage, can be split into two groups:

### Standard

Rocket Launchers that are primarily intended to be used against ground targets have **Indirect Damage Resist** Type 6 – Common Explosion. Any rocket hit will produce splash damage in a small area.

- Infantry takes full damage from that damage type.
- MAXes take 50% less.
- All vehicles except Flash are immune to it.
- Flash takes 25% reduced damage.

It’s worth noting that compared to **[mines](http://cmdrcyrious.com/planetside2/equipment/utility-items/anti-personnel-mines/)** and **[frag grenades](http://cmdrcyrious.com/planetside2/equipment/frag-grenades/)**, **rockets deal very little splash damage**, and it can be further reduced by first rank of **[Flak Armor](http://cmdrcyrious.com/planetside2/equipment/suit-slots/#Flak_Armor)** and **[Ordnance Armor](http://cmdrcyrious.com/planetside2/classes/max/#Ordnance_Armor)**.

### Flak Detonation

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/Flak-Detonation-e1507069838586.png)


Lock-on Launchers with dedicated anti-air capability use **Indirect Damage Resist Type** 12 – Flak Explosion. In-game description will mention this fact.

Rockets from these launchers automatically detonate near enemy aircraft, damaging them with Indirect Damage. Aircraft take bonus damage from Flak. You can use the **[Toolbox](http://cmdrcyrious.com/toolbox/)** to find out exact resistances.

Flak-type rockets will not produce splash damage in any other circumstances, so it’s highly unlikely for anything but the aircraft to be in range of Flak damage.

- Still, ground vehicles and MAXes have immunity to Flak damage.
- Infantry has no resistances to it and would take full damage if it managed to be in range of Flak explosion.

### Indirect Damage Hidden Distance Scaling

Currently, only **[Empire Specific Ground-to-Ground](http://cmdrcyrious.com/rocket-launchers/#Empire-speicifcGround-to-Ground)** lock-on launchers are affected by this obscure mechanic.

For all rocket launchers that deal splash damage, Indirect Damage scales with distance to the explosion – **the closer you are to the explosion, the more damage you take**. You can judge this by Indirect Damage values listed in game. This is easy and intuitive.

However, [**M9 SKEP Launcher**, **AF-22 Crow** and **Hades VSH4**](http://cmdrcyrious.com/rocket-launchers/#Empire-speicifcGround-to-Ground) have an additional, hidden scaling with Rocket Flight Distance – **the longer the rocket was flying, the higher its Indirect Damage**.

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/indirect-damage-scaling.png)


They deal:

- 50% Indirect Damage within 10m
- 50% to 100% within 10m to 30m, scaling with distance
- 100% at 30m+

In other words, **they deal less Indirect Damage up close, and more Indirect Damage at range.** If you want to splash damage a group of infantry, you want to be 30m+ away from them.

Indirect Damage is applied on direct hits to MAXes and Infantry, so if you want to deal more damage to a MAX or a shielded Heavy Assault, you also want to be further away.

\[/spoiler\]
## Dumbfire Mechanics

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/rocket-launcher-speed.png)


Dumbfired rockets start flying at relatively low **Starting Velocity**, and then rapidly **Accelerate** to **Maximum Velocity**, listed in-game as “Muzzle Velocity”.

Starting Velocity and Acceleration are hidden in-game, and can only be accessed via **[Census API](http://cmdrcyrious.com/weapon-stats/)**, and without these values you cannot fully evaluate rocket’s speed.

Rockets dumbfired from **[Lock-on Launchers](http://cmdrcyrious.com/rocket-launchers/#Lock-on_Launchers)** do not accelerate, they always fly at their Starting Velocity.

- While flying, rockets are affected by **Gravity**.
- The slower the rocket is flying, the more time **Gravity** has to affect its trajectory, so faster rockets with more Gravity can sometimes have less projectile drop than slower rockets with less **Gravity**.
- If a rocket doesn’t hit anything during its **Lifespan**, it will self-detonate.
- Rocket’s trajectory will be more flat if you’re shooting downwards.

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/gravity-trajectory.png)


\[spoiler title=”Formulas for Dumbfires”\]

Validity of these formulas has been confirmed by in-game testing. To **calculate rocket’s velocity at any given time** (remember to respect maximum velocity and lifespan):

`Velocity = Starting Velocity + Acceleration * Time`

It is harder to **calculate the amount of time, necessary to cover a certain distance.** First, we have to calculate how long will a rocket take to accelerate to maximum velocity:

`Time`<sub>MV</sub> = (Maximum Velocity - Starting Velocity) / Acceleration

Then we can calculate the **distance the rocket can cover while accelerating:**

`Distance`<sub>Acc</sub> = Starting Velocity \* Time<sub>MV</sub> + (Acceleration \* Time<sub>MV</sub><sup>2</sup>) / 2

If the distance we want to calculate for is shorter than this, we can simply use the same formula to calculate time:

`Acceleration * Time`<sup>2</sup> / 2 + Starting Velocity \* Time - Distance = 0

This is a quadratic equation. I recommend using **[this online tool](http://www.math.com/students/calculators/source/quadratic.htm)** for quickly solving quadratic equations. Choose the positive root.

If the distance we want to calculate for is longer than Distance<sub>Acc</sub>, then we will have to solve this in two steps. 

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/two-part-cal2c.png)


We already know Distance<sub>Acc</sub> the rocket will cover while accelerating, and Time<sub>MV</sub> it would take to do so. Knowing the Distance<sub>All</sub>, we can calculate the Distance<sub>X</sub>:

`Distance`<sub>X</sub> = Distance<sub>All</sub> - Distance<sub>Acc</sub>

When the rocket fully accelerates, it starts moving at constant velocity, so finding out Time<sub>X</sub> is easy:

`TimeX = Distance`<sub>X</sub> / Max Velocity

Then it’s just a matter of adding two times:

`Time`<sub>All</sub> = Time<sub>X</sub> + Time<sub>MV</sub>

#### Example

Let’s calculate maximum flight distance of a rocket from a starting rocket launcher.

Starting Velocity: 35 m/s

Maximum Velocity: 85 m/s

Acceleration: 40 m/s<sup>2</sup>

Lifespan: 8 sec

What we need to calculate:

`Distance`<sub>All</sub> = Distance<sub>Acc</sub> + Distance<sub>X</sub>

`Time`<sub>All</sub> = Time<sub>X</sub> + Time<sub>MV</sub>

We already know that:

`Time`<sub>All</sub> = Lifespan = 8 sec

Then:

`Lifespan = Time`<sub>X</sub> + Time<sub>MV</sub>

`Time`<sub>X</sub> = Lifespan - Time<sub>MV</sub>

`Time`<sub>MV</sub> = (Maximum Velocity - Starting Velocity) / Acceleration

`Time`<sub>MV</sub> = (85 - 35) / 40 = 50 / 40 = 1.25 sec

`Distance`<sub>Acc</sub> = Starting Velocity \* Time<sub>MV</sub> + (Acceleration \* Time<sub>MV</sub><sup>2</sup>) / 2

`Distance`<sub>Acc</sub> = 35 \* 1.25 + (40 \* 1.25<sup>2</sup>) / 2 = 43.75 + 31.25 = 75 m

Now we know that the rocket will cover 75m while accelerating, and it would take 1.25 seconds to fly. The rest of the Lifespan the rocket will fly at a constant velocity, equal to maximum velocity for this launcher.

`Time`<sub>X</sub> = Lifespan - 1.25 = 6.75 sec

Now we just have to find out what distance the rocket will cover during that time.

`Distance`<sub>X</sub> = Time<sub>X</sub> \* Maximum Velocity

`Distance`<sub>X</sub> = 6.75 \* 85 = 573.75m

`Distance`<sub>All</sub> = 573.75 + 75 = 648.75

The answer: a rocket from a starting rocket launcher can cover \~650m during 8 seconds of its lifespan.

Unfortunately, **we still don’t know how *exactly* projectile drop is calculated**. I’ve done some extensive testing, but haven’t found anything conclusive.

\[/spoiler\]

## Lock-on Mechanics

- Some of the launchers can lock-on to ground vehicles and/or aircraft.
- Some of these launchers cannot fire without an established lock (cannot dumbfire).
  - Both these facts will be mentioned in the launcher’s description.
- Rockets dumbfired from lock-on launchers will not accelerate, though they usually have slightly higher Starting Velocity.

To gain a lock, user must hold the enemy vehicle inside **Lock-on Angle** of the sights for several seconds. **Lock-on Time** is the same at all ranges and against all targets.

On launchers without dumbfire capabilities, **you can hold “fire” key to fire as soon as the lock is established.**

There are two statistics related to lock-on distance:

- **Lock Range** – determines the maximum range at which a target can be locked.
- **Lock Hold Range** – some launchers can keep tracking the target with a lock even after it has left the Lock Range.

In other words, launchers that have Lock Hold Range longer than Lock Range can hold a lock at ranges where they can’t establish a lock.

Launchers that can lock on to both air and ground targets will have different lock-on ranges against them.

When target goes outside Lock-on Angle or Lock Hold Range, a launcher can keep the lock for a short amount of time, equal to **Lock-on Loss Delay**.

However, during that time the lock is still fully functional, and you can take advantage of this by **[angling your rockets](https://www.youtube.com/watch?v=V0vDAlH4agk)** to make sure they don’t hit anything on the way to the target. There is a more extreme example **[here](https://clips.twitch.tv/MiniatureTentativeRavenKappa)**.

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/Vehicle-Stealth.png)


**Vehicle Stealth** defense slot can increase the lock-on time by 0.25 to 2 seconds, depending on vehicle and Vehicle Stealth rank. You can find specific numbers in in-game descriptions of Vehicle Stealth.

**Fire-and-forget:** after the rocket has been fired with a lock, it will automatically track the vehicle without the need to maintain the lock.

The rocket will only pursue the target for **Lock-on Lifespan** amount of time, so theoretically the rockets can be outrun, but it is usually impossible outside of edge cases, like an ESF at maximum lock range, afterburning away.

The “agility” of a locked on rocket is determined by **Lock-on Turn Angle**. If the vehicle performs evasive maneuvers, the rocket may not be able to adjust trajectory in time, and can miss the vehicle.

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/dodging-rockets.jpg)


If then the angle between rocket’s flight direction and direction to the target becomes greater than **Lock-on Lose Angle**, the rocket will lose the lock. This means that the mechanic of dodging lock-ons is built into the rockets themselves.

It is currently unclear if locked on rockets are affected by **Gravity**.

### Proximity Seeking

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/Proximity-Seeking.png)


**Proximity Seeking** rockets are dumbfired as usual, but if they fly near enemy aircraft, they will automatically snap lock-on to them.

Currently the only rocket launcher employing this mechanic is [**T2 Striker**](http://cmdrcyrious.com/rocket-launchers/#T2_Striker), though similar mechanic is applied to **Coyotes** and **Hyena Rocket Pods**.

### Lock-on Related Stats in Census API

The Census API contains a lot of information, related to the lock-on behavior. Unfortunately, most of that information is wrong and meaningless. Values that are actually being used by the game are recorded in the part of the API without public access.

For example, according to Census API, **[NS Annhilator](<http://census.daybreakgames.com/s:iridar/get/ps2/item?name.en=NS%20Annihilator%20&c:lang=en&c:join=fire_mode^inject_at:fire_mode^list:1,item_to_weapon^inject_at:fire_mode_2(weapon,weapon_to_fire_group^on:weapon_id^to:weapon_id^list:1(fire_group^on:fire_group_id^to:fire_group_id,fire_group_to_fire_mode^on:fire_group_id^to:fire_group_id^list:1(fire_mode_2^on:fire_mode_id^to:fire_mode_id^list:1(player_state_group^list:1^inject_at:player_state_group,player_state_group_2^on:player_state_group_id^to:player_state_group_id^inject_at:player_state_group_2^list:1,fire_mode_to_projectile^on:fire_mode_id^to:fire_mode_id^inject_at:projectile(projectile^on:projectile_id^to:projectile_id^inject_at:projectile_details))))))&c:join=weapon_datasheet^inject_at:ammo&c:join=item_category^on:item_category_id^to:item_category_id^inject_at:category&c:join=item_attachment^on:item_id^to:item_id^list:1^inject_at:attachments(item^on:attachment_item_id^to:item_id^inject_at:attachment(zone_effect^on:passive_ability_id^to:ability_id^inject_at:attachment_effects^list:1(zone_effect_type^on:zone_effect_type_id^to:zone_effect_type_id^inject_at:attachment_effects_description)))>)** has:

- Starting Velocity: 50 m/s
- Maximum Velocity: 100 m/s
- Lock-on Acceleration: 6.67
- Variable lock-on time: 1.5 sec @ 100m -> 2.5 sec @ 300m

And here are actual rocket travel times for different distances, acquired by in-game testing, by frame-by-frame watching of 60 FPS Shadowplay recording:

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/NS-Annihilator-rocket-travel-time.png)


As you can see from the testing, Annihilator rocket covers 350m over 3 seconds, which means average velocity of \~116 m/s, which clearly exceeds supposed “Maximum Velocity” of 100 m/s. It also seems to travel at a constant velocity, despite the fact there is an “acceleration” statistic.

There is naturally some inaccuracy due to measuring method, but not on the scale of 0.5 seconds. I have ran into similar walls with G2G and G2A lock on launchers.

As a conclusion: **listed Muzzle Velocity can not be used to judge locked on rocket speed**. Same goes for such stats as lock-on range,  lock-on time and lock-on loss time.

Rocket Launchers did used to have their lock-on time vary with distance to the target, but it was changed in one of the patches, and now lock-on time is the same at any distance, though it will vary from launcher to launcher.

Some values, like Lock-on Turn Angle and Lock-on Loss Angle cannot be effectively tested. In Rocket Launcher stat sheets below, you will see a red question mark in brackets **(?)** to highlight stats that are listed in the API, but could easily be wrong.

**Lock-on Lifespan** is *probably* correct.

### Vehicle Interaction

Vehicle pilots receive a warning when you try to lock-on to their vehicle, and they can see whether the source of that lock is someone on the ground or an air vehicle.

When a rocket is tracking the vehicle, they get continuous warning and they can see flying rockets on the minimap as pulsing red dots.

Establishing and holding a lock will not give away your position.

### Decoy Flares and IR Smoke

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/Decoy-Flares.png) 

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/IR-Smoke.png)


Air vehicles can use **Decoy Flares** utility to remove the lock and prevent locking for several seconds. Any lock-on rockets already in flight will automatically miss – veer off skywards and self-destruct.

Ground vehicles can use **Smoke Screen** to the same effect, though it is much less popular.

## Mythbusting

There is a myth that jumping or falling greatly increases hip fire accuracy of dumbfired rockets. **[Busted](https://www.youtube.com/watch?v=FPU6KmhHlAU)**.

## Misc. Rocket Launcher Mechanics

**Sprint Override:** after firing a rocket, the player cannot sprint for a certain period of time. Depending on the launcher, this delay ranges from 0.3 to 0.5 seconds.

**Terminal Resupply to Instantly Reload:** you can double-tap the “use” key (default \[E\]) on an infantry terminal to instantly reload all your weapons and restock on ammo. This can be a great way of boosting your combat rate of fire while using a launcher.

However, resupplying at a terminal mid-reload will result in your character doing a non-skippable reload animation after the resupply, so before resupplying make sure to switch to something that doesn’t need reloading.

**Fire Detect Range of 100m:** when fired, all launchers put their user on the minimap of enemies within 100m.

**Iron Sight Time:** all launchers take 0.35 seconds to ADS, and 0.15 seconds to return from ADS to hip firing.

**ADS Movement Speed Multiplier:** most rocket launchers have 0.5x multiplier, the only exception is NSX Masamune, which has 0.33x.

**Reloading continues in a vehicle:** if you enter a vehicle after the reload has started, the reload will continue and complete successfully while you are inside. This works the same for all weapons, but only after they spend all ammo in the mag.

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/Munitions_Pouch-e1506986910551.png)


**[Munitions Pouch Suit Slot](http://cmdrcyrious.com/planetside2/classes/heavy-assault/#Munitions_Pouch)** allows to carry extra spare ammunition. One extra rocket / magazine / battery per rank, up to 4 ranks.

# Dumbfire Launchers

These launchers do not have any sort of laser guidance or heat seeking, but they deal the most damage per rocket.

The ability to instantly fire a highly damaging rocket make them great against MAXes, hovering aircraft and other vehicles at close range.

According to my tests and confirmed by /u/Renuse’s experiences, a rocket dumbfired from the hip while standing moving is guaranteed to hit an infantry-sized target within \~6.5m, as long as you aim exactly at its center mass.

Dumbfire launchers can be used as one-shot “sniper rifle” against camping Infiltrators and Light Assaults, as it’s a guaranteed OHK if the rocket touches the player.

All dumbfire launchers share the same **Damage Resist Type**, so they can be compared directly.

## Starting Launchers

*Despite looking different, these launchers function exactly the same between factions.*

### ML-7

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/TR-Lockon.png)


### Shrike

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/Phoenix.png)


### S1

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/VS-Lockon.png)


\[spoiler title=”Stats”\]

**Direct Damage:** 725

Direct Damage Resist Type: 34 – Infantry Rockets

Indirect Damage: 250 @ 0.35m – 50 @ 3m

Indirect Damage Resist Type: 6 – Common Explosion

**Reload Time:** 3.43 seconds

**Ammo:** 1 + 11

Hip CoFs: 3.5 / 3.5 / 3.5 / 3.5

ADS CoFs: 0.1 / 1 / 0.1 / 1

**Starting Velocity:** 35 m/s

Max Velocity: 85 m/s

Acceleration: 40 m/s<sup>2</sup>

Lifespan: 8 sec

Gravity: 2

**Sprint Override:** 300 ms

ADS Movespeed Multiplier: 0.5x

Equip / Unequip Time: 0.9 / 0.25

**Approximate rocket travel time:** 

- 100m: 1.5 sec
- 200m: 2.7 sec
- 300m: 3.8 sec
- 400m: 5 sec

\[/spoiler\]

Starting rocket launchers are your basic RPGs, they have good velocity and damage, but hitting mobile or distant targets can be challenging. Iron sights can be especially inconvenient when trying to compensate for projectile drop.

Quick reload lets you keep dealing a solid amount of damage to ground vehicles, especially at close range, but starting launchers aren’t very effective against aircraft. Even if you manage to hit them, you will still need multiple hits to destroy them.

One rocket is almost enough to get an ESF burning. If you do manage to get a hit, you can quickly finish off the ESF with about 20-30 bullets from your primary weapon.

Valkyries require at least 3 rockets hits, and other aircraft even more. At that point, using a lock-on launcher for easy guaranteed hits is likely a better bet.

One rocket deals 32% to 42.5% of **[MAX](http://cmdrcyrious.com/planetside2/classes/max/)**‘s health, depending on whether he has Ordnance Armor, and of what rank.

## NS Decimator

*Can be used by all factions.*

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/Decimator.png)


**Direct Damage:** 975

Direct Damage Resist Type: 34 – Infantry Rockets

Indirect Damage: 350 @ 0.35m – 50 @ 5m

Indirect Damage Resist Type: 6 – Common Explosion

**Reload Time:** 5.7 seconds

**Ammo:** 1 + 8

Hip CoFs: 3.5 / 3.5 / 3.5 / 3.5

ADS CoFs: 0.1 / 1 / 0.1 / 1

**Starting Velocity**: 30 m/s

Max Velocity: 60 m/s

Acceleration: 40 m/s<sup>2</sup>

Lifespan: 8 sec

Gravity: 2

**Sprint Override:** 300 ms

ADS Movespeed Multiplier: 0.5x

Equip / Unequip Time: 0.9 / 0.25

**Approximate rocket travel time:** 

- 100m: 1.8 sec
- 200m: 3.4 sec
- 300m: 5.1 sec
- 400m: 6.7 sec

\[/spoiler\]

NS Decimator is a heavy RPG. It deals more damage than starting launchers, but reloads longer, carries fewer rockets, and the rocket itself has lower velocity, which makes it more susceptible to Gravity and harder to use against vehicles at range and aircraft.

Compared to starting launchers, Decimator deals \~34% higher damage per shot, and usually requires 1 rocket fewer to kill a vehicle.

Both dumbfire launchers can deal roughly the same damage with the amount of carried ammunition, but starting launchers still deal \~23% more damage per reload time (damage per minute) than Decimator.

However, requiring to fire fewer rockets makes Decimator safer, and higher damage per shot is more desirable against infantry and MAXes at close range:

- Decimator deals 57.5% to 43.4% MAX’s health in 1 rocket, depending on Ordnance Armor.
- One direct rocket hit will kill full health infantry without Flak Armor 3+.

One rocket will **[reliably one-shots ESFs](https://www.youtube.com/watch?v=k33B368MXcU)** without Composite Armor. Such overwhelming power earned the Decimator lots of love and adoration from the community.

Decimator is noticeably harder to use at any meaningful range, so often it is better to stick to starting launchers. After all, it’s better to hit with a weaker missile than miss with a stronger one.

### The Kraken

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/The-Kraken.png)


The Kraken is a cosmetic variant of the Decimator, granted for completing the auraxium level of rocket launcher Directives. Kraken has an auraxium shader, and its rocket explosions have noticeable visual and sound effects.

The Directive requires you to earn an auraxium medal (1160+ kills) with five different rocket launchers. Since most rocket launchers are no longer effective against infantry, this directive is very hard to complete for the moment.

# Lock-on Launchers

## Empire-specific Ground-to-Air

*Despite looking different, these launchers function exactly the same between factions.*

### ASP-30 Grounder

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/TR-Lockon.png)


### Hawk GD-68

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/Phoenix.png)


### Nemesis VSH9

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/VS-Lockon.png)


**Direct Damage:** 700

Direct Damage Resist Type: 34 – Infantry Rockets

Indirect Damage: 400 @ 5m – 50 @ 8m

Indirect Damage Resist Type: 12 – Flak Explosion

**Reload Time:** 3.43 sec

**Ammo:** 1 + 11

Hip CoFs: 5 / 5 / 5 / 5 

ADS CoFs: 0.1 / 1 / 0.1 / 1

**Dumbfire velocity:** 50 m/s

Dumbfire Lifespan: 5 sec

Gravity: 1

**Lockon Lifespan:** 5 sec **(?)**

Lockon Lose Angle: 145 **(?)**

Lockon Turn Rate: 1.5 **(?)**

**Lock-on Range:** 350m

Lock Hold Range: 400m

Lock-on Time: 1.67 sec

Lock-on Angle: 8 degrees

Lock-on Loss Delay: 0.75 seconds

**Sprint Override:** 300 ms

ADS Movespeed Multiplier: 0.5x

Equip / Unequip Time: 1 / 0.25

**Approximate rocket travel time (dumbfire):** 

- 100m: 2 sec
- 200m: 4 sec
- 250m: 5 sec (max dumbfire range)

\[/spoiler\]

These launchers can lock-on to enemy aircraft, but they can still be dumbfired against ground targets, which makes them **incredibly versatile**. A Heavy Assault armed with one of these will have an option against every target type in the game.

Comparing G2A launchers to default dumbfire launchers:

**The good:** there’s virtually no performance loss against ground vehicles at close range.

They are also **more convenient** to use:

- Scope doesn’t get in the way like Iron Sights, and it’s great for dumbfiring.
- The rocket is slower, but it flies at a constant velocity, so it is more consistent and predictable within \~75m.
- It is less affected by Gravity, and doesn’t require as much compensation for drop within 200m. It will have \~50% longer travel time, though.

**The bad:** default launchers deal more damage to MAXes and Infantry, since rockets from G2A launcher do not produce splash damage when fired at ground targets.

**The ugly:**

- Low velocity and shorter lifespan limit G2A dumbfire range at 250m.
- G2A Launchers have much worse hip fire accuracy.

## Empire-specific Ground-to-Ground

*Despite looking different, these launchers function exactly the same between factions.*

### M9 SKEP Launcher

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/TR-Lockon.png)


### AF-22 Crow

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/Phoenix.png)


### Hades VSH4

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/VS-Lockon.png)


**Direct Damage:** 750

Direct Damage Resist Type: 34 – Infantry Rockets

Indirect Damage: 250 @ 0.35m – 50 @ 3m

Indirect Damage Resist Type: 6 – Common Explosion

**Indirect Damage Hidden Scaling:** 50% within 10m, 100% when >30m.

**Reload Time:** 4 sec

**Ammo:** 1 + 11

Hip CoFs: 5 / 5 / 5 / 5 

ADS CoFs: 0.1 / 1 / 0.1 / 1

**Dumbfire velocity:** 40 m/s

Dumbfire Lifespan: 5 sec

Gravity: 1

**Lockon Lifespan:** 5 sec **(?)**

Lockon Lose Angle: N/A **(?)**

Lockon Turn Rate: 1.25 **(?)**

**Lock-on Range:** 200m

Lock Hold Range: 250m

Lock-on Time: 1.67 sec

Lock-on Angle: 8 degrees

Lock-on Loss Delay: 0.75 seconds

**Sprint Override:** 300 ms

ADS Movespeed Multiplier: 0.5x

Equip / Unequip Time: 1 / 0.25

**Approximate rocket travel time (dumbfire):** 

- 100m: 2.5 sec
- 200m: 5 sec (max dumbfire range)

**Approximate rocket travel time (lock on):** 

- 300m: 2.75 sec (unconfirmed after CAI)

\[/spoiler\]

These launchers can lock-on to enemy ground vehicles, and they can still be dumbfired against infantry and MAXes, or vehicles at close range.

Interestingly, G2G launchers deal a tiny bit more damage per shot than default dumbfire launchers. That would be enough to let them reliably oneshot infantry without Flak Armor…. if not for hidden indirect damage scaling. Up close, G2G launcher rockets will deal less splash damage. So the rocket will oneshot only at 30m+.

G2G launchers have great accuracy and consistency within their relatively short lock-on range of 200m, as long as the vehicle is in relatively open field and the target cannot just hide into cover to throw off the lock.


## NS Annihilator

*Can be used by all factions.*

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/Annihilator.png)


**Direct Damage:** 650

Direct Damage Resist Type: 34 – Infantry Rockets

Indirect Damage: 325 @ 5m – 1 @ 8m

Indirect Damage Resist Type: 12 – Flak Explosion

**Reload Time:** 3 sec

**Ammo:** 1 + 15

**Lockon Lifespan:** 8 sec **(?)**

Lockon Lose Angle: 145 **(?)**

Lockon Turn Rate: 1.5 **(?)**

Gravity: 0.5

**Lock-on Range Air:** 350m

Lock Hold Range Air: 400m

**Lock-on Range Ground:** 300m

Lock Hold Ground: 300m

Lock-on Time: 1.2 sec

Lock-on Angle: 8 degrees

Lock-on Loss Delay: 0.75 seconds

**Sprint Override:** 300 ms

ADS Movespeed Multiplier: 0.5x

Equip / Unequip Time: 1 / 0.25

NS Annihilator cannot dumbfire, but it can lock to both ground and air vehicles. Against ground targets, it has a longer lock-on range than dedicated G2G launcher.

Annihilator deals less damage per shot, but it has faster reload and \~half a second shorter lock-on time, and it also carries more rockets. Overall, Annihilator can deal slightly more damage before having to resupply.

The inability to dumbfire makes Annihilator ineffective against ground vehicles at close range, and useless against infantry and MAXes.

It’s not necessarily such a terrible thing, as it simplifies the decision-making. Removing the option to dumbfire against MAXes and infantry forces the player to rely on firearms, but it also removes the possibility to be flanked and killed while handling the launcher, or missing a crucial rocket. It also makes it nearly impossible to accidentally hit an allied unit. For these reasons, Annihilator is the best launcher you could give to a complete FPS newbie. Which is probably the reasoning behind it being included in the **[Elite Recruit Bundle](http://cmdrcyrious.com/planetside2/starter-guide/#Battle_Rank_15_Milestone)**.

## NS-R3 Swarm

*Can be used by all factions.*

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/Swarm.png)


**Direct Damage:** 350

Direct Damage Resist Type: 34 – Infantry Rockets

Indirect Damage: 160 @ 5m – 1 @ 8m

Indirect Damage Resist Type: 12 – Flak Explosion

**Rate of Fire:** 60 (1 shot per second)

**Ammo:** 3 + 27

**Reload Time:** 4  sec

**Lock-on Range Air:** 350m

Lock Hold Range Air: 400m

**Lock-on Range Ground:** 300m

Lock Hold Ground: 300m

Lock-on Time: 1.2 sec

Lock-on Angle: 8 degrees

Lock-on Loss Delay: 0.75 seconds

Lockon Lose Angle: 180 **(?)**

Gravity: 0.5

According to **[patch notes](https://forums.daybreakgames.com/ps2/index.php?threads/pc-game-update-8-16-fanning-the-fire-teams.250101/#post-3511809)**, Swarm’s rockets will follow the target for up to 800m, though it’s currently unclear whether that affects only aircraft, or ground targets as well, and if both firemodes are affected.

**Default Firemode**

Lock-on Velocity: High

Lockon Turn Rate: 0.8

Lockon Lifespan: 12 sec **(?)**

**Secondary Firemode**

Lock-on Velocity: Low

Lockon Turn Rate: 2

Lockon Lifespan: 12 sec **(?)**

**Sprint Override:** 1000 ms

ADS Movespeed Multiplier: 0,5x

Equip / Unequip Time: 1 / 0.25

NS-R3 Swarm is a sidegrade to Annihilator. It too cannot dumbfire, and can lock-on to both ground and air vehicles, with same lock-on ranges and lock-on time.

Swarm is magazine-fed, with 3 rockets per magazine, each rocket dealing slightly more than half of Annihilator’s rocket. Swarm can fire only 1 rocket per second, and requires you to maintain the lock for 2 seconds while firing 3 rockets, while the Annihilator is strictly fire-and-forget.

All in all, Swarm has about \~17% lower damage per minute than Annihilator, but in return it can output the most amount of damage per reload.

Swarm has **two firemodes:**

-  **In default firemode**, it fires fast, but not very agile rockets. They are great at quickly reaching a large or slow-moving vehicle, but can miss a more maneuverable target.
- **In secondary firemode**, Swarm fires slow, but agile rockets. They are nearly impossible to dodge, but they can take a long time to reach the target, and can potentially run into terrain or be outrun.

# Empire Specific Rocket Launchers

These rocket launchers embrace the traits of different factions: volume of fire for **TR**, precise and powerful punch for **NC**, adaptability and versatility for **VS**. These launchers are rather unique, and historically have been a hot topic for community, with constant calls for nerfs or buffs, and with whole squads being organized to play around their strengths. Things have been calm and stable lately, though.

All of these launchers are weak on their own, especially outside their element, but – just like everything else – become noticeably stronger when used in greater numbers in coordianated squads.


## T2 Striker

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/Striker.png)


**Direct Damage:** 150

Direct Damage Resist Type: 34 – Infantry Rockets

Indirect Damage: 100 @ 5m – 1 @ 8m

Indirect Damage Resist Type: 12 – Flak Explosion

**Rate of Fire:** 150 (2.5 shots per second)

**Ammo:** 6 + 42

**Reload Time:** 3.43 / 3.43 sec

Hip CoFs: 2.5 / 2.5 / 2.5 / 2.5 / 0,1

ADS CoFs: 0.1 / 1 / 0.1 / 1 / 0.1

**Velocity: (??????)**

Lifespan: 2 sec (\~445m max range)

Gravity: 2

**When locked-on to a nearby aircraft:** Proximity Lock Range: \~12m (based on in-game testing)

Lockon Lifespan: 5 sec

**(?)**

Lockon Lose Angle: N/A

Lockon Turn Rate: 1.5

**Sprint Override:** 400 ms

ADS Movespeed Multiplier: 0,5x

Equip / Unequip Time: 0.9 / 0.25

T2 Striker is a magazine-fed rocket launcher, with a focus on sustained fire and close range anti-air. Striker dumbfires small, fast rockets both when hip firing and when looking through the scope. If a rocket passes within \~15m of an enemy aircraft, it will automatically snap lock-on to it.

Striker can be a great deterrence to aircraft when terrain and proximity interferes with traditional lock-ons, but it’s fairly average against armored ground vehicles.

Striker’s velocity does not seem to follow the parameters in the Census API. Here are some results from in-game testing:

![T2 Striker Average Velocity](http://cmdrcyrious.com/wp-content/uploads/2017/03/T2-Striker-Average-Velocity.png)

Click to enlarge

![T2 Striker Projectile Travel Time](http://cmdrcyrious.com/wp-content/uploads/2017/03/T2-Striker-Projectile-Travel-Time.png)

Click to enlarge

Due to high velocity – more than twice as fast as default dumbfires – individual hits are easy to score, so the Striker can sustain fire on distant targets without any trouble.

Striker is a versatile launcher that can engage both air and ground targets, but noticeably lacks in alpha damage, and exposes the user while firing.

When dealing with distant targets, starting Cone of Fire becomes a real issue, and has to be managed by staying still. Striker also has a little bit of CoF Bloom, but it’s no big deal and can be ignored, for the most part

Striker has maximum range of about 445 meters.

**Tip:** Striker is fully automatic, you don’t have to click for each shot, you can just hold “fire”.

Striker is ineffective against MAXes, requiring 14+ rockets to kill one.

## NC15 Phoenix

![NC15 Phoenix](http://cmdrcyrious.com/wp-content/uploads/2017/03/NC-Lockon.png)


**Direct Damage:** 875

Direct Damage Resist Type: 34 – Infantry Rockets

Indirect Damage: 75 @ 0.35m – 25 @ 4m

Indirect Damage Resist Type: 6 – Common Explosion

**Reload Time:** 3.43  sec

**Ammo:** 1 + 11

**Maximum Velocity:** 42 m/s

**Maximum Distance from the user:** 295m

Lifespan: 12 sec

Gravity: 0.5

**Sprint Override:** 300 ms

ADS Movespeed Multiplier: 0,5x

Equip / Unequip Time: 1.2 / 0.25

- Phoenix fires slow TV-guided missiles, almost as damaging as Decimator’s.
- While the rocket is in flight, the player uses his first person camera to steer to rocket.
- During that time, the player character is forced to stand and becomes immobile; vulnerable to enemy fire.
- The rocket is slow, emits distinctive blue flames and a screeching sound effect, and can be shot down.
- The reloading process only starts after the user exits the steering mode.
- The rocket can fly maximum 295m away from the user. Flying further will force a detonation. While steering the rocket, players can monitor the distance to their body in the upper right corner.
- Phoenix cannot fire from the hip.

Phoenix users have accumulated a lot of tactical and mechanical quirks to help them:

In prolonged hunkered-down fights, dug-in NC will pull out the Phoenixes. You don’t need to coordinate with them. Pull yours out, and wait for them to fire theirs. Fire yours right away. You should be able to follow where the first NC rocket is going, and most Phoenix users know to do this trick of following the first rocket. It leads to coordinated spikes of damage without actually coordinating.

The Phoenix packs a serious punch and has the incredibly useful **trait of not needing line of sight to engage**. The best time I’ve found to use this weapon is in **support of a friendly armor push**: position yourself closely behind, out of enemy line of sight, and fire your Phoenix over cover towards the fight. Focus on an enemy that is being engaged by your allies. This technique is just brutal when you combine it with friendly Vanguards. They cause enemy tanks to seek cover, and you follow the burning tank into cover with your Phoenix and blow it up. You’ll want a vehicle of some sort so you can keep up with the friendly push, and keep the enemy in your range of 295 meters.

Solo Phoenix is **amazing against inexperienced and distracted tanks** from a flanking position, and can quickly kill even an MBT. Engaging veteran tanks that are not distracted will result in them killing, evading or outrepairing you, so its best to avoid.

**Against aircraft**, Phoenix can sometimes get good surprise alpha damage. ESFs take especially high damage, almost enough to be one-shot. But you won’t be able to reliably hit evading aircraft. Hovering Galaxies and Liberators are fairly easy to hit, if they are in range, however.

**Pressing the “Change Camera” key** (default “T”) after the shot switches the first person rocket view to third person, allowing for a much wider Field of View, which really helps with finding and tracking targets.

Alternatively, you can press the “Hide HUD” key (default Ctrl + F10) after the shot to remove the scope overlay.

Unfortunately, in both cases you lose the distance tracking.

The rocket can be accelerated and decelerated for better control, same as an aircraft.

/u/[Daetaur](https://www.reddit.com/r/Planetside/comments/61mjrr/rocket_launcher_guide/dffq5op/)

You cannot fire the Phoenix while crouching, even when using crouch toggle. Firing the rocket will force you into standing once you enter the camera mode.

It’s something to keep in mind if want to avoid exposing yourself as sniper bait.


You can **prematurely end the steering process** by pressing the “Exit vehicle” key (default “E”). The rocket will continue flying, but with a heavy drop downwards. It will still deal damage if it hits something. You can use this technique to shave off a few milliseconds between shots by “exiting” the rocket when it is about to hit something. You can also use this to pseudo dumbfire the Phoenix at close range targets.

If you have a fancy gaming mouse, it can be convenient to have a thumb button that would increase mouse’s sensitivity while steering the rocket, so you can easier make sharper turns.

**You can use the keyboard to steer the rocket.** The rocket will respond to Aircraft Controls for Pitching Up and Down, and Rolling Left and Right. Arrow keys by default. You can also change rocket’s speed to make sharper turns.

Phoenix one-shots Engineers’ MANA Turrets, and kills the Engineer in the process, unless they bail before impact. This is the main reason I use the Phoenix, because a well placed MANA Turret can pin down a whole squad.


## Lancer VS22

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/Lancer.png)


**Direct Damage:** Charge level one: 100 @ 150m – 50 @ 300m

Charge level two (1.5 sec charge): 350 @ 150m – 175 @ 300

Charge level three (3 sec charge): 700 @ 150m – 350 @ 300

Maximum charge hold: 5 seconds

Direct Damage Resist Type: 34 – Infantry Rockets

Rate of Fire: 120 (0.5 sec Refire Time)

Reload Time: 4 / 4 sec

Ammo: 9 + 27

Hip CoFs: 5 / 5 / 5 / 5 / 0.5

ADS CoFs: 0 / 0 / 0 / 0 / 0.5

**Velocity:** 450 m/s

Lifespan: 1 sec

Maximum range: 450m

**Sprint Override:** 300 ms

ADS Movespeed Multiplier: 0.5x

Equip / Unequip Time: 1 / 0.25

Lancer is not a traditional rocket launcher, it’s more of a charge up anti-materiel plasma rifle. Lancer’s battery holds 9 plasma cells. By default, Lancer fires weak bolts of plasma that deal minor damage and consume 1 plasma cell. But the user can hold down the trigger to fire more powerful bolts:

- 1.5 sec charge – 3.5x damage – consumes 2 plasma cells
- 3 sec charge – 7x damage – consumes 3 plasma cells

Lancer has **no projectile drop and pinpoint accurate while aiming down sights**.

Charged shots are more ammo-efficient, so normally Lancer is used in charged mode. It is a common tactic to charge the shot from the hip, and fire it in ADS mode. That way, you can move faster while charging.

There are several ways to cancel the charging process, should you need to:

- switch to a sidearm
- start reloading the Lancer
- perform a quick knife attack
- press “Toggle Weapon Visibility” key (default “Ctrl + F11”)

Due to highest in class projectile velocity, Lancer is easy to use at range. It can even be used to snipe ESFs. Low scope magnification can be a nuisance at extreme ranges, though. Lancer has a considerable damage degradation after 150m, so it’s not very effective at 200m+.

More than any other ESRL, Lancer is known for being used en-masse in organized squads. However, its main allure was that once a certain critical mass of Lancers was reached, the squad could delete any enemy vehicle within render distance. Now that Lancer has considerable damage degradation, it’s less effective in that role. It’s still does a good job of consistently inflicting damage to vehicles at great distances, but the necessary critical mass to instakill a vehicle is now at around \~20 Lancers.

With Lancer, VS heavies can engage any vehicle on the battlefield at basically any range. The charge feature lets you choose how to distribute the damage. Instead of always charging (which does yield the highest percentage of damage), use the appropriate charge for the situation:

- Two fully charged shots take \~6.5 seconds to empty a battery and will deal 1400 base damage. The enemy pilot will have \~3.5 seconds between shots to react to incoming damage.
- Alternatively, you can start with one fully charged shot, then follow up with a lvl 2 charged shot, and then finish with an uncharged shot. It will take \~5.8 seconds, giving the enemy only a couple seconds to react and dealing 1150 base damage.

The key to the Lancer is to focus fire on targets that are already being engaged. Since you can choose how to distribute the damage, you often can easily steal the kill. For this, I like to use Flashes to get in flanking positions of big tank battles.

Don’t try to solo a veteran tank crew, unless they are already engaged or otherwise distracted. If they can’t kill you, they will just disengage or outrepair your damage.

The Lancer shines against light vehicles. Once you get enough practice, hitting a cruising harasser is pretty easy.

Lancer is great for sniping MAXes. Unless running Ordnance Armor 3+, they will die to 3 charged shots within 150m. Note: Lancer doesn’t deal bonus headshot damage.

However, Lancer is horrible against infantry and MAXes at close range. Its lack of burst damage makes it useless on the front lines.


# Other Launchers

## NSX Masamune

![](http://cmdrcyrious.com/wp-content/uploads/2017/03/NSX-Masamune.png)


**Direct Damage:** 185

Direct Damage Resist Type: 34 – Infantry Rockets

Indirect Damage: 125 @ 0.35m – 50 @ 3m

Indirect Damage Resist Type: 6 – Common Explosion

**Hip Fire:**

Hip CoFs: 0.5 / 1 / 0.5 / 1

ADS CoFs: 0.1 / 1 / 0,1 / 1 / 0.5

Flying/Falling CoF: 4

Hip Fire Rockets Per Salvo: 4

Hip Fire Spread: 4 degrees

Refire Time: 0.5 seconds

**Reload Time:** 4 sec

**Ammo:** 4 + 32

**Hip Fire Starting Velocity:** 30 m/s

Hip Fire Rocket Acceleration: 60 m/s<sup>2</sup>

Hip Fire Max Velocity: 120 m/s

Hip Fire Rocket Lifespan: 6 sec

Gravity: 1.5

ADS Rocket Lifespan: 3.8 sec **(?)** 

ADS Refire Time: 1 second

(time before you can start reloading after final rocket is fired)

**Sprint Override:** 500 ms

ADS Movespeed Multiplier: 0.33x

Equip / Unequip Time: 1.0 / 0.25

NSX Masamune is a quad-barrel rocket launcher, and a part of the unique Nanite Systems Exports weapons lineup. It has some interesting mechanics.

**In hip fire mode**, it fires all barrels at the same time **[like a shotgun](http://cmdrcyrious.com/planetside2/weapons/shotguns/#Pellet_Spread)**. Crouching and staying still will increase hip fire accuracy.

**In ADS mode**, it fires all rockets one by one over 0.75 seconds. The player can use the scope to steer the rockets, similarly to Engineer’s **[AV Mana Turret](http://cmdrcyrious.com/planetside2/classes/engineer/#MANA_Anti-Vehicle_Turret)**. A reload can be started 1 second after the final rocket is fired.

Rockets do not follow the crosshair exactly. They start flying noticeably below the crosshair, so usually you have to aim above the target for rockets to hit.

When leading a moving target, it is better to overlead and then drag rockets backwards, rather than trying to drag rockets forwards. Overleading fast moving targets may require an extreme body turn, though.

Rockets accelerate much slower in ADS mode.

Masamune always fires and reloads all 4 barrels, so it can be treated as a pseudo single shot launcher.

Keep in mind that you are **exposed and vulnerable while steering the rockets**, and you are not reloading while doing so. Masamune also has **reduced ADS Movement Speed Multiplier** – you can only move at 1/3rd of your normal movement speed while ADSing.

Masamune can be hard to use properly, but it’s a powerful and versatile launcher, capable of close range MAX and infantry takedowns, accurate long-range hits on ground vehicles, and effective air deterrence out to medium range.

Masamune is also okay for anti-infantry purposes; it can one shot infantry without Flak Armor, if all 4 rockets hit. A full salvo will damage an ESF without Composite Armor into a burning state.

Masamune can do a lot more than most launchers, but it also takes a lot of skill to use at range, and can often deliver lower than optimal performance.

# Tips and Tactics

## Quickscoping

When engaging enemy vehicles at “medium range” of 50-100m, it’s a common tactic to “quickscope” a rocket launcher. You use your hip fire crosshair to aim, then start Aiming Down Sights and fire the rocket during Aiming Down Sights animation, before you actually see Iron Sights align.

For rocket launchers, it takes 0.35 seconds to transition to Iron Sights, but only \~0.15 seconds for Cone of Fire to shrink to ADS state.

So as long as you fire \~0.15 seconds after you pressed the ADS key, your shot will have the same accuracy.

The point of this tactic is to be more efficient with your time, and spend less time being exposed while aiming. Staying still at the moment of the shot will increase accuracy as well.

## Ballistic Crosshair Overlay

Hitting distant targets requires compensating for projectile drop, which can be tricky to do, since iron sights will be obscuring the target. While massive amounts of practice can help, there are a couple of completely legal tricks you can employ.

![Ballistic Crosshair Screenshot](http://cmdrcyrious.com/wp-content/uploads/2017/03/Ballistic-Crosshair-Screensho2t-250x300.png)


If you use **[RTST Crosshair Overlay](http://cmdrcyrious.com/planetside2/performance-guide/#Custom_crosshair_overlay)**, you can use these ballistic crosshairs:

| **Starting Launchers** | **NS Decimator** | **G2A Lockon** | **G2G Lockon** | 
| **[Link](http://cmdrcyrious.com/wp-content/uploads/2017/03/BallisticCrosshair_StartingLauncher.png)** | **[Link](http://cmdrcyrious.com/wp-content/uploads/2017/03/BallisticCrosshair_Decimator.png)** | **[Link](http://cmdrcyrious.com/wp-content/uploads/2017/03/BallisticCrosshair_G2A.png)** | **[Link](http://cmdrcyrious.com/wp-content/uploads/2017/03/BallisticCrosshair_G2G.png)** | 
| [**Demo (350m)**](https://www.youtube.com/watch?v=mtbcR8rGFHc) | [**Demo (330m)**](https://www.youtube.com/watch?v=tRRMd2zZSq8) |  |  | 
| **[Download link](http://cmdrcyrious.com/wp-content/uploads/2017/03/Ballistic_Launcher_Crosshairs_for_RTST.zip)** to a .zip archive with all 4 crosshairs |  |  |  | 


Enable “Centered image” option.

There are 4 red bars, each serves as a crosshair for 100m, 200m, 300m and 400m. These crosshairs are scaled based on 1920 x 1080 resolution and 74 degree Vertical FoV. **If you play at a different resolution or FoV**, you will have to scale the crosshairs accordingly.

At 100m+, rockets have so much drop that your target will be obscured by iron sights. You can avoid this by **hiding your weapon model**, default Ctrl + F11. Obviously, it helps to rebind it to something more convenient. You cannot shoot while the model is hidden, so you will need some quick finger work.

**You can bind Toggle Weapon Visibility in-game and Toggle Crosshair Overlay in RTST to the same keybind**, and then you will be able to toggle between aiming and firing with one button. You will need a secondary keybind for Toggle Weapon Visibility so you can synchronize these things when you first log in.

If you have a gaming mouse, you could **create a macro** for a thumb mouse button that would hide the weapon while you’re holding the button, and show it when you release the button. Effectively, you would have a “hold to hide weapon for aiming” key. You could also rig that macro to fire as soon as the weapon is shown.

## Rocket Jousting

It is  a common tactic for a Heavy Assault to turn the corner with a Rocket Launcher ready and surprise the enemy with a point blank rocket shot. This tactic is especially effective due to **[Internet Delay](http://cmdrcyrious.com/planetside2/weapons/gunplay-guide/#Internet_Delay)** advantage.

Keep in mind this is only really effective against infantry if you use NSX Masamune or NS Decimator, as other launchers are incapable of reliably killing infantry without Flak Armor.

There are a couple of ways you can improve this trick:

1. Firing the rocket while jumping will allow you to preserve sprint-level speed.
2. If you activate overshield after your feet leave the ground, you can also gain overshield’s protection from enemy fire and your own splash damage without receiving movement speed penalty until you land.
3. If you deactivate overshield before your feet touch the ground, you will not suffer overshield’s penalty at all.
4. Immediately after the rocket shot, you can switch to something else, like a sidearm, med kit or even C4, depending on what you want to do next. Switching to LMG is usually a bad idea, as it will take much longer.

Naturally, these improvements require some quick finger work, and require a lot of skill to pull off in combat scenarios. But it is deadly effective against infantry and MAXes, and allows to do a ton of damage while still being very mobile.

## [C4](http://cmdrcyrious.com/planetside2/equipment/utility-items/c4/) Combo

There used to be a special trick you could do: deploy C4 on enemy vehicle, and then use Rocket Launcher’s splash damage to detonate it, saving a bit of time required to detonate C4 manually. However, now that Rocket Launchers deal little splash damage, *this combo is no longer possible.*

## Calculating Launchers’ Damage

You can use the **[Toolbox](http://cmdrcyrious.com/toolbox/)** to calculate Rocket Launchers’ damage to different vehicles with different defensive certifications.

# Credits

This guide wouldn’t be possible without generous contributions of other community members that have answered my call for help with this guide. Every response in **[this thread](https://www.reddit.com/r/Planetside/comments/60d93g/writing_a_rocket_launcher_guide_need_help/?utm_content=title&utm_medium=user&utm_source=reddit&utm_name=frontpage)** is appreciated. Especially helpful people:

- **[/u/NS\_CorraDald](https://www.reddit.com/user/NS_CorraDald)**
- **[/u/Teoke](https://www.reddit.com/user/Teoke)**
- **[/u/magnanimous\_xkcd](https://www.reddit.com/user/magnanimous_xkcd)**
- **[/u/PS2Orange](https://www.reddit.com/user/PS2Orange)**
- **[/u/CloaknDagger505](https://www.reddit.com/user/CloaknDagger505)**
- **[/u/t0nas](https://www.reddit.com/user/t0nas)**
- **[/u/TheSubEx](https://www.reddit.com/user/TheSubEx)**
- **[/u/kennyn172](https://www.reddit.com/user/kennyn172)**
- **[/u/Nazgren](https://www.reddit.com/user/Nazgren)**
- **[/u/commissar\_emperor](https://www.reddit.com/user/commissar_emperor)** x2
- **[/u/RYKK888](https://www.reddit.com/user/RYKK888)**
- **[/u/gitroni](https://www.reddit.com/user/gitroni)** x2
- **[/u/st0mpeh](https://www.reddit.com/user/st0mpeh)**
- **[/u/PlansThatComeTrue](https://www.reddit.com/user/PlansThatComeTrue)**
- **[/u/xxkid123](https://www.reddit.com/user/xxkid123)**
- **[/u/Xerox1231](https://www.reddit.com/user/Xerox1231)**
- **[/u/zharrhen](https://www.reddit.com/user/zharrhen)**
- **[/u/SanguinaryXII](https://www.reddit.com/user/SanguinaryXII)** gets **[MVP Stars](http://i.imgur.com/j3hpNiU.png)** for [explaining splash damage scaling](https://www.reddit.com/r/Planetside/comments/60d93g/writing_a_rocket_launcher_guide_need_help/df5yeos/).
- [**/u/shanterlad**](https://www.reddit.com/user/shanterlad)
- **[/u/SteveFrench2017](https://www.reddit.com/user/SteveFrench2017)** great tips on Lancer and Phoenix
- Thanks to **[Xerox1231](https://forums.daybreakgames.com/ps2/index.php?members/xerox1231.217934/)** for pointing out some typos.
- **[/u/Renuse-Sol-Ex](https://www.reddit.com/user/Renuse-Sol-Ex)** for his explanation of Rocket Jousting tactic and other tips.
