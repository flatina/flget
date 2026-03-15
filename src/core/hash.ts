import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

type HashAlgorithm = "sha1" | "sha256" | "sha512" | "md5";

export interface ParsedHash {
  algorithm: HashAlgorithm;
  value: string;
}

export function parseHashSpec(input: string): ParsedHash {
  const normalized = input.trim();
  const match = normalized.match(/^(sha1|sha256|sha512|md5):(.+)$/i);
  if (match) {
    return {
      algorithm: match[1].toLowerCase() as HashAlgorithm,
      value: match[2].toLowerCase(),
    };
  }
  if (/^[a-f0-9]+$/i.test(normalized)) {
    if (normalized.length === 32) {
      return {
        algorithm: "md5",
        value: normalized.toLowerCase(),
      };
    }
    if (normalized.length === 40) {
      return {
        algorithm: "sha1",
        value: normalized.toLowerCase(),
      };
    }
    if (normalized.length === 128) {
      return {
        algorithm: "sha512",
        value: normalized.toLowerCase(),
      };
    }
  }
  return {
    algorithm: "sha256",
    value: normalized.toLowerCase(),
  };
}

export async function hashFile(path: string, algorithm: HashAlgorithm): Promise<string> {
  const hash = createHash(algorithm);
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex").toLowerCase();
}

export async function verifyFileHash(path: string, expected: string): Promise<boolean> {
  const parsed = parseHashSpec(expected);
  const actual = await hashFile(path, parsed.algorithm);
  return actual === parsed.value;
}
