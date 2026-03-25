import { assertSourceEnabled, isSourceEnabled } from "../core/source-enablement";
import { SOURCE_FAMILIES } from "../core/source-family";
import type { AnySourceResolver, InstallSource, RuntimeContext } from "../core/types";
import { listResolvers } from "../sources";

export type SearchScope = InstallSource | null;

export interface SearchMatch {
  source: Exclude<SearchScope, null>;
  identifier: string;
  line: string;
  installable: boolean;
}

function normalizeQuery(query: string): string {
  return query === "*" ? "" : query.trim().toLowerCase();
}

export function parseSearchQuery(queryInput: string): { scope: SearchScope; query: string } {
  const trimmed = queryInput.trim();
  const prefixes: Array<Exclude<SearchScope, null>> = [
    ...SOURCE_FAMILIES.map((family) => family.cliSource),
  ];
  for (const prefix of prefixes) {
    if (trimmed.toLowerCase().startsWith(`${prefix}:`)) {
      return {
        scope: prefix,
        query: normalizeQuery(trimmed.slice(prefix.length + 1)),
      };
    }
  }
  return {
    scope: null,
    query: normalizeQuery(trimmed),
  };
}

export function applySearchSource(queryInput: string, source?: InstallSource): string {
  const trimmed = queryInput.trim();
  if (!source) {
    return trimmed;
  }

  const parsed = parseSearchQuery(trimmed);
  if (parsed.scope === null) {
    return `${source}:${trimmed}`;
  }

  if (parsed.scope !== source) {
    throw new Error("Use either a source-prefixed query or --source, not both.");
  }

  return trimmed;
}

function dedupeMatches(matches: SearchMatch[]): SearchMatch[] {
  const seen = new Set<string>();
  const deduped: SearchMatch[] = [];
  for (const match of matches) {
    const key = `${match.source}:${match.identifier}:${match.line}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(match);
  }
  return deduped;
}

function mapSourceMatches(resolver: AnySourceResolver, matches: { identifier: string; line: string; installable: boolean }[]): SearchMatch[] {
  return matches.map((match) => ({
    ...match,
    source: resolver.family.cliSource,
  }));
}

function shouldIncludeResolver(
  resolver: AnySourceResolver,
  scope: SearchScope,
  options?: { includeSkills?: boolean },
): boolean {
  if (scope !== null) {
    return resolver.family.cliSource === scope;
  }
  if (resolver.family.cliSource === "skill") {
    return options?.includeSkills === true;
  }
  return true;
}

async function collectSourceMatches(
  context: RuntimeContext,
  scope: SearchScope,
  query: string,
  options: { includeSkills?: boolean },
  mode: "search" | "exact",
): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];

  for (const resolver of listResolvers()) {
    if (!shouldIncludeResolver(resolver, scope, options)) {
      continue;
    }

    const source = resolver.family.cliSource;
    if (scope === null && !isSourceEnabled(context.config, source)) {
      continue;
    }

    const capability = mode === "exact" ? resolver.findExact : resolver.search;
    if (!capability) {
      continue;
    }

    matches.push(...mapSourceMatches(resolver, await capability(context, query)));
  }

  return matches;
}

export async function findSearchMatches(
  context: RuntimeContext,
  queryInput: string,
  options?: { includeSkills?: boolean },
): Promise<SearchMatch[]> {
  const { scope, query } = parseSearchQuery(queryInput);
  if (queryInput.includes(":") && query === "") {
    throw new Error("Usage: flget search <query>");
  }
  if (scope) {
    assertSourceEnabled(context.config, scope);
  }

  const matches = await collectSourceMatches(context, scope, query, options ?? {}, "search");
  return dedupeMatches(matches);
}

export async function findExactInstallMatches(
  context: RuntimeContext,
  queryInput: string,
  options?: { includeSkills?: boolean },
): Promise<SearchMatch[]> {
  const { scope, query } = parseSearchQuery(queryInput);
  if (queryInput.includes(":") && query === "") {
    throw new Error("Usage: flget search <query>");
  }
  if (scope) {
    assertSourceEnabled(context.config, scope);
  }

  return dedupeMatches(await collectSourceMatches(context, scope, query, options ?? {}, "exact"));
}

export async function runSearchCommand(context: RuntimeContext, queryInput: string, source?: InstallSource): Promise<void> {
  if (!queryInput) {
    throw new Error("Usage: flget search <query>");
  }

  const results = await findSearchMatches(context, applySearchSource(queryInput, source));
  if (results.length === 0) {
    console.log("No matches found.");
    return;
  }

  for (const result of results) {
    console.log(result.line);
  }
}
