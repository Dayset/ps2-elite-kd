# CMDRCyrious / Iridar PlanetSide 2 Knowledge Archive

**What this is.** A local preservation archive of the PlanetSide 2 knowledge base that
CMDRCyrious hosted at cmdrcyrious.com — above all, Iridar's work: the Weapon Mechanics
guide, the Construction System guide, the "Highly Technical" analysis method, the Weapon
Analysis Toolbox, and the videos. CMDRCyrious spent years hosting and preserving Iridar's
guides, tools, and videos; this archive takes over that role. We are the knowledge
database now.

**Why it was built, and why now.** The data is vanishing while we watch. On 2026-11-09,
when this archive was made, the live site still answered HTTP 200 for every page — but
**64 of its 159 pages served no article body at all** in their static HTML: navigation
shell, empty content. The loss is already in progress, not a future risk. Of those 64,
51 were recovered from the Wayback Machine and 1 (Weapon Mechanics) was already held as
a 2023 snapshot; 12 pages have no Wayback snapshot anywhere and their text is lost.
That is the state of the record as of 2026-11-09, and the reason this archive exists.

**Who this is for.** Someone looking for this information 10 years from now. Every entry
below is written to stand on its own: original author and date, source URL, snapshot or
archive date, what the item is, its lineage (who built on whom), and its currency status
— still working, outdated, dead, or lost — with the verification date where one is known.
No entry assumes you were here when it was made.

**Archive date:** 2026-11-09. **Location:** `~/workspace/cmdrcyrious-archive/`.
**Contents:** 163 markdown files (~364,000 words), raw HTML for every page, the Toolbox
spreadsheet, and the Halospud Google Docs as plain text. Nothing here was republished or
uploaded anywhere; this is a local archive only.

---

## How to read the currency statuses

| Mark | Meaning |
|---|---|
| ✅ VERIFIED WORKING (2026) | Checked in the live game by Dayset in 2026. The one hard currency fact in this archive. |
| 🕰️ METHOD TIMELESS, DATA DATED | The math and mechanics still hold; the weapon numbers are from the stated year. |
| ⚠️ LARGELY OUTDATED | The game systems described have changed since; the exceptions that still work are named. |
| 💀 DEAD (kept for history) | The research or method was disproven — by its own author, or by later measurement. Kept because the correction is part of the story. |
| ❌ LOST | The text is unrecoverable: the live copy is empty and no Wayback snapshot exists. What remains is noted honestly. |
| ⏳ PENDING | Not yet captured when this archive was made. The URL and the reason are recorded so a later reader can try again. |

---

## Lineage — who built on whom

The whole collection is one chain, and the chain is the point:

1. **Iridar (2016–2018)** wrote the Weapon Mechanics guide, the Construction System
   guide, the "Highly Technical" analysis method, the Weapon Analysis Toolbox
   spreadsheet, and the angular-size research. He also made the videos.
2. **CMDRCyrious** hosted and preserved Iridar's work on cmdrcyrious.com — guides,
   Toolbox, videos, the Weapon Simulator — and added his own highly-technical weapon
   guides, mechanics explainers (recoil recovery delay, horizontal recoil tolerance),
   and calculators on top of it.
3. **Halospud** wrote the Infantry Guide (Shooting Mechanics, Movement Tricks) that
   CMDRCyrious linked from his infantry-guides page; it credits Iridar and teaches
   the movement layer Iridar's numbers don't cover.
4. **EmperorDorf (2022–2023)** built the Weapon Surgeon simulator on Iridar's Toolbox
   stats — his stats page *is* Iridar's Toolbox data. His projectile-radius finding
   (0.03 m) then corrected Iridar's angular-size research, closing the exact in-game
   vs model gap Iridar himself had found and published in 2017.
5. **This archive (2026-11-09)** takes over CMDRCyrious's preservation role, because
   the live site is already losing pages.

The angular-size correction deserves its own line, because it runs through the whole
collection: Iridar's angular-size research predicted headshot rates from target angular
size. In 2017 he tested it himself in VR (Eridani) and found 57% headshots observed
against 44% predicted. In that same Reddit thread, u/BoatsFriends proposed the
projectile-size hypothesis; Iridar confirmed a large bullet hitbox. In 2023 Dorf
quantified it: a 0.03 m projectile radius reproduces Iridar's 43%/57% numbers exactly.
Anything in this archive built on angular size — the Toolbox CoF page's effective-range
function, the Weapon Simulator's target scaling, the CoF analysis in the Toolbox
Spotlight video — is dead for that reason, and is marked so. The replacement is Dorf's
method: simulate with a 0.03 m projectile radius.

---

## Part 1 — The Iridar core

These seven items are the core of the archive. Everything else supports them.

### 1. PlanetSide 2 Weapon Mechanics (the guide)

- **Author:** Iridar (Institoros). **Date:** 2016-04-25.
- **Original:** https://iridar.net/ (mirrored at https://iridar-mirror.knyazev.io/) and
  https://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/
- **What it is:** The complete guide to how PlanetSide 2 weapons work: cone of fire
  (including the stance-change rules — the minimum/maximum CoF rules behind the
  ideal-ADAD derivation), recoil, bloom and recovery, damage calculation, attachments.
  The single most important document in this archive.
- **Archive files:** `pages/planetside2__weapons__weapon-mechanics.md` (11,249 words),
  `raw/wayback__planetside2__weapons__weapon-mechanics.html` (Wayback snapshot
  2023-05-19) and `raw/planetside2__weapons__weapon-mechanics.html` (live copy).
