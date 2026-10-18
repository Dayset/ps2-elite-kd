# Game Theory for 3-Faction PS2 Alerts
## Research notes — 2026-10-04 (Part I: in-game commander), 2026-10-11 (Part II: market design)

---

# PART II — Market-design game theory (bettor behavior)
## Research dive 2026-10-11 — aimed at our parimutuel market design

Product context for this part: 3-faction parimutuel prediction market on alert
outcomes, virtual points, no real money. AI oracle posts per-faction win
probabilities with star confidence ratings. Graded fees by displayed odds: 5%
at 50%, 15% at 80%, 30% at 90%, +10% kicker above 75%. Fees feed the winners'
pot; no house cut. A faction's market closes when the oracle locks it at 100%.

### HEADLINE FINDING
The literature predicts this market will systematically OVERPRICE the trailer
and UNDERPRICE the leader — and our graded fee schedule COMPOUNDS that skew
instead of correcting it. It taxes leader-bets at 30–40% while trailer-bets
cost ~5%, and bettor psychology already pushes the same direction (overweight
small probabilities, underweight large ones). The fee curve accidentally
mirrors the cognitive distortion. (Sources: Kahneman & Tversky 1979; Snowberg
& Wolfers 2010; Ziemba 2023 Annual Review.)

### 1. Parimutuel equilibrium — informed money bets LATE
- Bettors can't condition on final odds, so everyone betting at once means a
  high final pool share *reveals* favorable info nobody can react to
  (Ottaviani & Sørensen, AER 2009).
- Late money is the sharp money: horses whose odds declined in the final five
  minutes earn higher returns at identical final odds (Hanyu et al., arXiv 2026).
  Asch & Quandt (1986) built a whole system off late money.
- Equilibrium play is back-loaded: waiting dominates, early bettors get diluted.
  Koessler et al. (2002) characterize the unique sequential-parimutuel
  equilibrium; transaction costs + probability attitudes generate the bias.
- Herding is real in-play: soccer bettors' stakes run ~12.7pp higher the minute
  after their team scores (Reading Univ. "Gambling on Momentum"). Expect the
  same after base flips in a live alert.
- Cautionary tale: CAW syndicates (~30%+ of US horse-racing handle) bet seconds
  before post, crashing odds after casuals are locked in. Tracks now throttle
  CAW 1–2 min before post (NYRA 2026, Del Mar 2025).
- In parimutuel pools the favorite is systematically UNDERBET vs true chance
  (same direction as fixed-odds; flatter on exchanges like Betfair).

### 2. Favorite-longshot bias — who donates to whom
- Textbook magnitudes (horse racing): ~5% long-run loss betting favorites vs
  ~40% on longshots. First documented Griffith (1949).
- Explanations, no single winner: risk-love (Ali 1977; Quandt 1986),
  misperceived probabilities — data favor misperception in prospect-theory
  style (Snowberg & Wolfers 2010), information scarcity (Sobel & Raines 2003 —
  bias can REVERSE where experts dominate), survival dynamics (Kajii &
  Watanabe 2014), bragging rights (Thaler & Ziemba 1988).
- It CAN reverse: Hong Kong, Japan, baseball show reverse bias (risk-averse
  bettor populations). Heterogeneous pools explain cross-market differences.
- In OUR 3-faction pool: the trailer gets overbet, the leader underbet — value
  flows from trailer-backers to leader-backers. Milder than 10-horse races
  (less room for extreme longshots), same direction. Twist: fees go to the
  winners' pot, so the "donation" partly recycles — trailer-backers still lose,
  but their fees inflate what leader-backers collect.

### 3. Prospect theory / probability weighting — the fee curve problem
- At 90%+ odds: bettors underweight the large probability (90% *feels* like
  ~75–80%), and cumulative-prospect-theory work finds bettors unwilling to take
  near-certain shots at unfair prices. Add 30% fee + 10% kicker = 40% total:
  the leader's bet feels doubly bad — psychologically discounted AND heavily
  taxed. Expect chronic leader underbetting.
