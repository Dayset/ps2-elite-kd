# Weapon Stats

- **Source:** https://cmdrcyrious.com/weapon-stats/
- **Saved:** 2026-11-09
- **Status:** live, HTTP 200
- **Raw HTML:** `raw/weapon-stats.html`
- **Extraction:** trafilatura

---

---
title: Weapon Stats | CMDRCyrious.com
author: CMDRCyrious
url: https://cmdrcyrious.com/weapon-stats/
hostname: cmdrcyrious.com
description: PlanetSide 2 weapons have a lot of statistics, but only a portion of them is shown in-game. This is how you can access the rest.
sitename: CMDRCyrious.com | Take your gaming Cyriously!
date: "2017-01-03"
categories: ['PlanetSide 2, API, mechanics']
tags: ['API', 'mechanics', "A Newbie's Experience", 'beginner', 'calculator', 'combat medic', 'comparison', 'construction system', 'guest post', 'guide', 'heavy assault', 'highly technical', 'implant', 'infantry', 'infiltrator', 'Light Assault', 'LMG', 'loadout', 'mechancis', 'mechanic', 'New Conglomerate', 'NSX', 'PC Building', 'performance', 'repost', 'rocket launchers', 'SMG', 'stalker', 'suggestion', 'Terran Republic', 'tool', 'Vanu Sovreignty', 'Video', 'weapon', 'Weapon Calculator', 'XCOM 2']
fingerprint: "7a1f8fd26f7713bf"
---
PlanetSide 2 weapons have a lot of statistics that [define how they function in-game](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/). But only a portion of those statistics is shown in-game. This is how you can access the rest:

# [PlanetStats](http://planetstats.net/data/weapons/)

This should be your go-to resource. Lists all weapons in a convenient, sortable form. You can also select and compare several weapons. This source would be ideal, if not for a few issues:

- Sometimes weapon stats take too long to load.
- Some numbers are rounded too roughly. For example, it will show 0.225 as 0.23.
- Some stats, like [Recoil Recovery Delay](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Recoil_Recovery_Delay), are not shown, and [Equip Time](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Equip_time) is incorrect for some weapons.

# [Daybreak Census API](http://cmdrcyrious.com/how-to-use-daybreak-census-api/)

This online database is owned and controlled by Daybreak – PlanetSide 2 developers. It contains information about player characters and weapon statistics. This is where PS2 informational sites pull data from.

To pull information from the API, you have to put a query into browser’s address bar. Here is an example of the simplest request:

[http://census.daybreakgames.com/get/ps2/item?name.en=**TRAC-5**&c:lang=en](http://census.daybreakgames.com/get/ps2/item?name.en=TRAC-5&c:lang=en)

You will receive a [**JSON string**](http://cmdrcyrious.com/wp-content/uploads/2017/01/json-string.jpg). I highly recommend you use a browser plugin that formats JSON strings to make them [**more readable**](http://cmdrcyrious.com/wp-content/uploads/2017/01/json-string-formatted.jpg), or at least use a **[JSON formatting site](http://jsonformatter.curiousconcept.com/)**.

Normally, you can view JSON strings right in the browser, but some browsers **prompt a download** of the .json file instead. In that case, you can open it with any text editor, such as Notepad.


However, that simplest query does not give you any useful information about the weapon. This is because Census database is fairly complex, and weapon data is stored in several different tables, with different key fields. So if you want to pull all available information about a weapon, you have to pull information from several places at once, and the query becomes much bigger.

## Full Query

*Go **[here](http://cmdrcyrious.com/how-to-use-daybreak-census-api/)** if you’d like to learn how to put together your own queries.*

These versions of the query pull all information about the weapon, including what cannot be accessed in-game, such as Recoil, Equip Time, Projectile Lifespan and exact effects of attachments.

[**By Item ID**](<http://census.daybreakgames.com/s:iridar/get/ps2/item?item_id=43&c:lang=en&c:join=fire_mode^inject_at:fire_mode^list:1,item_to_weapon^inject_at:fire_mode_2(weapon,weapon_to_fire_group^on:weapon_id^to:weapon_id^list:1(fire_group^on:fire_group_id^to:fire_group_id,fire_group_to_fire_mode^on:fire_group_id^to:fire_group_id^list:1(fire_mode_2^on:fire_mode_id^to:fire_mode_id^list:1(player_state_group^list:1^inject_at:player_state_group,player_state_group_2^on:player_state_group_id^to:player_state_group_id^inject_at:player_state_group_2^list:1,fire_mode_to_projectile^on:fire_mode_id^to:fire_mode_id^inject_at:projectile(projectile^on:projectile_id^to:projectile_id^inject_at:projectile_details))))))&c:join=weapon_datasheet^inject_at:ammo&c:join=item_category^on:item_category_id^to:item_category_id^inject_at:category&c:join=item_attachment^on:item_id^to:item_id^list:1^inject_at:attachments(item^on:attachment_item_id^to:item_id^inject_at:attachment(zone_effect^on:passive_ability_id^to:ability_id^inject_at:attachment_effects^list:1(zone_effect_type^on:zone_effect_type_id^to:zone_effect_type_id^inject_at:attachment_effects_description)))>) \[spoiler title=”By Item ID”\]

http://census.daybreakgames.com/s:iridar/get/ps2/item?**item\_id=43**&c:lang=en&c:join=fire\_mode^inject\_at:fire\_mode^list:1,item\_to\_weapon^inject\_at:fire\_mode\_2(weapon,weapon\_to\_fire\_group^on:weapon\_id^to:weapon\_id^list:1(fire\_group^on:fire\_group\_id^to:fire\_group\_id,fire\_group\_to\_fire\_mode^on:fire\_group\_id^to:fire\_group\_id^list:1(fire\_mode\_2^on:fire\_mode\_id^to:fire\_mode\_id^list:1(player\_state\_group^list:1^inject\_at:player\_state\_group,player\_state\_group\_2^on:player\_state\_group\_id^to:player\_state\_group\_id^inject\_at:player\_state\_group\_2^list:1,fire\_mode\_to\_projectile^on:fire\_mode\_id^to:fire\_mode\_id^inject\_at:projectile(projectile^on:projectile\_id^to:projectile\_id^inject\_at:projectile\_details))))))&c:join=weapon\_datasheet^inject\_at:ammo&c:join=item\_category^on:item\_category\_id^to:item\_category\_id^inject\_at:category&c:join=item\_attachment^on:item\_id^to:item\_id^list:1^inject\_at:attachments(item^on:attachment\_item\_id^to:item\_id^inject\_at:attachment(zone\_effect^on:passive\_ability\_id^to:ability\_id^inject\_at:attachment\_effects^list:1(zone\_effect\_type^on:zone\_effect\_type\_id^to:zone\_effect\_type\_id^inject\_at:attachment\_effects\_description)))

**[By weapon name](<http://census.daybreakgames.com/s:iridar/get/ps2/item?name.en=M77-B&c:lang=en&c:join=fire_mode^inject_at:fire_mode^list:1,item_to_weapon^inject_at:fire_mode_2(weapon,weapon_to_fire_group^on:weapon_id^to:weapon_id^list:1(fire_group^on:fire_group_id^to:fire_group_id,fire_group_to_fire_mode^on:fire_group_id^to:fire_group_id^list:1(fire_mode_2^on:fire_mode_id^to:fire_mode_id^list:1(player_state_group^list:1^inject_at:player_state_group,player_state_group_2^on:player_state_group_id^to:player_state_group_id^inject_at:player_state_group_2^list:1,fire_mode_to_projectile^on:fire_mode_id^to:fire_mode_id^inject_at:projectile(projectile^on:projectile_id^to:projectile_id^inject_at:projectile_details))))))&c:join=weapon_datasheet^inject_at:ammo&c:join=item_category^on:item_category_id^to:item_category_id^inject_at:category&c:join=item_attachment^on:item_id^to:item_id^list:1^inject_at:attachments(item^on:attachment_item_id^to:item_id^inject_at:attachment(zone_effect^on:passive_ability_id^to:ability_id^inject_at:attachment_effects^list:1(zone_effect_type^on:zone_effect_type_id^to:zone_effect_type_id^inject_at:attachment_effects_description)))>)** \[spoiler title=”By weapon name”\]

http://census.daybreakgames.com/s:iridar/get/ps2/item?name.en=**M77-B**&c:lang=en&c:join=fire\_mode^inject\_at:fire\_mode^list:1,item\_to\_weapon^inject\_at:fire\_mode\_2(weapon,weapon\_to\_fire\_group^on:weapon\_id^to:weapon\_id^list:1(fire\_group^on:fire\_group\_id^to:fire\_group\_id,fire\_group\_to\_fire\_mode^on:fire\_group\_id^to:fire\_group\_id^list:1(fire\_mode\_2^on:fire\_mode\_id^to:fire\_mode\_id^list:1(player\_state\_group^list:1^inject\_at:player\_state\_group,player\_state\_group\_2^on:player\_state\_group\_id^to:player\_state\_group\_id^inject\_at:player\_state\_group\_2^list:1,fire\_mode\_to\_projectile^on:fire\_mode\_id^to:fire\_mode\_id^inject\_at:projectile(projectile^on:projectile\_id^to:projectile\_id^inject\_at:projectile\_details))))))&c:join=weapon\_datasheet^inject\_at:ammo&c:join=item\_category^on:item\_category\_id^to:item\_category\_id^inject\_at:category&c:join=item\_attachment^on:item\_id^to:item\_id^list:1^inject\_at:attachments(item^on:attachment\_item\_id^to:item\_id^inject\_at:attachment(zone\_effect^on:passive\_ability\_id^to:ability\_id^inject\_at:attachment\_effects^list:1(zone\_effect\_type^on:zone\_effect\_type\_id^to:zone\_effect\_type\_id^inject\_at:attachment\_effects\_description)))

Make sure to type the name **exactly** as it appears in-game, including blank spaces, dashes, quotes and capital letters.

**[Implant Effects](<https://census.daybreakgames.com/s:iridar/get/ps2/item?item_category_id=133&c:limit=500&c:lang=en&c:sort=name.en:1&c:join=zone_effect^on:passive_ability_id^to:ability_id^list:1(zone_effect_type)>)** \[spoiler title=”Query”\]

https://census.daybreakgames.com/s:iridar/get/ps2/item?item\_category\_id=133&c:limit=500&c:lang=en&c:sort=name.en:1&c:join=zone\_effect^on:passive\_ability\_id^to:ability\_id^list:1(zone\_effect\_type)

\[/spoiler\]
[**Vehicle Attachments**](<http://census.daybreakgames.com/s:iridar/get/ps2/vehicle?name.en=Flash&c:lang=en&c:join=vehicle_attachment^list:1(item(zone_effect^on:passive_ability_id^to:ability_id^list:1(zone_effect_type)))>) \[spoiler title=”Query”\]

http://census.daybreakgames.com/s:iridar/get/ps2/vehicle?name.en=Flash&c:lang=en&c:join=vehicle\_attachment^list:1(item(zone\_effect^on:passive\_ability\_id^to:ability\_id^list:1(zone\_effect\_type)))

\[/spoiler\]
**[Nanoweave Armor](<https://census.daybreakgames.com/s:iridar/get/ps2/item?name.en=Nanoweave%20Armor%205&c:lang=en&c:join=zone_effect^on:passive_ability_id^to:ability_id^list:1(resist_info^on:param1^to:resist_info_id(fire_mode^on:resist_type_id^to:damage_resist_type^show:damage_resist_type%27item_id^list:1(item^show:name.en)))>)** \[spoiler title=”Query”\]

https://census.daybreakgames.com/s:iridar/get/ps2/item?name.en=Nanoweave%20Armor%205&c:lang=en&c:join=zone\_effect^on:passive\_ability\_id^to:ability\_id^list:1(resist\_info^on:param1^to:resist\_info\_id(fire\_mode^on:resist\_type\_id^to:damage\_resist\_type^show:damage\_resist\_type%27item\_id^list:1(item^show:name.en)))

\[/spoiler\]
**[Built-in Armor and Resistances](<http://census.daybreakgames.com/s:iridar/get/ps2/profile_2?profile_id=26&c:join=profile_resist_map^on:profile_id^to:profile_id^list:1^show:resist_info_id(resist_info(resist_type^show:description^inject_at:resist_type))&c:join=profile_armor_map^on:profile_id^to:profile_id^list:1^hide:rank(armor_info(armor_facing^show:description^inject_at:facing))>)** \[spoiler title=”Query”\]

http://census.daybreakgames.com/s:iridar/get/ps2/profile\_2?profile\_id=26&c:join=profile\_resist\_map^on:profile\_id^to:profile\_id^list:1^show:resist\_info\_id(resist\_info(resist\_type^show:description^inject\_at:resist\_type))&c:join=profile\_armor\_map^on:profile\_id^to:profile\_id^list:1^hide:rank(armor\_info(armor\_facing^show:description^inject\_at:facing))

\[/spoiler\]
These queries pull a lot of info at once, and if you intend to make several queries in a short time frame, you may be required to register a **[Service ID](https://census.daybreakgames.com/#service-id)**.

Both queries above pull information in English. If you want to pull all languages, simply remove **&c:lang=en** from the query.

Or you can specify another language: de, en, es, fr, it, tr

There are other queries you can make to the Census, as explained **[here](http://census.daybreakgames.com/)** and **[here](https://www.reddit.com/r/Planetside/comments/3kezf9/api_query_love_in/)**.

### How to find out weapon’s Item ID?

**You can make a query using weapon’s name:** 

[http://census.daybreakgames.com/get/ps2:v2/item?name.en=Force-Blade](http://census.daybreakgames.com/get/ps2:v2/item?name.en=Force-Blade)

Make sure to type the name ***exactly*** as it appears in game, including blank spaces, if there are any. The Item ID will be listed in one of the first fields, e.g: “item\_id“: “19”

If you’re having trouble typing the weapon name properly, or if you don’t know the name, then another way is to make a query of all weapons of certain category.

**Or query for a list of categories:**

http://census.daybreakgames.com/s:iridar/get/ps2/item\_category?c:limit=500&c:lang=en

Examples of queries for all weapons in “Carbine” category:

http://census.daybreakgames.com/s:iridar/get/ps2/item\_category?c:limit=500&c:lang=en&name.en=Carbine&c:join=item^list:1

http://census.daybreakgames.com/s:iridar/get/ps2/item?item\_category\_id=8&c:limit=500&c:lang=en&c:show=item\_id,name

# [Weapon Analysis Toolbox](http://cmdrcyrious.com/toolbox/)

This Excel Sheet can:

- **download weapon stats from Census API** and display them in formatted form, including information about weapon’s projectile
- make manual query to Census API about a weapon with a simple double click
- analyze and calculate weapon mechanics, such as Bullets to Kill, Time to Kill, bullet damage at certain range, analyze weapon’s Cone of Fire and Recoil properties.

# [DasAnfall](http://stats.dasanfall.com/ps2/civ/index.php?id=1)

An alternative to PlanetStats. It displays more weapon stats, but can potentially be outdated, and you still have to know weapon’s Item ID. DasAnfall may be necessary to find out such weapon stats as:

- Equip and Unequip Times
- Projectile Lifespan
- Projectile Gravity
- Weapon’s Fire Modes

For example, you can use [PlanetStats](http://planetstats.net/data/weapons/?id=43) to find out that **TRAC 5** has ID of 43.

Then link to the DasAnfall page of TRAC 5 will look like this:

[http://stats.dasanfall.com/ps2/civ/index.php?id=43](http://stats.dasanfall.com/ps2/civ/index.php?id=43)

As you may notice, DasAnfall lists weapon stats several times. This is done because PS2 weapons have separate stats for each fire mode.

For example, TRAC 5 has 4 modes: single shot, full auto, single shot while ADS, full auto while ADS.

Most weapon stats are identical in different fire modes, but it’s important to understand that as far as game engine is concerned, those are all completely different weapons.

It is theoretically possible to make a weapon that will function like a full auto grenade launcher while firing from the hip, and like a sniper rifle while ADSing, and could also switch into a Flak Turret fire mode.

# [FISU](http://ps2.fisu.pw/weapons)

An alternative to PlanetStats.