- **Lineage:** Iridar's guide, hosted by CMDRCyrious. Dorf's Weapon Surgeon and the
  ideal-ADAD rhythm both derive from its CoF rules.
- **Currency:** 🕰️ METHOD TIMELESS, DATA DATED. The CoF, recoil, bloom, and recovery
  mechanics are game constants. Weapon-stat examples are from 2016. The
  effective-range material built on angular size is 💀 DEAD (see Lineage above).

### 2. Construction System Guide

- **Author:** Iridar. **Date:** 2018 (snapshot 2018-08-01).
- **Original:** https://iridar.net/construction-system-guide/
- **What it is:** The full construction guide: modules, the core, placement, and the
  preview-placement trick.
- **Archive files:** three copies — `pages/wayback__iridar__construction-system-guide.md`
  (6,722 words, Wayback snapshot 2018-08-01),
  `pages/mirror__iridar__construction-system-guide.md` (7,127 words, live mirror
  iridar-mirror.knyazev.io), and `pages/construction-system-guide.md` (the CMDRCyrious
  repost, live copy, HTTP 200).
- **Lineage:** Iridar's guide, mirrored and reposted by CMDRCyrious.
- **Currency:** ⚠️ LARGELY OUTDATED (verified 2026-11-09, Dayset). Construction has
  changed heavily since 2018: the modules are gone (replaced by something else), the
  core is gone, many things changed. Do not treat module/core details as current.
  **Exception — ✅ VERIFIED WORKING (2026):** the preview-placement trick (Ctrl+F11 to
  hide the weapon + E to place without starting construction) still works in 2026.

### 3. "Highly Technical: How to analyze a weapon"

