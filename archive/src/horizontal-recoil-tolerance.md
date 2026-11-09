# Horizontal Recoil Tolerance

- **Source:** https://cmdrcyrious.com/horizontal-recoil-tolerance/
- **Saved:** 2026-11-09
- **Status:** live, HTTP 200
- **Raw HTML:** `raw/horizontal-recoil-tolerance.html`
- **Extraction:** trafilatura

---

---
title: Horizontal Recoil Tolerance | CMDRCyrious.com
author: CMDRCyrious
url: https://cmdrcyrious.com/horizontal-recoil-tolerance/
hostname: cmdrcyrious.com
description: The most mysterious and elusive recoil characteristic - finally figured out and explained.
sitename: CMDRCyrious.com | Take your gaming Cyriously!
date: "2016-05-22"
categories: ['PlanetSide 2, mechanics']
tags: ['mechanics', "A Newbie's Experience", 'API', 'beginner', 'calculator', 'combat medic', 'comparison', 'construction system', 'guest post', 'guide', 'heavy assault', 'highly technical', 'implant', 'infantry', 'infiltrator', 'Light Assault', 'LMG', 'loadout', 'mechancis', 'mechanic', 'New Conglomerate', 'NSX', 'PC Building', 'performance', 'repost', 'rocket launchers', 'SMG', 'stalker', 'suggestion', 'Terran Republic', 'tool', 'Vanu Sovreignty', 'Video', 'weapon', 'Weapon Calculator', 'XCOM 2']
fingerprint: c21bd17d9306b573
---
# Introduction

Horizontal Recoil Tolerance is the most mysterious and elusive recoil characteristic. We all knew what it’s supposed to do: set a limit on just how far Horizontal Recoil can take you from initial aiming position.

