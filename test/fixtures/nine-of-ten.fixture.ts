/**
 * Regression material for the first real issue (2026-11-26, one robotics paper). The abstract is
 * a representative reconstruction of the published source's key claim — a 15–60% position RMSE
 * reduction in nine out of ten evaluated combinations — not a verbatim copy. The generated article
 * claimed "the tenth combination showed no improvement", which the source does not establish.
 */
export const NINE_OF_TEN_TITLE =
  'Learning Residual Dynamics for Agile Quadrotor Flight Across Platforms and Trajectories';

export const NINE_OF_TEN_ABSTRACT =
  'Accurate dynamics models are essential for model-based control of agile quadrotors, but ' +
  'first-principles models miss aerodynamic effects at high speed. We learn a residual dynamics ' +
  'model that augments a nominal physics model and use it inside a model predictive controller. ' +
  'We evaluate the approach on two quadrotor platforms and five reference trajectories. Compared ' +
  'with the nominal model, the learned residual model reduces position RMSE by 15–60% in nine out ' +
  'of ten evaluated combinations. The model runs in real time on the onboard computer.';

/** The sentence that appeared in the published issue (translated back from Turkish). */
export const NINE_OF_TEN_UNSUPPORTED_TR =
  'Onuncu kombinasyonda ise herhangi bir iyileşme görülmedi.';
