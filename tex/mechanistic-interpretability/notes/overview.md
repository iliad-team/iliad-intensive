Rough Lecture outline:

- goal of MechInterp
- how to make MechInterp usefull for AI safety
- AI safety ontology:
  - Feature
  - circuit
  (chirs olah @olah2020)
  

Historical Mechinterp:
 - feature saliency maps in cnns?
 - circuits in cnns via stiching together what features activate together lead to the next feature? @cammarata2020


MechInterp in Transformers:

What is a feature in a transformer?
 - in ML, linear directions in activation space can have interpretable meanings @mikolov2013
 - this is also true for LLMs @park2024
 - Linear probes can read off internal representations out of a tranformer @nanda2023 
 - steering to measure effects @panickssery2024
 - ablation to measure absence @arditi2024

 - toy models of superposition @elhage2022
 - mathematical background: why superposition/why SAEs @candes2004 @donoho2006 
 - SAE @bricken2023
 - what makes a good SAE? @karkonen2025b
 - Transcoders, Cross Coders, Model Diffing @lindsey2024
 - MelBo @mack2024
 - Feature Geometry/Absorbtion/Splitting @chanin2024

 - other idea for labeling features: activation oracles @karvonen2026

Circuit Discovery:
 - example of success: completely reverse engineered a arithmetic model @nanda2023a 
 - Circuit Diecovery mthods:
  - Logit attribution (induction heads) @elhage2021
  - Logit lense (exercise) @nostalgebraist2020
  - Path patching (IOI) @wang2022
  - Ablation (ACDC) @conmy2023
  - Attribution Graph (Rhyming) @lindsey2025a


 - causal scrubbing as a framework to validate Circuits @chan2022
 - Is circuit discovery NP hard? @adolfi2025

Outlook section:
 - How MechInterp us usefull now:
   - Claude 4.5 system card '6.4.2 Follow-up interpretability investigations of deception by omission' @anthropic2025b
 - Open problems in mechiinterp (25 paper) @sharkey2025
- Cretiques of Mechinterp:
 - Neel Nandas Mechinterp cretique @nanda2025
 - Charbels against almost every theory of impact @segerie2023
 - Dan Hendricks cretique @hendrycks2025
 - the apollo post on limitations of activations based Intep @chughtai2025
