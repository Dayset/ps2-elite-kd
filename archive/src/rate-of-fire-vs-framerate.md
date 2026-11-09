# Rate of Fire vs Framerate

- **Source:** https://cmdrcyrious.com/rate-of-fire-vs-framerate/
- **Saved:** 2026-11-09
- **Status:** live, HTTP 200
- **Raw HTML:** `raw/rate-of-fire-vs-framerate.html`
- **Extraction:** trafilatura

---

---
title: Rate of Fire vs Framerate | CMDRCyrious.com
author: CMDRCyrious
url: https://cmdrcyrious.com/rate-of-fire-vs-framerate/
hostname: cmdrcyrious.com
description: It is known Rate of Fire of PlanetSide 2 weapons depends on your PC's performance, so I decided to run a few tests of my own.
sitename: CMDRCyrious.com | Take your gaming Cyriously!
date: "2018-02-23"
categories: ['PlanetSide 2, mechanics, performance']
tags: ['mechanics', 'performance', "A Newbie's Experience", 'API', 'beginner', 'calculator', 'combat medic', 'comparison', 'construction system', 'guest post', 'guide', 'heavy assault', 'highly technical', 'implant', 'infantry', 'infiltrator', 'Light Assault', 'LMG', 'loadout', 'mechancis', 'mechanic', 'New Conglomerate', 'NSX', 'PC Building', 'repost', 'rocket launchers', 'SMG', 'stalker', 'suggestion', 'Terran Republic', 'tool', 'Vanu Sovreignty', 'Video', 'weapon', 'Weapon Calculator', 'XCOM 2']
fingerprint: "27753dc672578fb7"
---
It’s a somewhat widely known phenomenon that the Rate of Fire of PlanetSide 2 weapons depends on your PC’s performance. Getting killed because your PC lags too much is bad enough, but dying because your gun literally shoots slower than the other guys’ is just horrible.

Unfortunately, this seems to be the limitation of PlanetSide 2’s engine, and there’s not much the current development team can do to fix it.

There is a lot of drama revolving around this issue, and there seems to be a lot of myths or unclear information, so I decided to run my own set of tests to find out what exactly causes the reduction in Rate of Fire, and how strong this effect is.

Usually game’s performance is bottlenecked either by CPU or GPU (Graphics Card). I wanted to figure out which of the two causes Rate of Fire issues.

# GPU Bound Results

| **Weapon** | **Settings** | **FPS Cap** | **FPS** | **Time, sec** | **Expected Time** | 
| **EM6** (600 RPM) | Very Low | Uncapped | \~200 | \~20.3 (98%) | 19.9 | 
|  | Usual Settings | Uncapped | \~180 | \~20.7 (96%) |  | 
|  |  | RTSS FPS Limiter = 120 | 120 | \~21.2 (94%) |  | 
|  |  | RTSS FPS Limiter = 150 | 150 | \~21 (95%) |  | 
|  |  | Smoothing | \~120 | \~20.3 (98%) |  | 
|  | RQ = 1.41 | Uncapped | \~100 | \~21.6 (92%) |  | 
|  | RQ = 2.0 | Uncapped | \~50 | \~23.1 (86%) |  | 
| **M18 Rotary** (1000 RPM) |  | Uncapped | \~60 | \~3.6 | 3.54 | 
|  |  | RTSS FPS Limiter = 30 | 30 | \~3.6 |  | 
| **Kobalt** (Sunderer) (550 RPM) |  | Uncapped | \~50 | \~16.3 | 16.25 | 
|  |  | RTSS FPS Limiter = 30 | 30 | \~16.3 |  | 
| **EM6** (600 RPM) |  | MaximumFPS = 45 | 43 | \~20.3 (98%) | 19.9 | 
|  |  | RTSS FPS Limiter = 45 | 45 | \~24.1 (83%) |  | 
|  |  | Smoothing | \~54 | \~21.5 (93%) |  | 
| **Gauss SAW** (500 RPM) |  | Uncapped | \~50 | \~13.7 (87%) | 11.88 | 
| **Watchman** (857 RPM) |  | Uncapped |  | \~10.9 (80%) | 8.68 | 
|  |  | RTSS FPS Limiter = 30 | 30 | \~12.6 (69%) |  | 

For most of my tests I used **EM6** with Extended Mags. It has convenient 600 RoF, which means the time period between two shots should be equal to 0.1 seconds. There are 199 time periods between 200 shots, so firing them should take 19.9 seconds.

