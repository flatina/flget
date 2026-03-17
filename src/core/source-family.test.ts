import { describe, expect, test } from "bun:test";
import { getPackageBaseRelativePath } from "./package-layout";
import { inferPackageLocationFromRelativeParts } from "./source-family";

describe("source family registry", () => {
  test("maps source types to install paths and infers them back from meta locations", () => {
    expect(getPackageBaseRelativePath("github-release", "ripgrep")).toBe("ghr\\ripgrep");
    expect(getPackageBaseRelativePath("skill-github", "codex")).toBe("agents\\skills\\codex");
    expect(inferPackageLocationFromRelativeParts(["npmgh", "pnpm", "flget.meta.json"])).toEqual({
      id: "pnpm",
      sourceType: "npm-github",
      installKind: "app",
    });
    expect(inferPackageLocationFromRelativeParts(["agents", "skills", "codex", "flget.meta.json"])).toEqual({
      id: "codex",
      sourceType: "skill-github",
      installKind: "skill",
    });
  });
});
