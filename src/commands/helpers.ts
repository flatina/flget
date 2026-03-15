import { join } from "node:path";
import type {
  AppSourceType,
  AnyResolvedSource,
  PackageMeta,
  PreparedPackage,
  ResolvedSource,
  RuntimeContext,
} from "../core/types";
import { getPackageBaseRelativePath } from "../core/package-layout";

export function getPackageBaseDir(
  context: RuntimeContext,
  id: string,
  sourceType: ResolvedSource["sourceType"] | PackageMeta["sourceType"],
): string {
  return join(context.root, getPackageBaseRelativePath(sourceType, id));
}

export function getCurrentPath(
  context: RuntimeContext,
  id: string,
  sourceType: ResolvedSource["sourceType"] | PackageMeta["sourceType"],
): string {
  return join(getPackageBaseDir(context, id, sourceType), "current");
}

export function buildPackageMeta(
  resolved: AnyResolvedSource,
  prepared: PreparedPackage,
): PackageMeta {
  if (resolved.installKind === "skill") {
    if (!prepared.skill) {
      throw new Error(`Prepared skill package is missing skill metadata for ${resolved.id}`);
    }
    const skillResolved = resolved as ResolvedSource<"skill-github">;
    return {
      id: skillResolved.id,
      displayName: prepared.displayName ?? skillResolved.displayName,
      sourceType: skillResolved.sourceType,
      sourceRef: skillResolved.sourceRef,
      resolvedVersion: skillResolved.resolvedVersion,
      resolvedRef: skillResolved.resolvedRef,
      installKind: skillResolved.installKind,
      portability: prepared.portability,
      runtime: prepared.runtime,
      bin: prepared.bin,
      interactiveEntries: prepared.interactiveEntries,
      daemonEntries: prepared.daemonEntries,
      persist: prepared.persist,
      envAddPath: prepared.envAddPath,
      envSet: prepared.envSet,
      warnings: prepared.warnings,
      notes: prepared.notes ?? null,
      skill: prepared.skill,
    };
  }

  const appResolved = resolved as ResolvedSource<AppSourceType>;
  return {
    id: appResolved.id,
    displayName: prepared.displayName ?? appResolved.displayName,
    sourceType: appResolved.sourceType,
    sourceRef: appResolved.sourceRef,
    resolvedVersion: appResolved.resolvedVersion,
    resolvedRef: appResolved.resolvedRef,
    installKind: appResolved.installKind,
    portability: prepared.portability,
    runtime: prepared.runtime,
    bin: prepared.bin,
    interactiveEntries: prepared.interactiveEntries,
    daemonEntries: prepared.daemonEntries,
    persist: prepared.persist,
    envAddPath: prepared.envAddPath,
    envSet: prepared.envSet,
    warnings: prepared.warnings,
    notes: prepared.notes ?? null,
  };
}
