import { describe, expect, test } from "bun:test";
import { normalizePersistEntries } from "./persist";

describe("normalizePersistEntries", () => {
  test("normalizes mixed persist definitions", () => {
    expect(normalizePersistEntries(["config.ini", ["data", "appdata"]])).toEqual([
      { source: "config.ini", target: "config.ini" },
      { source: "data", target: "appdata" },
    ]);
  });
});
