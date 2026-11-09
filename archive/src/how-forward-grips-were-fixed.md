# How Forward Grips were fixed

- **Source:** https://cmdrcyrious.com/how-forward-grips-were-fixed/
- **Saved:** 2026-11-09
- **Status:** live, HTTP 200
- **Raw HTML:** `raw/how-forward-grips-were-fixed.html`
- **Extraction:** trafilatura

---

---
title: How Forward Grips were fixed | CMDRCyrious.com
author: CMDRCyrious
url: https://cmdrcyrious.com/how-forward-grips-were-fixed/
hostname: cmdrcyrious.com
description: In the patch that came live on 7/7/2016, Forward Grips were fixed:"Fixed an error where some Forward Grips would incorrectly increase the number of horizontal "kicks" in one direction"I'd like to take a moment to explain what exactly has changed.How it worked beforePreviously, Forward Grips reduced Horizontal Recoil by a percent, and Horizontal Recoil Tolerance
sitename: CMDRCyrious.com | Take your gaming Cyriously!
date: "2016-07-08"
categories: ['PlanetSide 2, mechanics']
tags: ['mechanics', "A Newbie's Experience", 'API', 'beginner', 'calculator', 'combat medic', 'comparison', 'construction system', 'guest post', 'guide', 'heavy assault', 'highly technical', 'implant', 'infantry', 'infiltrator', 'Light Assault', 'LMG', 'loadout', 'mechancis', 'mechanic', 'New Conglomerate', 'NSX', 'PC Building', 'performance', 'repost', 'rocket launchers', 'SMG', 'stalker', 'suggestion', 'Terran Republic', 'tool', 'Vanu Sovreignty', 'Video', 'weapon', 'Weapon Calculator', 'XCOM 2']
fingerprint: "975bc3f59336b54b"
---
In the [patch](https://forums.daybreakgames.com/ps2/index.php?threads/game-update-7-7.241708/) that came live on 7/7/2016, Forward Grips were fixed:

- “Fixed an error where some Forward Grips would incorrectly increase the number of horizontal “kicks” in one direction”


I’d like to take a moment to explain what exactly has changed.

# How it worked before

Previously, Forward Grips reduced Horizontal Recoil by a percent, and Horizontal Recoil Tolerance by a flat amount.

For example, standard Forward Grip would reduce Horizontal Recoil by 25% and Tolerance by 0.05 degrees.

[In case of some weapons](http://cmdrcyrious.com/horizontal-recoil-tolerance/#Unexpected_implications), it could result in increasing the maximum number of horizontal recoil kicks in one direction, and increase the width of the recoil pattern (all pictures are clickable):

![Pulsar C recoil comparison - side by side](http://cmdrcyrious.com/wp-content/uploads/2016/07/Pulsar-C-old-1024x831.png)

Pulsar C recoil comparison – side by side

![Pulsar C recoil comparison - overlay](http://cmdrcyrious.com/wp-content/uploads/2016/07/Pulsar-C-old-2.png)

Pulsar C recoil comparison – overlayed

The problem was occurring in this equation:

![formula 1](http://cmdrcyrious.com/wp-content/uploads/2016/07/formula-1.jpg)


Number of kicks, “N\_Kicks” is important for calculating the width of the recoil pattern:

`Width = N`<sub>kicks</sub> \* Horizontal Recoil Maximum \* 2

So the problem was that HRT and Horizontal Recoil Minimum got affected in a different way. HRT was reduced by a flat amount, and Horizontal Recoil by a percentage multiplier:

![formula 2](http://cmdrcyrious.com/wp-content/uploads/2016/07/formula-2.jpg)


In certain combination of variables, that would cause recoil to have an extra kick, which increased the width of the recoil pattern.

# How it works now

Now Forward Grips reduce both Horizontal Recoil and Tolerance by the same percent.

![formula 3](http://cmdrcyrious.com/wp-content/uploads/2016/07/formula-3.jpg)


Since HRT and Horizontal Recoil Minimum are separated from each other by the fraction sign, the X multipliers from the Forward Grip cancel each other out, and Forward Grip cannot possibly have any effect on the number of kicks:

![formula 1](http://cmdrcyrious.com/wp-content/uploads/2016/07/formula-1.jpg)


![Pulsar C recoil comparison - side by side](http://cmdrcyrious.com/wp-content/uploads/2016/07/Pulsar-C-new.png)

Pulsar C recoil comparison – side by side

![Pulsar C recoil comparison - overlayed](http://cmdrcyrious.com/wp-content/uploads/2016/07/Pulsar-C-new-2-1024x611.png)

Pulsar C recoil comparison – overlayed

For vast majority of weapons, Forward Grip did no cause any issues, but there were 5-6 weapons where Forward Grip could actually reduce their horizontal stability – basically doing the opposite of what it’s supposed to.

With these changes, Forward Grip will always correctly reduce the total width of the recoil pattern.

You can expect updated version of the Weapon Simulator to release soon, reflecting these changes.
