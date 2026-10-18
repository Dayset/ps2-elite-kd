# Hossin conditional models v1 — "in that situation, what are the chances?"

**Dataset:** 7385 Hossin alerts (zone 4), 90-min territory control.

## Model A — P(win | situation at minute t)
Situation per faction = territory-share bucket x 15-min momentum bucket x pop-share bucket.

### VS — highest and lowest win-probability situations
- **87.3%** (n=3965): `VS|S4:40+|M5:>5|P3:33+`
- **79.1%** (n=6177): `VS|S4:40+|M4:+2..+5|P3:33+`
- **76.6%** (n=2611): `VS|S4:40+|M5:>5|P2:25-33`
- **3.2%** (n=592): `VS|S1<25|M1:<=-5|P1<25`
- **2.8%** (n=109): `VS|S1<25|M5:>5|P1<25`

### NC — highest and lowest win-probability situations
- **81.3%** (n=4322): `NC|S4:40+|M5:>5|P3:33+`
- **75.6%** (n=123): `NC|S4:40+|M5:>5|P1<25`
- **71.4%** (n=6637): `NC|S4:40+|M4:+2..+5|P3:33+`
- **4.9%** (n=102): `NC|S2:25-33|M1:<=-5|P1<25`
- **3.4%** (n=207): `NC|S1<25|M1:<=-5|P1<25`

### TR — highest and lowest win-probability situations
- **79.0%** (n=2862): `TR|S4:40+|M5:>5|P3:33+`
- **70.1%** (n=5276): `TR|S4:40+|M4:+2..+5|P3:33+`
- **67.2%** (n=1209): `TR|S4:40+|M5:>5|P2:25-33`
- **2.5%** (n=200): `TR|S2:25-33|M1:<=-5|P1<25`
- **0.7%** (n=451): `TR|S1<25|M1:<=-5|P1<25`

## Model B — P(frontier facility captured in 15 min | pressure)
Frontier = owned by A with >=1 lattice neighbor owned by attacker B. Pressure = >=1 B-neighbor flipped to B in trailing 15 min.

- `P0:none|early:0-30`: **18.8%** (n=1024453, 95% CI 18.8%-18.9%)
- `P0:none|late:60-90`: **18.0%** (n=559778, 95% CI 17.9%-18.1%)
- `P0:none|mid:30-60`: **17.6%** (n=850967, 95% CI 17.5%-17.7%)
- `P1:pressured|early:0-30`: **33.8%** (n=244065, 95% CI 33.6%-34.0%)
- `P1:pressured|late:60-90`: **32.9%** (n=239855, 95% CI 32.8%-33.1%)
- `P1:pressured|mid:30-60`: **32.8%** (n=355935, 95% CI 32.6%-32.9%)

## Caveats
- Correlation, not causation. Pressure may proxy for zerg presence, not cause captures.
- Bins with small n have wide CIs — check n before quoting a probability.
- Hossin only. Other continents need their own books.
- Re-run after the extended fetch lands (~555 alerts) for tighter cells.