![Horizontal Recoil Tolerance](http://cmdrcyrious.com/wp-content/uploads/2016/04/Horizontal-Recoil-Tolerance-1024x552.jpg)


There were many hints, starting with the datamined name of this stat, and ending with [this video](https://www.youtube.com/watch?v=60WQ05-vn1g) by Vanu Labs.

However, nobody was able to figure out how to translate the datamined HRT values into what can be seen in game.

# How everybody thinks it works

Let’s take the infamous Gauss SAW as an example:

`Horizontal Recoil: 0.175 / 0.175`

`Horizontal Recoil Tolerance: 0.525`

Instantly it becomes obvious that 0.525 is divisible by 0.175 without residue:

`0.525 / 0.175 = 3`

So the logical conclusion would be that Gauss SAW can kick up to 3 times into one direction, after which Horizontal Recoil Tolerance forces it to bounce in the opposite direction.

But that assumption is wrong. Gauss SAW can only kick up to 2 times in the same direction.

This comes from multiple in-game tests, where I record a high resolution video of firing a weapon, and then watch it frame by frame and document how crosshair moves after each shot.

Here’s an example of such recording:

And here’s the recorded recoil path from that video example:

![Gauss SAW recoil path](http://cmdrcyrious.com/wp-content/uploads/2016/05/full-path.jpg)


You can clearly see that Gauss SAW recoils only up to 2 times in the same direction. More recorded recoil paths:

![SAW HRT no grip](http://cmdrcyrious.com/wp-content/uploads/2016/05/SAW-HRT-no-grip.jpg)


It’s not just Gauss SAW, this is confirmed by testing other weapons as well; they all bounce less than this theory suggests. I have a notebook full of these scribbles:

![manual testing](http://cmdrcyrious.com/wp-content/uploads/2016/05/WP_20160522_02_07_43_Pro-1024x575.jpg)


It’s obvious that the first theory about Horizontal Recoil Tolerance is wrong.

For years nobody was able to offer a correct theory, mostly from lack of interest or necessary knowledge.

In the meantime, the solution is painfully simple, and if not for misleading HRT values, we’d crack that nut much earlier.

# How it actually works

If you imagine HRT as an angle, the center of that angle is the position of your first shot. If the gun recoils left several times and exceeds the left **half of tolerance**, it will be forced to to recoil right at least once.

![HRT explanation](http://cmdrcyrious.com/wp-content/uploads/2016/05/HRT-explanation-1.jpg)


HRT is split in halves by crosshair position of a first shot in a burst, so that’s what we care about – half of tolerance, not the whole value.

If we return to our example with Gauss SAW:

![Gauss Saw Horizontal Recoil Tolerance](http://cmdrcyrious.com/wp-content/uploads/2016/04/h8CgbDf-1.jpg)


![full path - HRT](http://cmdrcyrious.com/wp-content/uploads/2016/05/full-path-HRT.jpg)


Accumulated horizontal recoil from 2 shots of Gauss SAW is equal to 0.35, which is greater than half of tolerance: 0.2625. That is why Gauss SAW can only recoil twice in the same direction.

So the fact that 0.525 can be divided by horizontal recoil without residue has no meaning at all. It’s a nasty coincidence, nothing more.

I have tested and retested this theory many times with at least 12 different weapons, and it remains consistent and predictable.

The possibility that it works somehow differently behind the scenes still exists, but it is small.

The funny part is that HRT could take different values without affecting anything. Gauss SAW could have Tolerance anywhere between 0.36 and 0.69, and the result would be exactly the same – still kick only up to 2 times in the same direction.

![HRT deviation](http://cmdrcyrious.com/wp-content/uploads/2016/05/HRT-deviation.jpg)


This leads to funny and unexpected things. For example:

`T32 Bull: 0.18 / 0.18 Recoil, 0.5 Tolerance`

`T16 Rhino: 0.2 / 0.2 Recoil, 0.7 Tolerance`

`TMG-50: 0.175 / 0.175, 0.7 Tolerance`

T32 Bull has much lower Tolerance than T16 Rhino, yet they both kick up to 2 times in one direction.

TMG-50 has same tolerance as T16 Rhino, but lower Horizontal Recoil, so it kicks up to 3 times in one direction, giving it a wider recoil pattern.

# How HRT can be used

Horizontal Recoil is the most unpredictable and uncontrollable part of the whole recoil system. You can’t compensate for random.

Horizontal Recoil Tolerance brings a piece of order into this chaos. Horizontal Recoil can bounce wildly all it wants, but only within the bounds of HRT.

Knowing how HRT works, you can calculate the width of the recoil pattern: the distance between the extremities of Horizontal Recoil:

![recoil pattern width](http://cmdrcyrious.com/wp-content/uploads/2016/05/recoil-pattern-width-1.jpg)


Notice that Width is always larger than HRT, because Horizontal Recoil can exceed half of HRT once.

## Calculations

First you will have to calculate the maximum amount of horizontal recoil kicks in the same direction:

`N_Kicks = Round_Down ((HRT / 2) / Horizontal Recoil Minimum) + 1`

In other words, to calculate the number of kicks, you have to divide HRT by 2, then divide the result by Minimum Horizontal Recoil, then round the result down, and then increase it by one.

\[spoiler title=”No, you can’t just round the result up instead.”\]

This is easier to explain on an example:

Let’s take Reaper DMR:

`Horizontal Recoil: 0.2 / 0.2`

`Tolerance: 0.4`

`Half of tolerance: 0.2`

Let’s calculate the number of kicks rounding up, instead of rounding down and then adding 1.

`Round_Up(0.2 / 0.2) = Round_Up(1) = 1`

According to these calculations, Reaper DMR should kick only once in the same direction, similarly to Pulsar C.

Let’s test that. Here’s a recorded recoil pattern from in-game testing:

![](http://i.imgur.com/VqKcAkQ.jpg)


As you can see, Reaper DMR can kick up to 2 times in the same direction. This is because accumulated horizontal recoil can be equal to half HRT and still kick further.

In other words, accumulated recoil has to exceed half HRT to be forced to kick back.

\[/spoiler\]

For example:

`T5 AMC`

`Horizontal Recoil: 0.2 / 0.2`

`Horizontal Recoil Tolerance: 0.45`

`HRT / 2 = 0.225`

`0.225 / 0.2 = 1.125`

`Round it down to 1, then increase by 1`

`N_Kicks = 2`

Confirmed by in-game testing.

When you know the maximum amount of kicks, you can calculate the total width of the recoil pattern:

`Width = N_Kicks * Horizontal Recoil Maximum * 2`

For T5 AMC:

`Recoil Pattern Width = 0.2 * 2 * 2 = 0.8 degrees`

This means that as long as target’s [Angular Size](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Angular_Size) is less or equal to 0.8 degrees, you are guaranteed to hit it, from the standpoint of Horizontal Recoil.

# Unexpected implications

*Attention! The following issue was fixed in [7/7/2016 patch](https://forums.daybreakgames.com/ps2/index.php?threads/game-update-7-7.241708/). It no longer works this way!*

As you know, [Forward Grip / Advanced Forward Grip](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Forward_Grip_Advanced_Forward_Grip) reduce both Horizontal Recoil and Tolerance.

But the reduction in recoil is percentage-based, while reduction in Tolerance is a flat amount. So in certain conditions equipping a Forward Grip may increase the number of kicks, and sometimes even **increase the width** of the recoil pattern.

Essentially making it a **downgrade**, making the weapon **worse** at what it’s supposed to make it better.

**[Pulsar C](http://cmdrcyrious.com/planetside2/weapons/carbines/#Pulsar_C)** is the most prominent example of that:

![Pulsar C HRT no Grip](http://cmdrcyrious.com/wp-content/uploads/2016/05/Pulsar-C-HRT-no-Grip.jpg)

![Pulsar C HRT Grip](http://cmdrcyrious.com/wp-content/uploads/2016/05/Pulsar-C-HRT-Grip.jpg)


This is confirmed by in-game testing.

Advanced Forward Grip still reduces horizontal recoil per shot, so in that sense, it will make recoil a bit smoother. But it will be able to bounce in wider bounds, making it less consistent and predictable.

So basically Pulsar C is likely to perform ***better*** at ranged shooting ***without*** Forward Grip. How crazy is that, huh?

This is mostly because of how accurate is Pulsar C by default – it’s one of two weapons that can only kick once in the same direction, with the other gun being Gauss Compact Burst.

There are other weapons affected negatively by Forward Grip, but it’s not as black and white with them.

Let’s use Gauss SAW again:

`Horizontal Recoil: 0.175 / 0.175`

`Horizontal Recoil Tolerance: 0.525`

`Half of tolerance: 0.2625`

`With Advanced Forward Grip:`

`Horizontal Recoil: 0.175 * 0.67 = 0,11725`

`Tolerance: 0.525 - 0.05 = 0.475`

`Half of tolerance: 0.2375`

`Round_Down(0.2625 / 0.175) + 1 = 2`

Without AFG, SAW kicks up to 2 times in the same direction.

`Round_Down(0.2375 / 0.11725) + 1 = 3`

With AFG, it takes 3 horizontal recoil bounces to exceed half of tolerance:

![SAW HRT grip ++](http://cmdrcyrious.com/wp-content/uploads/2016/05/SAW-HRT-grip-.jpg)

![Gauss Saw Horizontal Recoil Tolerance](http://cmdrcyrious.com/wp-content/uploads/2016/04/h8CgbDf-1.jpg)


This is confirmed by in-game testing.

But is it actually a bad thing? If we calculate the width of the recoil pattern in both cases:

`No grip, width = 0.175 * 2 * 2 = 0.7`

`AFG, width = 0.11725 * 3 * 2 = 0.7035`

So the difference in recoil pattern width is negligible, while the reduction in Horizontal Recoil per shot is substantial, which is important for firing in short bursts, which is done a lot with Gauss SAW.

So despite the fact that AFG increases the number of kicks for Gauss SAW, it remains a noticeable upgrade.

## Handout

![sheet](http://cmdrcyrious.com/wp-content/uploads/2016/05/sheet-300x200.jpg)


**[This Excel Spreadsheet](http://cmdrcyrious.com/wp-content/uploads/2016/05/HRT-vs-AFG-FG.xlsx)** contains recoil statistics of 76 automatic and burst weapons, along with calculations for number of kicks, and how they are affected by Forward Grip.

These recoil stats were [pulled from DBG API](https://forums.daybreakgames.com/ps2/index.php?threads/take-off-forward-grip-from-your-pulsar-c-thx-wrel.232007/page-5#post-3265059), which contains their exact values – in DBG database weapon stats often have values like “0,174999999999999”, while in online spreadsheets they are rounded to “0,175”.

This kind of imprecision can be crucial in calculating the number of bounces.

According to my calculations, Forward Grip / Advanced Forward Grip increases the number of kicks and width of the recoil pattern by a noticeable amount for these weapons:

- Orion VS54
- VX29 Polaris
- T9 CARV S
- TAR
- Equinox VE2
- Pulsar C

Forward Grip ***should not be used*** with these weapons. Outside of short bursting of 2-3 rounds, it will only make things worse.

There is also a category of weapons where Forward Grip increases the amount of kicks, but the increase to width of the recoil pattern is negligible, and Forward Grip largely remains an upgrade for them:

- NC6 Gauss SAW
- Carnage AR
- Corvus VA55

Finally, we have AF-4 Cyclone. Its horizontal recoil varies by a great amount, so Forward Grip will sometimes increase the number of kicks, and sometimes it won’t.

Overall, I don’t recommend using Forward Grips on SMGs, but for [other reasons](http://cmdrcyrious.com/planetside2/weapons/smgs/#Attachments).

# Conclusion

Horizontal Recoil Tolerance remained a blind spot of PS2 weapon community for a long time, and I’m happy to finally shed some light on it.

There is still much to do in theorycrafting of PlanetSide 2, but now we finally can predict a weapon’s recoil pattern just from its stats.

Please feel free to comment me with any questions regarding PS2 weapon mechanics.