To establish some baselines, first I recorded the time to empty a magazine using my [**Usual Settings**](https://pastebin.com/9LFgLqAy), and then with all settings set to **Very Low**. In both cases I wasn’t capping FPS in any way, and RoF was close to expected values.

**Test methodology:** I went to Koltyr, stepped outside of the spawn building, and fired at full auto. I recorded using my shitty phone, as I wanted to avoid any potential impact from my own PC. I kinda forgot to disable Shadowplay’s background recording, though. I ran each test only once, and it’s possible the results would be inconsistent.


Then I used RTSS to cap FPS at 120, and then at 150. In both cases there was a negative impact to Rate of Fire.

Then I enabled Smoothing, which caps FPS at your monitor’s Refresh Rate. In my case, this is 120 Hz. That fixed the Rate of Fire issues.

Then I created a GPU-bound scenario by increasing **Render Quality** to 1.41, making the game render at double resolution, putting a lot of raw workload on my GTX 1060 3 GB. This had a noticeable negative impact to Rate of Fire.

Then I made GPU-bound situation more severe by increasing Render Quality to 2.0, making the game render at quadruple resolution. That reduced RoF even further, and introduced some horrible **Input Lag**.

Thanks to [**/u/Octiceps**](https://www.reddit.com/r/Planetside/comments/7e7mbr/tweak_guide_for_reducing_input_lag_in_planetside_2/), we know that being GPU bound causes **Input Lag**, and indeed, it felt like an eternity would pass between moving the mouse and seeing the crosshair move on screen. According to my measurements, the delay was around 0.1 seconds, but it felt much longer, and the game would definitely be unplayable.


Capping the FPS by any means should remove the Input Lag. First I used **RTSS** to cap FPS at 45. That removed Input Lag, but impacted Rate of Fire even further.

Then I set an FPS limit through **UserOptions.ini** by setting **MaximumFPS** to 45. That removed Input Lag and solved the Rate of Fire issues.

Note that according to Octiceps, using MaximumFPS to cap FPS still adds some Input Lag, but it seems miles better than being GPU bound, and I couldn’t feel any during my short tests.


I also ran a test with Smoothing enabled while GPU bound. In this case having an FPS cap at 120 should not have affected anything, but it’s possible that Smoothing actually does something else behind the scenes. And indeed the RoF impact was lower than while simply being GPU-bound, but it’s possible this was just a statistical margin of error. Since I’m lazy and ran each test only once, there’s no way to tell.

Finally, I wanted to test whether low RoF or high RoF weapons are more affected, so I removed the FPS Cap and ran tests with 500 RPM **Gauss SAW** and 857 RPM **Watchman**. As you can see from the results, the impact to higher RoF Watchman was nearly double.

Per [**/u/Punisherlceman’s suggestion**](https://www.reddit.com/r/Planetside/comments/7zrgmi/test_rate_of_fire_vs_framerate/dur48ls/), I ran tests with a couple of vehicle weapons, and surprisingly they seem to be unaffected by this issue at all. Even when I used RTSS to limit FPS at 30, which made the Watchman fire at 69% of its intended Rate of Fire.

# CPU Bound Results

| **Weapon** | **Settings** | **FPS** | **Time, sec** | **Expected Time** | 
| **EM6** (600 RPM) | 1 Core, 1200 MHz | \~25 | \~24.4 sec (82%) | 19.9 | 
|  | 4 Cores, 1200 MHz | \~65 | \~21.8 sec (91%) |  | 
|  | 1 Core, 4500 MHz | \~120 | \~20.6 sec (97%) |  | 

My CPU is Core i5 7600k. To create a CPU-bound scenario, I went to BIOS and manually reduced its maximum multiplier to 12 and disabled 3 of the 4 cores, as well as reduced memory frequency to 2133 MHz.

For the test I set all settings to Very Low to make sure the FPS is not GPU-bound.

It didn’t feel like there’s any Input Lag, but all animations would play at super low FPS, the famous “[**Doom Animations**](https://clips.twitch.tv/SingleEsteemedSlothEagleEye)“.

There was a significant impact to Rate of Fire. Then I increased the number of active cores to 4, and impact to RoF was not as huge, but it was still there. “Doom Animations” went away as the number of cores increased, so we can conclude that laggy animations happen when the CPU cannot handle several threads at the same time.

Normally my CPU runs at 4500 MHz, and RAM at 3000 MHz, so I went back to these settings, but once again left only one active core. I would still get laggy animations, but negative impact to RoF all but evaporated.

During these tests the PlanetSide’s FPS counter was showing \[GPU\] half the time, in a situation where being GPU-bound is practically impossible, which just goes to show that indicator cannot be trusted.

It’s worth noting that while CPU-bound, the framarate fluctuated like crazy.


# Second PC Results

| **Weapon** | **Settings** | **FPS** | **Time, sec** | **Expected Time** | 
| **EM6** (600 RPM) | Low Settings, Uncapped FPS | \~65 | \~21 sec (95%) | 20 | 
|  | High Settings, Uncapped FPS | \~38 | \~20.8 sec (95%) |  | 
|  | Low Settings, Capped FPS | 53 | \~20.5 (98%) |  | 

I ran one more round of tests on my brother’s PC, who’s using entry-level Ryzen R3 1200, overclocked to 3.8 or 3.9 GHz, and an obsolete HD5770, middle of the road graphics card from 2009.

- “Low Settings” = Very Low preset with Ultra Textures.
- “High Settings” = Ultra Preset with Shadows Disabled.
- Render Distance of 800m and FullHD resolution in both cases.

Similar to before, there was considerable Input Lag while GPU-bound with uncapped FPS. Using MaximumFPS in UserOptions.ini to cap FPS at 55 removed Input Lag and mostly solved RoF issues.

It’s interesting to note that even in worst case scenario RoF impact was not as severe as on my machine.

# Conclusions

- Rate of Fire is reduced when you are:
  - GPU-bound at low FPS.
  - Using RTSS to cap FPS.
  - CPU-bound by frequency.
- It’s possible to have reduced RoF without any Input Lag.
- You don’t need high FPS to fire at nearly full RoF.
- RoF issues can be solved by:
  - Having very high FPS.
  - Setting an FPS Cap through MaximumFPS in UserOptions.ini just below your usual FPS.
  - Using Smoothing if your FPS is usually above your monitor’s Refresh Rate.
  - Preferring weapons with low Rate of Fire.

This set of tests is not intended as the last word on this topic, I mainly just wanted to see the problem with my own eyes and confirm tests done [**/u/ChasseurDePorcinet and /u/Datnade**](https://www.reddit.com/r/Planetside/comments/5meifs/fps_affecting_rof_in_ps2_2017/dc3chq5/), and [**/u/Ahorns**](https://www.reddit.com/r/Planetside/comments/7qva5v/rpm_vs_fps_test_2_it_is_not_tied_to_fps_but_gpu/), as well as rule out Input Lag as the primary cause.

I’ve been using RTSS for a while at 90 fps so I was alarmed and ran some tests : I got an average of 21.74 time to empty the EM6 which is 92% rof.

Using smoothing is out of the question since my pc certainly can’t handle 144+ fps in PS2 at all times and the point of capping in the first place is to have stable frametimes.

I switched to the MaximumFPS solution, and my frametimes were jittery and induced stuttering exactly like what that guy had https://old.reddit.com/r/Planetside/comments/bhypyz/your\_game\_stutters\_a\_lot\_try\_rtss\_to\_get/ and in short the game was absolutely unplayable.

A comment in the reddit thread suggested that you could have the best of both worlds by using both rtss and MaximumFPS, but in my tests, whatever MaximumFPS was set to : 250, 93, 91, the rof stayed at 92%.

So my conclusion is this : if MaximumFPS introduces jittery frametime and stuttering for you (I’d be interested to know if it happens for everyone) and if your monitor has a refresh rate far above what PS2 can run at which is most 120+hz owners since PS2 runs like shit in big fights, then your only choice is to use RTSS and suffer from the slight handicap that reduced rof will bring.

Good stuff as always 🙂

Here some more helpful info (especially for G-Sync users): http://www.blurbusters.com/gsync/gsync101/

e.g. comparison between ingame and external framerate limiters: https://www.blurbusters.com/gsync/gsync101-input-lag-tests-and-settings/11/

Optimal settings: https://www.blurbusters.com/gsync/gsync101-input-lag-tests-and-settings/14/

Sadly PlanetSide (or the Forgelight Engine in general) is one ofthe rare occasions, where RTSS isn’t the best limiter to reduce input lag, but instead also doesn’t help with the ROF issue.
