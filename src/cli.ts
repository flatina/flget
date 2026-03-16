import { loadContext } from "./core/context";
import { runBucketCommand } from "./commands/bucket";
import { runEnvCommand } from "./commands/env";
import { runFundCommand } from "./commands/fund";
import { runInfoCommand } from "./commands/info";
import { runInstallCommand } from "./commands/install";
import { runListCommand } from "./commands/list";
import { runRegistryCommand } from "./commands/registry";
import { runResetCommand } from "./commands/reset";
import { runRemoveCommand } from "./commands/remove";
import { runRootCommand } from "./commands/root";
import { runRepairCommand } from "./commands/repair";
import { runSearchCommand } from "./commands/search";
import { runSkillsCommand } from "./commands/skills";
import { runUpdateCommand } from "./commands/update";
import type { Arch, InstallOptions, InstallSource, RuntimeContext } from "./core/types";
import { getBooleanFlag, getStringFlag, parseCliArgs, type ParsedCliArgs } from "./utils/cli";

const VERSION = "0.1.1";

function printHelp(): void {
  console.log(`flget v${VERSION}

Usage:
  flget install <source-or-query> [--source <source>] [--force] [--no-scripts] [--no-hash] [--arch <arch>]
  flget update [<package>] [--all] [--no-self]
  flget reset <package> [--source <source>]
  flget remove <package>
  flget list [--json]
  flget fund [<package>] [--json]
  flget info <package>
  flget search <query> [--source <source>]
  flget skills <find|install|list|info|update|remove> ...
  flget env
  flget repair [package]
  flget root <add|remove|list|first|last> ...
  flget bucket <add|remove|list|update> ...
  flget compat <list|add|remove|update> ...

Aliases:
  i   install
  u   update
  rm  remove
  ls  list
  skills add/install/i/a
  skills find/search/f/s
  skills list/ls
  skills update/upgrade
  skills remove/rm/r

Sources:
  ghr:<owner>/<repo>[@tag]
  scoop:<bucket>/<app>
  npm:<name>[@version]
  npmgh:<owner>/<repo>[@ref]
  skill:<owner>/<repo>[@ref][#subpath]

Global options:
  --help, -h
  --version, -v

Install options:
  --source <scoop|npm|ghr|npmgh|skill>
  --force, -f
  --no-scripts
  --no-hash
  --arch <arch>
  --skill <skill-id>   (repeatable; for flget skills install <owner>/<repo>)
  --list               (for flget skills install <owner>/<repo>)
  --all                (for flget skills install/update)`);
}

type RuntimeContextMode = "existing" | "create" | ((parsed: ParsedCliArgs) => "existing" | "create");

interface CommandSpecBase {
  name: string;
  aliases?: string[];
}

interface NoContextCommandSpec extends CommandSpecBase {
  kind: "none";
  run: (parsed: ParsedCliArgs, installOptions: InstallOptions) => Promise<void>;
}

interface RuntimeCommandSpec extends CommandSpecBase {
  kind: "runtime";
  contextMode: RuntimeContextMode;
  run: (parsed: ParsedCliArgs, installOptions: InstallOptions, context: RuntimeContext) => Promise<void>;
}

type CommandSpec = NoContextCommandSpec | RuntimeCommandSpec;

const ARCH_VALUES = ["64bit", "32bit", "arm64"] as const satisfies readonly Arch[];
const INSTALL_SOURCE_VALUES = ["scoop", "npm", "ghr", "npmgh", "skill"] as const satisfies readonly InstallSource[];

function defineNoContextCommand(spec: Omit<NoContextCommandSpec, "kind">): NoContextCommandSpec {
  return {
    kind: "none",
    ...spec,
  };
}

function defineRuntimeCommand(spec: Omit<RuntimeCommandSpec, "kind">): RuntimeCommandSpec {
  return {
    kind: "runtime",
    ...spec,
  };
}

function isArch(value: string): value is Arch {
  return ARCH_VALUES.includes(value as Arch);
}

function isInstallSource(value: string): value is InstallSource {
  return INSTALL_SOURCE_VALUES.includes(value as InstallSource);
}

function parseArchFlag(parsed: ParsedCliArgs): Arch | undefined {
  const value = getStringFlag(parsed.flags, "arch");
  if (value === undefined) {
    return undefined;
  }
  if (!isArch(value)) {
    throw new Error(`Invalid --arch: ${value}`);
  }
  return value;
}

function parseInstallSourceFlag(parsed: ParsedCliArgs): InstallSource | undefined {
  const value = getStringFlag(parsed.flags, "source");
  if (value === undefined) {
    return undefined;
  }
  if (!isInstallSource(value)) {
    throw new Error(`Invalid --source: ${value}`);
  }
  return value;
}

