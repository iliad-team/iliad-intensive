# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

# Mess3 as an input-conditioned transducer, and its mixed-state presentation.
# Runs as-is in Google Colab (needs only numpy + matplotlib).

import numpy as np
import matplotlib.pyplot as plt

rng = np.random.default_rng(0)

# ---------------------------------------------------------------------------
# 1) Mess3 transducer: labeled matrices T^(y|x) for inputs x in {0, 1}.
#    Mess3's usual parameters are (alpha, x); to avoid clashing with the
#    input symbol x, the second parameter is called m here.
# ---------------------------------------------------------------------------

def mess3_matrices(alpha, m):
    """[T0, T1, T2] with T[y][i, j] = P(next state j, output y | state i)."""
    b = (1 - alpha) / 2
    g = 1 - 2 * m
    T0 = np.array([[alpha * g, b * m,     b * m    ],
                   [alpha * m, b * g,     b * m    ],
                   [alpha * m, b * m,     b * g    ]])
    T1 = np.array([[b * g,     alpha * m, b * m    ],
                   [b * m,     alpha * g, b * m    ],
                   [b * m,     alpha * m, b * g    ]])
    T2 = np.array([[b * g,     b * m,     alpha * m],
                   [b * m,     b * g,     alpha * m],
                   [b * m,     b * m,     alpha * g]])
    return [T0, T1, T2]

PARAMS = {0: dict(alpha=0.85, m=0.05),   # input 0: classic fractal regime
          1: dict(alpha=0.50, m=0.15)}   # input 1: noisier, faster mixing

# T_hat[(y, x)] acts on belief column vectors |rho>
T_hat = {(y, x): Ty.T
         for x in PARAMS
         for y, Ty in enumerate(mess3_matrices(**PARAMS[x]))}

# ---------------------------------------------------------------------------
# 2) Generate a length-L word: inputs X from a biased coin, outputs Y
# ---------------------------------------------------------------------------

def generate_word(L, p0=0.5):
    """X ~ iid coin with P(x=0) = p0; Y sampled from the transducer."""
    X = (rng.random(L) >= p0).astype(int)
    Y = np.empty(L, dtype=int)
    s = rng.integers(3)                       # hidden state
    for t in range(L):
        Ts = mess3_matrices(**PARAMS[X[t]])
        joint = np.array([T[s] for T in Ts])  # rows: y, cols: next state
        k = rng.choice(9, p=joint.ravel() / joint.sum())
        Y[t], s = divmod(k, 3)
    return X, Y

# ---------------------------------------------------------------------------
# 3) MSP: belief states via |rho_{t+1}> = T^(y_t|x_t)|rho_t> / norm
# ---------------------------------------------------------------------------

# EXERCISE
#EXERCISE 1: Produce the MSP for a L=50,000 sequence for three different input
#probabilities

#Note: The MSP must be a length-L array of length-3 arrays that each encode
#latent distribution
# END EXERCISE
# SOLUTION
def msp_from_word(X, Y):
    rho = np.full(3, 1 / 3)                   # start from uniform ignorance
    beliefs = [rho]
    for x, y in zip(X, Y):
        rho = T_hat[(y, x)] @ rho
        rho = rho / rho.sum()
        beliefs.append(rho)
    return beliefs
# END SOLUTION

# ---------------------------------------------------------------------------
# 4) Plot a list of 3-element beliefs in the simplex over states A, B, C
# ---------------------------------------------------------------------------

def plot_beliefs(beliefs):
    """beliefs: a sequence of 3-element lists/arrays summing to 1."""
    verts = np.array([[0, 0], [1, 0], [0.5, np.sqrt(3) / 2]])  # A, B, C
    pts = np.asarray(beliefs) @ verts
    fig, ax = plt.subplots(figsize=(7, 6.5))
    tri = np.vstack([verts, verts[0]])
    ax.plot(tri[:, 0], tri[:, 1], color="gray", lw=1)
    for (vx, vy), name in zip(verts, "ABC"):
        ax.text(vx, vy - 0.04 if vy == 0 else vy + 0.04, name,
                ha="center", va="center", fontsize=12)
    ax.scatter(pts[:, 0], pts[:, 1], s=1.5, lw=0, color="#2a78d6", alpha=0.5)
    ax.set_aspect("equal")
    ax.axis("off")
    plt.show()

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

# EXERCISE
#EXERCISE 2: Plot all three MSPs
# END EXERCISE
# SOLUTION
L  = 50_000
p0 = .2         # P(input = 0) -- tune me

X, Y = generate_word(L, p0=p0)
beliefs = msp_from_word(X, Y)
plot_beliefs(beliefs)
# END SOLUTION

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

