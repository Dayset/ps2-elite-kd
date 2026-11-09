# Laggy Animations vs ADAD Spam

- **Source:** https://cmdrcyrious.com/laggy-animations-vs-adad-spam/
- **Saved:** 2026-11-09
- **Status:** live, HTTP 200
- **Raw HTML:** `raw/laggy-animations-vs-adad-spam.html`
- **Extraction:** trafilatura

---

---
title: Laggy Animations vs ADAD Spam | CMDRCyrious.com
author: CMDRCyrious
url: https://cmdrcyrious.com/laggy-animations-vs-adad-spam/
hostname: cmdrcyrious.com
description: Enemy movement sometimes gets jerky in big battles, and there is also a known phenomenon known as "ADAD Warping". In this article I set out to test if they are connected.
sitename: CMDRCyrious.com | Take your gaming Cyriously!
date: "2018-02-24"
categories: ['PlanetSide 2, mechanic']
tags: ['mechanic', "A Newbie's Experience", 'API', 'beginner', 'calculator', 'combat medic', 'comparison', 'construction system', 'guest post', 'guide', 'heavy assault', 'highly technical', 'implant', 'infantry', 'infiltrator', 'Light Assault', 'LMG', 'loadout', 'mechancis', 'mechanics', 'New Conglomerate', 'NSX', 'PC Building', 'performance', 'repost', 'rocket launchers', 'SMG', 'stalker', 'suggestion', 'Terran Republic', 'tool', 'Vanu Sovreignty', 'Video', 'weapon', 'Weapon Calculator', 'XCOM 2']
fingerprint: "7c50b581e030de72"
---
Some of you may have noticed that enemy movement gets kinda jerky in big battles. This is especially annoying when you’re trying to hit headshots, and have enemy’s head jerk out right from under your crosshair.

There is also a known phenomenon known as “**ADAD Warping**“, which happens when the enemy rapidly switches strafing direction in a firefight, and their player models appears to be teleporting left and right rather than smoothly walking.

During my recent tests on the subject of [**Rate of Fire vs Framerate**](http://cmdrcyrious.com/rate-of-fire-vs-framerate/), I discovered a reliable way to trigger laggy animations – reduce the number of active cores. If you have a CPU that can work only on 4 threads or less at the same time, you may get laggy animations in big battles, or when you a lot of background processes running. However, reducing the number of active CPU cores to 1 allows to reliably trigger laggy animations at all times, even if you’ll still have acceptable framerate.

So I developed a theory that laggy animations could have something to do with warping, and performed a simple test – asked a friend to ADAD while I was recording with 1 active core, and with all 4.

To exclude the possibility of recording having an impact on the PC, I had to use my shitty phone to record the video, so pardon the quality.

The video shows an interesting thing. Even with laggy animations, enemy’s *position* in the world changes smoothly. However, enemy’s player *model* is jerking and twitching. Landing headshots on such a derpy hitbox would be impossible.

It seems the ADAD Warping is caused by server lag after all. But jerky animations are a problem nonetheless, and to avoid being affected by it:

- Disable as many background processes and services as possible before launching the game. Consider using [**Razer Gamebooster**](https://www2.razerzone.com/cortex/boost) if you don’t know how to do that.
- Upgrade your CPU to something with more cores in it, giving preference to CPUs with Hyper Threading or SMT technology – it’s [**been confirmed**](https://www.reddit.com/r/Planetside/comments/7zvsf8/test_laggy_animations_vs_adad_spam/dus6sc8/) they solve this issue for the most part.
- In big battles shoot for enemy’s center mass instead of head.
- If all else fails, avoid big battles.

I think the biggest concern to most is facing laggy players, not lagging themselves. How would it be if someone recorded you ADADing with only one core active? I’m on Discord if you want someone to record goaten#1214

I have two PCs, so I can handle it. I doubt having one core active will change how movement is sent, but I’m going to be running a CPU-bound test anyway, so may as well take a look at that.

I ran the test, and as expected being CPU bound on my PC didn’t change how my movement is perceived on other PCs. However, I vaguely recall that during my previous tests while I was using only one core at 1200 MHz I saw “Connection Quality: Bad” warning, so maybe if the CPU is extremely weak that’ll interfere with PC’s ability to effectively communicate within the network, and that can potentially appear as warping to enemies.

It’s hard to call an advantage because at that point you’re literally playing at 20 FPS in Warpgate.
