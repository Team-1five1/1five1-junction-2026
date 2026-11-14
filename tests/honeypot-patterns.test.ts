import { expect, it } from "bun:test";
import { honeypotPatternId } from "../src/engines/honeypot-patterns";

it("clusters repeated bot templates while ignoring whitespace, casing, and rotating links", () => {
  expect(honeypotPatternId("BUY NOW https://spam.org/one")).toBe(honeypotPatternId("buy  now https://spam.org/two"));
  expect(honeypotPatternId("A different message")).not.toBe(honeypotPatternId("BUY NOW https://spam.org/one"));
});
