import { getSourceFamilyByType, parseInstallSourcePrefix } from "./source-family";
import type { FlgetConfig, InstallSource, SourceType, SourceEnablementConfig } from "./types";

export const DEFAULT_SOURCE_ENABLEMENT: SourceEnablementConfig = {
  scoop: true,
  npm: true,
  ghr: true,
  npmgh: true,
  skill: true,
};

export function normalizeSourceEnablement(value: unknown): SourceEnablementConfig {
  const parsed = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    scoop: parsed.scoop !== false,
    npm: parsed.npm !== false,
    ghr: parsed.ghr !== false,
    npmgh: parsed.npmgh !== false,
    skill: parsed.skill !== false,
  };
}

export function isSourceEnabled(config: FlgetConfig, source: InstallSource): boolean {
  return config.sources[source] !== false;
}

export function isSourceTypeEnabled(config: FlgetConfig, sourceType: SourceType): boolean {
  return isSourceEnabled(config, getSourceFamilyByType(sourceType).cliSource);
}

export function assertSourceEnabled(config: FlgetConfig, source: InstallSource): void {
  if (!isSourceEnabled(config, source)) {
    throw new Error(`Source disabled by config: ${source}`);
  }
}

export function assertIdentifierSourceEnabled(config: FlgetConfig, identifier: string): void {
  const source = parseInstallSourcePrefix(identifier);
  if (!source) {
    return;
  }
  assertSourceEnabled(config, source);
}
