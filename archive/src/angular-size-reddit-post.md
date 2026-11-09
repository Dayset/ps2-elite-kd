# Results of the testing related to my Angular Size research: debunked as wrong?

- **Source (live):** https://www.reddit.com/r/Planetside/comments/6z5uax/results_of_the_testing_related_to_my_angular_size/
- **Author:** u/Iridar51
- **Posted:** 2017-09-10 (r/Planetside, score 27)
- **Saved:** 2026-11-09, by Dayset as a browser MHTML snapshot — automated fetch of reddit.com is blocked, so the post was saved by hand
- **Raw snapshot:** `raw/angular-size-reddit-post.mhtml`
- **Status:** 💀 DEAD (kept for history) — Iridar debunks his own Angular Size research in this post and takes it down, along with the Ideal Burst Length Calculator and the CoF page in his Toolbox. The correction chain continues in the comments (u/BoatsFriends proposes projectile size as the cause; Iridar confirms a large bullet hitbox) and ends with Dorf's 2023 measurement of the projectile radius at 0.03 m.

---

## The post

u/Iridar51, 2017-09-10.

## Prehistory

Somewhat recently I humiliated myself participated in an interesting discussion regarding crosshairs and how they relate to CoF size.

The short of it, I speculated that PS2 probably doesn't have the means to draw a crosshair that accurately represents actual weapon Cone of Fire. Then u/Stan2112 and u/Azukae mentioned Aphelion, and how its crosshair actually represents weapon's CoF.

I was skeptical, made a few screenshots and tried to debunk their claim, referring to my Angular Size research, according to which, Aphelion's CoF should be much smaller than displayed crosshair.

They replied with screenshots of Aphelion shots clearly going outside the supposed CoF size. Only then I bothered to do what I should've done from the start - actually fired the Aphelion, and confirmed their claim. I confess to the sin of feeling righteous and entitled.

That incident was a good indication that Angular Size research might be wrong, and only then I realize that I never actually bothered to test it.

## The test

I went into VR with Eridani with 4x Scope and Sweeper HUD. I positioned myself 50m away from target dummies, aimed directly at the center of the head, and used the keyboard to fire single shots. Any hits or misses should have been dictated exclusively by Eridani's starting Cone of Fire, which is equal to 0.3 degrees in all stances.

Total shots: 351
Headshots: 200
Bodyshots: 47
Complete misses: 104

From the perspective of the test, bodyshots are treated the same as misses. So out of all shots, ~43% missed completely or hit the body, and 57% hit the head.

According to Angular Size research, the head hitbox at that range should have about ~0.2 degrees of Angular Size. Depending on method of measurement, the results can vary within ~10% or so.

So the Eridani's CoF is ~50% larger than target's hitbox.

However, we are interested in hit probabilities, which should be determined by the relative areas of the circles.

Using the diameter (D) of the circle, we can calculate its area as: S = D * D * Pi / 4

Hitbox area: 0.0309
CoF Area: 0.0706

If we put these circles on top of each other - which is what I supposedly did with the firing test - the hitbox area would make up for 43.7% of the CoF area. So we should be getting ~44% of headshots, and ~56% of misses and bodyshots.

Clearly that is not the case. So that pretty much seals it.

## Conclusion

The Angular Size research as it is on my site is wrong, and I will be taking it down. So is the Ideal Burst Length Calculator and the CoF Page in my Weapon Toolbox, which use the Angular Size research as the basis for their calculations. I'm very sorry for the lack of effort in properly testing these tools before releasing them to the public. If its any consolation, I've been relying on the same wrong information myself this whole time, though it probably only makes it worse, since I based many recommendations on it.

Turns out, based just on CoF values, we cannot predict approximate weapon accuracy at a certain range. What you can personally test in-game is also limited, because we're usually mostly interested in moving CoFs, which you can't test easily.

EDIT: Per the suggestion of u/BoatsFriends, it makes sense to assume that the discrepancy between projected and tested accuracy values is caused by bullet projectile size. Bullets have invisible dimensions, and they can still hit the target, even if you are not directly aiming at it. This is a hit. So this would explain why in-game weapons hit more than shots than my calculations would suggest.

However, without knowing the exact size of the projectile, it's not possible to confirm this assumption, and Angular Size research remains useless for the purposes of determining weapon's accuracy at range.

---

## Comments (23)

Thread order as shown on the page. Indentation follows the reply depth.

**u/ShadowInsignus** — 2017-09-10 · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmts8es/)

> Humble confessions are the path to forgiveness, my son, and the community accepts them, in the name of the Valker, the Spotter, and the Boomy Frisbee, Amen.
>
> But I'm busy at the moment. Go hop on the game and personally train 5 rank 1 newbies as your absolution ;D
>

