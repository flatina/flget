# flget by flatina

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)

## 📦 Portable-First Package Manager

- Built for portable drives, optical media, and multiple isolated roots
  - No junction, no symlink in core flows
  - No `-g`, no registry writes, no `%PATH%` mutation in core flows
  - Rename-based install/update/persist migration
- Focused on standalone and Bun-friendly ecosystems
  - App sources: `scoop`, `npm`, `ghr`, `npmgh`, `depot`
- Agent skills: `flget skills ...` with shims for declared entry scripts

### ⚠️ Notes

- `flget` does not aim to be a drop-in replacement for `scoop` or `npm`
- Many packages may still perform host mutation through their own install scripts
  - flget is portable but existing packages may not

## 🚀 Install / Update

```powershell
cd <some_directory>
powershell -c "irm https://flatina.github.io/flget/update.ps1 -OutFile .\update.ps1;.\update.ps1"

# update flget
.\update.ps1
```

## ⚡ Quick Start

```powershell
.\activate.ps1                        # session PATH setup
flget --version

flget search 7zip
flget install 7zip                     # prompts if ambiguous
flget install 7zip --source scoop      # source-scoped install
flget install servo --source ghr       # source-scoped GitHub Releases query
flget install typescript --source npm  # source-scoped npm registry query
flget install pnpm --source npmgh      # source-scoped GitHub source repo query
flget skills install flatina/skills --skill cowsay-ts # install one skill from a skill repo and create shims
```
- Use a fully-qualified ref such as `ghr:<owner>/<repo>` when you need an exact non-interactive install
- Update flget itself with `flget update` or `.\update.ps1`
- `update.ps1` is a stable Pages entrypoint; flget runtime comes from the latest GitHub release zip and Bun is fetched from the latest official Bun release

## 📡 Depot (Distributed Package Source)

- Any flget root can serve as a package source for other flget instances
- Supports both local directories and remote HTTP depots
- Packages installed from a depot are stored as `sourceType: "depot"`

```powershell
# Add a depot (local or remote)
flget depot add K:\flget
flget depot add http://10.0.0.5:8080
flget depot list
flget depot first K:\flget
flget depot remove K:\flget

# Install from depot
flget install depot:7zip
flget install 7zip --source depot
flget search 7zip --source depot

# Serve your root as a depot
flget serve --host 0.0.0.0 --port 8080
```

## 🔐 Secrets

- `flget` supports plain `.env` files and built-in encrypted `.flenc` files
- Encrypted `.flenc` files require `FLGET_SECRETS_KEY`
- `.flenc` stays dotenv-shaped and encrypts values with `FLENC[...]`, not a SOPS-compatible format

```env
# .env
GITHUB_TOKEN=...

# .secrets/.env.flenc
GITHUB_TOKEN=FLENC[v1,cipher:AES256_GCM,kdf:scrypt,n:16384,r:8,p:1,salt:...,iv:...,tag:...,data:...]
```

- `flget` supports multi-user profile secrets
- Lookup order: process env -> `.env` -> `.secrets/.env` -> `.secrets/<profile>.env` -> encrypted `.flenc` variants
- Profile selection: `FLGET_PROFILE` first, then OS username fallback
```text
<flget-root>/
  .env
  .secrets/
    .env
    .env.flenc
    alice.env
    alice.env.flenc
```

### ⚠️ Notes

If you need stronger key management, sharing, rotation, or auditability, use `SOPS` and inject secrets into process env before running `flget`

## 🗂️ Initialized Directory Structure

```text
<flget-root>/
  flget.root.toml
  flget.js
  flget.js.map
  bun.exe
  activate.ps1
  update.ps1
  scoop/
    <package-id>/
      flget.meta.json
      current/
      <version>/		# reusable local source
  npm/
    <package-id>/
      flget.meta.json
      current/
      <version>/		# reusable local source
  ghr/
    <package-id>/
      flget.meta.json
      current/
      <version>/		# reusable local source
  gh/
    npm/
      <package-id>/
        flget.meta.json
        current/
        <version>/		# reusable local source
    skills/
      <skill-id>/
        flget.meta.json
        current/
        <version>/		# reusable local source
  depot/
    <package-id>/
      flget.meta.json
      current/
  buckets/
  shims/
    bun.cmd
    bun.ps1
    flget.cmd
    flget.ps1
  xdg/
    .config/              # XDG_CONFIG_HOME (set by activate.ps1)
    .local/
      share/              # XDG_DATA_HOME
      state/              # XDG_STATE_HOME
        flget/            # staging, transactions, activation cache
    .cache/               # XDG_CACHE_HOME
      flget/              # download temp files
```

