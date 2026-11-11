// @vitest-environment node
import { describe, expect, it } from "vitest";
import { devReleaseVersion } from "./dev-release-version.ts";

describe("devReleaseVersion", () => {
  it("uses the date for the first release of the day", () => {
    expect(devReleaseVersion("20261111", ["dev-v0.1.40-local.1", "20261110", "20261112"])).toBe("20261111");
  });

  it("numbers additional releases without overwriting earlier tags", () => {
    expect(devReleaseVersion("20261111", ["refs/tags/20261111"])).toBe("20261111.2");
    expect(devReleaseVersion("20261111", ["20261111", "20261111.2", "20261111.10"])).toBe("20261111.11");
  });

  it("keeps increasing the sequence when an earlier tag was removed", () => {
    expect(devReleaseVersion("20261111", ["20261111.3"])).toBe("20261111.4");
  });

  it("ignores unrelated and malformed suffixes", () => {
    expect(devReleaseVersion("20261111", ["202611110", "20261111.2-notes", "20261111.02"])).toBe("20261111");
  });

  it("accepts a valid leap day", () => {
    expect(devReleaseVersion("20240229", [])).toBe("20240229");
  });

  it.each([undefined, "", "2026-11-11", "2026111", "202611111", "20260229", "20261301", "20261131"])(
    "rejects an invalid date %s",
    (date) => expect(() => devReleaseVersion(date, [])).toThrow(/date/),
  );

  it("fails instead of rounding an out-of-range release sequence", () => {
    expect(() => devReleaseVersion("20261111", ["20261111.9007199254740991"])).toThrow("sequence");
  });
});
