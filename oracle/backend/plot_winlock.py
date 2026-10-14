#!/usr/bin/env python3
"""Plot win-lock timing graphs (dark theme, % only, no 'pp')."""
import json, os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.expanduser("~/workspace/your_files")

plt.rcParams.update({
    "figure.facecolor": "#14161c",
    "axes.facecolor": "#14161c",
    "axes.edgecolor": "#3a3f4d",
    "axes.labelcolor": "#c9d1e0",
    "xtick.color": "#8b93a7",
    "ytick.color": "#8b93a7",
    "text.color": "#e8ecf4",
    "grid.color": "#262b36",
    "font.size": 11,
})

summary = json.load(open(os.path.join(ROOT, "winlock_timing_summary.json")))
th = summary["thresholds"]
ps = list(range(50, 101))
med = [th[str(p)]["median"] for p in ps]
q25 = [th[str(p)]["p25"] for p in ps]
q75 = [th[str(p)]["p75"] for p in ps]

# --- Graph 1: median minute per percentage, IQR band ---
fig, ax = plt.subplots(figsize=(11, 6.2))
ax.fill_between(ps, q25, q75, color="#4f7cff", alpha=0.22, label="Middle 50% of alerts (IQR)")
ax.plot(ps, med, color="#7ea0ff", linewidth=2.6, label="Median minute")
ax.scatter([100], [th["100"]["median"]], color="#ffd166", s=90, zorder=5)
ax.annotate(f"100%: median t={th['100']['median']:.0f}",
            xy=(100, th["100"]["median"]), xytext=(88, th["100"]["median"] + 7),
            color="#ffd166", fontsize=11,
            arrowprops=dict(arrowstyle="->", color="#ffd166", lw=1.4))
for t in (80, 85, 90):
    ax.axvline(t, color="#3a3f4d", linestyle=":", linewidth=1)
ax.set_xlim(50, 100)
ax.set_ylim(0, 92)
ax.set_xlabel("Win chance (%)")
ax.set_ylabel("Alert minute when first reached (median)")
ax.set_title("How long until the Oracle is this sure?  (38,104 alerts, all continents)",
             fontsize=13, pad=12)
ax.grid(True, linestyle="--", alpha=0.5)
ax.legend(framealpha=0.25, loc="upper left")
fig.tight_layout()
fig.savefig(os.path.join(OUT, "winlock_median_time.png"), dpi=150)
plt.close(fig)

# --- Graph 2: histogram of 100%-lock times, 5-min bins ---
dist = json.load(open(os.path.join(ROOT, "winlock_timing_p100.json")))
times = np.array(dist["times"])
bins = np.arange(0, 95, 5)
counts, edges = np.histogram(times, bins=bins)
centers = (edges[:-1] + edges[1:]) / 2
fig, ax = plt.subplots(figsize=(11, 6.2))
bars = ax.bar(centers, counts, width=4.4, color="#7ea0ff", edgecolor="#14161c", alpha=0.92)
# highlight the median bin
med_t = float(np.median(times))
for bar, c in zip(bars, centers):
    if abs(c - (med_t // 5 * 5 + 2.5)) < 2.6:
        bar.set_color("#ffd166")
ax.axvline(med_t, color="#ffd166", linestyle="--", linewidth=1.6,
           label=f"Median t={med_t:.0f}")
ax.set_xlim(0, 90)
ax.set_xlabel("Alert minute of 100% win lock (5-min bins)")
ax.set_ylabel("Number of alerts")
ax.set_title(f"When does the 100% win lock land?  ({len(times):,} alerts)",
             fontsize=13, pad=12)
ax.grid(True, axis="y", linestyle="--", alpha=0.5)
ax.legend(framealpha=0.25)
fig.tight_layout()
fig.savefig(os.path.join(OUT, "winlock_100pct_hist.png"), dpi=150)
plt.close(fig)
print("wrote both PNGs")
