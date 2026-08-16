# dsh-archive-manager — Windows install script
# Copies this plugin into the DSH profile's hoisted node_modules and enables
# it in the profile's cordis.patch.yml. Requires DSH to be restarted (or the
# patch HMR to pick the change up) before the plugin activates.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -ProfileName headless
param(
    [string]$ProfileName = "web"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME ".dsh" }
$profilesNodeModules = Join-Path $dshHome "profiles\node_modules"
$profileDir = Join-Path $dshHome ("profiles\" + $ProfileName)
$dest = Join-Path $profilesNodeModules "dsh-archive-manager"
$patchFile = Join-Path $profileDir "cordis.patch.yml"

Write-Host "==> dsh-archive-manager installer" -ForegroundColor Cyan
Write-Host "    DSH home        : $dshHome"
Write-Host "    Profile         : $ProfileName"
Write-Host "    Plugin target   : $dest"
Write-Host "    Patch file      : $patchFile"

if (-not (Test-Path $profileDir)) {
    Write-Error "Profile directory not found: $profileDir"
}
if (-not (Test-Path $profilesNodeModules)) {
    Write-Error "Profiles node_modules not found: $profilesNodeModules (is DSH installed?)"
}

# 1) copy the plugin package
Write-Host "==> Copying plugin files..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $dest | Out-Null
foreach ($item in @("package.json", "src", "LICENSE", "README.md", "README.zh-CN.md")) {
    $src = Join-Path $repoRoot $item
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $dest -Recurse -Force
        Write-Host "    copied $item"
    }
}

# 2) enable it in cordis.patch.yml (backup first, merge if non-trivial)
Write-Host "==> Enabling plugin in $patchFile ..." -ForegroundColor Cyan
$backup = "$patchFile.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -Path $patchFile -Destination $backup -Force
Write-Host "    backup: $backup"

$content = Get-Content -Path $patchFile -Raw -Encoding UTF8
if ($content -match "dsh-archive-manager") {
    Write-Host "    already enabled, nothing to change" -ForegroundColor Yellow
} else {
    $entry = @"

- insert:
    - id: dsh-archive-manager
      name: dsh-archive-manager
"@
    $trimmed = $content.TrimEnd()
    if ($trimmed -eq "" -or $trimmed -eq "[]") {
        # fresh/empty patch file: write the canonical form with comments
        $new = @"
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; ``!!js`` expressions allowed).
$entry
"@
    } else {
        # append to existing entries
        $new = $trimmed + "`n" + $entry + "`n"
    }
    Set-Content -Path $patchFile -Value $new -Encoding UTF8 -NoNewline
    Write-Host "    enabled (insert added)"
}

Write-Host "==> Done." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Restart DSH (or let the patch HMR re-compose the config)."
Write-Host "  2. Hard-refresh the browser (Ctrl+Shift+R)."
Write-Host "  3. Look for the '归档 / Archive' button at the bottom of the sidebar."
