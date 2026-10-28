# dsh-archive-manager — Windows install script
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
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -ProfileName web
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -PluginName "@earnest020522/dsh-archive-manager"
param(
    [string]$ProfileName = "",
    [string]$PluginName = "dsh-archive-manager"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME ".dsh" }
$profilesDir = Join-Path $dshHome "profiles"

# Auto-detect the profile: prefer an explicit -ProfileName, else the desktop
# profile (DSH 0.2.x), else web (0.1.x), else the first profile present.
if ([string]::IsNullOrWhiteSpace($ProfileName)) {
    if (Test-Path (Join-Path $profilesDir "desktop")) { $ProfileName = "desktop" }
    elseif (Test-Path (Join-Path $profilesDir "web")) { $ProfileName = "web" }
    else {
        $first = Get-ChildItem $profilesDir -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ne "node_modules" } | Select-Object -First 1
        if ($null -eq $first) { Write-Error "No DSH profile found under $profilesDir" }
        $ProfileName = $first.Name
    }
}

$profileDir = Join-Path $profilesDir $ProfileName
# DSH 0.2.x keeps a per-profile node_modules; 0.1.x used the hoisted one.
$nodeModules = Join-Path $profileDir "node_modules"
if (-not (Test-Path $nodeModules)) { $nodeModules = Join-Path $profilesDir "node_modules" }

# Scoped names install under node_modules/@scope/name; bare names directly.
$scopeSplit = $PluginName.Split("/")
if ($PluginName.StartsWith("@") -and $scopeSplit.Length -eq 2) {
    $dest = Join-Path (Join-Path $nodeModules $scopeSplit[0]) $scopeSplit[1]
} else {
    $dest = Join-Path $nodeModules $PluginName
}
$patchFile = Join-Path $profileDir "cordis.patch.yml"

Write-Host "==> dsh-archive-manager installer" -ForegroundColor Cyan
Write-Host "    DSH home        : $dshHome"
Write-Host "    Profile         : $ProfileName"
Write-Host "    Plugin name     : $PluginName"
Write-Host "    Plugin target   : $dest"
Write-Host "    Patch file      : $patchFile"

if (-not (Test-Path $profileDir)) { Write-Error "Profile directory not found: $profileDir" }
if (-not (Test-Path $nodeModules)) { Write-Error "Plugin node_modules not found: $nodeModules (is DSH installed?)" }
if (-not (Test-Path $patchFile)) { Write-Error "Patch file not found: $patchFile" }

# 1) copy the plugin package
Write-Host "==> Copying plugin files..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $dest | Out-Null
foreach ($item in @("package.json", "cordis.patch.yml", "src", "LICENSE", "README.md", "README.en.md", "docs")) {
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
if ($content -match [regex]::Escape($PluginName)) {
    Write-Host "    already enabled, nothing to change" -ForegroundColor Yellow
} else {
    $entry = "`n- insert:`n    - id: dsh-archive-manager`n      name: $PluginName`n"
    $trimmed = $content.TrimEnd()
    $meaningful = @($content -split "\r?\n" | Where-Object {
        $t = $_.Trim()
        $t -ne "" -and -not $t.StartsWith("#")
    })
    $isEmpty = ($meaningful.Count -eq 0) -or ($meaningful.Count -eq 1 -and $meaningful[0].Trim() -eq "[]")
    if ($isEmpty) {
        $new = "# Your patch layer for this dsh profile, applied after every bundle layer:`n" +
               "# a top-level YAML array of loader patch entries (id-targeted config`n" +
               "# overrides, disables, and insert lists; ``!!js`` expressions allowed).`n" +
               $entry
    } else {
        $new = $trimmed + "`n" + $entry
    }
    Set-Content -Path $patchFile -Value $new -Encoding UTF8 -NoNewline
    Write-Host "    enabled (insert added)"
}

Write-Host "==> Done." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Restart DSH (or let the patch HMR re-compose the config)."
Write-Host "  2. Hard-refresh the browser/desktop window (Ctrl+Shift+R)."
Write-Host "  3. Look for the 'Archive' button at the bottom of the sidebar."
