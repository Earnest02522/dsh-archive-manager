# dsh-archive-manager - Windows uninstall script
# Removes the plugin entry from the profile's cordis.patch.yml and deletes the
# plugin package from the profile's hoisted node_modules.
#
# IMPORTANT: the patch overlay must ALWAYS remain a top-level YAML array. After
# the entry is removed, an otherwise-empty overlay is written back as the
# canonical empty form ("[]"); otherwise DSH refuses to boot with
# "must be a top-level YAML array of loader patch entries".
#
# Idempotent: running it when the plugin is not installed is a safe no-op (it
# even repairs a patch file left as comments-only by an older buggy uninstall).
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

# Canonical empty overlay (the same template dsh writes when initializing a profile).
$EMPTY_PATCH = @(
    "# Your patch layer for this dsh profile, applied after every bundle layer:",
    "# a top-level YAML array of loader patch entries (id-targeted config",
    "# overrides, disables, and insert lists; ``!!js`` expressions allowed).",
    "[]"
) -join "`n"

Write-Host "==> dsh-archive-manager uninstaller" -ForegroundColor Cyan
Write-Host "    DSH home        : $dshHome"
Write-Host "    Profile         : $ProfileName"

# 1) remove the entry from cordis.patch.yml (backup first)
if (Test-Path -LiteralPath $patchFile) {
    $content = Get-Content -LiteralPath $patchFile -Raw -Encoding UTF8

    # Drop every line that references the plugin, then collapse any
    # `- insert:` block left empty.
    $lines = $content -split "`n"
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        if ($line -match "dsh-archive-manager") { continue }
        $out.Add($line)
    }
    $new = ($out -join "`n")
    # Collapse empty "- insert:" blocks left behind by the removal: at EOF
    # (with or without a trailing newline) or before the next top-level item.
    $new = $new -replace "(?m)^- insert:[ \t]*\r?\n?(?=[ \t\r\n]*\z)", ""
    $new = $new -replace "(?m)^- insert:[ \t]*\r?\n(?=(?:[ \t]*\r?\n)*(?=- |\z))", ""

    # Does the file still hold real entries (non-comment, non-blank lines)?
    $significant = @($new -split "`r?`n" | Where-Object {
        $t = $_.Trim()
        $t -ne "" -and -not $t.StartsWith("#")
    })

    $changed = ($new -cne $content)
    if (-not $changed -and $significant.Count -gt 0) {
        Write-Host "    no entry found, overlay already valid - nothing to change" -ForegroundColor Yellow
    } else {
        $backup = "$patchFile.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        Copy-Item -LiteralPath $patchFile -Destination $backup -Force
        Write-Host "    backup: $backup"
        if ($significant.Count -eq 0) {
            # Comments/whitespace only -> must be a top-level YAML array, use "[]".
            Set-Content -LiteralPath $patchFile -Value $EMPTY_PATCH -Encoding UTF8
            Write-Host "    entry removed; overlay reset to canonical empty [] form" -ForegroundColor Green
        } else {
            Set-Content -LiteralPath $patchFile -Value $new -Encoding UTF8 -NoNewline
            Write-Host "    entry removed; remaining entries preserved" -ForegroundColor Green
        }
    }
} else {
    Write-Host "    patch file not found, skipping" -ForegroundColor Yellow
}

# 2) delete the plugin package
if (Test-Path -LiteralPath $dest) {
    Remove-Item -LiteralPath $dest -Recurse -Force
    Write-Host "    removed $dest"
} else {
    Write-Host "    plugin package not found, skipping" -ForegroundColor Yellow
}

Write-Host "==> Done. Restart DSH (or let patch HMR apply) and hard-refresh the browser." -ForegroundColor Green