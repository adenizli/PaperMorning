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
