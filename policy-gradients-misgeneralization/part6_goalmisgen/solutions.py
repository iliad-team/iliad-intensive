# %%


import functools
from typing import Callable

import matplotlib.pyplot as plt
import numpy as np
import torch as t
from jaxtyping import Float, Int
from torch import Tensor
from tqdm.auto import tqdm

import part6_goalmisgen.tests as tests
from part6_goalmisgen.agent import ActorCriticNetwork
from part6_goalmisgen.evaluation import RewardFunction, compute_return, evaluate_behaviour
from part6_goalmisgen.potteryshop import Action, Environment, Item, State, collect_rollout
from part6_goalmisgen.ppo import ppo_train_step, ppo_train_step_multienv
from part6_goalmisgen.util import LivePlot, display_envs, display_rollout, display_rollouts

device = t.device("cuda" if t.cuda.is_available() else "mps" if t.backends.mps.is_available() else "cpu")

# On CPU, PyTorch's default of one thread per core hurts on big machines: the rollout loop is 64
# sequential environment steps on small tensors, so beyond ~8 threads the synchronisation overhead
# outweighs the parallelism (measured: 8 threads is fastest, 16 is ~30% slower, 48 is several
# times slower). This has no effect when running on a GPU.
if device.type == "cpu" and t.get_num_threads() > 8:
    t.set_num_threads(8)

MAIN = __name__ == "__main__"

# %%

DISCOUNT_RATE = 0.995

# %%

env = Environment(
    init_robot_pos=t.tensor((1, 2), dtype=t.long),
    init_items_map=t.tensor(
        (
            (0, 0, 0, 0, 2, 2),
            (0, 1, 0, 0, 0, 2),
            (0, 0, 0, 0, 0, 0),
            (0, 1, 1, 0, 0, 2),
            (0, 0, 0, 0, 2, 2),
            (2, 0, 1, 0, 2, 2),
        ),
        dtype=t.long,
    ),
    bin_pos=t.tensor((0, 0), dtype=t.long),
)

if MAIN:
    tests.test_env(env)

# %%

def reward1(state: State, action: Int[Tensor, "B"], next_state: State) -> Float[Tensor, "B"]:
    batch = t.arange(state.inventory.shape[0], device=state.inventory.device)
    item_below_robot = state.items_map[
        batch,
        state.robot_pos[:, 0],
        state.robot_pos[:, 1],
    ]
    pickup_reward = (
        (item_below_robot == Item.SHARDS)
        & (state.inventory == Item.EMPTY)
        & (action == Action.PICKUP)
    ).float()
    dispose_reward = (
        (state.bin_pos[:, 0] == state.robot_pos[:, 0])
        & (state.bin_pos[:, 1] == state.robot_pos[:, 1])
        & (state.inventory == Item.SHARDS)
        & (action == Action.PUTDOWN)
    ).float()
    total_reward = pickup_reward + dispose_reward
    return total_reward

# %%

def train_agent(
    env: Environment,
    net: ActorCriticNetwork,
    reward_fn: RewardFunction,
    num_train_steps: int = 128,
    seed: int = 42,
) -> ActorCriticNetwork:
    generator = t.Generator().manual_seed(seed)
    net = net.to(device)
    env = env.to(device)
    optimiser = t.optim.Adam(net.parameters(), lr=0.003)

    panels = [
        {"title": "losses", "metrics": ["loss", "actor", "critic"]},
        {"title": "return / entropy", "metrics": ["return"], "secondary": ["entropy"]},
    ]
    # `with` draws the final frame and stops the renderer on exit, including on an interrupt
    with LivePlot(panels, num_train_steps) as liveplot:
        pbar = tqdm(range(num_train_steps))
        for step in pbar:
            metrics = ppo_train_step(
                net=net,
                env=env,
                reward_fn=reward_fn,
                optimiser=optimiser,
                discount_rate=DISCOUNT_RATE,
                generator=generator,
            )
            liveplot.log(step, metrics)
            pbar.set_postfix(metrics)

    return net

# %%

