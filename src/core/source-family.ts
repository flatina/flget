type SourceFamilySpec = {
  sourceType: string;
  cliSource: string;
  installKind: "app" | "skill";
  rootDirSegments: readonly string[];
  dirsKey: string;
};

export const SOURCE_FAMILIES = [
  {
    sourceType: "scoop",
    cliSource: "scoop",
    installKind: "app",
    rootDirSegments: ["scoop"],
    dirsKey: "scoop",
  },
  {
    sourceType: "npm",
    cliSource: "npm",
    installKind: "app",
    rootDirSegments: ["npm"],
    dirsKey: "npm",
  },
  {
    sourceType: "github-release",
    cliSource: "ghr",
    installKind: "app",
    rootDirSegments: ["ghr"],
    dirsKey: "ghr",
  },
  {
    sourceType: "npm-github",
    cliSource: "npmgh",
    installKind: "app",
    rootDirSegments: ["npmgh"],
    dirsKey: "npmgh",
  },
  {
    sourceType: "skill-github",
    cliSource: "skill",
    installKind: "skill",
    rootDirSegments: ["agents", "skills"],
    dirsKey: "skills",
  },
] as const satisfies readonly SourceFamilySpec[];

export type SourceFamily = typeof SOURCE_FAMILIES[number];
export type SourceType = SourceFamily["sourceType"];
export type InstallKind = SourceFamily["installKind"];
export type InstallSource = SourceFamily["cliSource"];
export type SourceDirsKey = SourceFamily["dirsKey"];

export function getSourceFamilyByType<T extends SourceType>(sourceType: T): Extract<SourceFamily, { sourceType: T }> {
  const family = SOURCE_FAMILIES.find((entry) => entry.sourceType === sourceType);
  if (!family) {
    throw new Error(`Unsupported source type: ${sourceType}`);
  }
  return family as Extract<SourceFamily, { sourceType: T }>;
}

export function getSourceFamilyByCliSource<T extends InstallSource>(cliSource: T): Extract<SourceFamily, { cliSource: T }> {
  const family = SOURCE_FAMILIES.find((entry) => entry.cliSource === cliSource);
  if (!family) {
    throw new Error(`Unsupported source family: ${cliSource}`);
  }
  return family as Extract<SourceFamily, { cliSource: T }>;
}

export function parseInstallSourcePrefix(value: string): InstallSource | null {
  const lower = value.trim().toLowerCase();
  for (const family of SOURCE_FAMILIES) {
    if (lower.startsWith(`${family.cliSource}:`)) {
      return family.cliSource;
    }
  }
  return null;
}

export function inferPackageLocationFromRelativeParts(parts: string[]): {
  id: string;
  sourceType: SourceType;
  installKind: InstallKind;
} | null {
  for (const family of SOURCE_FAMILIES) {
    const { rootDirSegments } = family;
    if (rootDirSegments.some((segment, index) => parts[index] !== segment)) {
      continue;
    }
    const id = parts[rootDirSegments.length];
    if (!id) {
      continue;
    }
    return {
      id,
      sourceType: family.sourceType,
      installKind: family.installKind,
    };
  }
  return null;
}
