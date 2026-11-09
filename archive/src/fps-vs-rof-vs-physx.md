# FPS vs RoF vs PhysX

- **Source (live):** https://cmdrcyrious.com/fps-vs-rof-vs-physx/ — live copy returns HTTP 200 but its static HTML contains no article body (verified 2026-11-09); content below is from the Wayback Machine.
- **Source (archived):** http://web.archive.org/web/20230519114414/http://cmdrcyrious.com/fps-vs-rof-vs-physx/
- **Snapshot date:** 20230519114414
- **Saved:** 2026-11-09
- **Raw HTML (archived):** `raw/wayback__fps-vs-rof-vs-physx.html`
- **Raw HTML (live, empty body):** `raw/fps-vs-rof-vs-physx.html`

---

---
title: FPS vs RoF vs PhysX
author: CMDRCyrious
url: http://cmdrcyrious.com/fps-vs-rof-vs-physx/
hostname: cmdrcyrious.com
description: It's a well-established fact that Rate of Fire of PlanetSide 2 infantry weapons will vary depending on player's framerate, getting especially bad when being GPU-bound at low framerate. A fellow redditor alluded that this may be potentially caused by PhysX somehow being tied to weapon mechanics, an
sitename: CMDRCyrious.com
date: "2018-06-30"
categories: ['PlanetSide 2']
tags: ["A Newbie's Experience", 'API', 'beginner', 'calculator', 'combat medic', 'comparison', 'construction system', 'guest post', 'guide', 'heavy assault', 'highly technical', 'implant', 'infantry', 'infiltrator', 'Light Assault', 'LMG', 'loadout', 'mechancis', 'mechanic', 'mechanics', 'New Conglomerate', 'NSX', 'PC Building', 'performance', 'repost', 'rocket launchers', 'SMG', 'stalker', 'suggestion', 'Terran Republic', 'tool', 'Vanu Sovreignty', 'Video', 'weapon', 'Weapon Calculator', 'XCOM 2']
fingerprint: "88c01dc68f3696b7"
---
It’s a **[well-established fact](http://cmdrcyrious.com/rate-of-fire-vs-framerate/)** that Rate of Fire of PlanetSide 2 infantry weapons will vary depending on player’s framerate, getting especially bad when being GPU-bound at low framerate.

**[A fellow redditor alluded](https://www.reddit.com/r/Planetside/comments/8ogu92/planetside_2_gameplay_with_ryzen_2400g_let_me/e03tbfh/)** that this may be potentially caused by PhysX somehow being tied to weapon mechanics, and PhysX does run on GPU by default.

So I decided to run a series of tests to determine whether forcing PhysX to run on CPU fixes the problem. Too long, didn’t read – it doesn’t.

|  | **FPS** | **Time, sec** | 
| **Expected values** |  | 8.68 | 
| **PhysX on GPU (Auto)** |  |  | 
| **Uncapped FPS** | \~175 | 9.176 (94.6%) | 
| **GPU Bound** | \~54 | 10.81 (80.3%) | 
| **FPS Cap** | \~59 | 8.98 (96.7%) | 
| **PhysX on CPU** |  |  | 
| **Uncapped FPS** | \~185 | 9.19 (94.5%) | 
| **GPU Bound** | \~56 | 10.71 (81%) | 
| **FPS Cap** | \~59 | 9.03 (96.1%) | 
| **Uncapped FPS,  CPU @ 1200 MHz** | \~60 | 10.18 (85.3%) | 

I’ve used Shadowplay and Sony Vegas to record and measure how long it takes to fire one 125 round magazine from Watchman. I’ve ran multiple tests, using [**these settings**](http://cmdrcyrious.com/wp-content/uploads/2018/06/settings.png) in all cases.

GPU Bound refers to setting Render Quality to 2.0 in UserOptions.ini. This forces the game to render at quadruple resolution, significantly increasing the load on the Graphics Card.

FPS Cap refers to setting MaximumFPS to 60 in UserOptions.ini. In my previous tests, this provided the best results in fixing the FPS vs RoF problem.

For one final test, I set the frequency of my Core i5 7600k to 1200 MHz to emulate a weak PC and create a CPU-bound scenario.

As you can see from the numbers, it doesn’t matter whether you run PhysX on CPU or GPU.
