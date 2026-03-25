import type { FlgetConfig } from "./types";
import { DEFAULT_SOURCE_ENABLEMENT, normalizeSourceEnablement } from "./source-enablement";
import { getDirs } from "./dirs";
import { pathExists, writeText } from "../utils/fs";
import { parseToml, readRuntimeText } from "../utils/runtime";

export function getDefaultConfig(): FlgetConfig {
  return {
    version: 1,
    arch: null,
    logLevel: "info",
    sources: { ...DEFAULT_SOURCE_ENABLEMENT },
    buckets: [
      {
        name: "main",
        url: "https://github.com/ScoopInstaller/Main",
      },
    ],
    depots: [],
    compatRegistries: {
      official: [
        "https://github.com/flatina/flget-compat",
      ],
      community: [],
    },
    useLocalOverrides: true,
  };
}

function formatString(value: string): string {
  return JSON.stringify(value);
}

function formatStringArray(key: string, values: string[]): string {
  return `${key} = [${values.map((value) => formatString(value)).join(", ")}]`;
}

function formatRootConfigToml(config: FlgetConfig): string {
  const lines: string[] = [
    `version = ${config.version}`,
    `arch = ${config.arch === null ? "''" : formatString(config.arch)}`,
    `logLevel = ${formatString(config.logLevel)}`,
    `useLocalOverrides = ${config.useLocalOverrides ? "true" : "false"}`,
    "",
    "[sources]",
    `scoop = ${config.sources.scoop ? "true" : "false"}`,
    `npm = ${config.sources.npm ? "true" : "false"}`,
    `ghr = ${config.sources.ghr ? "true" : "false"}`,
    `npmgh = ${config.sources.npmgh ? "true" : "false"}`,
    `skill = ${config.sources.skill ? "true" : "false"}`,
    `depot = ${config.sources.depot ? "true" : "false"}`,
    "",
    "[compatRegistries]",
    formatStringArray("official", config.compatRegistries.official),
    formatStringArray("community", config.compatRegistries.community),
  ];

  for (const bucket of config.buckets) {
    lines.push("", "[[buckets]]");
    lines.push(`name = ${formatString(bucket.name)}`);
    lines.push(`url = ${formatString(bucket.url)}`);
  }

  for (const depot of config.depots) {
    lines.push("", "[[depots]]");
    lines.push(`uri = ${formatString(depot.uri)}`);
  }

  return `${lines.join("\n")}\n`;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value === "" ? null : value;
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseTomlConfig(content: string): FlgetConfig {
  const parsed = parseToml(content) as Record<string, unknown>;
  const sources = parsed.sources;
  const compatRegistries = (
    parsed.compatRegistries as Record<string, unknown> | undefined
  ) ?? (
    parsed.compatibilityRegistries as Record<string, unknown> | undefined
  );

  return {
    version: Number(parsed.version) === 1 ? 1 : 1,
    arch: (normalizeNullableString(parsed.arch) as FlgetConfig["arch"]),
    logLevel: parsed.logLevel === "debug" || parsed.logLevel === "warn" || parsed.logLevel === "error" ? parsed.logLevel : "info",
    sources: normalizeSourceEnablement(sources),
    buckets: Array.isArray(parsed.buckets)
      ? parsed.buckets.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const bucket = entry as Record<string, unknown>;
        if (typeof bucket.name !== "string" || typeof bucket.url !== "string") {
          return [];
        }
        return [{ name: bucket.name, url: bucket.url }];
      })
      : [],
    depots: Array.isArray(parsed.depots)
      ? parsed.depots.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const depot = entry as Record<string, unknown>;
        if (typeof depot.uri !== "string") {
          return [];
        }
        return [{ uri: depot.uri }];
      })
      : Array.isArray(parsed.roots)
        ? parsed.roots.flatMap((entry) => {
          if (!entry || typeof entry !== "object") {
            return [];
          }
          const root = entry as Record<string, unknown>;
          if (typeof root.path !== "string") {
            return [];
          }
          return [{ uri: root.path }];
        })
        : [],
    compatRegistries: {
      official: ensureStringArray(compatRegistries?.official),
      community: ensureStringArray(compatRegistries?.community),
    },
    useLocalOverrides: parsed.useLocalOverrides !== false,
  };
}

export async function readConfig(root: string): Promise<FlgetConfig> {
  const dirs = getDirs(root);
  if (await pathExists(dirs.configFile)) {
    return parseTomlConfig(await readRuntimeText(dirs.configFile));
  }
  return getDefaultConfig();
}

export async function writeConfig(root: string, config: FlgetConfig): Promise<void> {
  const dirs = getDirs(root);
  await writeText(dirs.configFile, formatRootConfigToml(config));
}