- **Author:** CMDRCyrious (Iridar's method). **Date:** 2017-07-03.
- **Original:** https://cmdrcyrious.com/highly-technical-how-to-analyze-a-weapon/
- **What it is:** The method paper: which weapon stats to look at to properly analyze
  a weapon — CoF bloom three ways (per shot, per second, per point of damage), CoF
  recovery, initial accuracy, ADS speed as a survival trait. Worked comparison:
  NSX Tanto vs NS-11C (including the note that with the NS-11C you can start moving
  after 5 shots with no accuracy penalty).
- **Archive files:** `pages/highly-technical-how-to-analyze-a-weapon.md` (2,969 words).
  The live copy is empty; the content is from a Wayback snapshot (2023-05-19).
- **Lineage:** The method behind the Toolbox; the CoF-bloom-per-damage idea is what
  makes burst-fire need comparable across weapons.
- **Currency:** 🕰️ METHOD TIMELESS, DATA DATED. The Effective Range section is
  💀 DEAD (it depended on the angular-size research). Everything else in it is
  mechanics, not numbers.

### 4. Iridar's Weapon Analysis Toolbox (spreadsheet, v6h)

- **Author:** Iridar. **File date:** 2018-08-19.
- **Original:** http://cmdrcyrious.com/wp-content/uploads/2016/12/Iridars-Toolbox-v6h.zip
- **What it is:** The Toolbox itself: 10 sheets (Stats, Damage, Resistances, Built In
  Resistances, Cone of Fire, Recoil, Attachments, Categories, Implants, Temp). Per-weapon
  damage, CoF per stance, bloom, recoil statistics, Monte Carlo horizontal deviation.
  194 weapons.
- **Archive files:** `Iridars-Toolbox-v6h.zip` (414 KB, verified Zip archive).
- **Lineage:** Iridar's tool, hosted by CMDRCyrious. Dorf's Weapon Surgeon stats page
  is this data. The Ideal ADAD Calculator (a separate 2026 artifact, not in this
  archive) computes its still-shot counts from this sheet.
- **Currency:** 🕰️ METHOD TIMELESS, DATA DATED (2018 — old Nanoweave, pre-rebalance
  weapon stats). The CoF page's effective-range function was already stripped in v4f
  as "more or less pointless" after angular size died. The Stats sheet does not store
  Maximum CoF per stance — that number is missing everywhere in this collection.

### 5. "Weapon Analysis Toolbox Spotlight" (video)

- **Author:** Iridar (YouTube channel @Iridar51).
- **Original:** https://www.youtube.com/watch?v=Njd4iKRLS6s
- **What it is:** A walkthrough of the Toolbox: loading a weapon, the analysis pages.
  Gauss SAW vs Nanoweave TTK; HVA effects on damage ranges and kill thresholds
  (Pulsar C as the case where HVA matters more); the Recoil page and horizontal
  deviation (Pulsar C's exceptionally low deviation vs the Cyclone); CoF-based
  effective ranges; Cyclone vs Armistice, including the famous Cyclone 3-headshot kill.
  The video's stated purpose is not balance argument — it is a practical tour of the
  tool's features.
- **Archive files:** No video file is stored (see Method notes). This entry is the
  record: title and channel confirmed via YouTube oEmbed 2026-11-09; the content
  summary above is Dayset's own summary of the video.
- **Currency:** ⚠️ MIXED. The CoF analysis in the video is 💀 DEAD by the author's own
  warning (based on the incorrect angular-size research). The rest is a 2017-era
  feature walkthrough of the tool. Transcript unavailable (YouTube rate-limited the
  fetch, HTTP 429).

### 6. Angular Size testing post (Reddit)

- **Author:** Iridar (u/Iridar51). **Date:** September 2017.
- **Original:** https://www.reddit.com/r/Planetside/comments/6z5uax/results_of_the_testing_related_to_my_angular_size/
- **What it is:** "Results of the testing related to my Angular Size [research]". The
  post where Iridar published his own debunk: the Eridani VR test gave 57% headshots
  observed against 44% predicted by angular size. In the comments, u/BoatsFriends
  proposed the projectile-size hypothesis, and Iridar confirmed a large bullet
  hitbox. This is the hinge of the whole collection — the moment the old model died
  and the radius model was born.
- **Archive files:** ⏳ PENDING — not captured in this archive. Automated text fetch
  is blocked (reddit.com refuses automated access); a separate live-browser read was
  running in parallel on 2026-11-09. If you are reading this later, try the URL above
  in a normal browser first.
- **Lineage:** Iridar's research → self-debunked here (2017) → Dorf quantified the
  replacement (0.03 m projectile radius, 2023).
- **Currency:** 💀 DEAD as a method, PRICELESS as a record. The research it reports
  is wrong; the correction it contains is the foundation of everything after it.

### 7. "[MECHANIC] Preview placement before construction" (video)

- **Author:** Iridar (YouTube channel @Iridar51).
- **Original:** https://www.youtube.com/watch?v=vyIJnPWLTr4
- **What it is:** The video demonstration of the construction preview-placement trick:
  preview where a construction will go before committing to it.
- **Archive files:** No video file is stored. This entry is the record: title and
  channel confirmed via YouTube oEmbed 2026-11-09. Transcript unavailable (YouTube
  blocks this IP range); a separate live-browser read was running in parallel to
  identify it.
- **Lineage:** The video companion to the Construction System Guide (§2), linked from
  its `#Previewing_Placement` section.
- **Currency:** ✅ VERIFIED WORKING (2026). The trick it demonstrates — Ctrl+F11 to
  hide the weapon + E to place without starting construction — was verified still
  working in the live game in 2026 by Dayset, even though the rest of the
  construction system has changed around it.

---

## Part 2 — The full CMDRCyrious site inventory

Every page from the site's sitemaps (159 URLs), plus the two Iridar construction
copies and the two Halospud documents. Each row gives the archive file, the page
title, the word count of the saved text, where the text came from, and what happened
to it. "Live" means the live site's own HTML still contained the article on
2026-11-09. "Wayback" means the live copy was empty and the text was recovered from
a Wayback snapshot (date in the file's header). "LOST" means neither source has it.


| File | Title | Words | Source | Notes |
|---|---|---:|---|---|
| `advanced-specialization-program.md` | Advanced Specialization Program | 908 | Live |  |
| `af-4-cyclone-highly-technical-weapon-guide.md` | AF-4 Cyclone: Highly Technical Weapon Guide | 2846 | Wayback | Wayback snapshot; live copy empty |
| `auraxium-smgs-what-changed-and-why.md` | Auraxium SMGs: what changed and why | 861 | Live |  |
| `automated-command-system.md` | Automated Command System | 1425 | Live |  |
| `battle-rifles.md` | PlanetSide 2 Battle Rifles | 4323 | Wayback | Wayback snapshot; live copy empty |
| `claymore-guide-by-bvllish.md` | Claymore Guide by Bvllish | 335 | Live |  |
| `close-range-sniping-guide-by-davregis.md` | Close Range Sniping Guide by Davregis | 1302 | Live |  |
| `combat-medic-loadout-swiss-army-knife.md` | Combat Medic Loadout: Swiss Army Knife | 1817 | Live |  |
| `combined-arms-initiative-and-critical-mass-update-has-arrived.md` | Combined Arms Initiative and Critical Mass Update has arrived! | 187 | Live |  |
| `construction-system-guide.md` | Construction System Guide | 7123 | Live |  |
| `custom-voice-channels.md` | Custom Voice Channels | 541 | Wayback | Wayback snapshot; live copy empty |
| `enlist-today.md` | Join the Cyrious Army! | 394 | Live |  |
| `epic-montage-dangerous.md` | Epic Montage – “Dangerous” | 181 | ❌ LOST | live body empty; no Wayback snapshot exists |
| `explanation-of-upcoming-melee-changes.md` | Upcoming melee changes | 857 | Live |  |
| `find-an-outfit.md` | Find an Outfit. | 523 | ❌ LOST | live body empty; no Wayback snapshot exists |
| `fps-vs-rof-vs-physx.md` | FPS vs RoF vs PhysX | 429 | Wayback | Wayback snapshot; live copy empty |
| `fwf-fish-with-feet.md` | [FwF] Fish with Feet | 248 | Live |  |
| `halospud-part2-shooting-mechanics-1v1-basics.md` | Halospud — Planetside 2 Infantry Guide, Part 2: Shooting Mechanics and 1v1 Basics | 3339 | Google Docs | export format=txt |
| `halospud-part4-movement-tricks.md` | Halospud — Planetside 2 Infantry Guide, Part 4: Movement Tricks | 3170 | Google Docs | export format=txt |
| `highly-technical-how-to-analyze-a-weapon.md` | Highly Technical: How to analyze a weapon | 2941 | Wayback | Wayback snapshot; live copy empty |
| `highly-technical-nsx-tanto-vs-ns-11c.md` | Highly Technical: NSX Tanto vs NS-11C | 3256 | Live |  |
| `highly-technical-weapon-comparison-143-698-lmgs.md` | Highly Technical Weapon Comparison: 143 @ 698 LMGs | 5095 | Wayback | Wayback snapshot; live copy empty |
| `home.md` | CMDRCyrious.com | 791 | Wayback | Wayback snapshot; live copy empty |
| `horizontal-recoil-stability-calculator.md` | Horizontal Recoil Stability Calculator | 801 | Live | interactive tool — saved text only, functionality not preserved |
| `horizontal-recoil-tolerance.md` | Horizontal Recoil Tolerance | 1821 | Live |  |
| `how-forward-grips-were-fixed.md` | How Forward Grips were fixed | 510 | Live |  |
| `how-to-benchmark-planetside-2.md` | How to benchmark PlanetSide 2 | 1184 | Live |  |
| `how-to-record-and-upload-planetside-2-videos.md` | How to Record and Upload Videos | 8110 | Live |  |
| `how-to-use-daybreak-census-api.md` | How to use Daybreak Census API | 3806 | Live |  |
| `http-cmdrcyrious-com-planetside2-weapons.md` | http://cmdrcyrious.com/planetside2/weapons/ | 369 | ❌ LOST | live body empty; no Wayback snapshot exists |
| `ideal-burst-length-calculator.md` | Ideal Burst Length Calculator | 1219 | Live | interactive tool — saved text only, functionality not preserved |
| `infiltrator-armors-in-darkness.md` | Infiltrator Cosmetics in Darkness | 424 | Live |  |
| `infiltrator-loadout-nightshade.md` | Infiltrator Loadout: Nightshade | 675 | Live |  |
| `infiltrators-handbook-what-to-do-if-you-got-caught.md` | Infiltrator’s Handbook: what to do if you get caught? | 742 | Live |  |
| `jet-pack-mechanics-video-guide.md` | Jet Pack Mechanics Video Guide | 208 | Live |  |
| `known-alert-rewards.md` | Known Alert Rewards | 888 | Live |  |
| `laggy-animations-vs-adad-spam.md` | Laggy Animations vs ADAD Spam | 653 | Live |  |
| `mercmercenaries.md` | [MERC]Mercenaries | 491 | Wayback | Wayback snapshot; live copy empty |
| `mg-h1-watchman-highly-technical-weapon-guide.md` | MG-H1 Watchman: Highly Technical Weapon Guide | 3592 | Wayback | Wayback snapshot; live copy empty |
| `mirror__iridar__construction-system-guide.md` | Construction System Guide — Iridar | 6903 | Mirror | iridar-mirror.knyazev.io |
| `new-patch.md` | New Patch | 266 | Live |  |
| `new-version-of-toolbox-released.md` | New version of Toolbox released! | 167 | ❌ LOST | live body empty; no Wayback snapshot exists |
| `new-weapon-guides-released.md` | New weapon guides released! | 172 | ❌ LOST | live body empty; no Wayback snapshot exists |
| `nmanew-model-army.md` | [NMA]New Model Army | 359 | Live |  |
| `ns-15m2-vs-automatic-scout-rifle.md` | NS-15M2 vs Automatic Scout Rifle | 279 | ❌ LOST | live body empty; no Wayback snapshot exists |
| `nsx-naginata-highly-technical-weapon-guide.md` | NSX Naginata - Weapon Guide | 2314 | Live |  |
| `nsx-tengu-highly-technical-weapon-guide.md` | NSX Tengu: Highly Technical Weapon Guide | 2693 | Wayback | Wayback snapshot; live copy empty |
| `nsx-tomoe-highly-technical-weapon-guide.md` | NSX Tomoe: Highly Technical Weapon Guide | 2824 | Live |  |
| `nsx-yumi-highly-technical-weapon-guide.md` | NSX Yumi: Highly Technical Weapon Guide | 2336 | Wayback | Wayback snapshot; live copy empty |
| `parkour-guide.md` | CuteBeaver's Parkour Guide | 3242 | Live |  |
| `performance-and-customization-guide-updates.md` | Performance and Customization Guide updates | 249 | Live |  |
| `planetside-2-a-newbies-experience-what-i-like.md` | PlanetSide 2 – A Newbie’s Experience: What I Like | 1384 | Live |  |
| `planetside-2-weapon-simulator.md` | PlanetSide 2 Weapon Simulator | 1332 | Live | interactive tool — saved text only, functionality not preserved |
| `planetside2.md` | PlanetSide 2 Guide Compilation | 172 | Wayback | Wayback snapshot; live copy empty |
| `planetside22.md` | at progress Planetside 2 | 396 | Live |  |
| `planetside2__about.md` | About PlanetSide 2 | 490 | Live |  |
| `planetside2__beginner-guides.md` | PlanetSide 2 Beginner Guides | 464 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__beginner-guides__bases.md` | PlanetSide 2 Bases | 3002 | Live |  |
| `planetside2__beginner-guides__basic-class-directives.md` | Basic Class Directives | 2161 | Live |  |
| `planetside2__beginner-guides__basic-training-directives.md` | Basic Training Directives | 1092 | Live |  |
| `planetside2__beginner-guides__character-customization.md` | PlanetSide 2 Character Customization | 345 | Live |  |
| `planetside2__beginner-guides__character-progression-and-currencies.md` | Character Progression and Currencies | 1945 | Live |  |
| `planetside2__beginner-guides__common-problems-and-misconceptions.md` | Common Problems and Misconceptions | 1420 | Live |  |
| `planetside2__beginner-guides__communication.md` | Communication and Interaction | 946 | Live |  |
| `planetside2__beginner-guides__continents.md` | Continents and Strategy | 2917 | Live |  |
| `planetside2__beginner-guides__facility-and-continent-benefits.md` | Facility and Continent Benefits | 366 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__beginner-guides__factions.md` | PlanetSide 2 Factions | 908 | Live |  |
| `planetside2__beginner-guides__fps-basics.md` | First Person Shooter Basics | 1268 | Live |  |
| `planetside2__beginner-guides__glossary.md` | PlanetSide 2 Glossary | 566 | Live |  |
| `planetside2__beginner-guides__how-to-capture-a-base.md` | How to capture PlanetSide 2 base | 411 | ❌ LOST | live body empty; no Wayback snapshot exists |
| `planetside2__beginner-guides__how-to-get-more-certification-points.md` | How to get more Certification Points | 703 | Live |  |
| `planetside2__beginner-guides__how-to-get-to-the-battle.md` | How to get to the battle | 414 | ❌ LOST | live body empty; no Wayback snapshot exists |
| `planetside2__beginner-guides__how-to-kill.md` | How to kill enemies | 407 | ❌ LOST | live body empty; no Wayback snapshot exists |
| `planetside2__beginner-guides__how-to-survive.md` | How to survive in PlanetSide 2 | 343 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__beginner-guides__join-an-outfit.md` | PlanetSide 2 Outfits | 379 | Live |  |
| `planetside2__beginner-guides__leading-a-squad.md` | Leading a squad in PlanetSide 2 | 1258 | Live |  |
| `planetside2__beginner-guides__loadout.md` | PlanetSide 2 Infantry Loadout | 638 | Live |  |
| `planetside2__beginner-guides__minimap.md` | PlanetSide 2 Minimap Guide | 744 | Live |  |
| `planetside2__beginner-guides__mission-system.md` | PlanetSide 2 Mission System | 168 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__beginner-guides__premium-membership.md` | Premium Membership | 268 | Live |  |
| `planetside2__beginner-guides__progressing-your-character.md` | Progressing your character | 410 | ❌ LOST | live body empty; no Wayback snapshot exists |
| `planetside2__beginner-guides__recommended-early-certifications.md` | Recommended Early Certifications | 3393 | Live |  |
| `planetside2__beginner-guides__social-directives.md` | Social Directives | 366 | Live |  |
| `planetside2__beginner-guides__spawning-rules.md` | PlanetSide 2 Spawning Rules | 801 | Live |  |
| `planetside2__beginner-guides__spotting.md` | PlanetSide 2 Spotting Guide | 471 | Live |  |
| `planetside2__beginner-guides__squads-and-platoons.md` | PlanetSide 2 Squads and Platoons | 821 | Live |  |
| `planetside2__beginner-guides__starter-guide.md` | PlanetSide 2 Quick Start Guide | 1257 | Live |  |
| `planetside2__beginner-guides__teamwork.md` | Teamwork in PlanetSide 2 | 341 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__beginner-guides__tips-for-beginners.md` | PlanetSide 2 Tips | 515 | Live |  |
| `planetside2__classes.md` | PlanetSide 2 Classes | 329 | Live |  |
| `planetside2__classes__combat-medic.md` | PlanetSide 2 Combat Medic | 6857 | Live |  |
| `planetside2__classes__engineer.md` | PlanetSide 2 Engineer | 3064 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__classes__heavy-assault.md` | Heavy Assault in PlanetSide 2 | 2848 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__classes__infiltrator.md` | PlanetSide 2 Infiltrator | 3792 | Live |  |
| `planetside2__classes__light-assault.md` | PlanetSide 2 Light Assault Guide | 14696 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__classes__max.md` | PlanetSide 2 MAX | 1906 | Live |  |
| `planetside2__community-and-videos.md` | PlanetSide Community and Videos | 118 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__community-and-videos__community-organized-events.md` | PlanetSide 2 Community Events | 295 | Live |  |
| `planetside2__critical-mass-alerts.md` | Critical Mass Alerts | 394 | ❌ LOST | live body empty; no Wayback snapshot exists |
| `planetside2__equipment.md` | PlanetSide 2 Equipment | 124 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__equipment__camo.md` | CuteBeaver’s Camo Guide | 295 | Live |  |
| `planetside2__equipment__frag-grenades.md` | PlanetSide 2 Frag Grenades | 525 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__equipment__implants.md` | PlanetSide 2 Implants | 8828 | Live |  |
| `planetside2__equipment__nsx-fujin.md` | NSX Fujin: Highly Technical Weapon Guide | 1657 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__equipment__smoke.md` | Smoke | 625 | Live |  |
| `planetside2__equipment__suit-slots.md` | PlanetSide 2 Suit Slots | 3434 | Live |  |
| `planetside2__equipment__utility-items.md` | PlanetSide 2 Utility Items | 199 | Live |  |
| `planetside2__equipment__utility-items__anti-personnel-mines.md` | Anti-Personnel Mines | 490 | Live |  |
| `planetside2__equipment__utility-items__c4.md` | C4 in PlanetSide 2 | 1331 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__equipment__utility-items__med-kits-and-restoration-kits.md` | Med Kits and Restoration Kits | 589 | Live |  |
| `planetside2__equipment__utility-items__tank-mines.md` | Tank Mines | 308 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__infantry-guides.md` | Infantry Guides | 99 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__performance-guide.md` | PlanetSide 2 Performance Guide | 370 | Live |  |
| `planetside2__performance-guide__hardware.md` | Hardware | 3888 | Live |  |
| `planetside2__performance-guide__mouse-settings.md` | Mouse settings | 3265 | Live |  |
| `planetside2__performance-guide__os-and-setup.md` | OS and Setup | 1796 | Live |  |
| `planetside2__performance-guide__settings.md` | Settings | 4568 | Live |  |
| `planetside2__performance-guide__suggested-settings.md` | Suggested Settings | 291 | Live |  |
| `planetside2__spawn-beacon.md` | Spawn Beacon | 153 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__starter-guide-archive.md` | PlanetSide 2 Starter Guide | 139 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__tools-and-useful-links.md` | PlanetSide 2 Tools and Links | 517 | Live |  |
| `planetside2__tools-and-useful-links__bullet-damage-calculator.md` | PlanetSide 2 Damage Calculator | 856 | Wayback | Wayback snapshot; live copy empty; interactive tool — saved text only, functionality not preserved |
| `planetside2__tools-and-useful-links__game-update-chronicles.md` | PlanetSide 2 Update Chronicles | 11545 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__tools-and-useful-links__game-update-chronicles__game-update-chronicles-2013.md` | Game Update Chronicles - 2013 | 462 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__tools-and-useful-links__game-update-chronicles__game-update-chronicles-2014.md` | Game Update Chronicles - 2014 | 2386 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__tools-and-useful-links__game-update-chronicles__game-update-chronicles-2015.md` | Game Update Chronicles – 2015 | 1139 | Live |  |
| `planetside2__tools-and-useful-links__game-update-chronicles__game-update-chronicles-2016.md` | Game Update Chronicles – 2016 | 2061 | Live |  |
| `planetside2__tools-and-useful-links__game-update-chronicles__game-update-chronicles-2017.md` | Game Update Chronicles - 2017 | 1954 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__tools-and-useful-links__game-update-chronicles__game-update-chronicles-2018.md` | Game Update Chronicles – 2018 | 1544 | Live |  |
| `planetside2__tools-and-useful-links__game-update-chronicles__game-update-chronicles-2019.md` | Game Update Chronicles – 2019 | 2482 | Live |  |
| `planetside2__tools-and-useful-links__game-update-chronicles__game-update-chronicles-2020.md` | Game Update Chronicles – 2020 | 4922 | Live |  |
| `planetside2__tools-and-useful-links__game-update-chronicles__tldr_chronicles.md` | TLDR_chronicles | 1853 | Live |  |
| `planetside2__vehicles.md` | PlanetSide 2 Vehicles | 6761 | Live |  |
| `planetside2__weapons.md` | PlanetSide 2 Weapons | 228 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__weapons__assault-rifles.md` | PlanetSide 2 Assault Rifles | 7924 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__weapons__carbines.md` | PlanetSide 2 Carbines | 10838 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__weapons__gunplay-guide.md` | PlanetSide 2 Gunplay Guide | 8562 | Live |  |
| `planetside2__weapons__heavy-weapons.md` | PlaneSide 2 Heavy Weapons | 1596 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__weapons__lmgs.md` | PlanetSide 2 LMGs | 9845 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__weapons__melee-weapons.md` | PlanetSide 2 Melee Weapons | 2987 | Live |  |
| `planetside2__weapons__scout-rifles.md` | PlanetSide 2 Scout Rifles | 1511 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__weapons__shotguns.md` | PlanetSide 2 Shotguns | 6737 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__weapons__sidearms.md` | PlanetSide 2 Sidearms | 11748 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__weapons__smgs.md` | PlanetSide 2 SMGs | 5229 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__weapons__sniper-rifles.md` | PlanetSide 2 Sniper Rifles | 8392 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__weapons__weapon-attachments.md` | PlanetSide 2 Weapon Attachments | 4419 | Wayback | Wayback snapshot; live copy empty |
| `planetside2__weapons__weapon-mechanics.md` | PlanetSide 2 Weapon Mechanics | 11112 | Wayback | Wayback snapshot; live copy empty |
| `rate-of-fire-vs-framerate.md` | Rate of Fire vs Framerate | 1960 | Live |  |
| `recoil-scaling-mechanics-explained.md` | Recoil Scaling Mechanics Explained | 217 | Live |  |
| `rocket-launchers.md` | PlanetSide 2 Rocket Launchers | 7782 | Wayback | Wayback snapshot; live copy empty |
| `small-squad-point-holding.md` | A guide for aspiring small squad point-holders (taking bases against overpopulation with a small squad) | 3538 | Live |  |
| `stalker-infiltrator-guide.md` | PlanetSide 2 Stalker Infiltrator | 11359 | Live |  |
| `the-discovery-of-recoil-recovery-delay.md` | The “Discovery” of Recoil Recovery Delay | 715 | Live |  |
| `the-guardian-shield.md` | The Guardian Shield | 336 | Wayback | Wayback snapshot; live copy empty |
| `the-gunslinger-loadout.md` | The Gunslinger Loadout | 995 | Live |  |
| `tigs-sunderer-placement-guide.md` | Tig's Sunderer Placement Guide | 107 | Wayback | Wayback snapshot; live copy empty; text-light, image-heavy guide (placement diagrams) |
| `toolbox-updated.md` | Toolbox updated | 123 | Wayback | Wayback snapshot; live copy empty |
| `toolbox.md` | Iridar's Weapon Analysis Toolbox | 3488 | Live | interactive tool — saved text only, functionality not preserved |
| `vr-training.md` | VR Training | 398 | ❌ LOST | live body empty; no Wayback snapshot exists |
| `vs-lmgs-ursa-vs-flare.md` | Highly Technical: Flare vs Ursa | 1281 | Wayback | Wayback snapshot; live copy empty |
| `wayback__iridar__construction-system-guide.md` | Construction System Guide — Iridar | 6501 | Wayback | snapshot 2018-08-01 |
| `weapon-stats.md` | Weapon Stats | 920 | Live |  |
| `working-on-something.md` | Working on something | 160 | Wayback | Wayback snapshot; live copy empty |
---

## Part 3 — Supporting material

### Halospud's Infantry Guide (Google Docs)

Linked from the CMDRCyrious infantry-guides page; credits Iridar. These teach the
movement and shooting layer that Iridar's numbers don't cover. Both were saved in full
via the Google Docs export endpoint on 2026-11-09 — every section listed in each
document's table of contents is present in the saved body text.

- **Part 2: Shooting Mechanics and 1v1 Basics** —
  `pages/halospud-part2-shooting-mechanics-1v1-basics.md` (3,339 words).
  Cone of fire, recoil, bursting, hipfire vs ADS, crosshair placement, minimising line
  of sight, to ADS or not to ADS, **ADAD**, peek-first advantage, partial cover /
  head-glitching. Source:
  https://docs.google.com/document/d/1QIdGeys7mcBU0fz2Q8OqdZIhoyVlfhXij7HFRrmazSI/edit?tab=t.0
  Currency: 🕰️ principles, qualitative. No numeric ADAD cadence anywhere in it — the
  timing advice is qualitative ("quicker than most players leave it"; 0.75x ADS weapons
  make it much more effective). Read as principles, not timings.
- **Part 4: Movement Tricks** —
  `pages/halospud-part4-movement-tricks.md` (3,170 words). Evasive movement concepts,
  mouse movements, sprint strafing, zig-zagging, the Therum Shuffle, sprint peeking,
  repeeking, doubling back, jump-pad control, beating the turkey-shoot. Source:
  https://docs.google.com/document/d/16u22rB6300qaE5l9zxkeKPQUYoTeXeUj0jmhjVcv-Ms/edit?tab=t.0
  Currency: 🕰️ principles, qualitative. Sprint strafing, the Therum Shuffle, sprint
  peeking, and repeeking are the movement layer of the ADAD question.

### EmperorDorf — related holdings (outside this archive)

Dorf's work is the next link in the lineage, but it lives outside this archive and is
not duplicated here. For the future reader, where it is:

- **Weapon Surgeon workbook (v1.0, Dec 2023):** `~/workspace/emperordorf-workbook.xlsm`
  (305 MB, 9 sheets) — recovered 2026-11-07 from the Drive folder
  https://drive.google.com/drive/folders/1ZCGUPWa530d2T0KvJrBpdesUGlmvYwB2 (the
  single-file Reddit links are dead). Its stats page is Iridar's Toolbox data.
- **Dorf's explanations, scraped and synthesised:**
  `~/workspace/your_files/emperordorf-naginata-and-explanation.md` — the Naginata
  rundown he wrote for Dayset (Nov 2023), his doctrine (single stats mislead; only
  simulated TTK compares fairly; burst length optimised per range), and the earliest
  comments (May 2022) with the recovered long-comment tails.
  `~/workspace/your_files/emperordorf-naginata-charts.md` — the record that his 14
  Naginata charts are deleted from their hosts (Imgur removed-placeholder, i.redd.it
  404, Wayback empty); the per-distance numbers are unrecoverable except by
  re-simulating the Naginata in the workbook.
- **Ideal ADAD derivation:** `~/workspace/your_files/iridar-toolbox-adad.md` — how the
  "perfect ADAD" rhythm falls out of Iridar's two CoF rules (open ~4 shots still, then
  strafe; for the Naginata every still moment is also a CoF reset), the enemy-side
  reaction-time math, and what is dead vs still usable. The Ideal ADAD Calculator
  (separate artifact, slug `ideal-adad-calculator`, built 2026-11-09) computes the
  still-shot count for all 194 Toolbox weapons.

### What was deliberately not saved

- **Videos as files.** No video was downloaded. The two Iridar videos are recorded in
  Part 1 with title, channel, URL, and content notes. Downloading video was out of
  scope for a text archive, and the videos still exist on YouTube as of 2026-11-09.
- **Images and media.** Page images were not downloaded (only their URLs survive inside
  the markdown). The one exception that matters is already lost: Dorf's 14 Naginata
  charts (see above).
- **Non-PlanetSide 2 content.** The sitemaps list 11 non-PS2 URLs (XCOM 2 modding,
  PC-building posts, contact/about pages, blog index pages). They were skipped and are
  listed in Part 4. The site is a gaming blog; only its PlanetSide 2 knowledge was
  the subject.

---

## Part 4 — Lost and pending

### Lost: live body empty, no Wayback snapshot anywhere (12 pages)

Checked via the Wayback availability API and the CDX API on 2026-11-09. These texts
are unrecoverable from any source tried. Each file below still holds the live page
shell (navigation) and its metadata (title, description) — which is sometimes all that
survives of what the page was.

| Page | What it was | What survives |
|---|---|---|
| `pages/epic-montage-dangerous.md` | A montage video post | Title only; video not saved |
| `pages/find-an-outfit.md` | Outfit finder page | Shell only |
| `pages/http-cmdrcyrious-com-planetside2-weapons.md` | A redirect-artifact URL (not a real page) | Shell only |
| `pages/new-version-of-toolbox-released.md` | Short Toolbox release announcement | Shell only |
| `pages/new-weapon-guides-released.md` | Short new-guides announcement | Shell only |
| `pages/ns-15m2-vs-automatic-scout-rifle.md` | NS-15M2 vs automatic scout rifle comparison | Shell only — a real loss; nearby comparison posts survive |
| `pages/planetside2__beginner-guides__how-to-capture-a-base.md` | Beginner stub | Shell only |
| `pages/planetside2__beginner-guides__how-to-get-to-the-battle.md` | Beginner stub | Shell only |
| `pages/planetside2__beginner-guides__how-to-kill.md` | Beginner stub | Shell only — but its description survives: "in order to hit anything you have to remember two things: suppress recoil by pulling your mouse and fire in bursts to manage your cone of fire" |
| `pages/planetside2__beginner-guides__progressing-your-character.md` | Beginner stub | Shell only |
| `pages/planetside2__critical-mass-alerts.md` | Critical Mass alerts page | Shell only |
| `pages/vr-training.md` | VR Training page | Shell only |

### Pending: not captured, URLs recorded for a later attempt

- **Iridar's Angular Size testing post** (Part 1, §6) — the most important pending
  item. Automated fetch is blocked; a live-browser read was running in parallel on
  2026-11-09. URL: https://www.reddit.com/r/Planetside/comments/6z5uax/results_of_the_testing_related_to_my_angular_size/
- **Video transcripts** — both Iridar videos (Part 1, §5 and §7). YouTube rate-limited
  the transcript fetch (HTTP 429) and blocks this IP range for transcripts
  (IpBlocked). Titles and channels are confirmed via oEmbed; descriptions were not
  retrievable by any route tried. A live-browser read was running in parallel to
  identify the construction video.
- **Skipped sitemap URLs (non-PS2, deliberately excluded):**
  https://cmdrcyrious.com/xcom2/, https://cmdrcyrious.com/xcom2/modding/,
  https://cmdrcyrious.com/contact/, https://cmdrcyrious.com/portfolio-fullwidth-masonry/,
  https://cmdrcyrious.com/about-me-extended/, https://cmdrcyrious.com/home-blog/,
  https://cmdrcyrious.com/blog/, https://cmdrcyrious.com/about-pc-memory/,
  https://cmdrcyrious.com/800-build-balanced-gaming/,
  https://cmdrcyrious.com/2200-pc-build-make-your-dreams-come-true/,
  https://cmdrcyrious.com/current-situation-with-intel-cpus/

---

## Part 5 — Method and verification notes

**How it was made (2026-11-09).**

1. Inventoried the site from its sitemaps (`post-sitemap.xml`, `page-sitemap.xml`):
   170 URLs; 159 PlanetSide 2 pages kept, 11 non-PS2 skipped (listed above).
2. Downloaded every kept page's raw HTML from the live site (all 159 returned
   HTTP 200 — and that is the trap: a 200 with an empty body still looks healthy).
3. Audited the live HTML by stripping navigation and counting body words: **64 of 159
   pages had empty bodies** (0–118 words). The live site is a redesigned knowledge-base
   theme; the article bodies are gone from the served HTML for those pages.
4. Recovered 51 of the 64 from the Wayback Machine (closest snapshot at or before
   2023-05-19, the date of the Weapon Mechanics snapshot; where none existed before
   that date, the earliest available snapshot). The first pass used the availability
   API and falsely reported 45 pages as having no snapshot; a second pass with the
   CDX API recovered them — if you re-run this, trust CDX, not the availability API.
5. One archiving gotcha worth recording for the next person: **33 of the Wayback
   downloads arrived gzip-encoded** (the `id_` endpoint returns the archived bytes
   verbatim, and the origin had served them gzipped). They parsed as 0 words until
   gunzipped in place. If a Wayback file parses to nothing, check for the gzip magic
   bytes (`1f 8b`) first.
6. Converted HTML to markdown with trafilatura (article extraction, links and tables
   kept), with a BeautifulSoup/html2text fallback for one file. Converted the
   Construction System Guide from both the Wayback snapshot and the live Iridar
   mirror; converted the two Halospud Google Docs from the Docs export endpoint
   (`/export?format=txt`) and verified every table-of-contents section appears in
   the saved body text.
7. Saved the Toolbox spreadsheet as `Iridars-Toolbox-v6h.zip` (verified Zip archive,
   414,071 bytes).
8. Recorded the two Iridar videos from YouTube oEmbed (title, channel) — transcripts
   blocked (429 / IpBlocked).

**Verification (done 2026-11-09).**

- Every markdown file in `pages/` was word-counted: 163 files, ~364,000 words of
  content. Only three files are under 120 words, and all three are genuinely thin sources,
  not extraction failures: `planetside2__infantry-guides.md` (99 words — an index
  page of links), `planetside2__community-and-videos.md` (118 words — an index page of
  links), and `tigs-sunderer-placement-guide.md` (109 words — a text-light,
  image-heavy placement guide).
- Spot-checked extractions against their sources: the Weapon Mechanics guide contains
  the Minimum CoF rule and the TRAC-5 worked example; the "How to analyze a weapon"
  article contains the Tanto/NS-11C comparison; the Construction guides contain the
  Previewing section; both Halospud exports contain every TOC section twice (contents
  list + body heading).
- The INDEX table above was generated from the files on disk (163 rows) — it matches
  `pages/` exactly. Raw HTML is present for every row: `raw/` holds the 159 live
  downloads, the 53 Wayback downloads (51 fallback + Weapon Mechanics priority +
  Construction System guide), the mirror Construction guide, the two Halospud plain-text exports, and the
  YouTube transcript attempt is recorded as failed (no file).
- Known gaps are all listed in Part 4. Nothing was silently dropped.

**A note on dates.** "Saved 2026-11-09" means this archive's capture date. Snapshot
dates in file headers are the Wayback snapshot dates — the date the content is *from*,
which is what a future reader needs. Where the two differ, both are recorded.
