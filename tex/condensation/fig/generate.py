"""Reproduce the finite-model illustration. Requires numpy and matplotlib.

Run: python fig/generate.py from this module, or python /path/to/generate.py.
The seed is fixed. No entropy estimates are computed. PDF/PNG/SVG are generated.
"""
from pathlib import Path
import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = Path(__file__).resolve().parent
SEED = 20260928
rng = np.random.default_rng(SEED)
grid = np.stack(np.meshgrid(np.arange(201), np.arange(201)), axis=-1).reshape(-1, 2)
shapes = [5*np.eye(2), np.array([[25., 20.], [20., 25.]]), np.array([[25., -20.], [-20., 25.]])]
shape_names = ["round", "right", "left"]
s = int(rng.integers(3))
groups = rng.integers(60, 141, size=(2, 2))

def draw(center, matrix, size=1):
    delta = grid - center
    logw = -.5 * np.einsum("ni,ij,nj->n", delta, np.linalg.inv(matrix), delta)
    weights = np.exp(logw - logw.max())
    weights /= weights.sum()
    # Floating sampling underflows negligible tails. The defined mathematical
    # kernel is strictly positive; this numerical sampler changes no entropy claim.
    return grid[rng.choice(len(grid), size=size, p=weights)]

centers = np.array([[draw(g, 64*np.eye(2))[0] for _ in range(2)] for g in groups])
points = np.array([[draw(centers[g,c], shapes[s], 9) for c in range(2)] for g in range(2)])
plt.rcParams.update({"font.family":"DejaVu Sans", "font.size":12,
                     "pdf.fonttype":42, "svg.fonttype":"none"})

# One view of the points beside the sharing structure. The figure has to make a
# single point: an address is a set of observations, and a point is determined
# by the latents whose sets contain it.
fig = plt.figure(figsize=(11.2, 4.8), facecolor="white")
gs = fig.add_gridspec(1, 2, width_ratios=[1, 1.06], wspace=.1)
colors = [["#1b5e9e", "#7fb3e0"], ["#b35806", "#f0a04b"]]

ax = fig.add_subplot(gs[0])
for g in range(2):
    ring = []
    for c in range(2):
        pts = points[g, c]
        ax.scatter(pts[:, 0], pts[:, 1], s=34, c=colors[g][c], marker="o",
                   edgecolors="black", linewidths=.4, zorder=3)
        ax.scatter(*centers[g, c], s=70, c="black", marker="x", linewidths=1.6, zorder=4)
        r = np.linalg.norm(pts - centers[g, c], axis=1).max()
        ax.annotate(rf"$M_{{{g+1}{c+1}}}$", centers[g, c], textcoords="offset points",
                    xytext=(.62*r + 9, .62*r + 5), fontsize=11.5, color=colors[g][c])
        ring.append((centers[g, c], r))
    # Colour already separates the clusters, and the groups are far enough apart
    # to read as groups: rings on top of that were redundant ink.
    mid = (ring[0][0] + ring[1][0]) / 2
    low = min(cc[1] - rr for cc, rr in ring)
    ax.annotate(rf"$G_{{{g+1}}}$", (mid[0], low), textcoords="offset points",
                xytext=(0, -20), ha="center", fontsize=13)
ax.set(xlabel="first coordinate", ylabel="second coordinate")
ax.set_aspect("equal"); ax.margins(x=.12, y=.2)
ax.spines[["top", "right"]].set_visible(False)
ax.tick_params(labelsize=9)
ax.set_title("36 points: two groups, two clusters each", pad=10, fontsize=12.5)

ax = fig.add_subplot(gs[1]); ax.set_xlim(0, 1.5); ax.set_ylim(0, 1); ax.axis("off")
positions = {"S": (.46, .92), "G1": (.20, .66), "G2": (.72, .66),
             "M11": (.03, .40), "M12": (.35, .40), "M21": (.57, .40), "M22": (.89, .40)}
labels = {"S": r"$S$: shape", "G1": r"$G_1$", "G2": r"$G_2$", "M11": r"$M_{11}$",
          "M12": r"$M_{12}$", "M21": r"$M_{21}$", "M22": r"$M_{22}$"}
tint = {"M11": colors[0][0], "M12": colors[0][1], "M21": colors[1][0], "M22": colors[1][1]}
node = dict(boxstyle="round,pad=.26", facecolor="white", edgecolor=".45", linewidth=.9)
# Lines show which latent is shared by which points, not causal claims.
for parent, child in [("S","G1"),("S","G2"),("G1","M11"),("G1","M12"),
                      ("G2","M21"),("G2","M22")]:
    a, b = positions[parent], positions[child]
    ax.plot([a[0], b[0]], [a[1]-.06, b[1]+.06], color=".55", lw=1, zorder=1)
for key, (x, y) in positions.items():
    ax.text(x, y, labels[key], ha="center", va="center", fontsize=12, zorder=2,
            color=tint.get(key, "black"), bbox=node)
for key in ["M11", "M12", "M21", "M22"]:
    x, y = positions[key]
    ax.plot([x, x], [y-.06, .20], color=".55", lw=1, zorder=1)
    ax.text(x, .14, r"$X_{%s,j}$" % key[1:], ha="center", va="center", fontsize=11,
            bbox=node, zorder=2)
for y, text in [(.92, "shared by all 36"), (.66, "18 points each"),
                (.40, "9 points each"), (.14, "one point each")]:
    ax.text(1.5, y, text, ha="right", va="center", fontsize=10.5, color=".35")
ax.set_title("A latent for each set of points", pad=10, fontsize=12.5)

fig.text(.5, .035, "Each point is determined by the latents whose sets contain it: "
         "its shape, group center, cluster center, and its own position in the cluster.",
         ha="center", fontsize=11.5)
fig.subplots_adjust(top=.87, bottom=.16, left=.07, right=.99)
for ext in ["pdf","png","svg"]:
    fig.savefig(OUT/f"hierarchical-points.{ext}", dpi=180, bbox_inches="tight", facecolor="white")
plt.close(fig)
(OUT/"sample.json").write_text(json.dumps({"seed":SEED,"shape":shape_names[s],
    "groups":groups.tolist(),"centers":centers.tolist(),"points":points.tolist()},indent=2)+"\n")
print("Wrote hierarchical-points.pdf, .png, .svg and sample.json")