if MAIN:
    net1 = ActorCriticNetwork.init(
        obs_height=env.world_size,
        obs_width=env.world_size,
        net_channels=8,
        net_width=16,
        num_conv_layers=2,
        num_dense_layers=1,
        num_actions=len(Action),
        generator=t.Generator().manual_seed(42),
    )
    
    net1 = train_agent(
        env=env,
        net=net1,
        reward_fn=reward1,
        num_train_steps=60,
    )

# %%

if MAIN:
    rollout = collect_rollout(
        env=env,
        policy_fn=net1.policy,
        num_steps=64,
        generator=t.Generator().manual_seed(1),
        device=device,
    )
    display_rollout(env, rollout)

# %%

def reward_drop(state: State, 
                action: Int[Tensor, "B"], 
                next_state: State
) -> Float[Tensor, "B"]:
    batch = t.arange(state.inventory.shape[0], device=state.inventory.device)
    item_below_robot = state.items_map[
        batch,
        state.robot_pos[:, 0],
        state.robot_pos[:, 1],
    ]
    return (
        (state.robot_pos != state.bin_pos).any(dim=-1)
        & (item_below_robot == Item.EMPTY)
        & (state.inventory == Item.SHARDS)
        & (action == Action.PUTDOWN)
    ).float()

# %%

def reward_break(state: State, action: Int[Tensor, "B"], next_state: State) -> Float[Tensor, "B"]:
    batch = t.arange(state.inventory.shape[0], device=state.inventory.device)
    item_below_robot_after_transition = next_state.items_map[
        batch,
        next_state.robot_pos[:, 0],
        next_state.robot_pos[:, 1],
    ]
    item_there_before_transition = state.items_map[
        batch,
        next_state.robot_pos[:, 0],
        next_state.robot_pos[:, 1],
    ]
    return (
        (item_below_robot_after_transition == Item.SHARDS)
        & (item_there_before_transition == Item.URN)
    ).float()


if MAIN:
    tests.test_reward_drop(reward_drop)
    tests.test_reward_break(reward_break)

# %%

def plot_return_hists(reward_fns, return_vecs, bins: int = 40, title: str | None = None):
    """
    Plot, for each reward function, a histogram of its per-rollout discounted
    return over the evaluation rollouts. Each reward function is used as a
    *behavioural probe*: the spread of returns tells us how often (and how
    consistently) the agent does the behaviour that probe rewards. Each subplot
    is labelled with what its probe measures; pass `title` to caption the whole
    figure (e.g. which agent / environment produced these rollouts).

    Robust to (near-)constant return distributions: a well-behaved agent often
    drives a probe's return to a single value (e.g. the `reward_break` probe
    pinned at 0), and matplotlib's automatic binning raises on a zero-width
    data range, so we filter non-finite values and widen a degenerate range.
    """
    # short human-readable description of what each probe measures
    probe_desc = {
        "reward1": "task return",
        "reward2": "task return",
        "reward_drop": "floor-drops (farming)",
        "reward_break": "urns smashed",
        "reward_bin": "shards binned",
        "proxy": "corner-drops (proxy goal)",
    }
    # one small panel per probe, side by side (at most three probes are ever passed)
    n = len(reward_fns)
    fig, axes = plt.subplots(1, n, figsize=(3.6 * n, 2.8), squeeze=False)
    for i, (reward_fn, returns, ax) in enumerate(zip(reward_fns, return_vecs, axes[0])):
        data = returns.cpu().numpy()
        data = data[np.isfinite(data)]
        lo, hi = (float(data.min()), float(data.max())) if data.size else (0.0, 1.0)
        if hi - lo < 1e-6:
            lo, hi = lo - 0.5, hi + 0.5
        ax.hist(data, bins=bins, range=(lo, hi))
        name = reward_fn.__name__
        desc = probe_desc.get(name)
        ax.set_title(f"{name} returns" + (f"\n{desc}" if desc else ""), fontsize=10)
        ax.set_xlabel("discounted return per rollout", fontsize=9)
        if i == 0:
            ax.set_ylabel("# rollouts", fontsize=9)
        ax.tick_params(labelsize=8)
    if title is not None:
        fig.suptitle(title, fontweight="bold", fontsize=11)
    fig.tight_layout()
    plt.show()

# %%

