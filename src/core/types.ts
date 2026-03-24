import type { InstallSource, SourceDirsKey, SourceType } from "./source-family";
import type { SourceFamily } from "./source-family";
import type { FundingInfo } from "./funding";

export type { InstallKind, InstallSource, SourceDirsKey, SourceType } from "./source-family";
export type Portability = "portable" | "host-integrated" | "unverified";
export type RuntimeKind = "standalone" | "bun-native" | "runtime-dependent" | "unverified";
export type Arch = "64bit" | "32bit" | "arm64";
export type PersistType = "none" | "xdg" | "xdg-full" | "folder-migrate";
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
  compatRegistries: {
    official: string[];
    community: string[];
  };
  useLocalOverrides: boolean;
}

export type SourceEnablementConfig = Record<InstallSource, boolean>;

export interface BucketConfig {
  name: string;
  url: string;
}

export interface RootConfig {
  path: string;
}

export interface FlgetDirs extends Record<SourceDirsKey, string> {
  root: string;
  agents: string;
  buckets: string;
  shims: string;
  staging: string;
  downloads: string;
  transactions: string;
  compat: string;
  compatLocal: string;
  compatOfficial: string;
  compatCommunity: string;
  bunExe: string;
  cliJs: string;
  cliMap: string;
  activatePs1: string;
  updatePs1: string;
  configFile: string;
  xdgConfig: string;
  xdgData: string;
  xdgState: string;
  xdgCache: string;
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
  uiEntries?: ShimDef[];
  daemonEntries?: DaemonEntry[];
  persistType?: PersistType;
  persist: PersistDef[];
  envAddPath?: string[];
  envSet?: Record<string, string>;
  warnings: string[];
  notes?: string | null;
  tags?: string[];
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
  tags?: string[];
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
  uiEntries?: ShimDef[];
  daemonEntries?: DaemonEntry[];
  persistType?: PersistType;
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
  persistType?: PersistType;
  assetPattern?: string;
  extractDir?: string;
  bin?: Partial<ShimDef>[];
  ui?: Partial<ShimDef>[];
  daemon?: Array<{
    name?: string;
    run?: Partial<ShimDef>;
    stop?: Partial<ShimDef>;
    status?: Partial<ShimDef>;
    restartPolicy?: DaemonEntry["restartPolicy"];
    dependsOn?: string[];
    autoStart?: boolean;
  }>;
  persist?: Array<{
    source?: string;
    target?: string;
  }>;
  env?: Record<string, string>;
  portability?: Portability;
  runtime?: RuntimeKind;
  notes?: string;
  warnings?: string[];
}
