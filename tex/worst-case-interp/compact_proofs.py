# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
# [E.3] Compact Proofs of Model Performance via Mechanistic Interpretability
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
# Introduction
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
# 0. Set up (Just run, don't read)
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
> **Use a GPU runtime.** In Colab, go to *Runtime → Change runtime type* and pick a GPU (e.g. T4). The notebook also runs on a CPU runtime, but the proofs then take a few minutes instead of a few seconds.
'''

# ! CELL TYPE: code
# ! FILTERS: [colab]
# ! TAGS: [master-comment]

# from IPython.display import clear_output

# %pip install tqdm
# %pip install torch
# %pip install matplotlib
# %pip install jaxtyping

# clear_output()

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

import torch as t
import torch.nn.functional as F
import matplotlib.pyplot as plt
import os
import time
import random, numpy
from dataclasses import dataclass
from jaxtyping import Float, Int
from torch import Tensor
from tqdm import tqdm

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

@dataclass
class Parameters:
    n_ctx: int = 2
    d_vocab: int = 2048
    d_model: int = 128
    num_epoch: int = 2
    batch_size: int = 1024
    subset_percentage: float = 5  # each epoch draws this % of all d_vocab**n_ctx possible inputs
    lr: float = 0.001


params = Parameters()
performance = {}  # proof name -> (loss bound, seconds)

# Run everything on the GPU if there is one (Runtime > Change runtime type > GPU on Colab)
device = t.device("cuda" if t.cuda.is_available() else "cpu")

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

def set_seed(seed: int = 57) -> None:
    numpy.random.seed(seed)
    random.seed(seed)
    t.manual_seed(seed)
    t.cuda.manual_seed(seed)
    # When running on the CuDNN backend, two further options must be set
    t.backends.cudnn.deterministic = True
    t.backends.cudnn.benchmark = False
    # Set a fixed value for the hash seed
    os.environ["PYTHONHASHSEED"] = str(seed)

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

def measure_time(func):
    def wrapper(*args, **kwargs):
        if device.type == "cuda":
            t.cuda.synchronize()
        start_time = time.time()
        result = func(*args, **kwargs)
        if device.type == "cuda":
            t.cuda.synchronize()
        end_time = time.time()
        elapsed_time = end_time - start_time
        print(f"Function '{func.__name__}' executed in: {elapsed_time:.6f} seconds")
        return result, elapsed_time

    return wrapper

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

set_seed(57)

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

def training_step(
    model,
    optimizer,
    inputs: Int[Tensor, "batch_size n_ctx"],
    labels: Int[Tensor, "batch_size"],
    params: Parameters,
):

    criterion = t.nn.CrossEntropyLoss()

    inputs_one_hot = F.one_hot(inputs, params.d_vocab).float()

    outputs = model(inputs_one_hot)

    loss = criterion(outputs, labels)

    loss.backward()
    optimizer.step()
    optimizer.zero_grad()

    return loss

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

def train(model, params):

    loss_history = []

    n_samples = int(params.d_vocab**params.n_ctx * (params.subset_percentage / 100))

    optimizer = t.optim.AdamW(
        model.parameters(),
        lr=params.lr,
    )

    set_seed(57)
    for epoch in tqdm(range(params.num_epoch)):
        # Fresh random inputs every epoch; the label is the max of each row
        inputs = t.randint(0, params.d_vocab, (n_samples, params.n_ctx), device=device)
        labels = inputs.max(dim=1).values

        for batch_inputs, batch_labels in zip(
            inputs.split(params.batch_size), labels.split(params.batch_size)
        ):
            loss = training_step(
                model=model,
                optimizer=optimizer,
                inputs=batch_inputs,
                labels=batch_labels,
                params=params,
            )

            loss_history.append(loss.detach().item())

    return loss_history

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
# 1. Introduction
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
## 1.1 The problem of understanding a model
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
**Why do we care about understanding a model?**

When we use or train a model, many things can go wrong. For example, during training the model can learn undesired behaviour, which is not obvious to us (deceptive alignment). Or it might have failure modes that are not salient to us (adversarial examples). 
On the other hand, we could steer a model towards a desired behaviour, if we understood how it works.

All of these issues could be resolved, if the models were transparent to us (though this is not the only approach). So an important question to raise here is: 
What do we mean when we talk of "a mechanistic understanding" of a model? When is a model transparent to us?

This is a difficult question! Let's say you study a model and reverse engineered parts of it, like a circuit. How can you be sure that the circuit you found actually does the thing you are claiming it is? Let's look at the specific example of autoencoders. This is a quote from [*Towards Monosemanticity: Decomposing Language Models With Dictionary Learning*](https://transformer-circuits.pub/2023/monosemantic-features)

>Usually in machine learning we can quite easily tell if a method is working by looking at an easily-measured quantity like the test loss. We spent quite some time searching for an equivalent metric to guide our efforts here, and unfortunately have yet to find anything satisfactory.
>
>We began by looking for an information-based metric, so that we could say in some sense that the best factorization is the one that minimizes the total information of the autoencoder and the data. Unfortunately, this total information did not generally correlate with subjective feature interpretability or activation sparsity.[...]
>
>Thus we ended up using a combination of several additional metrics to guide our investigations[...]
>
>Interpreting or measuring some of these signals can be difficult, though. For instance, at various points we thought we saw features which at first didn’t make any sense, but with deeper inspection we could understand.
>
>We think it would be very helpful if we could identify better metrics for dictionary learning solutions from sparse autoencoders trained on transformers.

See also Section 5 of this review [*Mechanistic Interpretability for AI Safety -- A Review*](https://arxiv.org/abs/2404.14082) for more references on the difficulty of evaluating interpretability results.
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
**Quantitative methods for interpretability**

Having quantitative methods would not only make mechanistic interpretability research more rigorous. If we want to scale up methods to huge models, we will need to automate parts of the process and we won't be able to have a human in the loop at every crucial point. A lack of quantitative benchmarks makes this task seem almost impossible. To spoiler the punchline: Compact proofs provide such a quantitative benchmark, although they currently are infeasible for larger models.

Before getting into the details, let's nail down two things that we want to quantify. The following two points are taken from the [Compact proofs blog post](https://www.alignmentforum.org/posts/bRsKimQcPTX3tNNJZ/compact-proofs-of-model-performance-via-mechanistic#Introduction), see also this [comment](https://www.lesswrong.com/posts/LNA8mubrByG7SFacm/against-almost-every-theory-of-impact-of-interpretability-1?commentId=7fNRMke9Gc4QghYyf) by Ryan Greenblatt.

>1. Correspondence (or faithfulness): How well our explanation reflects the model's internals.
>2. Compression: Explanations compress the particular behavior of interest. Not just so that it fits in our heads, but also so that it generalizes well and is feasible to find and check.

Specifically, the second points implies that the explanation, say the circuit that we discovered, should be more **compact** and therefore more understandable for us humans: The weights of a model are a perfectly faithful explanation of its behaviour, but this explanation is not helpful for us.
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
<img src="fig/Trade_off.png" width="700">
FILTERS: ~
Author note: Make this rather a pareto frontier?
END FILTERS
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
An important insight that we will make is that our explanations are not as good as we might think. Specifically, **noise** in the model's weights seem negligible. But worst case bound imply that it could still be an important contributing factor. In fact, it might be that something that we deem as noise, is important for the model's computation, but we simply don't understand it. This issue with the noise is another point that a quantitative evaluation should be able to address.
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
## 1.2 **What are compact proofs?**
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
Compact proofs are an attempt at formalizing the above diagram.

First of all, what do we mean by proof i.e. what are we trying to prove? Say we are training a model with weights $\theta$ on some task. The kind of statements that we want to prove are of the form
$$ \mathbb{E}[f_\theta(x)] \leq b$$
(or $\geq b$) where $f_\theta$ is a quantity that we are interested in bounding from above or below (depending on the quantity), such as loss or accuracy. 

The compactness of a proof is determined by its length. A good proxy for the length is the FLOPS required to run the proof, see the [paper](https://arxiv.org/pdf/2406.11779) for more details.
FILTERS: ~
Author note: Maybe I will write more on this.
END FILTERS

So once we have a proof, we can measure its correspondence by looking at the bound and measure its compactness by measuring its length. We get a similar picture to the one drawn above:
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
<img src="fig/Compact_proofs.png" width="700">
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
We will see many examples of proofs and compare their performance below. The ideal goal here would be to have a pipeline that takes in a vague interpretation of the model, turn that into a rigorous proof, and evaluate the interpretation based on the correspondence and compactness of the proof.

As we will see below this turns out to be rather difficult, even in toy models. The takeaway here is that quantification seems to be a hard problem and the compact proof approach is an example of this.
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
# 2. Max-of-2 Example
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
Having worked through the high level picture, let us now focus on concrete examples of compact proofs and explain what it means. Let's say we have a model:
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
<img src="fig/Model_2.png" width="700">
'''

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

