# dsh-archive-manager — Windows uninstall script
# Removes the plugin entry from the profile's cordis.patch.yml and deletes the
# plugin package from the profile's hoisted node_modules.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1 -ProfileName headless
param(
    [string]$ProfileName = "web"
)

$ErrorActionPreference = "Stop"

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME ".dsh" }
$profilesNodeModules = Join-Path $dshHome "profiles\node_modules"
$profileDir = Join-Path $dshHome ("profiles\" + $ProfileName)
$dest = Join-Path $profilesNodeModules "dsh-archive-manager"
$patchFile = Join-Path $profileDir "cordis.patch.yml"

Write-Host "==> dsh-archive-manager uninstaller" -ForegroundColor Cyan

# 1) remove the entry from cordis.patch.yml (backup first)
if (Test-Path $patchFile) {
    $backup = "$patchFile.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -Path $patchFile -Destination $backup -Force
    Write-Host "    backup: $backup"

    $content = Get-Content -Path $patchFile -Raw -Encoding UTF8
    if ($content -match "dsh-archive-manager") {
        # Drop the whole "- insert:" block that contained our entry, or just the
        # entry line. We keep it simple: remove the entry line; if its insert
        # block is left empty, remove that block too.
        $lines = $content -split "`n"
        $out = New-Object System.Collections.Generic.List[string]
        $skipNextInsert = $false
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]
            if ($line -match "dsh-archive-manager") { continue }
            $out.Add($line)
        }
        $new = $out -join "`n"
        # tidy: collapse empty - insert: blocks
        $new = $new -replace "(?m)^- insert:\r?\n(?:\s*\r?\n)*$", ""
        Set-Content -Path $patchFile -Value $new -Encoding UTF8 -NoNewline
        Write-Host "    entry removed from $patchFile"
    } else {
        Write-Host "    no entry found in $patchFile" -ForegroundColor Yellow
    }
} else {
    Write-Host "    patch file not found, skipping" -ForegroundColor Yellow
}

# 2) delete the plugin package
if (Test-Path $dest) {
    Remove-Item -Path $dest -Recurse -Force
    Write-Host "    removed $dest"
} else {
    Write-Host "    plugin package not found, skipping" -ForegroundColor Yellow
}

Write-Host "==> Done. Restart DSH (or let patch HMR apply) and hard-refresh the browser." -ForegroundColor Green
