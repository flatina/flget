import { join } from "node:path";
import { parseYaml, readRuntimeText } from "../utils/runtime";
import { pathExists } from "../utils/fs";

export interface FundingLink {
  platform: string;
  url: string;
}

export interface FundingInfo {
  links: FundingLink[];
  message: string | null;
}

type GitHubRef = {
  owner: string;
  repo: string;
};

const SPONSOR_HOSTS: Array<{ hosts: string[]; platform: string }> = [
  { hosts: ["ko-fi.com", "www.ko-fi.com"], platform: "ko-fi" },
  { hosts: ["buymeacoffee.com", "www.buymeacoffee.com"], platform: "buy-me-a-coffee" },
  { hosts: ["patreon.com", "www.patreon.com"], platform: "patreon" },
  { hosts: ["opencollective.com", "www.opencollective.com"], platform: "open-collective" },
  { hosts: ["liberapay.com", "www.liberapay.com"], platform: "liberapay" },
  { hosts: ["thanks.dev", "www.thanks.dev"], platform: "thanks.dev" },
  { hosts: ["polar.sh", "www.polar.sh"], platform: "polar" },
];

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeMessage(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const line = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line && line.length > 0 ? line : null;
}

function addLink(results: FundingLink[], platform: string, url: string): void {
  results.push({ platform, url });
}

function normalizeFundingPlatform(type: unknown, fallback: string): string {
  if (typeof type !== "string") {
    return fallback;
  }
  const normalized = type.trim().toLowerCase().replace(/\s+/g, "-");
  return normalized || fallback;
}

export function dedupeFundingLinks(links: FundingLink[]): FundingLink[] {
  const seen = new Set<string>();
  const results: FundingLink[] = [];

  for (const link of links) {
    const key = `${link.platform}\u0000${link.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(link);
  }

  return results;
}

export function detectKnownSponsorLink(value: string): FundingLink | null {
  const normalized = normalizeUrl(value);
  if (!normalized) {
    return null;
  }

  const url = new URL(normalized);
  const host = url.hostname.toLowerCase();
  if (host === "github.com" || host === "www.github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "sponsors" && parts[1]) {
      return {
        platform: "github",
        url: `https://github.com/sponsors/${parts[1]}`,
      };
    }
    return null;
  }

  const match = SPONSOR_HOSTS.find((entry) => entry.hosts.includes(host));
  if (!match) {
    return null;
  }

  return {
    platform: match.platform,
    url: normalized,
  };
}

export function extractGitHubRepoRef(value: string): GitHubRef | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const githubShortcut = trimmed.match(/^github:([^/]+)\/([^/#]+)$/i);
  if (githubShortcut) {
    return {
      owner: githubShortcut[1]!,
      repo: githubShortcut[2]!.replace(/\.git$/i, ""),
    };
  }

  const sshShortcut = trimmed.match(/^git@github\.com:([^/]+)\/([^/#]+?)(?:\.git)?$/i);
  if (sshShortcut) {
    return {
      owner: sshShortcut[1]!,
      repo: sshShortcut[2]!,
    };
  }

  try {
    const normalized = trimmed.replace(/^git\+/, "");
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return null;
    }
    return {
      owner: parts[0]!,
      repo: parts[1]!.replace(/\.git$/i, ""),
    };
  } catch {
    return null;
  }
}

export function parsePackageFunding(input: unknown): FundingLink[] {
  const results: FundingLink[] = [];

  function visit(value: unknown): void {
    if (!value) {
      return;
    }

    if (typeof value === "string") {
      const normalized = normalizeUrl(value);
      if (!normalized) {
        return;
      }
      const sponsor = detectKnownSponsorLink(normalized);
      if (sponsor) {
        results.push(sponsor);
      } else {
        addLink(results, "funding", normalized);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }
      return;
    }

    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.url === "string") {
        const normalized = normalizeUrl(record.url);
        if (!normalized) {
          return;
        }
        const sponsor = detectKnownSponsorLink(normalized);
        if (sponsor) {
          results.push(sponsor);
        } else {
          addLink(results, normalizeFundingPlatform(record.type, "funding"), normalized);
        }
      }
    }
  }

  visit(input);
  return dedupeFundingLinks(results);
}

export function parseGitHubFundingYaml(content: string): FundingLink[] {
  const parsed = parseYaml(content);
  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const data = parsed as Record<string, unknown>;
  const results: FundingLink[] = [];

  function visitHandles(
    key: string,
    platform: string,
    toUrl: (value: string) => string,
  ): void {
    const raw = data[key];
    const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    for (const value of values) {
      if (typeof value !== "string" || !value.trim()) {
        continue;
      }
      addLink(results, platform, toUrl(value.trim()));
    }
  }

  visitHandles("github", "github", (value) => `https://github.com/sponsors/${value}`);
  visitHandles("patreon", "patreon", (value) => `https://patreon.com/${value}`);
  visitHandles("open_collective", "open-collective", (value) => `https://opencollective.com/${value}`);
  visitHandles("ko_fi", "ko-fi", (value) => `https://ko-fi.com/${value}`);
  visitHandles("liberapay", "liberapay", (value) => `https://liberapay.com/${value}`);
  visitHandles("buy_me_a_coffee", "buy-me-a-coffee", (value) => `https://buymeacoffee.com/${value}`);
  visitHandles("polar", "polar", (value) => `https://polar.sh/${value}`);
  visitHandles("thanks_dev", "thanks.dev", (value) => `https://thanks.dev/${value}`);

  const custom = data.custom;
  const customValues = Array.isArray(custom) ? custom : custom === undefined ? [] : [custom];
  for (const value of customValues) {
    if (typeof value !== "string") {
      continue;
    }
    const sponsor = detectKnownSponsorLink(value);
    if (sponsor) {
      results.push(sponsor);
      continue;
    }
    const normalized = normalizeUrl(value);
    if (normalized) {
      addLink(results, "custom", normalized);
    }
  }

  return dedupeFundingLinks(results);
}

export async function readFundingFileLinks(root: string): Promise<FundingLink[]> {
  for (const relativePath of [join(".github", "FUNDING.yml"), join(".github", "FUNDING.yaml")]) {
    const path = join(root, relativePath);
    if (!await pathExists(path)) {
      continue;
    }
    return parseGitHubFundingYaml(await readRuntimeText(path));
  }
  return [];
}

export function fundingInfo(links: FundingLink[], message?: unknown): FundingInfo {
  return {
    links: dedupeFundingLinks(links),
    message: normalizeMessage(message),
  };
}