class MLP(t.nn.Module):
    def __init__(self, params):
        super().__init__()
        self.n_ctx = params.n_ctx

        self.embedding = t.nn.Linear(params.d_vocab, params.d_model, bias=False)
        self.linear = t.nn.Linear(params.d_model, params.d_model, bias=False)
        self.unembedding = t.nn.Linear(params.d_model, params.d_vocab, bias=False)

    def g(self, x):

        return self.unembedding((self.linear(x)))

    def forward(self, a):

        return self.g(self.embedding(a.sum(dim=1)))

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
In our first example, we will train the model to predict the max of the two tokens, where the tokens range from $0$ to $d_{vocab}-1$. We will be interested in estimating the global loss of this model, that is we want to estimate 
$$ \mathbb{E}[f(t_1,t_2)]= \frac{1}{(d_{vocab})^2}\cdot\sum_{t_1,t_2\in \{0,...,d_{vocab}-1\}} f(t_1,t_2). $$


The general proof strategy consists of two steps:
1. P1: Prove a statement that given a model with its weights $\theta$, there is a quantity $C(\theta)$ such that $ \mathbb{E}[f_\theta(t_1,t_2)]\leq C(\theta) $.
2. P2: Compute the quantity $C(\theta)$.

We will come back to this after we did some proofs and also discuss what it means to have a **compact** proof.
'''

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

model = MLP(params=params)

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
We train our model for 2 epochs. Each epoch draws fresh random inputs, as many as $5\%$ of all possible inputs, so in total the model sees about $10\%$ as many examples as there are possible inputs. (Since they are drawn at random, this is not literally $10\%$ of the data set.)
'''

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

