/**
 * "Best course" composite score, 0-100.
 *
 * Google rating is Bayesian-shrunk toward the statewide mean so a 5.0 with 12
 * reviews doesn't outrank a 4.6 with 2,000. GolfPass adds a second opinion when
 * present; editorial list appearances (Golf Digest, Golfweek, top-muni lists)
 * add a bounded bonus.
 */
const PRIOR_MEAN = 4.1; // typical public-course Google rating
const PRIOR_WEIGHT = 40; // pseudo-review count backing the prior

export interface ScoreInputs {
  googleRating: number | null;
  googleReviews: number | null;
  golfpassRating: number | null; // 0-5
  listBonuses?: number; // count of notable editorial list appearances
}

export function computeScore(inp: ScoreInputs): number {
  const reviews = inp.googleReviews ?? 0;
  const g = inp.googleRating ?? PRIOR_MEAN;
  const shrunk = (g * reviews + PRIOR_MEAN * PRIOR_WEIGHT) / (reviews + PRIOR_WEIGHT);

  let rating5 = shrunk;
  if (inp.golfpassRating != null) {
    rating5 = shrunk * 0.7 + inp.golfpassRating * 0.3;
  }

  // Map 3.0-5.0 → 0-90, clamp below 3.0.
  let score = Math.max(0, Math.min(90, ((rating5 - 3.0) / 2.0) * 90));
  score += Math.min(10, (inp.listBonuses ?? 0) * 5);
  return Math.round(score * 10) / 10;
}
