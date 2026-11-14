import { expect, it } from "bun:test";
import { detectReviewSpike, ratingDivergence, type ReviewEvent } from "../src/engines/review-velocity";
const now = Date.now();
const review = (author: string, age: number, rating = 1): ReviewEvent => ({ authorSessionHash: author, createdAt: new Date(now - age), rating, text: "review" });

it("ignores old complaints instead of accumulating them forever", () => {
  expect(detectReviewSpike(Array.from({ length: 10 }, (_, i) => review(String(i), 2 * 3600000)), now).spike).toBe(false);
});
it("does not call one repeated reviewer a coordinated spike", () => {
  expect(detectReviewSpike(Array.from({ length: 20 }, () => review("one-author", 1000)), now).spike).toBe(false);
});
it("detects a cold-start spike from independent reviewers", () => {
  expect(detectReviewSpike(Array.from({ length: 5 }, (_, i) => review(String(i), 1000)), now).spike).toBe(true);
});
it("uses rating divergence and volume against the historical baseline", () => {
  const history = Array.from({ length: 24 }, (_, i) => review(`old-${i}`, 2 * 3600000, 5));
  const current = Array.from({ length: 5 }, (_, i) => review(`new-${i}`, 1000));
  expect(detectReviewSpike([...history, ...current], now).spike).toBe(true);
  expect(ratingDivergence([1, 0, 0, 0, 0], [0, 0, 0, 0, 1])).toBe(1);
});