model = MLP(params=params).to(device)
loss_history = train(model=model, params=params)

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

plt.plot(loss_history)
plt.title("Loss Curve")
plt.xlabel("Batch")
plt.ylabel("Loss")
plt.grid(True)
plt.show()

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
Note that this is our **training set** loss.
'''

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

loss_history[-5:]

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
## 2.1 Brute force proof
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
Let's start proving things now! One thing we can do is a brute force proof. Remember that our proofs will consist of two steps. The first step (P1) is as follows

Theorem(Brute force proof):
The expected loss of a model $M$ with weights $\theta$ is bounded above by $\mathbb{E}[f(t_1,t_2)]$.

Proof: By definition the bound is actually an equality.
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
That was an easy proof, but the ones we will encounter from now on will be more difficult and feel less tautological!
Now we come to the second part of the proof (P2), which in this case means computing this quantity.
'''

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

# EXERCISE
# @measure_time
# def brute_force_loss_proof(model, params: Parameters) -> Float:
#     """Computes the loss for every possible input and returns the average of the sum of the losses"""

#     loss = 0
#     criterion = t.nn.CrossEntropyLoss()

#     # Solution goes here (create your tensors on `device`, where the model is)

#     pass
# END EXERCISE
# SOLUTION
@measure_time
def brute_force_loss_proof(model, params):
    loss = 0
    criterion = t.nn.CrossEntropyLoss()

    with t.no_grad():
        model.eval()

        for x in tqdm(range(0, params.d_vocab)):

            x_tensor = t.full((params.d_vocab,), x, device=device)
            y_tensor = t.arange(params.d_vocab, device=device)

            labels = t.max(x_tensor, y_tensor)

            inputs = t.stack(
                [
                    F.one_hot(x_tensor, num_classes=params.d_vocab).float(),
                    F.one_hot(y_tensor, num_classes=params.d_vocab).float(),
                ],
                dim=1,
            )

            outputs = model(inputs)

            loss += criterion(outputs, labels)

    return loss / params.d_vocab
