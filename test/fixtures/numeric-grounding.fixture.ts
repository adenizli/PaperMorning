/**
 * Regression material for the numeric-grounding false positives seen on Geveze (2026-11-28).
 * The quoted source sentences are verbatim from the production error reports; the surrounding
 * abstract text is a representative reconstruction, not a copy of the papers.
 */

/** Research analysis failure: "Numbers not present in the source text: 32". */
export const THIRTY_TWO_TITLE =
  'Learned Manipulation Policies in Clinical Robotics: A Systematic Review';
export const THIRTY_TWO_ABSTRACT =
  'We systematically searched five databases for studies of learned manipulation policies in ' +
  'clinical robotics. Thirty-two studies met the inclusion criteria. Most evaluated policies in ' +
  'simulation only, and few reported failure rates or long-term outcomes.';

/** Article writing failure: "numbers not present in the analysis/abstract: 470, 470.000". */
export const ROLLOUTS_TITLE = 'Scaling Evaluation of Generalist Robot Policies in Simulation';
export const ROLLOUTS_ABSTRACT =
  'Evaluating generalist robot policies on real hardware is slow and costly. We present a ' +
  'simulation benchmark built from real-world scenes and we evaluate over 470,000 rollouts across ' +
  'policies and tasks. Simulated success rates are strongly correlated with real-world success ' +
  'rates, with a mean error of 4.2 percentage points.';

/** What the Turkish article actually wrote: both forms denote 470,000. */
export const ROLLOUTS_ARTICLE_TR =
  'Yazarlar 470.000 deneme koşusunun üzerinde değerlendirme yapıyor; yani 470 binden fazla ' +
  'koşu. Benzetimdeki başarı ile gerçek dünyadaki başarı arasındaki ortalama hata 4,2 puan.';

/**
 * Article writing failure during the 2026-11-28 retry: "numbers not present in the
 * analysis/abstract: 3B". Turkish "3B" (üç boyutlu) is the standard rendering of English "3D".
 * The quoted Turkish sentence is verbatim from the production error; the abstract around
 * "3D gripper poses" is a representative reconstruction.
 */
export const GRIPPER_TITLE = 'Language Models Still Struggle with Spatial Grasp Reasoning';
export const GRIPPER_ABSTRACT =
  'We study whether large language models can reason about robotic grasps. Given a scene ' +
  'description, models must predict 3D gripper poses for a target object. Even with extended ' +
  'reasoning, current models predict 3D gripper poses poorly compared with geometric baselines.';
export const GRIPPER_PROBLEM_TR =
  'Büyük dil modelleri, genişletilmiş akıl yürütmeyle bile 3B gripper pozlarını zayıf tahmin ediyor.';