## 🧭 Commands

```powershell
# basic apps
flget install <source-or-query> [--source <source>] [--force] [--no-scripts] [--no-hash] [--arch <arch>] [--tag <tag>...]
flget update [<package>] [--all] [--no-self]
flget reset <package> [--source <source>]
flget remove <package>
flget list [--json] [--tsv] [--tag <tag>] [--path]
flget fund [<package>]
flget info <package>
flget search <query> [--source <source>]
flget env [--toml]
flget config <show|create>
flget cache refresh
flget repair [package]
flget depot <add|remove|list|first|last> ...
flget serve [--port <port>] [--host <host>]
flget bucket <add|remove|list|update> ...
flget compat <list|add|remove|update> ...

# agent skills
flget skills <find|install|list|info|update|remove> ...
flget skills <search|add|ls|upgrade|rm> ...            # aliases
flget skills install flatina/skills --skill cowsay-ts
flget skills install flatina/skills --all
flget skills install flatina/skills --list

# source-scoped install query
flget install cowsay --source scoop
flget install servo --source ghr
flget install pnpm --source npmgh

# exact install ref
flget install scoop:cowsay
flget install ghr:servo/servo
flget install npm:cowsay@1.5.0
flget install npmgh:piuccio/cowsay
flget install depot:7zip
# same app id from multiple sources: last installed wins
# switch winner: flget reset cowsay --source scoop

# source-scoped search query
flget search cowsay
flget search cowsay --source scoop
flget search npm:cowsay
flget search ghr:servo
flget search npmgh:cowsay

# funding
flget fund
flget fund servo

# skills
flget skills find cowsay-ts
```

## 🌐 Environment Info

- use `flget env` or `flget env --toml` to show flget environment
- XDG directories are set by `activate.ps1` — all XDG-aware programs in the session use the flget root's XDG directories

```powershell
# flget env
FL_ENV_VERSION=2
FL_ROOT=C:\flget
FL_SHIMS_DIR=shims
FL_CONFIG_FILE=flget.root.toml
FL_SOURCES=scoop,ghr,npm,npmgh
FL_BUCKETS=main
FL_DEPOTS=K:\flget
FL_XDG_CONFIG=xdg/.config
FL_XDG_DATA=xdg/.local/share
FL_XDG_STATE=xdg/.local/state
FL_XDG_CACHE=xdg/.cache

# flget env --toml
env_version = 2
root = "C:\\flget"
shims_dir = "shims"
config_file = "flget.root.toml"
sources = ["scoop", "ghr", "npm", "npmgh"]
buckets = ["main"]
depots = ["K:\\flget"]
xdg_config = "xdg/.config"
xdg_data = "xdg/.local/share"
xdg_state = "xdg/.local/state"
xdg_cache = "xdg/.cache"
```

## 🏷️ Tags

- Attach tags to packages at install time with `--tag` (repeatable)
- Filter installed packages by tag with `flget list --tag`
- Can also be used to install and manage your own extensions

```powershell
# install with tags
flget install ghr:my_org/my_repo --tag my_tag

# list packages with a specific tag
flget list --tsv --path --tag my_tag
my_org/my_repo	1.0.0	ghr	portable	my_tag	ghr/my_org/my_repo/current
```

## 🤖 Skill Script Shim Generation

- Declare skill shims with top-level `shims` in `SKILL.md` frontmatter

```yaml
---
name: cowsay
description: ASCII cowsay via TypeScript
shims:
  - scripts/cowsay.ts
---
```

- Optional shim fields: name, runner

```yaml
---
name: cowsay
description: ASCII cowsay via TypeScript
shims:
  - target: scripts/cowsay.ts
    name: my-cowsay
    runner: bun
---
```

## 🧩 Compatibility Overrides

- Official compatibility overrides repository:
  - https://github.com/flatina/flget-compat
  - PRs welcome.

```toml
# overrides/npm/openai--codex.toml
[env]
CODEX_HOME = '${FL_ROOT}\.codex'
```

## 🛠️ Troubleshooting

- `shims/flget.*` or `shims/bun.*` is missing
  - Run `.\activate.ps1`.
- Update the root runtime files
  - Run `flget update` or `.\update.ps1`.
- Fresh root cannot search Scoop packages
  - Ensure `git` is available, then run `flget bucket update`.
- `bun.exe` is missing from the root
  - `flget` tries root, parent, then system `bun`.
- Same app id exists in multiple sources
  - Last installed wins. Use `flget reset <id> --source <source>`.
- Disable package install scripts
  - Use `flget install ... --no-scripts`.
