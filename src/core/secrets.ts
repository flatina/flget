import { basename, join } from "node:path";
import { userInfo } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { RuntimeContext } from "./types";
import { getDirs } from "./dirs";
import { pathExists } from "../utils/fs";
import { readRuntimeText } from "../utils/runtime";

const FLENC_PREFIX = "FLENC[";
const FLENC_SUFFIX = "]";
const FLENC_VERSION = "v1";
const FLENC_CIPHER = "AES256_GCM";
const FLENC_KDF = "scrypt";
const FLENC_SCRYPT_N = 16_384;
const FLENC_SCRYPT_R = 8;
const FLENC_SCRYPT_P = 1;

function normalizeSecretValue(value: string): string {
  return value.trim();
}

function parseQuotedValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, "");
}

export function parseDotEnv(content: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const separator = normalized.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = normalized.slice(0, separator).trim();
    const value = parseQuotedValue(normalized.slice(separator + 1));
    if (key) {
      entries[key] = value;
    }
  }
  return entries;
}

function parseEncryptedSecretValue(content: string): {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  iv: Buffer;
  tag: Buffer;
  data: Buffer;
} {
  const trimmed = content.trim();
  if (!trimmed.startsWith(FLENC_PREFIX) || !trimmed.endsWith(FLENC_SUFFIX)) {
    throw new Error("Invalid encrypted secrets file envelope.");
  }

  const body = trimmed.slice(FLENC_PREFIX.length, -FLENC_SUFFIX.length);
  const parts = body.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts[0] !== FLENC_VERSION) {
    throw new Error("Unsupported encrypted secrets file version.");
  }

  const fields = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const separator = part.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    fields.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }

  const cipher = fields.get("cipher");
  const kdf = fields.get("kdf");
  const n = Number(fields.get("n"));
  const r = Number(fields.get("r"));
  const p = Number(fields.get("p"));
  const salt = fields.get("salt");
  const iv = fields.get("iv");
  const tag = fields.get("tag");
  const data = fields.get("data");
  if (
    cipher !== FLENC_CIPHER
    || kdf !== FLENC_KDF
    || !Number.isSafeInteger(n)
    || !Number.isSafeInteger(r)
    || !Number.isSafeInteger(p)
    || n <= 1
    || r <= 0
    || p <= 0
    || !salt
    || !iv
    || !tag
    || !data
  ) {
    throw new Error("Invalid encrypted secrets file fields.");
  }

  return {
    n,
    r,
    p,
    salt: Buffer.from(salt, "base64"),
    iv: Buffer.from(iv, "base64"),
    tag: Buffer.from(tag, "base64"),
    data: Buffer.from(data, "base64"),
  };
}

