#!/usr/bin/env bash
#
# dsh-archive-manager — install script (Linux / macOS)
#
# Copies this plugin into the DSH profile's plugin directory and enables it in
# the profile's cordis.patch.yml. Targets DSH 0.2.x and newer:
#   - per-profile layout: <profile>/node_modules
#   - older/hoisted layout: profiles/node_modules (fallback)
#
# Prefer the official CLI when you can:
#   npx --yes @deepseek-ai/dsh plugin --profile desktop add <spec>
#
# Usage:
#   bash scripts/install.sh                 # auto-detect profile (desktop, then web)
#   bash scripts/install.sh web             # non-default profile
#   bash scripts/install.sh desktop "@earnest020522/dsh-archive-manager"
#
set -euo pipefail

PROFILE="${1:-}"
PLUGIN_NAME="${2:-dsh-archive-manager}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILES_DIR="$DSH_HOME_DIR/profiles"

# Auto-detect: desktop -> web -> first non-node_modules profile.
if [ -z "$PROFILE" ]; then
  if [ -d "$PROFILES_DIR/desktop" ]; then PROFILE="desktop"
  elif [ -d "$PROFILES_DIR/web" ]; then PROFILE="web"
  else
    PROFILE="$(ls -1 "$PROFILES_DIR" 2>/dev/null | grep -v '^node_modules$' | head -n 1 || true)"
  fi
fi
if [ -z "$PROFILE" ]; then
  echo "error: no DSH profile found under $PROFILES_DIR" >&2
  exit 1
fi

PROFILE_DIR="$PROFILES_DIR/$PROFILE"
# 0.2.x keeps a per-profile node_modules; the hoisted one is a legacy fallback.
if [ -d "$PROFILE_DIR/node_modules" ]; then
  NODE_MODULES="$PROFILE_DIR/node_modules"
else
  NODE_MODULES="$PROFILES_DIR/node_modules"
fi
# Scoped names install under node_modules/@scope/name.
case "$PLUGIN_NAME" in
  @*/*) DEST="$NODE_MODULES/${PLUGIN_NAME%%/*}/${PLUGIN_NAME#*/}" ;;
  *) DEST="$NODE_MODULES/$PLUGIN_NAME" ;;
esac
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"

echo "==> dsh-archive-manager installer"
echo "    DSH home   : $DSH_HOME_DIR"
echo "    Profile    : $PROFILE"
echo "    Plugin     : $PLUGIN_NAME"
echo "    Target     : $DEST"
echo "    Patch      : $PATCH_FILE"

[ -d "$PROFILE_DIR" ] || { echo "error: profile not found: $PROFILE_DIR" >&2; exit 1; }
[ -d "$NODE_MODULES" ] || { echo "error: plugin node_modules not found: $NODE_MODULES (is DSH installed?)" >&2; exit 1; }
[ -f "$PATCH_FILE" ] || { echo "error: patch file not found: $PATCH_FILE" >&2; exit 1; }

# 1) copy the plugin package
mkdir -p "$DEST"
for item in package.json cordis.patch.yml src LICENSE README.md README.zh-CN.md; do
  [ -e "$REPO_ROOT/$item" ] && cp -R "$REPO_ROOT/$item" "$DEST/"
done
echo "    copied plugin files"

# 2) enable it in cordis.patch.yml (backup first, handle the empty-template case)
cp "$PATCH_FILE" "$PATCH_FILE.bak-$(date +%Y%m%d-%H%M%S)"

if grep -qF "$PLUGIN_NAME" "$PATCH_FILE"; then
  echo "    already enabled, nothing to change"
else
  if grep -q '^\[\][[:space:]]*$' "$PATCH_FILE"; then
    cat > "$PATCH_FILE" <<YAML
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).

- insert:
    - id: dsh-archive-manager
      name: $PLUGIN_NAME
YAML
  else
    cat >> "$PATCH_FILE" <<YAML

- insert:
    - id: dsh-archive-manager
      name: $PLUGIN_NAME
YAML
  fi
  echo "    enabled (insert added)"
fi

echo "==> Done."
echo "Next steps:"
echo "  1. Restart DSH (or let the patch HMR re-compose the config)."
echo "  2. Hard-refresh the window (Ctrl+Shift+R / Cmd+Shift+R)."
echo "  3. Look for the 'Archive' button at the bottom of the sidebar."