- At ~20% longshots: overweighting makes 20% feel like ~30%+, fee at its
  lowest, payoff salient. Expect chronic trailer overbetting — stacks with the
  favorite-longshot bias, same direction.
- Bettors evaluate the FRAMED, edited gain. A hidden 40% fee on a 90% shot is
  a misperception engine.

### 4. Ambiguity aversion (Ellsberg) — what stars do to behavior
- Ellsberg (1961): people prefer known 50/50 urns over unknown-composition
  urns — aversion to uncertainty *about beliefs*, not payoff variance
  (confirmed Whelan, UCD 2025).
- Making uncertainty explicit (stars) should REDUCE betting on low-star
  factions vs a bare probability. Two framing hazards: (1) stars read as
  *quality grades* ("3 stars = decent bet") not "the model is unsure";
  (2) high stars inflate trust in the point estimate, encouraging leader
  overbetting on top of prospect-theory effects.
- Interaction with the 100%-lock: locking removes ALL ambiguity for that
  faction, making the remaining two feel relatively MORE ambiguous — expect a
  brief betting pullback right after a lock, then re-concentration. Don't
  misread the pullback as a bug.

### 5. Sportsbook risk craft — do they predict or balance?
- BOTH models exist. Textbook (Zuber et al. 1985; Sauer et al. 1988): set
  market-clearing prices, earn the vig risk-free on balanced action.
- Levitt (2004, EJ): books post prices, adjust little, and TAKE POSITIONS —
  being better forecasters than bettors and shading prices to exploit known
  biases (e.g. road favorites), earning more than the commission. Caveat: his
  data were a prediction tournament, not a real book.
- Opening lines: oddsmaker models (power ratings, injuries, momentum), opened
  with LOW limits as "feeling-out" — respected sharps get first crack at small
  stakes and shape the line (Wynn practice), then limits rise for the public.
- Sharp vs square: ~$5k from a respected sharp moves the line more than $20k
  of public money. Reverse line movement (tickets one side, line moves other
  way) = the sharp tell. Books are "comfortable with uneven splits" when they
  trust their price.
- Profiling winners: the industry's sharp-detector is BEATING THE CLOSING
  NUMBER (closing line value, CLV), not "he wins a lot". Responses: limit cuts,
  dual lines, account closure. "Sharp" books (Pinnacle-style) accept the action
  and move the line instead. US retail books routinely limit winners while
  VIP-treating losers (Massachusetts 2026 now requires notification on limits).
- MAPPING TO US: operator has no exposure (no house cut; parimutuel), so
  classic book-balancing doesn't apply. The oracle = the oddsmaker posting an
  opener; the pool = the market. Transferable crafts: (1) low-confidence
  openers → explicit uncertainty display; (2) CLV-style profiling → make it
  PUBLIC, not private; (3) pull markets when outcome known → the 100%-lock.

### DESIGN RECOMMENDATIONS (from the research, aimed at our market)
1. **Show net-of-fee effective payouts, not gross oracle odds.** "Stake 100 →
   132 net if VS wins" at current pool shares minus the faction's fee band.
   Makes the favorite-longshot donation (oracle 64% vs pool-implied 52%)
   visible — the cheapest debiasing tool in the literature.
2. **Soft-suspension band before the 100% lock** (~95% oracle confidence:
   suspend new bets or cap stakes). A hard 100% cutoff invites last-second
   sniping into a nearly-decided pool — the CAW dynamic that makes casuals
   feel cheated. The lock rule is right; give it a ramp.
3. **Publish a "smart money" indicator instead of profiling privately.**
   Show what share of each faction's pool comes from historically profitable
   accounts (CLV analogue). Turns the sportsbook's private weapon into public
   information aggregation; deters manipulation by making it observable.
