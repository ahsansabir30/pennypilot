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

  it.each([
    ["9007199254740991", "£90,071,992,547,409.91"],
    ["9007199254740993", "£90,071,992,547,409.93"],
    ["-9007199254740993", "-£90,071,992,547,409.93"],
    ["9223372036854775807", "£92,233,720,368,547,758.07"],
    ["-9223372036854775808", "-£92,233,720,368,547,758.08"],
    ["0", "£0.00"],
    ["-1", "-£0.01"],
  ])("formats exact aggregate %s", (pence, expected) => {
    expect(formatPence(pence)).toBe(expected);
    expect(formatPence(BigInt(pence))).toBe(expected);
  });

  it("rejects unsafe numeric currency instead of formatting an already rounded value", () => {
    expect(() => formatPence(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => formatPence(1.5)).toThrow(RangeError);
  });
});
