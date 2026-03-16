import type { InstallKind, InstallSource, SourceType } from "./source-family";
import type { SourceFamily } from "./source-family";
import type { FundingInfo } from "./funding";

export type { InstallKind, InstallSource, SourceType } from "./source-family";
export type Portability = "portable" | "host-integrated" | "unverified";
export type RuntimeKind = "standalone" | "bun-native" | "runtime-dependent" | "unverified";
export type Arch = "64bit" | "32bit" | "arm64";
export type AppSourceType = Exclude<SourceType, "skill-github">;
export type InstallKindBySourceType<TSourceType extends SourceType> = Extract<SourceFamily, { sourceType: TSourceType }>["installKind"];
export type SourceTypeByCliSource<TInstallSource extends InstallSource> = Extract<SourceFamily, { cliSource: TInstallSource }>["sourceType"];
export type SourceRefByType = {
  scoop: `scoop:${string}`;
  npm: `npm:${string}`;
  "github-release": `ghr:${string}`;
  "npm-github": `npmgh:${string}`;
  "skill-github": `skill:${string}`;
};
export type SourceRef<TSourceType extends SourceType = SourceType> = SourceRefByType[TSourceType];
export type TransactionOperation = "install" | "update" | "remove";
export type TransactionPhase =
  | "started"
  | "downloading"
  | "extracting"
  | "staging-ready"
  | "committing"
  | "persisting"
  | "shimming"
  | "completed"
  | "failed";

export interface FlgetConfig {
  version: 1;
  arch: Arch | null;
  logLevel: "debug" | "info" | "warn" | "error";
  sources: SourceEnablementConfig;
  buckets: BucketConfig[];
  roots: RootConfig[];
  compatibilityRegistries: {
    official: string[];
    community: string[];
  };
  useLocalOverrides: boolean;
}

export interface SourceEnablementConfig {
  scoop: boolean;
  npm: boolean;
  ghr: boolean;
  npmgh: boolean;
  skill: boolean;
}

export interface BucketConfig {
  name: string;
  url: string;
}

export interface RootConfig {
  path: string;
}

export interface FlgetDirs {
  root: string;
  scoop: string;
  npm: string;
  ghr: string;
  npmgh: string;
  agents: string;
  skills: string;
  buckets: string;
  shims: string;
  temp: string;
  downloads: string;
  transactions: string;
  registriesMeta: string;
  localRegistries: string;
  officialRegistries: string;
  communityRegistries: string;
  bunExe: string;
  cliJs: string;
  cliMap: string;
  activatePs1: string;
  updatePs1: string;
  registerPathPs1: string;
  configFile: string;
  envFile: string;
  secretsDir: string;
  secretsFile: string;
}

interface PackageMetaBase<TSourceType extends SourceType = SourceType> {
  id: string;
  displayName: string;
  sourceType: TSourceType;
  sourceRef: SourceRef<TSourceType>;
  resolvedVersion: string;
  resolvedRef: string;
  portability: Portability;
  runtime: RuntimeKind;
  bin: ShimDef[];
  interactiveEntries?: ShimDef[];
  daemonEntries?: DaemonEntry[];
  persist: PersistDef[];
  envAddPath?: string[];
  envSet?: Record<string, string>;
  warnings: string[];
  notes?: string | null;
}

export interface AppPackageMeta<TSourceType extends AppSourceType = AppSourceType> extends PackageMetaBase<TSourceType> {
  installKind: "app";
  skill?: never;
}

export interface SkillPackageMeta extends PackageMetaBase<"skill-github"> {
  installKind: "skill";
  skill: SkillMeta;
}

export type PackageMeta = AppPackageMeta | SkillPackageMeta;

export interface SkillMeta {
  folderPath: string;
  folderHash: string;
}

export type ShimRunner = "direct" | "cmd" | "powershell" | "java" | "python" | "bun" | "bash";

export interface ShimDef {
  name: string;
  target: string;
  args?: string;
  type: "exe" | "cmd" | "ps1" | "jar" | "py" | "js" | "ts" | "other";
  runner?: ShimRunner;
}