if MAIN:
    reward_fns = [reward1, reward_drop, reward_break]
    return_vecs = [
        evaluate_behaviour(
            env=env,
            net=net1,
            reward_fn=r,
            generator=t.Generator().manual_seed(1),
        )
        for r in reward_fns
    ]
    
    plot_return_hists(
        reward_fns,
        return_vecs,
        title="net1 (trained on reward1): is the return real cleanup, or farming?",
    )

# %%

def inventory_potential(state: State) -> Float[Tensor, "B"]:
    return 0.5 * (state.inventory == Item.SHARDS).float()


def reward_bin(state: State, action: Int[Tensor, "B"], next_state: State) -> Float[Tensor, "B"]:
    return (
        (state.bin_pos[:, 0] == state.robot_pos[:, 0])
        & (state.bin_pos[:, 1] == state.robot_pos[:, 1])
        & (state.inventory == Item.SHARDS)
        & (action == Action.PUTDOWN)
    ).float()


def reward_shaped(state: State, action: Int[Tensor, "B"], next_state: State) -> Float[Tensor, "B"]:
    pickup_shaping_term = DISCOUNT_RATE * inventory_potential(next_state) - inventory_potential(state)
    bin_reward_term = reward_bin(state, action, next_state)
    return bin_reward_term + pickup_shaping_term

# %%

def reward_no_break(state: State, action: Int[Tensor, "B"], next_state: State) -> Float[Tensor, "B"]:
    return -2.0 * reward_break(state, action, next_state)


if MAIN:
    tests.test_reward_no_break(reward_no_break)

# %%

def reward2(state: State, action: Int[Tensor, "B"], next_state: State) -> Float[Tensor, "B"]:
    shaped = reward_shaped(state, action, next_state)
    nobreak = reward_no_break(state, action, next_state)
    return shaped + nobreak


if MAIN:
    tests.test_reward2(reward2)

# %%

if MAIN:
    # Train a new agent with the fixed reward function
    net2 = ActorCriticNetwork.init(
        obs_height=env.world_size,
        obs_width=env.world_size,
        net_channels=8,
        net_width=16,
        num_conv_layers=2,
        num_dense_layers=1,
        num_actions=len(Action),
        generator=t.Generator().manual_seed(42),
    )
    
    net2 = train_agent(
        env=env,
        net=net2,
        reward_fn=reward2,
        num_train_steps=192,
    )

# %%

if MAIN:
    # Manually inspect a rollout...
    rollout = collect_rollout(
        env=env,
        policy_fn=net2.policy,
        num_steps=64,
        generator=t.Generator().manual_seed(1),
        device=device,
    )
    display_rollout(env, rollout)

# %%

if MAIN:
    # ...and quantitatively inspect the behaviour with our probes
    reward_fns = [reward2, reward_drop, reward_break]
    return_vecs = [
        evaluate_behaviour(
            env=env,
            net=net2,
            reward_fn=r,
            generator=t.Generator().manual_seed(1),
        )
        for r in reward_fns
    ]
    
    plot_return_hists(
        reward_fns,
        return_vecs,
        title="net2 (trained on reward2): the fix — drop & break probes should collapse to ~0",
    )

# %%

env2 = Environment(
    init_robot_pos=t.tensor((3, 4), dtype=t.long),
    init_items_map=t.tensor(
        (
            (0, 0, 0, 0, 1, 1),
            (0, 2, 0, 0, 0, 1),
            (0, 0, 0, 0, 0, 0),
            (0, 2, 2, 0, 0, 1),
            (0, 0, 0, 0, 1, 1),
            (1, 0, 2, 0, 1, 1),
        ),
        dtype=t.long,
    ),
    bin_pos=t.tensor((0, 0), dtype=t.long),
)

if MAIN:
    rollout = collect_rollout(
        env=env2,
        policy_fn=net2.policy,
        num_steps=64,
        generator=t.Generator().manual_seed(1),
        device=device,
    )
    display_rollout(env2, rollout)

# %%

