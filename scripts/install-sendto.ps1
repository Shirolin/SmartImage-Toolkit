param(
    [switch]$Uninstall
)

# Adds SmartImage to the current user's SendTo menu:
#   - one shortcut converts the selected images to WebP immediately
#   - one shortcut opens the workbench with the selected images queued
# Run with pwsh -File scripts\install-sendto.ps1

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'bin\smartimage.exe'
$sendTo = [Environment]::GetFolderPath('SendTo')
if (-not $sendTo) {
    throw 'Could not locate the SendTo folder.'
}

$quickLnk = Join-Path $sendTo '转成 WebP (SmartImage).lnk'
$toolLnk = Join-Path $sendTo 'SmartImage 图片工具.lnk'

if ($Uninstall) {
    foreach ($path in @($quickLnk, $toolLnk)) {
        if (Test-Path $path) {
            Remove-Item $path -Force
            Write-Host "Removed $path"
        }
    }
    return
}

if (-not (Test-Path $exe)) {
    throw "Missing $exe. Build it first: go build -ldflags `"-s -w`" -o bin/smartimage.exe ./cmd/smartimage"
}

$shell = New-Object -ComObject WScript.Shell

$quick = $shell.CreateShortcut($quickLnk)
$quick.TargetPath = $exe
$quick.Arguments = '--quick webp'
$quick.WorkingDirectory = $root
$quick.IconLocation = "$exe,0"
$quick.Description = '用 SmartImage 把选中的图片转成 WebP'
$quick.Save()

$tool = $shell.CreateShortcut($toolLnk)
$tool.TargetPath = $exe
$tool.WorkingDirectory = $root
$tool.IconLocation = "$exe,0"
$tool.Description = '打开 SmartImage 并导入选中的图片'
$tool.Save()

Write-Host "Installed SendTo shortcuts in $sendTo"
Write-Host "  $quickLnk"
Write-Host "  $toolLnk"
