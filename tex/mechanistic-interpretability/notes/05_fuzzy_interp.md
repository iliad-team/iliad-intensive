--
A newer trend in interpretability is, to take less mechanistically faithful appproaches, and rely more on LLM judgement to interpret model internals
The idea is to direcly train an LLM to take in activations, and output natrual langugage explanations
first of this example are activation orcales:
 - Activation orcales
 @karvonen2026/training
 where we take activaltion from an LLM from one prompt/situation
 and feed this activation in anotehr version of this LLM: the activatio orcale
 now we ask the activaiton oracle a quesiton about the activations, we know the answer to
 then we finetune the AO to answer this question correclty when given access to the activation
 this generalizes to szenarios OOD to the one originally trained on
 @karvonen2026/benchmarks
 and on a bunch of examples, this has been the first method that purely looks at inernals, that can compete with blackbox clever prompting methods of realing the target fo fine tuning of a set of model orgnaisms.

 - Natural Language Autoencoders
  @fraser-taliente2026/training
NLAs take a different training approach:training 2 models: an activation verbalizer and an activation reconstrucutor
we train it the following way: we take a promtp, then take the activation from that prompt. just feed that activation ino the verbalizer, and let it produce a pice of text. that text is read in by the reeconstuctor, that proeuces then some activaiton after reading in this text.
now we can take a step of sft of the reconstructorer to make the reconstution closer to the original activation
and a step of GRPO RL of the verbalizer to produce better verbalizations


@fraser-taliente2026/reward-reasoning
this can also do cool things, like revleaing hidden unverblized motivations for answering a cirtain way

@fraser-taliente2026/hallucinations

@fraser-taliente2026/eval-awareness

@fraser-taliente2026/audit-game

@anthropic2025b
application: in the opus 4.8 system card they use NLAs to show that in 5% of of the answers in an evaluation, the model is aware of the presence of a  grader but does not verbalize this.
