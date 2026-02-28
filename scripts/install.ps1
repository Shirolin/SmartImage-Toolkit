$Shell = New-Object -ComObject WScript.Shell
$SendToPath = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\SendTo")

# 快捷方式1：原有的 WebP 静默转换
$ShortcutPathWebP = Join-Path $SendToPath "转成 WebP.lnk"
# 快捷方式2：新增的多格式可选转换
$ShortcutPathInteractive = Join-Path $SendToPath "更多图片转换处理.lnk"

$ScriptDir = $PSScriptRoot

if (-not $ScriptDir) { $ScriptDir = Get-Location }

$TargetPathWebP = Join-Path $ScriptDir "run.bat"
$TargetPathInteractive = Join-Path $ScriptDir "run_interactive.bat"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  ✨ SmartImage-Toolkit 极速安装向导 ✨" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "⚠️ [警告] 您的电脑似乎未安装 Node.js。工具需依赖它来运行，请前往 https://nodejs.org 下载安装！" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "⚙️ [处理中] 正在生成原生支持多图并发聚合的 '发送到' (SendTo) 快捷方式..." -ForegroundColor Cyan

# 兼容性清理：移除旧版本遗留的名为“转成更多图片格式”的快捷方式
$ShortcutPathOld = Join-Path $SendToPath "转成更多图片格式.lnk"
if (Test-Path $ShortcutPathOld) {
    Remove-Item $ShortcutPathOld -Force
    Write-Host "🧹 [清理] 已移除旧版本冗余快捷方式: 转成更多图片格式.lnk" -ForegroundColor Gray
}

# 创建转成 WebP 快捷方式
$Shortcut1 = $Shell.CreateShortcut($ShortcutPathWebP)
$Shortcut1.TargetPath = $TargetPathWebP
$Shortcut1.WorkingDirectory = $ScriptDir
$Shortcut1.Description = "批量转换图片为 WebP 格式"
$Shortcut1.IconLocation = "shell32.dll, 225"
$Shortcut1.Save()

# 创建转成更多图片格式快捷方式
$Shortcut2 = $Shell.CreateShortcut($ShortcutPathInteractive)
$Shortcut2.TargetPath = $TargetPathInteractive
$Shortcut2.WorkingDirectory = $ScriptDir
$Shortcut2.Description = "交互式选择转换图片格式 (WebP/PNG/AVIF/MozJPEG/抠图等)"
$Shortcut2.IconLocation = "shell32.dll, 321" # 修改一下图标以示区别
$Shortcut2.Save()

Write-Host "✅ [成功] 安装已顺利完成！" -ForegroundColor Green
Write-Host "👉 [提示] 多选图片后，请使用 '显示更多选项' -> '发送到' 功能，系统将优雅地自动合并所有图片到单个窗口处理。" -ForegroundColor Gray

# 弹出原生成功对话框
Add-Type -AssemblyName System.Windows.Forms
$msgStr = "安装已成功完成！`n`n您可以选中多张图片，右键选择 [发送到] 系统菜单中的 [转成 WebP] 或 [更多图片转换处理] 来使用本工具。"
$msgResult = [System.Windows.Forms.MessageBox]::Show($msgStr, "SmartImage-Toolkit 安装成功", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
