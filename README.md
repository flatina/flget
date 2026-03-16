# flget by flatina

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)

## 📦 Portable-First Package Manager

- Built for portable drives, optical media, and multiple isolated roots
  - No junction, no symlink in core flows
  - No `-g`, no registry writes, no `%PATH%` mutation in core flows
  - Rename-based install/update/persist migration
- Focused on standalone and Bun-friendly ecosystems
  - App sources: `scoop`, `npm`, `ghr`, `npmgh`
  - Agent skills: `flget skills ...`

### ⚠️ Notes

- `flget` does not aim to be a drop-in replacement for `scoop` or `npm`
- Many packages may still perform host mutation through their own install scripts
  - flget is portable but existing packages may not
- `flget` prefers `<root>/bun.exe`, then parent `bun.exe`, then system `bun`

## 🚀 Install / Update

```powershell
cd <some_directory>
powershell -c "irm https://flatina.github.io/flget/update.ps1 -OutFile .\update.ps1;.\update.ps1"

# update flget
.\update.ps1
```

## ⚡ Quick Start

```powershell
.\activate.ps1  # session PATH setup
flget --version

flget install 7zip --source scoop
flget install ripgrep --source ghr     # source-scoped GitHub Releases query
flget install typescript --source npm  # source-scoped npm registry query
flget install pnpm --source npmgh      # source-scoped GitHub source repo query
flget skills install openai/codex      # install an agent skill repo and create declared shims
```
- Use a fully-qualified ref such as `ghr:<owner>/<repo>` when you need an exact non-interactive install
- Update flget itself with `flget update` or `.\update.ps1`
- Run `.\REGISTER_PATH.ps1` only if you want to add `flget` to PATH (not recommended)

## 📁 Directory Root Source

- In an air-gapped environment, copying the entire root directory is usually enough
- If you only want to deploy some packages, use the existing flget root as an offline source

```powershell
mkdir <some_directory>
copy K:\flget\*.* <some_directory>   # copy only root files, not recursive

# Add the directory root as a source
cd <some_directory>
flget root add K:\flget
flget root list
flget root first K:\flget   # highest priority
flget root last K:\flget    # lowest priority
flget root remove K:\flget

flget install 7zip --source scoop
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

## 🗂️ Directory Structure

```text
<flget-root>/
  flget.root.toml
  flget.js
  flget.js.map
  bun.exe
  activate.ps1
  update.ps1
  REGISTER_PATH.ps1
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
  npmgh/
    <package-id>/
      flget.meta.json
      current/
      <version>/		# reusable local source
  agents/
    skills/
      <skill-id>/
        flget.meta.json
        current/
        <version>/		# reusable local source
  buckets/
  shims/
    bun.cmd
    bun.ps1
    flget.cmd
    flget.ps1
  tmp/
    downloads/
    transactions/
    cache-env-paths.txt
    cache-env-sets.txt
```

## 🧭 Commands

```powershell
# basic apps
flget install <source-or-query> [--source <source>] [--force] [--no-scripts] [--no-hash] [--arch <arch>]
flget update [<package>] [--all] [--no-self]
flget reset <package> [--source <source>]
flget remove <package>
flget list [--json]
flget fund [<package>] [--json]
flget info <package>
flget search <query> [--source <source>]
flget env
flget repair [package]
flget root <add|remove|list|first|last> ...
flget bucket <add|remove|list|update> ...
flget registry <list|add|remove|update> ...

# agent skills
flget skills <find|install|list|info|update|remove> ...
flget skills <search|add|ls|upgrade|rm> ...            # aliases
flget skills install cowsay-ts                         # installs an agent skill repo and creates declared shims

# source-scoped install query
flget install cowsay --source scoop
flget install ripgrep --source ghr
flget install pnpm --source npmgh

# exact install ref
flget install scoop:cowsay
flget install ghr:piuccio/cowsay
flget install npm:cowsay@1.5.0
flget install npmgh:piuccio/cowsay
# same app id from multiple sources: last installed wins
# switch winner: flget reset cowsay --source scoop

# source-scoped search query
flget search cowsay
flget search cowsay --source scoop
flget search npm:cowsay
flget search ghr:cowsay
flget search npmgh:cowsay
flget fund
flget fund pnpm
flget fund --json
flget skills find cowsay-ts
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