# END SOLUTION

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

loss_bf, time_bf = brute_force_loss_proof(model=model, params=params)

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

performance["Brute force"] = (loss_bf, time_bf)

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
<details>
  <summary>A word on the "formal" in "formal proofs"</summary>
  
  Strictly speaking we would want to formalize our proofs, meaning that we would rewrite them in a form that can be verified by a formal proof assistant such as Lean or Coq. For a more serious use case this would be indeed necessary, but for now I will leave it open to the you, the reader, to formalize the proof that you would want to be verified. Generally speaking, be aware though that Lean and Coq also have bugs!
  
</details>
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
## 2.2 Symmetry proof
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
Our brute force proof gave the optimal bound, but at the cost of having to compute all the inputs. 
Can we do better? Yes!

We start with the first part P1 of our proof. It will be based on the following observation

Lemma: Let $f_\theta(t_1,t_2)$ denote the neural network as depicted above. Then $$ f_\theta(t_1,t_2) = f_\theta(t_2,t_1).$$

Try to prove that statement!
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
<details>
  <summary>Proof</summary>
  
  This is a consequence of the following equalities 
  $$f_\theta(t_1,t_2)= g_\theta(t_1.E+t_2.E)= g_\theta(t_2.E+t_1.E)=f_\theta(t_2,t_1).$$
  
</details>
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
Now you can use that statement to prove the following statement.

Theorem: The expected loss of a model M with weights $\theta$ is bounded by (and in fact equal to) $$\frac{1}{d_{vocab}^2} \cdot \big[ \sum_{t_1<t_2} 2\cdot f_\theta(t_1,t_2) + \sum_{t_1} f_\theta(t_1,t_1) \big].$$
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
<details>
  <summary>Proof</summary>
  
  This is a consequence of the following equality
  $$\sum_{t_1,t_2}  f_\theta(t_1,t_2)= \sum_{t_1<t_2} f_\theta(t_1,t_2) + \sum_{t_1} f_\theta(t_1,t_1) + \sum_{t_1>t_2} f_\theta(t_1,t_2) = \sum_{t_1<t_2} f_\theta(t_1,t_2) + \sum_{t_1} f_\theta(t_1,t_1) + \sum_{t_2<t_1} f_\theta(t_2,t_1) = \sum_{t_1<t_2} 2\cdot f_\theta(t_1,t_2) + \sum_{t_1} f_\theta(t_1,t_1).$$
  