export function encryptSecretValue(content: string, passphrase: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, {
    N: FLENC_SCRYPT_N,
    r: FLENC_SCRYPT_R,
    p: FLENC_SCRYPT_P,
  });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(content, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${FLENC_PREFIX}${[
    FLENC_VERSION,
    `cipher:${FLENC_CIPHER}`,
    `kdf:${FLENC_KDF}`,
    `n:${FLENC_SCRYPT_N}`,
    `r:${FLENC_SCRYPT_R}`,
    `p:${FLENC_SCRYPT_P}`,
    `salt:${salt.toString("base64")}`,
    `iv:${iv.toString("base64")}`,
    `tag:${tag.toString("base64")}`,
    `data:${ciphertext.toString("base64")}`,
  ].join(",")}${FLENC_SUFFIX}`;
}

export function decryptSecretValue(content: string, passphrase: string): string {
  const envelope = parseEncryptedSecretValue(content);
  const key = scryptSync(passphrase, envelope.salt, 32, {
    N: envelope.n,
    r: envelope.r,
    p: envelope.p,
  });
  const decipher = createDecipheriv("aes-256-gcm", key, envelope.iv);
  decipher.setAuthTag(envelope.tag);
  const plaintext = Buffer.concat([decipher.update(envelope.data), decipher.final()]);
  return plaintext.toString("utf8");
}

export function encryptSecretsEnv(content: string, passphrase: string): string {
  const entries = parseDotEnv(content);
  return Object.entries(entries)
    .map(([key, value]) => `${key}=${encryptSecretValue(value, passphrase)}`)
    .join("\n")
    .concat("\n");
}

function decryptDotEnvValues(entries: Record<string, string>, passphrase: string): Record<string, string> {
  const decrypted: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    decrypted[key] = value.startsWith(FLENC_PREFIX)
      ? decryptSecretValue(value, passphrase)
      : value;
  }
  return decrypted;
}

async function readRootDotEnv(root: string): Promise<Record<string, string>> {
  const dirs = getDirs(root);
  if (!await pathExists(dirs.envFile)) {
    return {};
  }
  return readEnvFile(dirs.envFile);
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  if (!await pathExists(path)) {
    return {};
  }
  const entries = parseDotEnv(await readRuntimeText(path));
  try {
    const hasEncryptedValue = Object.values(entries).some((value) => value.startsWith(FLENC_PREFIX));
    if (!hasEncryptedValue) {
      return entries;
    }

    const passphrase = process.env.FLGET_SECRETS_KEY;
    if (!passphrase) {
      throw new Error(`FLGET_SECRETS_KEY is required to decrypt ${path}`);
    }
    return decryptDotEnvValues(entries, passphrase);
  } catch (error) {
    throw new Error(`Failed to decrypt ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeProfileName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = basename(value.trim()).replace(/[\\/:"*?<>|]+/g, "-");
  return normalized || null;
}

function getProfileName(): string | null {
  const explicit = normalizeProfileName(process.env.FLGET_PROFILE);
  if (explicit) {
    return explicit;
  }
  const envUser = normalizeProfileName(process.env.USERNAME ?? process.env.USER);
  if (envUser) {
    return envUser;
  }
  try {
    return normalizeProfileName(userInfo().username);
  } catch {
    return null;
  }
}

function getSharedSecretsPaths(root: string): { plain: string; encrypted: string } {
  const dirs = getDirs(root);
  return {
    plain: dirs.secretsFile,
    encrypted: `${dirs.secretsFile}.flenc`,
  };
}

function getProfileSecretsPaths(root: string, profile: string): { plain: string; encrypted: string } {
  const dirs = getDirs(root);
  const base = join(dirs.secretsDir, `${profile}.env`);
  return {
    plain: base,
    encrypted: `${base}.flenc`,
  };
}

async function readProfileSecretsEnv(root: string): Promise<Record<string, string>> {
  const profile = getProfileName();
  if (!profile) {
    return {};
  }
  const paths = getProfileSecretsPaths(root, profile);
  return {
    ...await readEnvFile(paths.plain),
    ...await readEnvFile(paths.encrypted),
  };
}

export async function resolveSecret(root: string, ...names: string[]): Promise<string | null> {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && normalizeSecretValue(value) !== "") {
      return value;
    }
  }

  const envFile = await readRootDotEnv(root);
  for (const name of names) {
    const value = envFile[name];
    if (typeof value === "string" && normalizeSecretValue(value) !== "") {
      return value;
    }
  }

  const sharedSecretsPaths = getSharedSecretsPaths(root);
  const secretsEnv = {
    ...await readEnvFile(sharedSecretsPaths.plain),
    ...await readEnvFile(sharedSecretsPaths.encrypted),
  };
  for (const name of names) {
    const value = secretsEnv[name];
    if (typeof value === "string" && normalizeSecretValue(value) !== "") {
      return value;
    }
  }

  const profileSecretsEnv = await readProfileSecretsEnv(root);
  for (const name of names) {
    const value = profileSecretsEnv[name];
    if (typeof value === "string" && normalizeSecretValue(value) !== "") {
      return value;
    }
  }

  return null;
}

export async function resolveGitHubToken(context: RuntimeContext): Promise<string | null> {
  return resolveSecret(context.root, "GITHUB_TOKEN", "GH_TOKEN");
}