4. **Reconsider the fee curve vs probability weighting.** Current schedule
   compounds the bias. Either flatten it (e.g. cap total fee ~20%) or frame it
   as the bias-correction mechanism in the UI ("high fee because the model is
   very confident — the crowd usually underbets these") so it reads as
   information, not punishment.
5. **Display uncertainty as interval + labeled stars, never a bare high
   probability.** "Model range 55–75%, certainty 3/5 — certainty means model
   confidence, not bet quality." A bare "92%, ★★★★★" maximally invites
   overconfidence wagers.
6. **Counter late-betting equilibrium: early-betting fee discount or late
   stake caps.** Informed players optimally wait and dilute early bettors;
   back-loaded pools harvest casuals. A small fee discount for first-half
   bets, or per-account stake caps in the final minutes, protects the
   recreational players who fund the ecosystem.

### OPEN QUESTIONS (researcher could not verify)
- No empirical data on gamer/virtual-points populations — all bias magnitudes
  are from racing/sports/prediction markets. Play-money stakes may dampen or
  amplify effects; unverified.
- Exact fee interpolation between our anchor points was not equilibrium-modeled.

---

# PART I — In-game commander game theory (2026-10-04, unchanged) (Part I: in-game commander), 2026-10-11 (Part II: market design)

---

# PART II — Market-design game theory (bettor behavior)
## Research dive 2026-10-11 — aimed at our parimutuel market design

Product context for this part: 3-faction parimutuel prediction market on alert
outcomes, virtual points, no real money. AI oracle posts per-faction win
probabilities with star confidence ratings. Graded fees by displayed odds: 5%
at 50%, 15% at 80%, 30% at 90%, +10% kicker above 75%. Fees feed the winners'
pot; no house cut. A faction's market closes when the oracle locks it at 100%.

### HEADLINE FINDING
The literature predicts this market will systematically OVERPRICE the trailer
and UNDERPRICE the leader — and our graded fee schedule COMPOUNDS that skew
instead of correcting it. It taxes leader-bets at 30–40% while trailer-bets
cost ~5%, and bettor psychology already pushes the same direction (overweight
small probabilities, underweight large ones). The fee curve accidentally
mirrors the cognitive distortion. (Sources: Kahneman & Tversky 1979; Snowberg
& Wolfers 2010; Ziemba 2023 Annual Review.)

### 1. Parimutuel equilibrium — informed money bets LATE
- Bettors can't condition on final odds, so everyone betting at once means a
  high final pool share *reveals* favorable info nobody can react to
  (Ottaviani & Sørensen, AER 2009).
- Late money is the sharp money: horses whose odds declined in the final five
  minutes earn higher returns at identical final odds (Hanyu et al., arXiv 2026).
  Asch & Quandt (1986) built a whole system off late money.
- Equilibrium play is back-loaded: waiting dominates, early bettors get diluted.
  Koessler et al. (2002) characterize the unique sequential-parimutuel
  equilibrium; transaction costs + probability attitudes generate the bias.
- Herding is real in-play: soccer bettors' stakes run ~12.7pp higher the minute
  after their team scores (Reading Univ. "Gambling on Momentum"). Expect the
  same after base flips in a live alert.
- Cautionary tale: CAW syndicates (~30%+ of US horse-racing handle) bet seconds
  before post, crashing odds after casuals are locked in. Tracks now throttle
  CAW 1–2 min before post (NYRA 2026, Del Mar 2025).
- In parimutuel pools the favorite is systematically UNDERBET vs true chance
  (same direction as fixed-odds; flatter on exchanges like Betfair).

### 2. Favorite-longshot bias — who donates to whom
- Textbook magnitudes (horse racing): ~5% long-run loss betting favorites vs
  ~40% on longshots. First documented Griffith (1949).
- Explanations, no single winner: risk-love (Ali 1977; Quandt 1986),
  misperceived probabilities — data favor misperception in prospect-theory
  style (Snowberg & Wolfers 2010), information scarcity (Sobel & Raines 2003 —
  bias can REVERSE where experts dominate), survival dynamics (Kajii &
  Watanabe 2014), bragging rights (Thaler & Ziemba 1988).
- It CAN reverse: Hong Kong, Japan, baseball show reverse bias (risk-averse
  bettor populations). Heterogeneous pools explain cross-market differences.
- In OUR 3-faction pool: the trailer gets overbet, the leader underbet — value
  flows from trailer-backers to leader-backers. Milder than 10-horse races
  (less room for extreme longshots), same direction. Twist: fees go to the
  winners' pot, so the "donation" partly recycles — trailer-backers still lose,
  but their fees inflate what leader-backers collect.

### 3. Prospect theory / probability weighting — the fee curve problem
- At 90%+ odds: bettors underweight the large probability (90% *feels* like
  ~75–80%), and cumulative-prospect-theory work finds bettors unwilling to take
  near-certain shots at unfair prices. Add 30% fee + 10% kicker = 40% total:
  the leader's bet feels doubly bad — psychologically discounted AND heavily
  taxed. Expect chronic leader underbetting.
- At ~20% longshots: overweighting makes 20% feel like ~30%+, fee at its
  lowest, payoff salient. Expect chronic trailer overbetting — stacks with the
  favorite-longshot bias, same direction.
- Bettors evaluate the FRAMED, edited gain. A hidden 40% fee on a 90% shot is
  a misperception engine.

### 4. Ambiguity aversion (Ellsberg) — what stars do to behavior
- Ellsberg (1961): people prefer known 50/50 urns over unknown-composition
  urns — aversion to uncertainty *about beliefs*, not payoff variance
  (confirmed Whelan, UCD 2025).
- Making uncertainty explicit (stars) should REDUCE betting on low-star
  factions vs a bare probability. Two framing hazards: (1) stars read as
  *quality grades* ("3 stars = decent bet") not "the model is unsure";
  (2) high stars inflate trust in the point estimate, encouraging leader
  overbetting on top of prospect-theory effects.
- Interaction with the 100%-lock: locking removes ALL ambiguity for that
  faction, making the remaining two feel relatively MORE ambiguous — expect a
  brief betting pullback right after a lock, then re-concentration. Don't
  misread the pullback as a bug.

### 5. Sportsbook risk craft — do they predict or balance?
- BOTH models exist. Textbook (Zuber et al. 1985; Sauer et al. 1988): set
  market-clearing prices, earn the vig risk-free on balanced action.
- Levitt (2004, EJ): books post prices, adjust little, and TAKE POSITIONS —
  being better forecasters than bettors and shading prices to exploit known
  biases (e.g. road favorites), earning more than the commission. Caveat: his
  data were a prediction tournament, not a real book.
- Opening lines: oddsmaker models (power ratings, injuries, momentum), opened
  with LOW limits as "feeling-out" — respected sharps get first crack at small
  stakes and shape the line (Wynn practice), then limits rise for the public.
- Sharp vs square: ~$5k from a respected sharp moves the line more than $20k
  of public money. Reverse line movement (tickets one side, line moves other
  way) = the sharp tell. Books are "comfortable with uneven splits" when they
  trust their price.
- Profiling winners: the industry's sharp-detector is BEATING THE CLOSING
  NUMBER (closing line value, CLV), not "he wins a lot". Responses: limit cuts,
  dual lines, account closure. "Sharp" books (Pinnacle-style) accept the action
  and move the line instead. US retail books routinely limit winners while
  VIP-treating losers (Massachusetts 2026 now requires notification on limits).
- MAPPING TO US: operator has no exposure (no house cut; parimutuel), so
  classic book-balancing doesn't apply. The oracle = the oddsmaker posting an
  opener; the pool = the market. Transferable crafts: (1) low-confidence
  openers → explicit uncertainty display; (2) CLV-style profiling → make it
  PUBLIC, not private; (3) pull markets when outcome known → the 100%-lock.

### DESIGN RECOMMENDATIONS (from the research, aimed at our market)
1. **Show net-of-fee effective payouts, not gross oracle odds.** "Stake 100 →
   132 net if VS wins" at current pool shares minus the faction's fee band.
   Makes the favorite-longshot donation (oracle 64% vs pool-implied 52%)
   visible — the cheapest debiasing tool in the literature.
2. **Soft-suspension band before the 100% lock** (~95% oracle confidence:
   suspend new bets or cap stakes). A hard 100% cutoff invites last-second
   sniping into a nearly-decided pool — the CAW dynamic that makes casuals
   feel cheated. The lock rule is right; give it a ramp.
3. **Publish a "smart money" indicator instead of profiling privately.**
   Show what share of each faction's pool comes from historically profitable
   accounts (CLV analogue). Turns the sportsbook's private weapon into public
   information aggregation; deters manipulation by making it observable.
4. **Reconsider the fee curve vs probability weighting.** Current schedule
   compounds the bias. Either flatten it (e.g. cap total fee ~20%) or frame it
   as the bias-correction mechanism in the UI ("high fee because the model is
   very confident — the crowd usually underbets these") so it reads as
   information, not punishment.
5. **Display uncertainty as interval + labeled stars, never a bare high
   probability.** "Model range 55–75%, certainty 3/5 — certainty means model
   confidence, not bet quality." A bare "92%, ★★★★★" maximally invites
   overconfidence wagers.
6. **Counter late-betting equilibrium: early-betting fee discount or late
   stake caps.** Informed players optimally wait and dilute early bettors;
   back-loaded pools harvest casuals. A small fee discount for first-half
   bets, or per-account stake caps in the final minutes, protects the
   recreational players who fund the ecosystem.

### OPEN QUESTIONS (researcher could not verify)
- No empirical data on gamer/virtual-points populations — all bias magnitudes
  are from racing/sports/prediction markets. Play-money stakes may dampen or
  amplify effects; unverified.
- Exact fee interpolation between our anchor points was not equilibrium-modeled.

---

# PART I — In-game commander game theory (2026-10-04, unchanged)

### What we have
1. Mathematical elimination (can/can't win by territory+time)
2. Critical bases (counterfactual win% impact)
3. Breaking points (trajectory to elimination)
4. Kingmaker (intervene in others' fights)
5. War shape (1v1 locked / two-front / free agent)
6. Ranked EV attacks/defends (P(capture) × margin)
7. Pop efficiency heuristics (global proxy)
8. Server×prime base rates (DST-aware)

### New concepts to apply

#### 1. SPOILER MODE (eliminated faction)
When mathematically eliminated, a faction isn't out — they become a pure
kingmaker with nothing to lose. Current commander goes quiet. It should switch:
- "ELIMINATED. Your only play: decide who wins."
- "Attack [X] to hand it to [Y]." / "Defend [Z] to deny [W]."
- Rank spoiler actions by |swing| on the remaining contenders' win%.
- This is different from kingmaker (opportunistic). Spoiler is intentional and
  spiteful. Players LOVE this.

#### 2. TEMPO / INITIATIVE
Who's dictating pace? Net base flips per 15 min per faction.
- Positive tempo = aggressor. Negative = reactive.
- "TR +3 tempo. You're -2. To seize initiative you need +4 net."
- Commander should track tempo trend: is the aggressor accelerating or stalling?
- Implementable NOW from flip data. No new data needed.

#### 3. ZUGZWANG
Chess term: must move, every move worsens position. In PS2: defending 8 bases
with 30% pop where reinforcing one lane starves another.
- Detection: (frontier_count × min_defense_per_base) > (pop × efficiency)
- Stronger than "SPREAD THIN" — it's "you're doomed if you stay defensive."
- Advice: "ZUGZWANG. Stop defending. Pick 2, abandon rest, all-in counterattack."
- The only winning move is to change the game (attack, not defend).

#### 4. REAL OPTIONS (base as option value)
A base isn't just 1.14pp — it's an OPTION on future attacks. Capturing a hub
unlocks 3 new lanes. We have "cascade count" but don't value it.
- Option value = territory + Σ(P(capture unlocked base) × its EV)
- Re-ranks attacks: a 1.14pp hub unlocking 3× 2pp attacks is worth more than
  a 1.14pp dead-end.
- Implementable from lattice + capture model. No new data.

#### 5. MINIMAX REGRET (risk-averse play)
When leading, don't maximize EV — minimize worst-case regret.
- "Attack A: EV +2.1, but if it fails you lose 5pp. Attack B: EV +1.8, fail = -2pp."
- Leader should pick B (protect lead). Trailer should pick A (need variance).
- Add a "risk mode" toggle: LEAD (minimax regret) vs TRAIL (max EV).
- Implementable NOW. Just re-rank by different objective.

#### 6. NASH / BEST RESPONSE (enemy reacts)
Current EV assumes enemy doesn't react. But if TR attacks X, VS will defend X.
True EV = EV after optimal enemy response (minimax).
- Approximate: defender reinforces highest-EV target. Attacker's best is
  second-highest EV (or highest after defense shift).
- This is "don't attack where they expect." Implementable via iterative:
  compute EV, assume defender covers top 1, recompute.
- More realistic than naive EV.

#### 7. COALITION STABILITY
Kingmaker is temporary. When is 2v1 STABLE? If VS+NC both gain from containing
TR, and neither can win alone, they'll implicitly coordinate.
- Detect: if P(VS win | TR weakened) + P(NC win | TR weakened) > P(VS win) + P(NC win)
  then VS+NC have aligned incentives.
- Predict: "VS+NC incentives aligned vs TR for ~20 min. Expect coordination."
- This explains the t=60-75 dynamic (VS+NC both wanted TR contained, but TR won anyway).

#### 8. INFORMATION / INTENT INFERENCE
We assume perfect info. Players don't. Track inaction:
- "TR hasn't attacked in 12 min. Either regrouping or massing. Likely targets: [top 2 EV]."
- "NC suddenly stopped defending [lane]. Either trap or collapse. Probe it."
- Implementable from flip timestamps. No new data.

### The Right Order: Commander's Decision Hierarchy

Not a dashboard — a FILTER. OODA loop:

**OBSERVE** (situation)
1. Elimination? → If yes, SPOILER MODE. Skip rest.
2. War shape? → Free / Locked / Double-teamed. Frames everything.
3. Tempo? → Who has initiative? Am I reactive?

**ORIENT** (threats)
4. Breaking point? → If yes, DEFEND NOW. Nothing else matters.
5. Zugzwang? → If yes, ABANDON defense, COUNTERATTACK.
6. Spoiler threat? → Is an eliminated faction about to kingmake against me?

**DECIDE** (opportunities)
7. Kingmaker? → Big swing in others' fight I can tip.
8. Ranked attacks → Best EV (or minimax regret if leading).
9. Coalition? → Who are my temporary allies?

**ACT** (resources)
10. Pop check → Wasting? Spread thin? Heroic?
11. Execute top 2. Ignore rest.

The commander should output IN THIS ORDER, and STOP when a higher priority
fires. If you're at a breaking point, don't show kingmaker — it's noise.

### Implementability

| Concept | New data? | Difficulty | Impact |
|---------|-----------|------------|--------|
| Spoiler mode | No | Easy | High (fun + useful) |
| Tempo | No | Easy | High |
| Zugzwang | No | Medium | High |
| Real options | No | Medium | Medium |
| Minimax regret | No | Easy | Medium |
| Best response | No | Hard | Medium |
| Coalition | No | Medium | Medium |
| Intent inference | No | Medium | Low-Medium |

All implementable with CURRENT data. No Census needed for these.

### Unused ps2alerts fields (we HAVE this data!)

- `outfitCaptured`: Which outfit took the base. Track elite outfit activity.
  If [Famous Outfit] is capping for TR, that's a skill signal.
- `durationHeld`: How long previous owner held it. Low = hotly contested lane.
  High = stronghold. Use for tempo: avg durationHeld dropping = accelerating.
- `isDefence`: Was it a successful defense? Compute P(defense holds | faction).
  A faction with 70% defense rate is hard to dislodge — attack elsewhere.

These are FREE — already in our fetched data, just not used.

### Census data (pending subagent)
See census_research.md for API findings.