def generate(
    world_size: int,
    num_shards: int,
    num_urns: int,
    num_envs: int,
    generator: t.Generator | None = None,
) -> Environment:
    num_cells = world_size**2

    # place the bin in the top left corner of the world
    bin_pos = t.zeros((num_envs, 2), dtype=t.long)

    # sample robot and item positions without replacement from the remaining
    # cells (cell 0 is the bin), by taking the first few cells of a random
    # permutation
    num_positions = 1 + num_shards + num_urns
    perm = t.rand(num_envs, num_cells - 1, generator=generator).argsort(dim=1) + 1
    positions = perm[:, :num_positions]
    rows, cols = positions // world_size, positions % world_size
    robot_pos = t.stack((rows[:, 0], cols[:, 0]), dim=-1)

    # create item map
    items_map = t.zeros((num_envs, world_size, world_size), dtype=t.long)
    batch = t.arange(num_envs)[:, None]
    items_map[
        batch,
        rows[:, 1 : 1 + num_shards],
        cols[:, 1 : 1 + num_shards],
    ] = Item.SHARDS
    items_map[
        batch,
        rows[:, 1 + num_shards :],
        cols[:, 1 + num_shards :],
    ] = Item.URN

    return Environment(
        init_robot_pos=robot_pos,
        init_items_map=items_map,
        bin_pos=bin_pos,
    )

# %%

if MAIN:
    envs = generate(
        world_size=6,
        num_shards=3,
        num_urns=4,
        num_envs=32,
        generator=t.Generator().manual_seed(1),
    )
    display_envs(
        envs,
        grid_width=8,
        title="Training distribution from generate(): robot & items random, bin always top-left",
    )

# %%

def train_agent_multienv(
    gen: Callable[[int, t.Generator], Environment],
    net: ActorCriticNetwork,
    reward_fn: RewardFunction,
    num_train_steps: int = 192,
    seed: int = 42,
) -> ActorCriticNetwork:
    generator = t.Generator().manual_seed(seed)
    net = net.to(device)
    optimiser = t.optim.Adam(net.parameters(), lr=0.003)

    panels = [
        {"title": "losses", "metrics": ["loss", "actor", "critic"]},
        {"title": "return / entropy", "metrics": ["return"], "secondary": ["entropy"]},
    ]
    # `with` draws the final frame and stops the renderer on exit, including on an interrupt
    with LivePlot(panels, num_train_steps) as liveplot:
        pbar = tqdm(range(num_train_steps))
        for step in pbar:
            envs = gen(num_envs=512, generator=generator).to(device)
            metrics = ppo_train_step_multienv(
                net=net,
                envs=envs,
                reward_fn=reward_fn,
                optimiser=optimiser,
                discount_rate=DISCOUNT_RATE,
                generator=generator,
            )
            liveplot.log(step, metrics)
            pbar.set_postfix(metrics)

    return net

# %%

if MAIN:
    world_size = 4
    
    net3 = ActorCriticNetwork.init(
        obs_height=world_size,
        obs_width=world_size,
        net_channels=16,
        net_width=64,
        num_conv_layers=5,
        num_dense_layers=2,
        num_actions=len(Action),
        generator=t.Generator().manual_seed(1),
    )
    
    net3 = train_agent_multienv(
        gen=functools.partial(
            generate,
            world_size=world_size,
            num_shards=4,
            num_urns=2,
        ),
        net=net3,
        reward_fn=reward2,
        num_train_steps=160,
        seed=1,
    )

# %%

if MAIN:
    env_probe = Environment(
        init_robot_pos=t.tensor((2, 2), dtype=t.long),
        init_items_map=t.tensor(
            (
                (0, 0, 0, 0),
                (0, 0, 1, 0),
                (0, 1, 0, 2),
                (0, 0, 2, 0),
            ),
            dtype=t.long,
        ),
        bin_pos=t.tensor((0, 3), dtype=t.long),
    )
    rollout = collect_rollout(
        env=env_probe,
        policy_fn=net3.policy,
        num_steps=64,
        generator=t.Generator().manual_seed(1),
        device=device,
    )
    display_rollout(env_probe, rollout)

# %%

env_shift = Environment(
    init_robot_pos=t.tensor((2, 2), dtype=t.long),
    init_items_map=t.tensor(
        (
            (0, 0, 0, 0),
            (0, 0, 1, 0),
            (0, 1, 0, 2),
            (0, 0, 2, 0),
        ),
        dtype=t.long,
    ),
    bin_pos=t.tensor((0, 3), dtype=t.long),
)