export interface DaemonEntry {
  name: string;
  run: ShimDef;
  stop?: ShimDef;
  status?: ShimDef;
  restartPolicy?: "manual" | "on-failure" | "always";
  dependsOn?: string[];
  autoStart?: boolean;
}

export interface PersistDef {
  source: string;
  target: string;
}

export interface Transaction {
  id: string;
  operation: TransactionOperation;
  phase: TransactionPhase;
  startedAt: string;
  targetVersion?: string;
  stagingPath?: string;
  previousVersion?: string;
  previousVersionPath?: string;
  lastError?: string;
  failedAt?: string;
}

export interface RuntimeContext {
  root: string;
  dirs: FlgetDirs;
  config: FlgetConfig;
  logger: Logger;
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface InstallOptions {
  arch?: Arch;
  noHash?: boolean;
  noScripts?: boolean;
  force?: boolean;
  source?: InstallSource;
}

export interface ResolvedSourceExtra {
  installPath?: string;
}

export interface ResolvedSource<
  TSourceType extends SourceType = SourceType,
  TExtra extends object = object,
> {
  id: string;
  displayName: string;
  sourceType: TSourceType;
  sourceRef: SourceRef<TSourceType>;
  resolvedVersion: string;
  resolvedRef: string;
  installKind: InstallKindBySourceType<TSourceType>;
  extra: TExtra & ResolvedSourceExtra;
}

export type AnyResolvedSource = {
  [TSourceType in SourceType]: ResolvedSource<TSourceType, object>;
}[SourceType];

interface PreparedPackageBase {
  displayName?: string;
  portability: Portability;
  runtime: RuntimeKind;
  bin: ShimDef[];
  interactiveEntries?: ShimDef[];
  daemonEntries?: DaemonEntry[];
  persist: PersistDef[];
  envAddPath?: string[];
  envSet?: Record<string, string>;
  warnings: string[];
  notes?: string | null;
}

export interface PreparedAppPackage extends PreparedPackageBase {
  skill?: never;
}

export interface PreparedSkillPackage extends PreparedPackageBase {
  skill: SkillMeta;
}

export type PreparedPackage = PreparedAppPackage | PreparedSkillPackage;

export interface SourceSearchResult {
  identifier: string;
  line: string;
  installable: boolean;
}

export interface SourceResolver<
  TSourceType extends SourceType = SourceType,
  TExtra extends object = object,
> {
  family: Extract<SourceFamily, { sourceType: TSourceType }>;
  canHandle(identifier: string): boolean;
  resolve(context: RuntimeContext, identifier: string, options: InstallOptions): Promise<ResolvedSource<TSourceType, TExtra>>;
  prepare(
    context: RuntimeContext,
    resolved: ResolvedSource<TSourceType, TExtra>,
    stagingDir: string,
    options: InstallOptions,
    reportPhase: (phase: TransactionPhase) => Promise<void>,
  ): Promise<PreparedPackage>;
  search?(context: RuntimeContext, query: string): Promise<SourceSearchResult[]>;
  findExact?(context: RuntimeContext, query: string): Promise<SourceSearchResult[]>;
  resolveFunding?(
    context: RuntimeContext,
    meta: AppPackageMeta,
    cache: Map<string, Promise<FundingInfo>>,
  ): Promise<FundingInfo | null>;
}

export type AnySourceResolver = {
  [TSourceType in SourceType]: SourceResolver<TSourceType, object>;
}[SourceType];

export interface RegistryOverride {
  assetPattern?: string;
  extractDir?: string;
  bin?: Partial<ShimDef>[];
  interactiveEntries?: Partial<ShimDef>[];
  daemonEntries?: Array<{
    name?: string;
    run?: Partial<ShimDef>;
    stop?: Partial<ShimDef>;
    status?: Partial<ShimDef>;
    restartPolicy?: DaemonEntry["restartPolicy"];
    dependsOn?: string[];
    autoStart?: boolean;
  }>;
  persist?: Array<string | [string, string]>;
  portability?: Portability;
  runtime?: RuntimeKind;
  notes?: string | string[];
  warnings?: string | string[];
}