</details>
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
Now we can come to the second part P2 of our proof -- actually computing the quantity.
'''

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

# EXERCISE
# @measure_time
# def symmetry_proof_loss(model, params: Parameters) -> Float:
#     """Computes the loss for the inputs specified above and returns the average of the sum of the losses (weighted correctly)"""

#     loss = 0
#     criterion = t.nn.CrossEntropyLoss()

#     # Solution goes here (create your tensors on `device`, where the model is)

#     pass
# END EXERCISE
# SOLUTION
@measure_time
def symmetry_proof_loss(model, params):
    loss = 0
    criterion = t.nn.CrossEntropyLoss()

    with t.no_grad():
        model.eval()
        for x in tqdm(range(0, params.d_vocab - 1)):

            x_tensor = t.full((params.d_vocab - x - 1,), x, device=device)
            y_tensor = t.arange(x + 1, params.d_vocab, device=device)

            labels = t.max(x_tensor, y_tensor)
            inputs = t.stack(
                [
                    F.one_hot(x_tensor, num_classes=params.d_vocab).float(),
                    F.one_hot(y_tensor, num_classes=params.d_vocab).float(),
                ],
                dim=1,
            )

            outputs = model(inputs)

            loss += criterion(outputs, labels) * 2 * len(x_tensor)

        x_tensor = t.eye(params.d_vocab, device=device)
        inputs = t.stack([x_tensor] * 2, dim=1)

        outputs = model(inputs)

        loss += criterion(outputs, t.arange(params.d_vocab, device=device)) * len(
            x_tensor
        )

    return loss / (params.d_vocab * params.d_vocab)
# END SOLUTION

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

loss_sym, time_sym = symmetry_proof_loss(model=model, params=params)

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

performance["Symmetric"] = (loss_sym, time_sym)

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
## 2.3 Convexity proof
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
So far our proofs didn't involve any proper bounds. We will now start using more coarse bounds, but this will lead to a great increase in compression. The central notion for this section is **convexity**.

Definition:
- A function $f:\mathbb{R}^n\to \mathbb{R}$ is convex, if $\forall x,y\in \mathbb{R}^n$ and $t\in [0,1]$, we have an inequality
$$ f(tx+(1-t)y)\leq tf(x)+(1-t)f(y).$$
- A function $f:\mathbb{R}^n\to \mathbb{R}^m$ is convex, if all the projections $f_1,...,f_m: \mathbb{R}^n\to \mathbb{R}^m\xrightarrow{pr_i} \mathbb{R}$ are convex.
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
Our strategy in this section is:
1. Prove that $L\circ g_\theta(v)$ is convex
2. Use that to prove a bound for $f_\theta(t_1,t_2)$
3. Compute the bound concretely

Again, step 1 and 2 are the P1 part of our proof and step 3 is the P2 part of our proof.
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
### 1. Proving that $L \circ g_{\theta}(v)$ is convex:

First we prove this general statement:

Lemma: Let $f_1:\mathbb{R}^n\to \mathbb{R}^m$ and $ f_2: \mathbb{R}^m\to \mathbb{R}^k$ be a linear and a convex function respectively, then $f_2\circ f_1: \mathbb{R}^n\to \mathbb{R}^k$ is convex as well.
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
<details>
  <summary>Proof</summary>
  This follows from the following inequalities

  $$f_2(f_1(t\cdot x + (1-t)\cdot y))=f_2(t\cdot f_1(x) + (1-t)\cdot f_1(y))\leq t\cdot f_2(f_1(x)) + (1-t)\cdot f_2(f_1(y)) $$
  where the first equality follows from linearity of $f_1$ and the second one from convexity of $f_2$.
  
</details>
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
Now we will combine the above statement with the following lemma.

Lemma: $g_\theta(v)$ is linear and $L(-,x)$ is convex.
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
<details>
  <summary>Proof</summary>

- $g_\theta(v)$ is a composition of linear functions, therefore also linear.

- There are several ways to prove that $L$ is convex. One could verify that the Hessian of $L$ is positive semi-definite or directly apply Hölder's inequality. Let's use the latter approach.
Our goal is to show that for $x\in \mathbb{R}^m$ we have the following function is convex
$$  -log(\frac{e^{x_i}}{\sum^m_{j=1}e^{x_j}}) $$
where we fixed an $i\in \{1,...,m\}$ (corresponding to the correct label).
We can rewrite the function as
$$ - x_i + log(\sum^m_{j=1}e^{x_j})$$
and it suffices to show that $log(\sum^m_{j=1}e^{x_j})$ is convex. This follows from Hölder's inequality
$$ \sum e^{t\cdot x_i} e^{(1-t)\cdot y_i} \leq (\sum e^{ x_i})^t \cdot (\sum e^{ y_i})^{1-t}.$$


</details>
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
### 2. Proving a bound for $f_\theta(t_1,t_2)$

Theorem: The expected loss of a model M with weights $\theta$ is bounded above by 
$$\frac{1}{d_{vocab}^2} \cdot \big[ \sum_{t_1} L(g_\theta(2\cdot t_1.E),t_1) + \sum_{t_1<t_2} \big( L(g_\theta(2\cdot t_1.E), t_2) + L(g_\theta(2\cdot t_2.E), t_2) \big) \big].$$

Note that we can rewrite the first and last term as $f_\theta(t_1,t_1)$ and $f_\theta(t_2,t_2)$ respectively, but we can't rewrite the middle term in terms of $f_\theta$ (Why?).
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
<details>
  <summary>Proof</summary>

From the symmetric proof section we have seen that expected loss is equal to $\frac{1}{d_{vocab}^2} \cdot \big[  \sum_{t_1} f_\theta(t_1,t_1) + \sum_{t_1<t_2} 2\cdot f_\theta(t_1,t_2) \big]$.

From the previous lemma we have seen, given $t_2>t_1$, that $ f_\theta(t_1,t_2)= L(g_\theta(t_1.E +t_2.E), t_2)\leq \frac{1}{2} \cdot L(g_\theta(2\cdot t_1.E), t_2) + \frac{1}{2} \cdot L(g_\theta(2\cdot t_2.E), t_2) $.

Combining the previous two statements yield the desired statement.
  
</details>
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
Now we come to the part P2 of our proof -- computing the above quantity.
'''

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

