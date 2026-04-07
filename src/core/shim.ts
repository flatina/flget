import { join } from "node:path";
import type { PackageMeta, ShimDef, ShimRunner } from "./types";
import { getPackageBaseRelativePath } from "./package-layout";
import { listPackageMetas, listWinnerPackageMetas } from "./metadata";
import { ensureDir, pathExists, removePath, writeText } from "../utils/fs";
import { inferShimRunner } from "../utils/strings";

function renderCmdWrapper(command: string): string {
  return `@echo off
setlocal
set "SHIMDIR=%~dp0"
${command}
`;
}

function renderPowerShellWrapper(command: string, setup?: string): string {
  return `${setup ? `${setup}\n` : ""}${command}
exit $LASTEXITCODE
`;
}

function renderCmdWithResolvedBun(buildInvocation: (bun: string) => string): string {
  return renderCmdWrapper(`set "BUN=%SHIMDIR%\\..\\bun.exe"
if not exist "%BUN%" set "BUN=%SHIMDIR%\\..\\..\\bun.exe"
if exist "%BUN%" goto run
where bun >nul 2>nul
if errorlevel 1 (
  echo bun.exe not found in the flget root, its parent directory, or PATH. 1>&2
  exit /b 1
)
set "BUN=bun"
:run
if "%BUN%"=="bun" (
  ${buildInvocation("bun")}
) else (
  ${buildInvocation('"%BUN%"')}
)`);
}

function renderPowerShellWithResolvedBun(buildInvocation: (bun: string) => string, setup?: string): string {
  return renderPowerShellWrapper(
    buildInvocation("$bun"),
    `${setup ? `${setup}\n` : ""}$rootBun = Join-Path $PSScriptRoot "..\\bun.exe"
$parentBun = Join-Path $PSScriptRoot "..\\..\\bun.exe"
if (Test-Path $rootBun) {
  $bun = [System.IO.Path]::GetFullPath($rootBun)
} elseif (Test-Path $parentBun) {
  $bun = [System.IO.Path]::GetFullPath($parentBun)
} else {
  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bunCommand) {
    Write-Error "bun.exe not found in the flget root, its parent directory, or PATH."
    exit 1
  }
  $bun = $bunCommand.Source
}`,
  );
}

function renderRootCmdFlgetShim(): string {
  return renderCmdWithResolvedBun((bun) => `${bun} "%SHIMDIR%\\..\\flget.js" %*`);
}

function renderRootPowerShellFlgetShim(): string {
  return renderPowerShellWithResolvedBun((bun) => `& ${bun} "$PSScriptRoot\\..\\flget.js" @args`);
}

function renderRootCmdBunShim(): string {
  return renderCmdWithResolvedBun((bun) => `${bun} %*`);
}

function renderRootPowerShellBunShim(): string {
  return renderPowerShellWithResolvedBun((bun) => `& ${bun} @args`);
}

function renderCmdBunRunner(target: string, args: string): string {
  return renderCmdWithResolvedBun((bun) => `${bun} run "${target}"${args} %*`);
}

function renderPowerShellBunRunner(target: string, args: string): string {
  return renderPowerShellWithResolvedBun(
    (bun) => `& ${bun} run $target${args} @args`,
    `$target = "${target}"`,
  );
}

const TYPE_TO_RUNNER: Record<ShimDef["type"], ShimRunner> = {
  exe: "direct",
  cmd: "cmd",
  ps1: "powershell",
  jar: "java",
  py: "python",
  js: "bun",
  ts: "bun",
  other: "direct",
};

function resolveShimRunner(shim: ShimDef): ShimRunner {
  return shim.runner ?? inferShimRunner(shim.target) ?? TYPE_TO_RUNNER[shim.type];
}

function getCmdShimTarget(id: string, sourceType: PackageMeta["sourceType"], shim: ShimDef): string {
  const baseDir = getPackageBaseRelativePath(sourceType, id);
  return `%SHIMDIR%\\..\\${baseDir}\\current\\${shim.target.replace(/\//g, "\\")}`;
}

function getPowerShellShimTarget(id: string, sourceType: PackageMeta["sourceType"], shim: ShimDef): string {
  const baseDir = getPackageBaseRelativePath(sourceType, id);
  return `$PSScriptRoot\\..\\${baseDir}\\current\\${shim.target.replace(/\//g, "\\")}`;
}

