import { describe, expect, it } from "vitest";
import { formatPence, poundsToPence } from "./finance";

describe("exact GBP amount conversion", () => {
  it.each([
    ["0.01", 1],
    ["12", 1200],
    ["12.3", 1230],
    ["12.34", 1234],
    ["999999999.99", 99_999_999_999],
  ])("converts %s to integer pence", (input, expected) => {
    expect(poundsToPence(input)).toBe(expected);
  });

  it.each(["", "0.001", "-1.00", "1e2", "£1.00", ".50", "1000000000.00"])(
    "rejects unsupported pound input %s",
    (input) => {
      expect(poundsToPence(input)).toBeNull();
    },
  );

  it("formats pence as GBP without losing precision", () => {
    expect(formatPence(1234)).toBe("£12.34");
    expect(formatPence(-1)).toBe("-£0.01");
  });
});