**u/DefinitelyHelpfulBot** — 2017-09-10 (reply to u/ShadowInsignus) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmts8ir/)

> > WTF Richard?
> >

**u/[deleted]** — 2017-09-10 · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmt6rir/)

> You are the rocket scientist of PS2, no pun intended.
>
> I actually read your stuff up after years of playing and learned a few things I didn't know.
>

**u/H_Q_** — 2017-09-10 · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmt3krg/)

> Well, well, well. First d0ku confesses and now you. Should we be worried what u/Wrel might come up with?
>

**u/VORTXS** — 2017-09-10 (reply to u/H_Q_) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmt7cdc/)

> > Hopefully something good for all this cai shit.
> >
> > Aka "I'm sorry I'm I have vs favouritism."
> >

**u/H_Q_** — 2017-09-10 (reply to u/VORTXS) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmtbx7d/)

> > > Aww come on, don't get your panties in a wad.
> > >

**u/AmigAtari** — 2017-09-10 · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmsxhqu/)

> We appreciate the transparency and admission of erring. However, even if you are incorrect 5% of the time, the other 95% well more than makes up for it. Your dedication and work is appreciated to the highest degree.
>
> Personally, you have influenced my gameplay and purchase decisions so much that even if your information is wrong once in a while, it's more than forgivable.
>
> You are doing more than 99.9% of the player base is doing and it is beyond useful.
>

**u/Iridar51** — 2017-09-10 (reply to u/AmigAtari) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmtdys7/)

> > Appreciated :)
> >

**u/moewillis2** — 2017-09-10 (reply to u/AmigAtari) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmt3y32/)

> > Amen! Couldn't have said it better myself.
> >
> > We are all human and err from time to time. You've already made up for this one iridar, just don't let it happen again... :)
> >

**u/BoatsFriends** — 2017-09-10 · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmsucb0/)

> just fyi, the charged shot projectile will start out lower than the regular projectiles. Kind of like how bullets start from the chest or something like that or it just has a bigger projectile size. Try pull a harasser then drive up to the side of the hood of a harasser. You can fire normal shots which will all miss, then hit with your charged shot. This is how I figured out the charged shot is equal to 4x regular shots, probably. Do you have any idea how to find out through the API? Would it be under zone effect stuff or maybe projectile stuff? (I'm not even sure if the charged shot starts out lower, but it looks that way visually. And yeah the Charged shot is large so who knows how big the normal shots are in comparison to the eridani.)
>

**u/Iridar51** — 2017-09-10 (reply to u/BoatsFriends) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmsurxy/)

> > Wait a second. The Aphelion projectile stuff has nothing to do with the topic, and no, I don't think that projectile size is accessible anywhere in the API.
> >
> > HOWEVER. The bullet projectile size would actually explain the discrepancy between projected and tested values. According to raw calculations, I should have been getting more misses. But there have been more hits. This would happen if bullets that had trajectory outside the actual head hitbox would still glance it, and that would count as a hit.
> >
> > The discrepancy is fairly large, though. It is possible that PS2 uses a sort of mechanic that makes bullet hitboxes larger at range.
> >
> > Gonna need to run some tests. Perhaps Angular Size wasn't wrong after all.
> >
> > EDIT: Though without knowing the actual hitbox size of the bullet it would still be useless.
> >
> > EDIT2: Yep, that confirms it. The bullet hitbox is fairly large, and allows you to score a hit even while clearly aiming past the head. That is a hit: http://i.imgur.com/vAet3dz.jpg
> >
> > However, without a way to know the exact size of a projectile, Angular Size cannot be used to determine weapon's effective range, because it always will underestimate weapon's accuracy by an unknown amount. And that's assuming that discrepancy is even caused by projectile size.
> >

**u/BoatsFriends** — 2017-09-10 (reply to u/Iridar51) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmt4f16/)

> > > random thoughts:
> > >
> > > Is there a fixed FOV when gunning? Were there enough test shots? Would a 0.99 meter difference account for the discrepancy? Like if you were 50.99 meters away when shooting? With regard to translation of degrees into pixels... What about fractions of pixels? Also maybe try setting render quality to 2.000000 for more refined crosshairs.
> > >
> > > Also,
> > >

**u/Iridar51** — 2017-09-10 (reply to u/BoatsFriends) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmtdq9d/)

