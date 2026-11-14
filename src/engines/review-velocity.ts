export interface ReviewEvent { rating: number; authorSessionHash: string; createdAt: Date; text: string }

export function ratingDivergence(a: number[], b: number[]): number {
  const totalA = a.reduce((s, n) => s + n, 0), totalB = b.reduce((s, n) => s + n, 0);
  if (!totalA || !totalB) return 0;
  return a.reduce((sum, n, i) => {
    const p = n / totalA, q = (b[i] || 0) / totalB, m = (p + q) / 2;
    return sum + (p ? p * Math.log2(p / m) / 2 : 0) + (q ? q * Math.log2(q / m) / 2 : 0);
  }, 0);
}

export function detectReviewSpike(events: ReviewEvent[], now = Date.now()) {
  const hour = 3600000;
  const current = events.filter(r => r.createdAt.getTime() >= now - hour && r.createdAt.getTime() <= now);
  const baseline = events.filter(r => r.createdAt.getTime() < now - hour && r.createdAt.getTime() >= now - 25 * hour);
  const negatives = current.filter(r => r.rating <= 2);
  const uniqueAuthors = new Set(negatives.map(r => r.authorSessionHash)).size;
  const histogram = (rows: ReviewEvent[]) => [1, 2, 3, 4, 5].map(n => rows.filter(r => r.rating === n).length);
  const divergence = ratingDivergence(histogram(current), histogram(baseline));
  const expectedHourly = baseline.length / 24;
  // Cold starts require five independent reviewers. History uses both velocity and rating shift.
  const spike = uniqueAuthors >= 5 && negatives.length / Math.max(current.length, 1) >= 0.6 &&
    (baseline.length < 20 || (current.length >= Math.max(5, expectedHourly * 3) && divergence >= 0.15));
  return { spike, divergence, uniqueAuthors, negatives, currentCount: current.length };
}
