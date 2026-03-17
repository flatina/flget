import { describe, expect, test } from "bun:test";
import { parseHashSpec } from "./hash";

describe("parseHashSpec", () => {
  test("infers algorithm from hash length", () => {
    expect(parseHashSpec("a".repeat(32)).algorithm).toBe("md5");
    expect(parseHashSpec("b".repeat(40)).algorithm).toBe("sha1");
    expect(parseHashSpec("c".repeat(64)).algorithm).toBe("sha256");
    expect(parseHashSpec("d".repeat(128)).algorithm).toBe("sha512");
  });
});