# EXERCISE
# @measure_time
# def convexity_proof(model, params: Parameters):
#     """Computes the loss for the diagonal entries and otherwise the convex bound specified above"""

#     loss = 0
#     criterion = t.nn.CrossEntropyLoss()

#     # Solution goes here (create your tensors on `device`, where the model is)

#     pass
# END EXERCISE
# SOLUTION
@measure_time
def convexity_proof(model, params):
    loss = 0

    with t.no_grad():
        model.eval()

        criterion = t.nn.CrossEntropyLoss()

        inputs = t.stack([t.eye(params.d_vocab, device=device) * 2], dim=1)

        logits = model(inputs)

        for i in tqdm(range(1, params.d_vocab)):

            # sum_{t1 < i} L(g(2 t1.E), i)  +  i copies of L(g(2 i.E), i)
            loss += i * criterion(logits[:i], t.full((i,), i, device=device))
            loss += i * criterion(logits[i : i + 1], t.full((1,), i, device=device))

        loss += params.d_vocab * criterion(
            logits, t.arange(params.d_vocab, device=device)
        )

    return loss / (params.d_vocab**2)
# END SOLUTION

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

performance["Convex"] = convexity_proof(model=model, params=params)

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
## 2.4 Summary
'''

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

def plot_performance(performance, title):
    colors = {"Brute force": "red", "Symmetric": "green", "Convex": "blue"}

    for label, (loss, elapsed_time) in performance.items():
        if loss is None:  # exercise not implemented yet
            continue
        plt.scatter(elapsed_time, float(loss), color=colors[label], label=label)

    plt.legend(loc="center left", bbox_to_anchor=(1.05, 0.5))
    plt.title(title)
    plt.xlabel("Time needed (in seconds)")
    plt.ylabel("Loss estimate")
    plt.show()


plot_performance(performance, "Different proof strategies to upper bound loss")

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
Let's break down what we see. On the $x$-axis we have the time it took to run the proofs. This is a proxy for the compactness of the proof. 
Another related notion would be to track the FLOPS needed to run the proof.
We see that the symmetric proof takes about half of the time compared to the brute force one. 
This makes sense: 

There is a total of $d^2$ inputs that the brute force proof needs. On the other hand the symmetric proof needs only $\frac{d(d+1)}{2}$ inputs. But note that our architecture was very simple -- we can't expect such an easy improvement in general. Note also that asymptotically both proofs scale **quadratic** in $d$.

On the other hand the convex proof scales only **linearly** in $d$. This is great, but it comes at a great cost: Our bound is very bad and we find ourselves on the other end of trade off, close to a vacuous proof. In fact, there is a straight forward explanation why our bound will always be comparatively coarse. Can you figure out why?
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
<details>
  <summary>The reason...</summary>

...that we should expect a very coarse bound in the expression $$ \big[ \sum_{t_1} L(g_\theta(t_1,t_1),t_1) + \sum_{t_1<t_2} L(g_\theta(t_1,t_1), t_2) + L(g_\theta(t_2,t_2), t_2) \big].$$

is the middle term $ L(g_\theta(t_1,t_1), t_2)$. This term computes the cross-entropy loss **not** between $\ell_{[t_1,t_1]}$ and $t_1= max([t_1,t_1])$, but between $\ell_{[t_1,t_1]}$  and $t_2$.
Thus even if our model would perform optimally, this term would remain high.
</details>
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
This concludes the first example! In the next section, we will explore a slightly different set up, where our convex proof will yield useful results. After that we are ready to dig into the proofs of the paper and replicate some of them. These will turn out to be more difficult, but will also make use of more serious mechanistic machinery.
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
# 3. Making convex work for $n=3$
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
We now slightly change our model and prove a new bound about it. This will be very similar to the previous section, but with better result.
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
<img src="fig/Model_3.png" width="700">
'''

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

