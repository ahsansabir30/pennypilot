import { describe, expect, it } from "vitest";
import { validateNewPassphrase } from "./security";

describe("validateNewPassphrase", () => {
  it("requires at least twelve Unicode characters", () => {
    expect(validateNewPassphrase("short", "short")).toContain("12");
    expect(validateNewPassphrase("é".repeat(12), "é".repeat(12))).toBeNull();
  });

  it("requires the confirmation to match exactly", () => {
    expect(
      validateNewPassphrase(
        "a sufficiently long phrase",
        "different phrase",
      ),
    ).toBe("The passphrases do not match.");
  });

  it("does not trim intentional whitespace", () => {
    expect(validateNewPassphrase(" twelve chars ", " twelve chars ")).toBeNull();
  });
});