def proxy(state: State, action: Int[Tensor, "B"], next_state: State) -> Float[Tensor, "B"]:
    batch = t.arange(state.inventory.shape[0], device=state.inventory.device)
    item_below_robot = state.items_map[
        batch,
        state.robot_pos[:, 0],
        state.robot_pos[:, 1],
    ]
    return (
        (state.robot_pos[:, 0] == 0)
        & (state.robot_pos[:, 1] == 0)
        & (item_below_robot == Item.EMPTY)
        & (state.inventory == Item.SHARDS)
        & (action == Action.PUTDOWN)
    ).float()


# Note: env_shift and proxy are both non-unique (any bin-not-at-(0,0) shifted layout
# with shards works; any reward encoding "drop at the old top-left bin site" works).
# test_env_shift checks only the structural requirements; test_proxy accepts the
# canonical (0,0)-corner proxy that this exercise steers towards. A student who
# encodes the same behavioural objective a different way can just eyeball the result.
if MAIN:
    tests.test_env_shift(env_shift)
    tests.test_proxy(proxy)

# %%

if MAIN:
    reward_fns = [reward2, proxy]
    return_vecs = [
        evaluate_behaviour(
            env=env_shift,
            net=net3,
            reward_fn=r,
            generator=t.Generator().manual_seed(1),
        )
        for r in reward_fns
    ]
    
    plot_return_hists(
        reward_fns,
        return_vecs,
        title="net3 on env_shift (bin moved): low reward2 (intended) but high proxy (corner-drop) = misgeneralisation",
    )

# %%

def generate_shift(
    world_size: int,
    num_shards: int,
    num_urns: int,
    num_envs: int,
    generator: t.Generator | None = None,
) -> Environment:
    num_cells = world_size**2

    # sample bin, robot and item positions without replacement, by taking the
    # first few cells of a random permutation of all grid cells
    num_positions = 1 + 1 + num_shards + num_urns
    perm = t.rand(num_envs, num_cells, generator=generator).argsort(dim=1)
    positions = perm[:, :num_positions]
    rows, cols = positions // world_size, positions % world_size
    bin_pos = t.stack((rows[:, 0], cols[:, 0]), dim=-1)
    robot_pos = t.stack((rows[:, 1], cols[:, 1]), dim=-1)

    # create item map
    items_map = t.zeros((num_envs, world_size, world_size), dtype=t.long)
    batch = t.arange(num_envs)[:, None]
    items_map[
        batch,
        rows[:, 2 : 2 + num_shards],
        cols[:, 2 : 2 + num_shards],
    ] = Item.SHARDS
    items_map[
        batch,
        rows[:, 2 + num_shards :],
        cols[:, 2 + num_shards :],
    ] = Item.URN

    return Environment(
        init_robot_pos=robot_pos,
        init_items_map=items_map,
        bin_pos=bin_pos,
    )


if MAIN:
    tests.test_generate_shift(generate_shift)

# %%

if MAIN:
    envs = generate_shift(
        world_size=6,
        num_shards=3,
        num_urns=4,
        num_envs=32,
        generator=t.Generator().manual_seed(1),
    )
    display_envs(
        envs,
        grid_width=8,
        title="Shifted distribution from generate_shift(): bin now appears anywhere on the grid",
    )

# %%

if MAIN:
    world_size = 4
    
    net4 = ActorCriticNetwork.init(
        obs_height=world_size,
        obs_width=world_size,
        net_channels=16,
        net_width=64,
        num_conv_layers=5,
        num_dense_layers=2,
        num_actions=len(Action),
        generator=t.Generator().manual_seed(1),
    )
    
    net4 = train_agent_multienv(
        gen=functools.partial(
            generate_shift,
            world_size=world_size,
            num_shards=4,
            num_urns=2,
        ),
        net=net4,
        reward_fn=reward2,
        num_train_steps=192,
        seed=1,
    )

# %%

if MAIN:
    reward_fns = [reward2, proxy]
    return_vecs = [
        evaluate_behaviour(
            env=env_shift,
            net=net4,
            reward_fn=r,
            generator=t.Generator().manual_seed(1),
        )
        for r in reward_fns
    ]
    
    plot_return_hists(
        reward_fns,
        return_vecs,
        title="net4 on env_shift (bin moved): reward2 recovers and proxy collapses to ~0 = fix",
    )

# %%