const COMMANDS: CommandSpec[] = [
  defineRuntimeCommand({
    name: "install",
    aliases: ["i"],
    contextMode: "create",
    async run(parsed, installOptions, context) {
      if (!parsed.positional[0]) {
        throw new Error("Usage: flget install <source>");
      }
      await runInstallCommand(context, parsed.positional[0], installOptions);
    },
  }),
  defineRuntimeCommand({
    name: "bucket",
    contextMode: "create",
    async run(parsed, _installOptions, context) {
      await runBucketCommand(context, parsed.positional);
    },
  }),
  defineRuntimeCommand({
    name: "root",
    contextMode: "create",
    async run(parsed, _installOptions, context) {
      await runRootCommand(context, parsed.positional);
    },
  }),
  defineRuntimeCommand({
    name: "compat",
    contextMode: "create",
    async run(parsed, _installOptions, context) {
      await runRegistryCommand(context, parsed.positional);
    },
  }),
  defineNoContextCommand({
    name: "env",
    async run(_parsed, _installOptions) {
      await runEnvCommand(process.cwd());
    },
  }),
  defineRuntimeCommand({
    name: "search",
    contextMode: "existing",
    async run(parsed, installOptions, context) {
      if (!parsed.positional[0]) {
        throw new Error("Usage: flget search <query>");
      }
      await runSearchCommand(context, parsed.positional[0], installOptions.source);
    },
  }),
  defineRuntimeCommand({
    name: "skills",
    contextMode(parsed) {
      const skillSubcommand = parsed.positional[0];
      return skillSubcommand === "install"
        || skillSubcommand === "add"
        || skillSubcommand === "i"
        || skillSubcommand === "a"
        ? "create"
        : "existing";
    },
    async run(parsed, installOptions, context) {
      await runSkillsCommand(context, parsed.positional, installOptions, parsed.flags);
    },
  }),
  defineRuntimeCommand({
    name: "update",
    aliases: ["u"],
    contextMode: "existing",
    async run(parsed, installOptions, context) {
      await runUpdateCommand(
        context,
        parsed.positional[0],
        getBooleanFlag(parsed.flags, "all"),
        getBooleanFlag(parsed.flags, "no-self"),
        installOptions,
      );
    },
  }),
  defineRuntimeCommand({
    name: "reset",
    contextMode: "existing",
    async run(parsed, installOptions, context) {
      if (!parsed.positional[0]) {
        throw new Error("Usage: flget reset <package> [--source <source>]");
      }
      await runResetCommand(context, parsed.positional[0], installOptions.source);
    },
  }),
  defineRuntimeCommand({
    name: "remove",
    aliases: ["rm", "uninstall"],
    contextMode: "existing",
    async run(parsed, _installOptions, context) {
      if (!parsed.positional[0]) {
        throw new Error("Usage: flget remove <package>");
      }
      await runRemoveCommand(context, parsed.positional[0]);
    },
  }),
  defineRuntimeCommand({
    name: "list",
    aliases: ["ls"],
    contextMode: "existing",
    async run(parsed, _installOptions, context) {
      await runListCommand(context.root, getBooleanFlag(parsed.flags, "json"));
    },
  }),
  defineRuntimeCommand({
    name: "fund",
    contextMode: "existing",
    async run(parsed, _installOptions, context) {
      await runFundCommand(context, parsed.positional[0], getBooleanFlag(parsed.flags, "json"));
    },
  }),
  defineRuntimeCommand({
    name: "info",
    contextMode: "existing",
    async run(parsed, _installOptions, context) {
      if (!parsed.positional[0]) {
        throw new Error("Usage: flget info <package>");
      }
      await runInfoCommand(context.root, parsed.positional[0]);
    },
  }),
  defineRuntimeCommand({
    name: "repair",
    contextMode: "existing",
    async run(parsed, _installOptions, context) {
      await runRepairCommand(context, parsed.positional[0]);
    },
  }),
];

function getCommandSpec(command: string): CommandSpec | undefined {
  return COMMANDS.find((entry) => entry.name === command || entry.aliases?.includes(command));
}

async function loadRuntimeContext(spec: RuntimeCommandSpec, parsed: ParsedCliArgs): Promise<RuntimeContext> {
  const mode = typeof spec.contextMode === "function" ? spec.contextMode(parsed) : spec.contextMode;
  switch (mode) {
    case "create":
      return loadContext(undefined, { createIfMissing: true });
    case "existing":
      return loadContext();
  }
}

function getInstallOptions(parsed: ParsedCliArgs): InstallOptions {
  return {
    force: getBooleanFlag(parsed.flags, "force") || getBooleanFlag(parsed.flags, "f"),
    noHash: getBooleanFlag(parsed.flags, "no-hash"),
    noScripts: getBooleanFlag(parsed.flags, "no-scripts"),
    arch: parseArchFlag(parsed),
    source: parseInstallSourceFlag(parsed),
  };
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  if (command === "--version" || command === "-v") {
    console.log(`flget ${VERSION}`);
    return;
  }

  const spec = getCommandSpec(command);
  if (!spec) {
    printHelp();
    throw new Error(`Unknown command: ${command}`);
  }

  const parsed = parseCliArgs(rest);
  const installOptions = getInstallOptions(parsed);
  if (spec.kind === "none") {
    await spec.run(parsed, installOptions);
    return;
  }

  const context = await loadRuntimeContext(spec, parsed);
  await spec.run(parsed, installOptions, context);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