> > > > Is there a fixed FOV when gunning?
> > > >
> > > > Yes, ~45 degrees of Vertical FoV, according to my tests. Piloting the vehicle is affected as well, probably.
> > > >
> > > > Would a 0.99 meter difference account for the discrepancy?
> > > >
> > > > Nope.
> > > >
> > > > What about fractions of pixels?
> > > >
> > > > Yeah, the statistical error would be somewhere in the ballpark of +/- ~10%. E.g. 40% vs 44% of misses would be okay, but not 43% vs 57%.
> > > >
> > > > Also maybe try setting render quality to 2.000000 for more refined crosshairs.
> > > >
> > > > It doesn't change much. Crosshairs were only mentioned in the context of the Aphelion, which doesn't have much to do with the test itself, performed on the Eridani.
> > > >

**u/BoatsFriends** — 2017-09-10 (reply to u/Iridar51) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmtjvpu/)

> > > > > what if fov was fixed at 40 instead of 45?
> > > > >

**u/Iridar51** — 2017-09-10 (reply to u/BoatsFriends) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmtk9ys/)

> > > > > > Just retested and fairly sure it's 45 for gunners. Could be different for vehicle pilot. Once again, it doesn't change anything regarding the Eridani tests, which are mostly like explained by bullet hitbox size.
> > > > > >

**u/middleground11** — 2017-09-10 · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmss8j0/)

> Question, does this mean using scopes can have a different recoil pattern or cone of fire compared to irons, reflex, etc?
>

**u/Iridar51** — 2017-09-10 (reply to u/middleground11) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmssua0/)

> > Good question. Normally I'd say no, but right now the translation of degrees into pixels doesn't make any sense to me.
> >
> > For example, Aphelion-H crosshair, which supposedly encases the CoF of 0.85 degrees at 45 FoV, has 44 pixel diameter without ADS, and 102 pixel with 2x Zoom. Try to wrap your head around that. Mine doesn't.
> >
> > The crosshair seems to fairly accurately represent Aphelion's bullet distribution pattern in both ADS and without ADS, so it's not the case of ADS crosshair just being randomly bigger.
> >
> > I feel like there's some sort of advanced optics phenomenon is involved.
> >
> > That said, I vaguely recall specifically testing the assertion that in ADS mode weapons have more recoil, and the result was negative.
> >

**u/Mvaughan1** — 2017-09-10 (reply to u/Iridar51) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmtkkkj/)

> > > I do remember reading the other night that you stated iron sights can be slightly inaccurate compared to even a 1x dot. I've been putting at least some kind of sight on all my weapons now. Was I reading that correctly? Or does it even matter with a reticle overlay? Thanks.
> > >

**u/Iridar51** — 2017-09-10 (reply to u/Mvaughan1) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmtlhfy/)

> > > > Yes, this doesn't have anything to do with Angular Size stuff. Iron Sights are bad because they are physical models, attached to the weapon, which wobbles and shake while moving and firing.
> > > >
> > > > Center of the weapons' Cone of Fire is always at the exact middle of the screen, but Iron Sights often deviate from that position, so they basically do not point where you're firing.
> > > >
> > > > Reflex dots and proper crosshair overlays are always in the exact center of the screen, so they don't have this issue.
> > > >

**u/Mvaughan1** — 2017-09-11 (reply to u/Iridar51) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmugzws/)

> > > > > Ah, thanks for clearing up my confusion and thanks for the great info on Iridar!
> > > > >

**u/[deleted]** — 2017-09-10 · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmsrua1/)

> B-but that's impossible, you're never wrong!!!
>

**u/Iridar51** — 2017-09-10 (reply to u/[deleted]) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmsslr0/)

> > I've been wrong about a lot of things. For example, for years, I used to say to people that NMG / Adrenaline isn't affected by Nanoweave, relying on someone else's say-so. When I actually bothered to test, turned out it wasn't the case. When I came to reddit to share the news, turned it was "common knowledge", even though nobody bothered to correct me on it for years.
> >
> > So I'm actually really grateful to u/Stan2112 [+1] and u/Azukae for correcting me. This is another thing that I'm usually preaching - don't trust people's words (including mine), test things properly yourself. This is the best path to the truth.
> >
> > Most of the time, I thoroughly test out my assertions, but this wasn't the case with Angular Size stuff. Which is really sad. I'm genuinely ashamed to so let down the PS2 community. I know that vast majority of people don't care about such complicated matters, but I was really proud of this Angular Size stuff, because it gave a nice (if approximate) way of figuring out weapon's effective range based on CoF.
> >
> > I've no intention of stopping my quest, though, and I'll try to figure out a way to find a new way. Even at the cost of sitting in VR for hours, if it comes to that.
> >

**u/Mentleman** — 2017-09-10 (reply to u/Iridar51) · [permalink](https://www.reddit.com/r/Planetside/comments/6z5uax/comment/dmt4o0s/)

> > > ur the batman of auraxis
> > >