function renderCmdShim(id: string, sourceType: PackageMeta["sourceType"], shim: ShimDef): string {
  const target = getCmdShimTarget(id, sourceType, shim);
  const args = shim.args ? ` ${shim.args}` : "";
  const runner = resolveShimRunner(shim);

  switch (runner) {
    case "cmd":
      return renderCmdWrapper(`call "${target}"${args} %*`);
    case "powershell":
      return renderCmdWrapper(`powershell -NoProfile -ExecutionPolicy Bypass -File "${target}"${args} %*`);
    case "java":
      return renderCmdWrapper(`java -jar "${target}"${args} %*`);
    case "python":
      return renderCmdWrapper(`python "${target}"${args} %*`);
    case "bun":
      return renderCmdBunRunner(target, args);
    case "bash":
      return renderCmdWrapper(`bash "${target}"${args} %*`);
    case "direct":
    default:
      return renderCmdWrapper(`"${target}"${args} %*`);
  }
}

function renderPowerShellShim(id: string, sourceType: PackageMeta["sourceType"], shim: ShimDef): string {
  const target = getPowerShellShimTarget(id, sourceType, shim);
  const args = shim.args ? ` ${shim.args}` : "";
  const runner = resolveShimRunner(shim);

  switch (runner) {
    case "cmd":
      return renderPowerShellWrapper(`& $target${args} @args`, `$target = "${target}"`);
    case "powershell":
      return renderPowerShellWrapper(`& powershell -NoProfile -ExecutionPolicy Bypass -File $target${args} @args`, `$target = "${target}"`);
    case "java":
      return renderPowerShellWrapper(`& java -jar $target${args} @args`, `$target = "${target}"`);
    case "python":
      return renderPowerShellWrapper(`& python $target${args} @args`, `$target = "${target}"`);
    case "bun":
      return renderPowerShellBunRunner(target, args);
    case "bash":
      return renderPowerShellWrapper(`& bash $target${args} @args`, `$target = "${target}"`);
    case "direct":
    default:
      return renderPowerShellWrapper(`& $target${args} @args`, `$target = "${target}"`);
  }
}

export async function createShims(root: string, sourceType: PackageMeta["sourceType"], id: string, shims: ShimDef[]): Promise<void> {
  const dir = join(root, "shims");
  await ensureDir(dir);
  for (const shim of shims) {
    await writeText(join(dir, `${shim.name}.cmd`), renderCmdShim(id, sourceType, shim));
    await writeText(join(dir, `${shim.name}.ps1`), renderPowerShellShim(id, sourceType, shim));
  }
}

export async function deleteShims(root: string, shims: ShimDef[]): Promise<void> {
  const dir = join(root, "shims");
  for (const shim of shims) {
    await removePath(join(dir, `${shim.name}.cmd`));
    await removePath(join(dir, `${shim.name}.ps1`));
  }
}

export async function refreshPackageShims(root: string, previous: PackageMeta | null, next: PackageMeta): Promise<void> {
  if (previous) {
    await deleteShims(root, previous.bin);
  }
  await createShims(root, next.sourceType, next.id, next.bin);
}

export async function regenerateRootShims(root: string): Promise<void> {
  const installed = await listPackageMetas(root);
  const winners = await listWinnerPackageMetas(root);

  for (const meta of installed) {
    await deleteShims(root, meta.bin);
  }
  for (const meta of winners) {
    await createShims(root, meta.sourceType, meta.id, meta.bin);
  }
}

export async function ensureStaticRootShims(root: string): Promise<void> {
  const dir = join(root, "shims");
  await ensureDir(dir);
  await writeText(join(dir, "flget.cmd"), renderRootCmdFlgetShim());
  await writeText(join(dir, "flget.ps1"), renderRootPowerShellFlgetShim());
  if (await pathExists(join(root, "bun.exe"))) {
    await writeText(join(dir, "bun.cmd"), renderRootCmdBunShim());
    await writeText(join(dir, "bun.ps1"), renderRootPowerShellBunShim());
  } else {
    await removePath(join(dir, "bun.cmd"));
    await removePath(join(dir, "bun.ps1"));
  }
}