params_3 = Parameters(n_ctx=3, d_vocab=256)
performance_3 = {}
set_seed(57)
model_3 = MLP(params=params_3).to(device)

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
So now our model is trained to predict the max of 3 tokens.
'''

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

loss_history_3 = train(model=model_3, params=params_3)

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

plt.plot(loss_history_3)
plt.title("Loss Curve")
plt.xlabel("Batch")
plt.ylabel("Loss")
plt.grid(True)
plt.show()

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
We can apply the brute force method again, the proof is as before.
'''

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

@measure_time
def brute_force_loss_proof_3(model, params):
    loss = 0
    criterion = t.nn.CrossEntropyLoss(reduction="sum")

    count = 0

    with t.no_grad():
        model.eval()

        # the first two tokens run over all d_vocab^2 pairs; these don't depend on x
        x_tensor = t.arange(params.d_vocab, device=device).repeat_interleave(params.d_vocab)
        y_tensor = t.arange(params.d_vocab, device=device).repeat(params.d_vocab)
        x_one_hot = F.one_hot(x_tensor, num_classes=params.d_vocab).float()
        y_one_hot = F.one_hot(y_tensor, num_classes=params.d_vocab).float()

        for x in tqdm(range(0, params.d_vocab)):

            z_tensor = t.full((params.d_vocab**2,), x, device=device)

            max_xy = t.max(x_tensor, y_tensor)
            labels = t.max(max_xy, z_tensor)

            inputs = t.stack(
                [
                    x_one_hot,
                    y_one_hot,
                    F.one_hot(z_tensor, num_classes=params.d_vocab).float(),
                ],
                dim=1,
            )

            outputs = model(inputs)

            loss += criterion(outputs, labels)

    return loss / params.d_vocab**3

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

performance_3["Brute force"] = brute_force_loss_proof_3(model=model_3, params=params_3)
performance_3["Brute force"][0]

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
### 1. Proving a bound for $f_\theta(t_1,t_2,t_3)$
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
Now we come to the P1 part of our proof. Again we make use of the convexity.


Theorem: The expected loss of a model M with weights $\theta$ is bounded above by 
$$\frac{1}{d_{vocab}^3} \cdot \big[ \sum_{t_1} f_\theta(t_1,t_1,t_1) + 3\cdot \sum_{t_1<t_2} f_\theta(t_1,t_1,t_2) + 3\cdot \sum_{t_1<t_2} f_\theta(t_1,t_2,t_2) + 3 \cdot \sum_{t_1<t_2 < t_3} \big( f_\theta(t_1,t_1,t_3)+f_\theta(t_2,t_2,t_3) \big) \big].$$
'''

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
<details>
  <summary>Proof</summary>

First, we decompose our input set $\{[t_1,t_2,t_3]\}$ into four disjoint subsets:
- $\{[t_1,t_1,t_1]\}$ , $\{[t_1,t_1,t_2] \mid t_1 \neq t_2 \}$ , $\{[t_1,t_2,t_2] \mid t_1 \neq t_2 \}$ 
- $\{[t_1,t_2,t_3]\mid t_i\neq t_j \textrm{ for } i\neq j\}$ 

Since our neural network is invariant under permutations, i.e. $f_\theta(t_1,t_2,t_3)= f_\theta(t_{\sigma(1)},t_{\sigma(2)},t_{\sigma(3)})$, we can decompose our loss into four terms as written above.

For the first three terms, we are computing the precise loss and for the last term we compute the estimated loss using convexity, where $t_3$ is **fixed**.

</details>
'''

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

