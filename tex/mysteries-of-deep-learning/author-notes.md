# Author notes

These unpublished notes were moved verbatim from `main.mdx` so they no longer
ship in the worksheet's MDX downloads. They remain source-only; they are not
student-facing worksheet content. Review notes and provisional answers have
not been resolved or published by this move.

Locations below refer to `main.mdx` at commit
`d5fec17706ceed1fa028ca949b97b92dcc2f5f7e`.

## Reading guide (original line 32)

``````mdx
{/* Every discussion question below carries the author's written-out answer.
    They were provisional TA-facing notes — shorthand in places, one of them
    still TODO — never meant to be read by students, so each is commented out
    here rather than published (author's call, 2026-07-29). Un-comment a block
    to bring it back; nothing inside one has been edited. */}
``````

## Lecture (original line 50)

``````mdx
{/*
<Solution>

Answer: many answers are acceptable here. A few points one might mention:

* It seems increasingly likely that AGI/ASI will be based on deep learning
* Safety is intrinsically hard to hill-climb in the way that capabilities benchmarks are. Failures can be rare and have heavy-tail costs
* Historical comparisons (steam engine safety, aviation safety, etc)

</Solution>
*/}
``````

## Lecture (original line 68)

``````mdx
{/*
<Solution>

Answer: TODO

</Solution>
*/}
``````

## Overview (original line 90)

``````mdx
{/*
<Solution>

Answer: people should mention the universality hypothesis class, the simplicity prior, optimality results.

</Solution>
*/}
``````

## Overview (original line 104)

``````mdx
{/*
<Solution>

Answer: this is answered in the post under the "Clarifying the hypothesis" expandable section. See in particular the FPGA analogy and the point about general-purpose search. It is also discussed further in the "representation problem" section where a possible mechanism is sketched

</Solution>
*/}
``````

## Overview (original line 118)

``````mdx
{/*
<Solution>

Answer: they map to the "paradox of approximation" section, the "paradox of generalization" section, and the "search problem" section. Optimization shows up in the "search problem" section within "path forward" because it's the only one of the three mysteries which Solomonoff induction can't explain.

</Solution>
*/}
``````

## Overview (original line 132)

``````mdx
{/*
<Solution>

Answer: they may *train* differently; the gradients can be different even if the function implemented is the same. For instance, suppose network A is an LLM that has never learned about bioweapons, and network B is an LLM who learned about bioweapons but was trained to suppress this knowledge in the last layer. They may behave the same right now, but under fine-tuning one can easily recover dangerous capabilities in B but not A.

* One may be tempted to say that we should care because even if networks implement the same function in-distribution, they may behave differently out-of-distribution. But, while true and important, this is actually denying the premise of the question, because behaving differently out-of-distribution means the two functions really *are* different. The strong claim here is that you should care about implementation *even if no possible input/output test could distinguish between the two networks*.

</Solution>
*/}
``````

## Approximation (original line 156)

``````mdx
{/*
<Solution>

Answer: because the number of neurons required is exponential, for generic smooth functions. The UAT is essentially a proof that *with exponential resources you can build a continuous lookup table.* This would require more parameters than are atoms in the universe just to e.g. approximate MNIST

</Solution>
*/}
``````

## Approximation (original line 170)

``````mdx
{/*
<Solution>

Answer: real target functions *provably* must have some non-generic structure beyond that of generic Lipschitz functions, if realistic-size deep neural networks are to be capable of representing them at all. Depth separation results are theoretical results showing that there exist target functions that require exponentially many more parameters for a shallow network to approximate compared to a deep network. They hint that the non-generic target structure neural networks are exploiting may be *compositional* structure, as deep but not shallow networks can exploit this structure. Bonus points for relating this to program structure discussed in the "program synthesis" post

</Solution>
*/}
``````

## Generalization (original line 192)

``````mdx
{/*
<Solution>

Answer: The resources here deliberately refer to *in-distribution generalization*, that is the gap between test loss and train loss where the train loss is sampled from the same distribution the test loss is evaluated over. This excludes OOD generalization, which would require evaluating the test loss against a different input/label distribution than the training samples are sampled from. Historically, the word "generalization" within statistical learning theory has typically referred to in-distribution generalization, but in common ML usage the word increasingly refers to OOD generalization. It is therefore *very common* for students to conflate in-distribution and OOD generalization, but they are totally different notions within a statistical learning theory context, and OOD generalization is almost impossible to prove useful results about in generality (the test distribution can change to anything!) despite sounding more appealing. There is still no consensus explanation for in-distribution generalization, and OOD generalization is strictly harder to explain.

* "The framework imagined a data distribution $D$ over inputs $X$ and outputs $Y$ where the goal was to fit a hypothesis $h : X \to Y$ that minimized the expected test loss for a loss function $L : X \times Y \to R$ over $D$. A learning algorithm would receive $n$ samples from the data distribution, and would minimize the training loss averaged across the sample $L(h(x), y)$."

</Solution>
*/}
``````

## Generalization (original line 208)

``````mdx
{/*
<Solution>

Answer: the architecture and algorithm are *fixed* across the two runs, so any complexity measure that depends only on the hypothesis class and the (data-independent) algorithm must give the same number in both - yet one generalizes and one doesn't. Therefore generalization is not a property of the model; it's an emergent property of model × algorithm × *data structure*.

</Solution>
*/}
``````

