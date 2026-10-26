#!/bin/sh
# Links the repo's tracked hooks (scripts/git-hooks/*) into .git/hooks. npm runs this on
# install ("prepare"), so every checkout gets them. The global ~/.git-hooks dispatcher
# (core.hooksPath) runs .git/hooks/<name> after its own work, so linking here is enough.
# Quietly does nothing outside a git checkout (Vercel and Railway installs).

top="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
hooks_dir="$(git rev-parse --path-format=absolute --git-common-dir)/hooks"
mkdir -p "$hooks_dir"

for src in "$top"/scripts/git-hooks/*; do
  name="$(basename "$src")"
  chmod +x "$src"
  ln -sf "$src" "$hooks_dir/$name"
done
