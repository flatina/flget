import { describe, expect, test } from "bun:test";
import { detectShimType, inferShimRunner, wildcardToRegExp } from "./strings";

describe("wildcardToRegExp", () => {
  test("matches glob-like asset names", () => {
    const pattern = wildcardToRegExp("ripgrep-*-windows-*.zip");
    expect(pattern.test("ripgrep-14.1.1-windows-x64.zip")).toBe(true);
    expect(pattern.test("ripgrep-14.1.1-linux-x64.tar.gz")).toBe(false);
  });
});

describe("detectShimType", () => {
  test("treats common JS module extensions as bun-run shims", () => {
    expect(detectShimType("bin/demo.js")).toBe("js");
    expect(detectShimType("bin/demo.cjs")).toBe("js");
    expect(detectShimType("bin/demo.mjs")).toBe("js");
  });

  test("treats common TS module extensions as bun-run shims", () => {
    expect(detectShimType("bin/demo.ts")).toBe("ts");
    expect(detectShimType("bin/demo.cts")).toBe("ts");
    expect(detectShimType("bin/demo.mts")).toBe("ts");
  });
});

describe("inferShimRunner", () => {
  test("infers runners from common script extensions", () => {
    expect(inferShimRunner("scripts/demo.ts")).toBe("bun");
    expect(inferShimRunner("scripts/demo.py")).toBe("python");
    expect(inferShimRunner("scripts/demo.sh")).toBe("bash");
  });
});