def convexity_proof_three_equal(
    model,
    params: Parameters,
):

    loss = 0
    criterion = t.nn.CrossEntropyLoss(reduction="sum")

    with t.no_grad():

        # Estimate f(x,x,x)

        x_one_hot = t.eye(params.d_vocab, device=device)

        inputs = t.stack([x_one_hot] * 3, dim=1)
        outputs = model(inputs)

        loss += criterion(outputs, t.arange(params.d_vocab, device=device))

    return loss

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

def convexity_proof_two_equal(model, params: Parameters):

    loss = 0
    criterion = t.nn.CrossEntropyLoss(reduction="sum")

    with t.no_grad():
        # Estimate f(x,x,z) where x<z
        for z in range(1, params.d_vocab):

            # [0,1,...,z-1]
            x_tensor = t.arange(z, device=device)
            # [z,z,...,z]
            z_tensor = t.full((z,), z, device=device)

            inputs = t.stack(
                [
                    F.one_hot(x_tensor, num_classes=params.d_vocab).float(),
                    F.one_hot(x_tensor, num_classes=params.d_vocab).float(),
                    F.one_hot(z_tensor, num_classes=params.d_vocab).float(),
                ],
                dim=1,
            )
            outputs = model(inputs)

            loss += 3 * criterion(outputs, z_tensor)

        # Estimate f(x,z,z) where x<z
        for z in range(1, params.d_vocab):

            # [0,1,...,z-1]
            x_tensor = t.arange(z, device=device)
            # [z,z,...,z]
            z_tensor = t.full((z,), z, device=device)

            inputs = t.stack(
                [
                    F.one_hot(x_tensor, num_classes=params.d_vocab).float(),
                    F.one_hot(z_tensor, num_classes=params.d_vocab).float(),
                    F.one_hot(z_tensor, num_classes=params.d_vocab).float(),
                ],
                dim=1,
            )
            outputs = model(inputs)

            loss += 3 * criterion(outputs, z_tensor)

    return loss

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

@measure_time
def convexity_proof_3(model, params: Parameters):

    loss = []
    criterion = t.nn.CrossEntropyLoss(reduction="sum")

    with t.no_grad():
        # Estimate f(x,y,z) where x<y<z

        def estimate_fixed(z: int):
            count = 0

            # [0,1,...,z-1]
            x_tensor = t.arange(z, device=device)

            length = x_tensor.size(dim=0)

            # [z,z,...,z]
            z_tensor = t.full((length,), z, device=device)

            inputs = t.stack(
                [
                    F.one_hot(x_tensor, num_classes=params.d_vocab).float(),
                    F.one_hot(x_tensor, num_classes=params.d_vocab).float(),
                    F.one_hot(z_tensor, num_classes=params.d_vocab).float(),
                ],
                dim=1,
            )

            outputs = model(inputs)

            count = (length - 1) * criterion(outputs, z_tensor)

            return 3 * count

        for z in tqdm(range(2, params.d_vocab)):
            loss.append(estimate_fixed(z))

    loss.append(convexity_proof_three_equal(model=model, params=params))

    loss.append(convexity_proof_two_equal(model=model, params=params))

    return sum(loss) / params.d_vocab**3

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

performance_3["Convex"] = convexity_proof_3(model=model_3, params=params_3)
performance_3["Convex"][0]

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
### 2. Summary

As for the max-of-2 model, we compare the bound each proof gives with the time it took.
'''

# ! CELL TYPE: code
# ! FILTERS: []
# ! TAGS: []

plot_performance(performance_3, "Different proof strategies to upper bound loss (max of 3)")

# ! CELL TYPE: markdown
# ! FILTERS: []
# ! TAGS: []

r'''
# 4. Implementing the cubic proof
'''
