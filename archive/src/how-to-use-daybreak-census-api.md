# How to use Daybreak Census API

- **Source:** https://cmdrcyrious.com/how-to-use-daybreak-census-api/
- **Saved:** 2026-11-09
- **Status:** live, HTTP 200
- **Raw HTML:** `raw/how-to-use-daybreak-census-api.html`
- **Extraction:** trafilatura

---

---
title: How to use Daybreak Census API | CMDRCyrious.com
author: CMDRCyrious
url: https://cmdrcyrious.com/how-to-use-daybreak-census-api/
hostname: cmdrcyrious.com
description: Information in the API is distributed between many collections. Each collection contains entries with typical structure for that collection.
sitename: CMDRCyrious.com | Take your gaming Cyriously!
date: "2017-07-04"
categories: ['PlanetSide 2, API, guide']
tags: ['API', 'guide', "A Newbie's Experience", 'beginner', 'calculator', 'combat medic', 'comparison', 'construction system', 'guest post', 'heavy assault', 'highly technical', 'implant', 'infantry', 'infiltrator', 'Light Assault', 'LMG', 'loadout', 'mechancis', 'mechanic', 'mechanics', 'New Conglomerate', 'NSX', 'PC Building', 'performance', 'repost', 'rocket launchers', 'SMG', 'stalker', 'suggestion', 'Terran Republic', 'tool', 'Vanu Sovreignty', 'Video', 'weapon', 'Weapon Calculator', 'XCOM 2']
fingerprint: "3a19c9554db66f15"
---
*You can find pre-made queries **[here](http://cmdrcyrious.com/weapon-stats/#Daybreak_Census_API)**. This article explains how they work, so you can make your own queries, if need be.*

# How to make an API Query

Information in the API is distributed between many **collections**. Each collection contains **entries** with typical structure for that collection. Each entry contains **fields** with information.

Usually, information about in-game objects is distributed between many different collections. For example, to pull full stats of one weapon, you have to access as many as 17 (!) different collections.

Fortunately, you can access several collections at once by **joining** several queries together.

Before you proceed, It is highly recommended you get a **JSON formatter plugin** for your browser. Google it.

**List of collections:** [https://census.daybreakgames.com/get/ps2/](https://census.daybreakgames.com/get/ps2/)

**Census website:** [https://census.daybreakgames.com/](https://census.daybreakgames.com/)

Some queries pull a lot of info at once, and if you intend to make several queries in a short time frame, you may be required to register a **[Service ID](https://census.daybreakgames.com/#service-id)**.

## Basic Queries

**To query a collection**, you simply write its name in the link. For example, let’s query the “**item**” collection, which is basically a huge list of all items in game:

[http://census.daybreakgames.com/get/ps2/**item**](http://census.daybreakgames.com/get/ps2/item)

This will return a JSON string with the first entry of the “item” collection. In this case, it contains information about [**Mag-Cutter**](http://cmdrcyrious.com/planetside2/weapons/melee-weapons/#StandardKnives).

**To query a collection for multiple entries**, you have to specify the amount using a c:limit modifier. [**One does not simply**](http://cmdrcyrious.com/wp-content/uploads/2017/07/One-Does-Not-Simply.jpg) access ALL entries in a collection.

[http://census.daybreakgames.com/get/ps2/item?c:limit=5](http://census.daybreakgames.com/get/ps2/item?c:limit=5)

This will give you first five “items”. However, there is an overall limit to query size, and querying for several thousand of items will get hard and messy, so it’s a method best kept to “small” collections of several hundred members.

**To query specific entries**, you can search entries with a field containing a certain value. For example, you can query a weapon by a **name**, or by an **item\_id**.

[http://census.daybreakgames.com/get/ps2/item?**name.en=TRAC-5**](http://census.daybreakgames.com/get/ps2/item?name.en=TRAC-5)

[http://census.daybreakgames.com/get/ps2/item?**item\_id=43**](http://census.daybreakgames.com/get/ps2/item?item_id=43)

Weapon name has to be written exactly as it appears in game, it is sensitive to letter case and spaces. Notice how we also specified the language of the name field. Collections with localized fields, such as names and descriptions, will contain all languages at the same time, which can get cluttering. You can **specify a language** like this:

[http://census.daybreakgames.com/get/ps2/item?name.en=TRAC-5&c:lang=en](http://census.daybreakgames.com/get/ps2/item?name.en=TRAC-5&c:lang=en)

You can search for multiple entries with a certain value in a field. For example:

[https://census.daybreakgames.com/get/ps2/item?**item\_category\_id=8**](https://census.daybreakgames.com/get/ps2/item?item_category_id=8)

This query will display the first entry in the “item” collection with the item\_category\_id of 8, which is the Carbines’ category ID. **To show *all* entries with that item\_category\_id**, you have to again use the **c:limit**:

[https://census.daybreakgames.com/get/ps2/item?item\_category\_id=8&c:limit=400](https://census.daybreakgames.com/get/ps2/item?item_category_id=8&c:limit=400)

## Joining Collections

**Joining several collections in one query** makes it easier to access full information about something. For example:

This query will join item and item\_category collections, so you can access a weapon by a name, and see its category right away.

“On” is the name of the field in parent collection, “to” is the name of the field in child collection. In some cases you can forego specifying the “on” and “to” parts of the joining. In this case, you can simply write:

[http://census.daybreakgames.com/get/ps2/item?name.en=TRAC-5&c:lang=en&**c:join=item\_category**](http://census.daybreakgames.com/get/ps2/item?name.en=TRAC-5&c:lang=en&c:join=item_category)

Sometimes **on** and **to** can be omitted and the join will still work. That’s because if you don’t specify them it will use **item\_id** by default.

Most times using only **on** to specify which field from the parent collection to use is enough. For example instead of **item\_id** you might want to use **item\_category\_id** or there is no **item\_id** in the collection so there is no default.

But there are times when you have to use **to** as well. That’s when the joining field from the parent collection has a different name from the identifying field of the child collection.

For example joining attachment item info to the attachment list of a weapon. The attachments list collection uses **attachment\_item\_id** to identify the attachment, but the attachment info collection uses **item\_id**.


You can also **specify the name of the join**:

This can make large queries more readable. If the child collection contains several entries with that identifier, you need to specify that you want to join all of them.

This query will show all weapons in the “Carbine” category.

### Multi Join

You can string several joins together by separating them with commas:

This identical to using several join commands in one query:

### Multi-Level Join

You can create multi level joins by using round brackets: **(** and **)**.

This query will display some of the weapon’s stats, stored in the “weapon” collection. It has the following structure and query response:

![JSON Multi Level Query](http://cmdrcyrious.com/wp-content/uploads/2017/07/multi_query.png)


# Collections

You may find [**this map of the API**](http://cmdrcyrious.com/Arklur's_API_map.svg) useful. All credit goes to **[/u/Arklur](https://www.reddit.com/r/Planetside/comments/75rnqd/ps2_api_model/)**.

## item

This collection contains meta information about an item, such as its localized name and description. This is the starting point for queries of weapon stats.

### Fields

**Category:** item\_category\_id

You can figure out item’s category by searching for the specified **item\_category\_id** in the **[item\_category](http://census.daybreakgames.com/s:iridar/get/ps2/item_category?c:limit=500)** collection, or **[joining](http://census.daybreakgames.com/get/ps2/item?name.en=TRAC-5&c:lang=en&c:join=item_category)** it.

**Description:** description

Contains all languages by default, but you can access specific language by writing the language’s two-letter code after a dot, for example: **description.en**, or using a [**&c:lang=en**](http://census.daybreakgames.com/s:iridar/get/ps2/item_category?c:limit=500&c:lang=en) modifier.

**Faction:** faction\_id

These field will specify which factions can use the weapon. Faction IDs can be accessed in **[faction](http://census.daybreakgames.com/get/ps2/faction?c:limit=50&c:lang=en)** collection.

**Item’s Image:** image\_path

This can be used to access item’s [**in game icon**](http://census.daybreakgames.com/files/ps2/images/static/963.png). Simply paste the path after the basic census link:

[http://census.daybreakgames.com/**files/ps2/images/static/963.png**](http://census.daybreakgames.com/files/ps2/images/static/963.png)

Some images are missing from the API, and will give a ***page\_not\_found*** error when you try to access them. There is nothing to be done about it, but you can datamine weapons’ icons from client files by using **[PS2LS tool](http://cmdrcyrious.com/planetside2/tools-and-useful-links/#Tools)**. Images are stored in .dds format, and you can use any free converter to convert them into .png.

**Image Set:** image\_set\_id

The API usually stores several icons of different sizes. The image\_path contains the address of the largest image, you can access smaller images by searching or **[joining](http://census.daybreakgames.com/s:iridar/get/ps2/item?name.en=TRAC-5&c:join=image_set^list:1)** the **image\_set** collection.

## weapon\_datasheet

**Parent collection:** item

**Join key:** item\_id

**Magazine Size:** clip\_size

**Ammo Pool:** capacity

It’s worth noting that Ammo Pool includes the ammunition already loaded into the weapon, so 40/240 in the API will appear as 40/200 in game.

The rest of the fields in **weapon\_datasheet** collection are **misleading and should not be used**, as they refer to the [**old format of displaying weapon stats in game**](http://cmdrcyrious.com/wp-content/uploads/2017/07/old-weapon-stats.png), basically somehow correlating with the number of bars in certain categories.

## fire\_mode

**Parent collection:** item

**Join key:** item\_id

This collection contains some of the weapon stats, related to Damage and Reload times. However, the [**fire\_mode\_2**](http://cmdrcyrious.com/how-to-use-daybreak-census-api/#fire_mode_2) collection contains the same information and much more, so it is preferable to use that when possible.

It is important to understand that in-game firemodes, such as “semi-auto” and “fully-automatic”, and the API “firemodes” are different.

As far as API is concerned, “semi auto” and “full auto” are [**fire groups**](http://cmdrcyrious.com/how-to-use-daybreak-census-api/#fire_group), and “fire modes” make the distinction between hip firing and ADSing.

Attachments like **[Underbarrel Grenade Launcher](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Underbarrel_Grenade_Launcher_UBGL)** function by attaching an additional fire\_group to a weapon.

Each API firemode contains a complete set of parameters and keys to entries in other collections that define how a weapon functions. So it is technically possible to give a weapon completely different functions in different firemodes; that’s how [**NSX Amaterasu**](http://cmdrcyrious.com/planetside2/weapons/melee-weapons/#NSX_Amaterasu) works.

The fire\_mode collection will usually have multiple entries for each weapon, all using the same **item\_id key**. So when joining the **item\_id collection**, remember to use **[^list:1](https://census.daybreakgames.com/s:iridar/get/ps2/item?name.en=TRAC-5&c:lang=en&c:join=fire_mode^list:1)** modifier, or when searching the fire\_mode collection manually, remember to use **[&c:limit=400](https://census.daybreakgames.com/s:iridar/get/ps2/fire_mode?item_id=43&c:limit=400)** modifier.

**Cone of Fire Bloom:** cof\_recoil

**Short Reload:** reload\_time\_ms

**Reload Chamber Time:** reload\_chamber\_time\_ms

**Pellets Per Shot:** pellets\_per\_shot

**Pellet Spread:** pellet\_spread

**Magnification:** default\_zoom

**Projectile Speed:** muzzle\_velocity

**Minimum Damage:** damage\_min

**Maximum Damage:** damage\_max

**Minimum Damage Range:** damage\_min\_range

**Maximum Damage Range:** damage\_max\_range

**Resistances:** damage\_target\_type, damage\_resist\_type


## weapon

**Parent Collections:** item -> item\_to\_weapon

**Key:** weapon\_id – required to join **fire\_group** collection.

**[Sprint Recovery Time](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Sprint_Recovery):** sprint\_recovery\_ms

A delay before a weapon can be fired after you stop sprinting.

**Equip Time:** equip\_ms

**Unequip Time:** unequip\_ms

**[Scope In Time](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Scope-In_and_Scope-Out_Times):** to\_iron\_sights\_ms

**Scope Out Time:** from\_iron\_sights\_ms

#### Unused or unknown fields

weapon\_group\_id, turn\_modifier, move\_modifier

## fire\_group

**Parent Collections:**  item -> item\_to\_weapon -> weapon\_to\_fire\_group (list)

For each **weapon\_id** there are one or several corresponding entries in **fire\_group** collection.

Each **fire\_group entry** refers to weapon’s in game firemode, such as 3x Burst, Semi Auto, etc.

Each fire\_group entry has an **index**, which refers to the order of in-game firemodes. Index of 0 corresponds with weapon’s first firemode.

Most **fire\_group entries** have two **firemode\_id**s. The first defines how the weapon behaves while hip firing, the second – ADSing.

#### Example

**[Link to example query.](<http://census.daybreakgames.com/s:iridar/get/ps2/item?name.en=TRAC-5&c:lang=en&c:join=item_to_weapon(weapon(weapon_to_fire_group^on:weapon_id^to:weapon_id^list:1(fire_group_to_fire_mode^on:fire_group_id^to:fire_group_id^list:1)))>)** First, we have to access TRAC-5’s **weapon\_id** by joining the **item\_to\_weapon collection**. **TRAC-5** has two in-game firemodes, **semi auto** and **auto**. This is represented in the API by fact that there are two entries in **weapon\_to\_fire\_group** collection with TRAC-5’s **weapon\_id**. But first you have to join the item\_to\_weapon collection to access TRA

Each **weapon\_to\_fire\_group** entry contain a **fire\_group\_id** and **index**.

The entry with index of 0 refers to TRAC-5’s default in-game firemode – the full auto one. Pressing the in-game **Change Firemode** key basically increases weapon’s current Fire Group index by 1.

For each **fire\_group\_id**, there are two entries in **fire\_group\_to\_fire\_mode** collection.

Again, each **fire\_group\_to\_fire\_mode** entry contains a **fire\_mode\_id** and **index**.

The entry with index of 0 refers to hip fire stats of the weapon, index of 0 refers to ADS stats.

![](http://cmdrcyrious.com/wp-content/uploads/2017/07/query-structure.png)

Click to enlarge

Each **fire\_mode\_2 entry** completely describes how a weapon performs, so in theory, a weapon can have completely different performance between hip firing and ADSing. Same goes for different in-game firemodes. This is why it’s possible for [**Spiker**](http://cmdrcyrious.com/planetside2/weapons/sidearms/#Spiker) to have a secondary charge up mode.

### Additional Fields

For some specific weapons, **fire\_group entries** also contain some crucial stats:

**transition\_duration\_ms** – how long does it take a weapon to switch to this fire group.

**chamber\_duration\_ms** – how long does it take to cycle a **[Bolt Action](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#Bolt_Action_Chamber_Time)** or **[Pump Action](http://cmdrcyrious.com/planetside2/weapons/shotguns/#Pump_Action_Shotguns)** weapon between shots. To calculate actual **time between shots**, you need to add together the **chamber\_duration\_ms** and **refire\_ms**.

**can\_chamber\_ironsights** – whether a Bolt Action or Pump Action weapon can be cycled between shots while the user Aims Down Sights.

**spool\_up\_ms** – how long does it take for a spool-up weapon to reach its maximum Rate of Fire. Ex. [T7 Mini-Chaingun](http://cmdrcyrious.com/planetside2/weapons/heavy-weapons/#T7_Mini-Chaingun)

**spool\_up\_initial\_refire\_ms** – initial Refire Time of a spool-up weapon.

## fire\_group\_to\_fire\_mode

A pass-through collection between **fire\_group** and **fire\_mode\_2**. In addition to **fire\_mode\_id**s, also contains **indexes** of relevant fire\_modes.

## fire\_mode\_2

This collection is much trickier to access than **fire\_mode**, and requires a multi-level join. However, in return it provides a much clearer structure and more stats.

**Collection:** fire\_mode\_2

**Parent collections:** item -> item\_to\_weapon -> weapon\_to\_fire\_group (list) -> 

fire\_group\_to\_fire\_mode (list) -> fire\_mode\_2

Check this **[example](<http://census.daybreakgames.com/get/ps2/item?name.en=TRAC-5&c:join=item_to_weapon^on:item_id^to:item_id(weapon_to_fire_group^on:weapon_id^to:weapon_id^list:1(fire_group_to_fire_mode^on:fire_group_id^to:fire_group_id^list:1(fire_mode_2^on:fire_mode_id^to:fire_mode_id)))&c:lang=en>)** to see which **keys** you need to specify for each join.

**Join key:** fire\_mode\_id

**Contains keys:** player\_state\_group\_id, damage\_direct\_effect\_id, damage\_indirect\_effect\_id

#### Step by step

**item -> item\_to\_weapon**

To learn weapon’s weapon\_id.

 **item\_to\_weapon -> weapon\_to\_fire\_group (list)**

Here you get a list of weapon’s in-game firemodes, such as “3x burst” and “semi-auto”. Each fire group has an **index**. Index of 0 refers to weapon’s default firemode.

 **weapon\_to\_fire\_group (list) -> fire\_group\_to\_fire\_mode (list)**

Here you get a list of fire modes for each fire group. Usually this will be hip firing and ADSing. Each mentioned firemode will also have an **index**. Usually, index of 0 usually refers to hip firing, and index of 1 to ADSing.

**fire\_group\_to\_fire\_mode (list) -> fire\_mode\_2**

Finally, you get to weapon stats for each firemode.

### Fields

**fire\_mode\_2 collection** has the same fields as **[fire\_mode collection](http://cmdrcyrious.com/how-to-use-daybreak-census-api/#fire_mode)**, and more:

**automatic** – defines whether the weapon will continuously fire if you hold the “fire” key.

**move\_modifier** – a multiplicative modifier to player’s movement speed in this firemode. This is how you access weapon’s **[ADS Movement Speed Modifier](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#ADS_Movespeed_Multiplier)**.

**cof\_scalar, cof\_scalar\_moving** – multiplicative multipliers to **Cone of Fire values** written in [**Player State Group entries**](http://cmdrcyrious.com/how-to-use-daybreak-census-api/#player_state_group). For example, **Laser Sight** functions by reducing **cof\_scalar** of hip fire fire\_modes. Moving CoFs are already affected by **cof\_scalar**, so **cof\_scalar\_moving** is an additional variable.

**Projectile Velocity aka Muzzle Velocity:** projectile\_speed\_override

Each projectile in PS2 has a pre-defined velocity. This field will override projectile’s pre-defined velocity. This is a convenient way for developers to set different velocities for different weapons that use the same projectile (e.g. bullet).

**Magnification:** zoom\_default

This is the field that gets overridden by **[optics attachments](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Scopes)**.

**Pellet Spread:** cof\_pellet\_spread

For non-shotgun weapons, this will be equal to 0.

**Cone of Fire Bloom:** cof\_recoil

**Headshot Damage Multiplier:** damage\_head\_multiplier

Increase this is by 1 to get a total multiplier. E.g., damage\_head\_multiplier of 1 means the weapon deals 2x damage on headshots.

**Legshot Damage Multiplier:** damage\_legs\_multiplier

Subtract this value from 1 to get the total multiplier. E.g. damage\_legs\_multiplier of -0.1 means the weapon deals 0.9x damage on legshots.

**fire\_ammo\_per\_shot** – determines how many rounds a weapon spends with each shot. E.g., shotguns fires multiple pellets per shot, but spend only one round per shot. While [**NSX Masamune**](http://cmdrcyrious.com/rocket-launchers/#NSX_Masamune) fires all 4 rockets at the same time from the hip.

**fire\_auto\_fire\_ms** – sets the weapon’s Refire Rate in fixed burst firemodes.

**fire\_burst\_count** – sets the weapon’s burst length in fixed burst firemodes.

**fire\_charge\_up\_ms** – determines for how long can you hold the fire key before releasing to fire. E.g. [**Lancer**](http://cmdrcyrious.com/rocket-launchers/#Lancer_VS22). It is unclear where the information about different charge levels is stored.

**fire\_delay\_ms** – determines the amount of time that passes between you clicking to fire, and the weapon firing. E.g. [**NSX Yumi**](http://cmdrcyrious.com/nsx-yumi-highly-technical-weapon-guide/), [**RailJack**](http://cmdrcyrious.com/planetside2/weapons/sniper-rifles/#AF-8_RailJack).

**Minimap Fire Detect Range:** fire\_detect\_range

**Refire Time:** fire\_refire\_ms

The amount of time that must pass between shots. Refire Time also plays an important role in **[CoF Recovery](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Cone_of_Fire_Bloom)** and **[Recoil Recovery](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Recoil_Recovery_Delay)** processes. Can be used to calculate weapon’s [**Rate of Fire**](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Fire_Rate):

`Rate of Fire = 60 / Refire Time.`

**Pellets Per Shot:** fire\_pellets\_per\_shot

How many projectiles a weapon fires with each shot. Important for shotguns and other similar weapons.

**Maximum Indirect Damage:** max\_damage\_ind

**Maximum Indirect Damage Radius:** max\_damage\_ind\_radius

**Minimum Indirect Damage:** min\_damage\_ind

**Minimum Indirect Damage Radius:** min\_damage\_ind\_radius

Go [**here**](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Indirect_Damage) to learn about Indirect Damage Mechanics.

#### [Recoil](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Recoil_Mechanics) Statistics

**Maximum Recoil Angle:** recoil\_angle\_max

**Minimum Recoil Angle:** recoil\_angle\_min

**First Shot Recoil Multiplier:** recoil\_first\_shot\_modifier

This is the total multiplier, no need to add or subtract anything.

**Maximum Horizontal Recoil:** recoil\_horizontal\_max

**Minimum Horizontal Recoil:** recoil\_horizontal\_min

**Horizontal Recoil Tolerance:** recoil\_horizontal\_tolerance

**Maximum Vertical Recoil:** recoil\_magnitude\_max

**Minimum Vertical Recoil:** recoil\_magnitude\_min

**Recoil Scaling Stats:** recoil\_increase, recoil\_increase\_crouched, 

recoil\_horizontal\_max\_increase, recoil\_horizontal\_min\_increase

**Recoil Recovery Delay:** recoil\_recovery\_delay\_ms

**Recoil Recovery Rate** aka **Recoil Decrease**: recoil\_recovery\_rate

**recoil\_recovery\_acceleration** – no solid information on how it functions, presumably the value of 1000 means there is no acceleration.


#### Unused or unknown fields

grief\_immune, sprint\_fire, turn\_modifier, use\_in\_water, cof\_override, cof\_range, armor\_penetration, shield\_bypass\_pct

## effect

**Parent Collection:** fire\_mode\_2

**Join keys:** damage\_direct\_effect\_id, damage\_indirect\_effect\_id

This collection’s entries contain effects caused by weapons. Usually, they just repeat the weapon’s damage values, but there are exceptions.

For example, accessing **[Rocket Launchers’ Indirect Damage Effect](<http://census.daybreakgames.com/s:iridar/get/ps2/item?name.en=S1&c:lang=en&c:join=item_to_weapon^inject_at:fire_mode_2(weapon,weapon_to_fire_group^on:weapon_id^to:weapon_id^list:1(fire_group^on:fire_group_id^to:fire_group_id,fire_group_to_fire_mode^on:fire_group_id^to:fire_group_id^list:1(fire_mode_2^on:fire_mode_id^to:fire_mode_id^list:1(effect^on:damage_indirect_effect_id^to:effect_id^list:1(effect_type^list:1))))))>)** allowed to discover the **[Hidden Scaling of Indirect Damage based on Rocket Flight Distance](http://cmdrcyrious.com/rocket-launchers/#Indirect_Damage_Hidden_Distance_Scaling)**.

Similarly to [**zone\_effect collection**](http://cmdrcyrious.com/how-to-use-daybreak-census-api/#zone_effect), you can join the **effect\_type collection** to get textual description of what effect’s parameters do.

## player\_state\_group

Contains some information about weapon’s **[Cone of Fire](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Hip_Accuracy_and_Aim_Accuracy__Cone_of_Fire)** properties, but less than [**player\_state\_group\_2**](http://cmdrcyrious.com/how-to-use-daybreak-census-api/#player_state_group_2).

**Parent Collection:** fire\_mode\_2

Each **fire\_mode\_2 entry** contains a **player\_state\_group\_id**. The **player\_state\_group** collection contains **multiple entries** with the same player\_state\_group\_id.

Each entry contains the **textual description** of the player state, like “Standing” or “CrouchWalking”, and weapon’s **Minimum Cone of Fire** in that state.

**Fields:** player\_state, min\_cone\_of\_fire

## player\_state\_group\_2

Basically the same as **[player\_state\_group collection](http://cmdrcyrious.com/how-to-use-daybreak-census-api/#player_state_group)**, but with more stats.

**Parent Collection:** fire\_mode\_2

**player\_state\_id** – determines which player stance is being described in this entry.

| **Player State ID** | **Stance** | 
| 0 | Standing Still | 
| 1 | Crouching Still | 
| 2 | Standing Moving | 
| 3 | Sprinting | 
| 4 | Falling Long | 
| 5 | Crouching Moving | 

**can\_iron\_sight** – whether the user can Aim Down Sights in this state. This is likely the field that was changed when players lost the ability to Aim Down Sights while jumping and falling.

**cof\_grow\_rate** – degrees per second, the speed of Cone of Fire expansion when it blooms or when the player moves to a stance with larger Minimum CoF.

**cof\_recovery\_rate** – degrees per second, the speed at of Cone of Fire reduction when the user stops firing or moves to a stance with lower Minimum Cone of Fire.

**Maximum Cone of Fire:** cof\_max

**Minimum Cone of Fire:** cof\_min

**Cone of Fire Recovery Delay:** cof\_recovery\_delay\_ms

I assume this functions by the same principles as **[Recoil Recovery Delay](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Recoil_Recovery_Delay)**.

#### Unused or unknown fields

cof\_shots\_before\_penalty, cof\_recovery\_delay\_threshold, cof\_turn\_penalty

## fire\_mode\_to\_projectile

A pass-through collection between **fire\_mode** or **fire\_mode\_2** and **projectile** collections.

## projectile

Contains information about the projectile used by a weapon in specific **fire\_mode**.

**Parent Collection:** fire\_mode\_2 -> fire\_mode\_to\_projectile -> projectile

**Projectile Speed** aka **Muzzle Velocity:** speed

Keep in mind that this field will be usually overridden by **projectile\_speed\_override** in **fire\_mode\_2 entry**.

**[Projectile Lifespan](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Projectile_Lifespan)**: lifespan

**[Dumbfire Rocket Acceleration:](http://cmdrcyrious.com/rocket-launchers/#Dumbfire_Mechanics)** acceleration

**Dumbfire Rocket Maximum Speed:** speed\_max

**[Projectile Gravity](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Muzzle_Velocity)**: gravity

**drag** – unknown field. Possibly a delay between weapon “firing” and projectile appearing. It seems to be greater than zero only for grenade-like weapons. [Drag > 0 query.](<https://census.daybreakgames.com/s:iridar/get/ps2/projectile?drag=%3E0&c:limit=4000&c:join=fire_mode_to_projectile(fire_group_to_fire_mode^on:fire_mode_id^to:fire_mode_id(weapon_to_fire_group^on:fire_group_id^to:fire_group_id(item_to_weapon^on:weapon_id^to:weapon_id(item^on:item_id^to:item_id))))&c:lang=en>)

**Projectile Flight Type:** projectile\_flight\_type\_id

This field can be used to search or join the **projectile\_flight\_typecollection**. This is a small collection with only a few **entries**:

- Ballistic
- True Ballstic – Uses Real Gravity
- Dynamic
- Proximity Detonate

These descriptions can be used to *speculate* how the projectile will behave in game.

-  **Ballistic** type is likely to “detonate” and disappear upon hitting anything.
- **Dynamic** type is assigned to grenade-like projectiles, so it means it will bounce around until the lifespan is over, and then it will “detonate”.
- **Proximity Detonate** type likely means the projectile will “detonate” when near an eligible enemy object. E.g. flak weapons.

By “detonate” I mean the projectile will apply its effects. E.g. a bullet will deal direct damage, a rocket will explode and deal direct and indirect damage, a Smoke Grenade will puff out smoke.

**[Lock-on Turn Rate](http://cmdrcyrious.com/rocket-launchers/#Lock-on_Mechanics)**: turn\_rate 

**[Lock-on Lose Angle](http://cmdrcyrious.com/rocket-launchers/#Lock-on_Mechanics)**: lockon\_lose\_angle

**[Lock-on Lifespan](http://cmdrcyrious.com/rocket-launchers/#Lock-on_Mechanics)**: lockon\_lifespan

**[Lock-on Acceleration](http://cmdrcyrious.com/rocket-launchers/#Velocity_of_Locked-on_Rockets_is_Unknown)**: lockon\_acceleration


Still no idea how it works.

## item\_attachment

PlanetSide 2 weapon attachments are also a part of the **item collection**. The **item\_attachment collection** contains **entries** with **item\_id**s of attachments, available to a weapon with a certain item\_id.

[Example query.](https://census.daybreakgames.com/s:iridar/get/ps2/item?name.en=TRAC-5&c:lang=en&c:join=item_attachment^list:1)**Example response.**

**Parent Collection:** item

Then you can **[join the item collection](<https://census.daybreakgames.com/s:iridar/get/ps2/item?name.en=TRAC-5&c:lang=en&c:join=item_attachment^list:1(item^on:attachment_item_id^to:item_id)>)** to get the **item entries** for all attachments, available to a weapon.

## zone\_effect

Among other things, this collection contains **effects of all weapon attachments**.

**Parent Collection:** item

Most attachment **item entries** have a **passive\_ability\_id** field. You can use this to **join** it with **ability\_id** of **zone\_effect** entries.

## zone\_effect\_type

This collection contains **textual descriptions** of values stored in **zone\_effect entries**.

Each **zone\_effect entry** has a **zone\_effect\_type\_id** field. It can be used to create a **join** with **zone\_effect\_type collection**.

## Attachment Effects Examples

Figuring out attachment effects can get kinda messy, so let’s go over a few examples so you get the general idea of how it works.

### [Scope](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Scopes)

![](http://cmdrcyrious.com/wp-content/uploads/2017/07/scope-attachment.png)


**[Query.](<https://census.daybreakgames.com/s:iridar/get/ps2/item?name.en=TRAC-5&c:lang=en&c:join=item_attachment^list:1(item^on:attachment_item_id^to:item_id(zone_effect^on:passive_ability_id^to:ability_id^list:1(zone_effect_type)))>)** Here we are interested in four things.

1. The attachment affects all fire\_groups.
2. The attachment affects only fire\_modes with index of 1 (usually, ADSing).
3. The attachment changes weapon’s default zoom in affected firemodes.
4. The value is changed by adding “1” to it.

M-77B has Default Zoom of “6”, so the 7x Scope Attachment simply adds “1” to that value.

### [Forward Grip](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Forward_Grip_Advanced_Forward_Grip)

![](http://cmdrcyrious.com/wp-content/uploads/2017/07/forward-grip-effects.jpg)


The “string1” description tells us the affected weapon statistic is Maximum Recoil Angle.

“param1” and “param2” are set to “-1”, which means that all weapon’s Fire Modes are affected by the attachment, i.e. regardless if you hip fire or ADS and from which stance.

“param3” is not set for this effect.

“param4” is set to “-25”. Description of param4 is “PcntAddend”, where “pcnt” stands for “percent”. **So this effect of the Forward Grip reduces Maximum Recoil Angle by 25%.**

But there are other effects of the Forward Grip.

![](http://cmdrcyrious.com/wp-content/uploads/2017/07/forward-grip-effects2.jpg)


**For example, here we can see that for TRAC 5 Forward Grip also increases Equip Time by 150ms.**

### [Suppressor](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Suppressor)

![](http://cmdrcyrious.com/wp-content/uploads/2017/07/suppressor-effects.jpg)


Here we can see that Suppressor for TRAC 5 reduces Max Damage Range by 5m and Min Damage Range by 20m.

### [HS/NV Scope](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#HSNV_IRNV_scope)

![](http://cmdrcyrious.com/wp-content/uploads/2017/07/HSNV-effect.jpg)


Increases the time it takes to ADS by 150ms.

For comparison, by default it takes TRAC 5 another 150ms to ADS:

![](http://cmdrcyrious.com/wp-content/uploads/2017/07/scope-in-time.jpg)


### [Underbarrel Grenade Launcher](http://cmdrcyrious.com/planetside2/weapons/weapon-attachments/#Underbarrel_Grenade_Launcher_UBGL)

![](http://cmdrcyrious.com/wp-content/uploads/2017/07/grenade-launcher-attachment.png)


**[Example query.](<https://census.daybreakgames.com/s:iridar/get/ps2/item?name.en=TRAC-5%20S&c:lang=en&c:join=item_attachment^list:1(item^on:attachment_item_id^to:item_id(zone_effect^on:passive_ability_id^to:ability_id^list:1(zone_effect_type)))>)** We can see that Underbarrel Grenade Launcher attachment adds a Fire Group to a weapon. **[Let’s query that Fire Group](<https://census.daybreakgames.com/s:iridar/get/ps2/fire_group?fire_group_id=48&c:join=fire_group_to_fire_mode^list:1(fire_mode_2^on:fire_mode_id^to:fire_mode_id)>)**. Here’s what we get:

![](http://cmdrcyrious.com/wp-content/uploads/2017/07/grenade-launcher-query.png)


This way we can access exact stats of the Grenade Launcher, and learn that it takes 0.8 seconds to switch to it.

## Ability Effects Examples

**zone\_effect collection** also contains effects of passive and active abilities, such as Zealot Overdrive Engine of VS MAXes. [Example query.](<http://census.daybreakgames.com/s:iridar/get/ps2/item?name.en=Zealot%20Overdrive%20Engine%201&c:lang=en&c:join=zone_effect^on:activatable_ability_id^to:ability_id^list:1(zone_effect_type)>)

We can query the [**armor\_info collection**](http://census.daybreakgames.com/get/ps2/armor_info?armor_info_id=1081,1080,1083,1084,1085) and learn that ZOE 1 increases incoming damage  by 20% from all sides except Bottom.

# Armor and Resistances

You can learn about Armor and Resistance interactions **[here](http://cmdrcyrious.com/planetside2/weapons/weapon-mechanics/#Health_Armor_and_Resistances)**.

[**profile\_2**](http://census.daybreakgames.com/s:iridar/get/ps2/profile_2?c:limit=500) – contains unit names and their **profile\_id**s.

[**profile\_armor\_map**](http://census.daybreakgames.com/get/ps2/profile_armor_map?c:limit=100), [**profile\_resist\_map**](http://census.daybreakgames.com/get/ps2/profile_resist_map?c:limit=100) – contains **armor\_info\_id**s and **resist\_info\_id**s for built-in armor and resistance values for all profiles, using **profile\_id** as key.

[**armor\_facing**](http://census.daybreakgames.com/get/ps2/armor_facing?c:limit=100) – contains descriptions for different **armor\_facing\_id**s. You need those to learn which armor\_info is applied to which unit’s projection.

[**armor\_info**](http://census.daybreakgames.com/get/ps2/armor_info?c:limit=100) – contains the actual information about units’ armor, both built-in and acquired from items and abilities, using **armor\_info\_id** as key.

[**resist\_info**](http://census.daybreakgames.com/get/ps2/resist_info?c:limit=100) – same as armor\_info, but for resistances. **resist\_info\_id** is key.

[**resist\_type**](http://census.daybreakgames.com/get/ps2/resist_type?c:limit=100) – contains textual descriptions for different **resist\_type\_id**s. Incomplete and sometimes not exactly accurate.

For example, it doesn’t contain Damage Type 9 – Tank Mine and Damage Type 11 – C4. It also won’t tell you that AV Grenades use Damage Type 34 – Infantry Rockets.

All of these collections are utilized in the “**[Resistances](http://cmdrcyrious.com/toolbox/#Resistances_Page)**” and “**[Built In Resistances](http://cmdrcyrious.com/toolbox/#Built_In_Resistances_Page)**” pages of the **[Toolbox](http://cmdrcyrious.com/toolbox/)**, which calculates weapon damage to vehicles.

This **[multi-join query](<http://census.daybreakgames.com/s:iridar/get/ps2/profile_2?profile_id=26&c:join=profile_resist_map^on:profile_id^to:profile_id^list:1^show:resist_info_id(resist_info(resist_type^show:description^inject_at:resist_type))&c:join=profile_armor_map^on:profile_id^to:profile_id^list:1^hide:rank(armor_info(armor_facing^show:description^inject_at:facing))>)** will show you built-in Armor and Resistance values for the Lightning.

# Credits

Huge thanks to **/u/L33-the-3rd**, **/u/shaql**, **/u/fisu\_**, **/u/Wrel** and **/u/nehylen** for teaching me how to use the API. You guys are awesome, wouldn’t be here without y’all.

Thanks for sharing.

I want to prepare a script. For example!

Server Name | Server Location | Server Population | Server Status

I would like to draw some information like this, would you give me a sample in it? Also https://census.daybreakgames.com/get/ps2/ I could not see anything related to the server in it.

Please

Sorry I don’t know anything about using API for info about servers/population. Try asking FISU or H\_Q\_.
