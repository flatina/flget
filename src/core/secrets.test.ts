import { describe, expect, test } from "bun:test";
import { decryptSecretValue, encryptSecretsEnv } from "./secrets";

describe("flenc secrets envelope", () => {
  test("encrypts dotenv values with a self-describing one-line envelope", () => {
    const encrypted = encryptSecretsEnv("GITHUB_TOKEN=test-token\n", "top-secret");
    const value = encrypted.trim().slice("GITHUB_TOKEN=".length);

    expect(encrypted).toStartWith("GITHUB_TOKEN=FLENC[v1,");
    expect(decryptSecretValue(value, "top-secret")).toBe("test-token");
  });
});