## Generalization (original line 222)

``````mdx
{/*
<Solution>

Answer: They're fully compatible - Zhang et al. is a negative result and Wilson is a positive proposal in the space it leaves open. Both say generalization is not a uniform property of the model class: capacity measures like VC dimension or Rademacher complexity can't explain it, since the same network generalizes on real data and memorizes random labels. Zhang stops there (an experimental result ruling out capacity-based explanations); Wilson supplies a candidate replacement - soft inductive biases, a flexible hypothesis space with a data-dependent preference for simpler solutions - which is exactly the kind of non-uniform, data-dependent explanation Zhang leaves room for. The "killed vs not mysterious" clash is one of tone, not content.

</Solution>
*/}
``````

## Optimization (original line 242)

``````mdx
{/*
<Solution>

Answer: the hardness argument means that (under cryptographic assumptions) SGD can't learn hard targets in polynomial time. Bayes, meanwhile, will rapidly concentrate posterior mass on the target because it's realizable and gets zero train loss. Bayes doesn't run in polynomial time, so hardness arguments are vacuously true here and don't force poor performance. In this way, Bayesian learning gives an algorithm with good approximation and generalization, but terrible optimization efficiency, because it can't run in polynomial time.

</Solution>
*/}
``````

## Optimization (original line 256)

``````mdx
{/*
<Solution>

Answer: one can make a few points here.

* As discussed in the previous question, this phenomenon separates approximation and generalization from optimization difficulty. This is especially important because while e.g. Solomonoff induction gives us a good model of how one can simultaneously achieve good approximation and generalization, it gives no answer as to the optimization problem. It separates the questions we have an in-principle explanation of from the one we don't
* It constrains explanation for the optimization problem. Any explanation for why training succeeds (in poly time) which works uniformly across all targets must be wrong. Instead, you *must* engage with the target structure, in such a way that your explanation applies for typical targets but does not apply for worst-case targets. (Emphasize: there's a pattern here, the approximation and generalization problems *also* force us to provide explanations which depend on non-generic target structure.)
  * As a kicker, it's not obvious at all how such worst-case functions can easily be separated from the typical ones. They're realizable, they lie inside your hypothesis class. They show up *automatically* and *inevitably* in any model which can perform sufficiently general computation (because then you can implement one-way functions.) In fact, you can't even distinguish worst-case functions from typical ones *by any black box (purely input/output) procedure whatsoever*, since that would break the cryptographic hardness assumption as well. So the explanation for the typical/worst-case gap must really be sophisticated.
  * Re: the program synthesis hypothesis, note also that the explanation here can't be "optimization succeeds because real-world targets have compositional/program structure and generic functions don't," because the worst-case targets obviously have program structure, and they're rather short and simple programs at that. One must distinguish between different types of programs.

</Solution>
*/}
``````

## Representational alignment (original line 281)

``````mdx
{/*
<Solution>

Answer: The *observation* that independently trained models learn similar representations is old and well-established - it predates the paper by years (model stitching, CKA/RSA similarity, "convergent learning," universal Gabor filters, vision models predicting visual cortex). What's *new* is not that models resemble each other but a claim about where they're heading: representations are converging toward a single endpoint, and that endpoint is a representation of the underlying reality - the statistical structure of the world that generated the data (their "platonic" representation, idealized as a kernel reflecting how real-world events co-occur). The evidence they cite for *this* is (i) convergence that grows with model scale and competence, (ii) convergence that holds *across modalities* - vision and language models becoming more alignable as they get more capable - and (iii) a theoretical argument that multitask pressure, capacity, and simplicity bias funnel diverse models toward the same solution. The distinction from "models converge to shared representations" is the addition of a *limit point* and its *identity*: plain convergence is just pairwise similarity, and is equally consistent with models merely sharing architectures, objectives, or training data; PRH claims they share a *destination*, and that the destination is reality's structure - which is what licenses its signature prediction that convergence should cross modalities. That cross-modal and scaling evidence is exactly the novel, load-bearing, and most-contested part; the bare convergence phenomenon is the consensus part.

* Note that papers like "[Revisiting the PRH: An Aristotelian View](https://arxiv.org/abs/2602.14486)" have criticized some of the evidence in the PRH paper and propose a slightly weaker hypothesis. However their critiques only apply to evidence based on CKA, a particular technique, and other evidence appears to survive

</Solution>
*/}
``````

## In-context learning (original line 303)

``````mdx
{/*
<Solution>

An induction head is a circuit implementing the rule \[A\]\[B\] … \[A\] → \[B\] - find the previous occurrence of the current token, see what followed it, predict that again ("complete the pattern" by copying). Mechanically it's two heads composed across layers (a previous-token head feeding the induction head), so it cannot exist in a 1-layer model. In-context learning is operationalized as the drop in loss from early to late token positions (the model predicting better the more context it has seen). Early in training there is a phase change, visible as a bump in the training loss, during which induction heads form and the bulk of in-context-learning ability appears simultaneously - for models of every size with more than one layer. Simultaneity alone would only be suggestive; the case is carried by co-perturbation (when they modify the architecture to move when induction heads can form, the in-context-learning jump moves to match) and by direct ablation (knocking out induction heads in small models sharply reduces in-context learning)

</Solution>
*/}
``````
