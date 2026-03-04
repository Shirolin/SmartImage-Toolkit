$Shell = New-Object -ComObject WScript.Shell
$SendToPath = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\SendTo")

# 快捷方式1：原有的 WebP 静默转换
$ShortcutPathWebP = Join-Path $SendToPath "转成 WebP.lnk"
# 快捷方式2：新增的多格式可选转换
$ShortcutPathInteractive = Join-Path $SendToPath "更多图片转换处理.lnk"
# 快捷方式3：界面按需切图
$ShortcutPathUI = Join-Path $SendToPath "界面切图(SmartImage).lnk"

$ScriptDir = $PSScriptRoot

if (-not $ScriptDir) { $ScriptDir = Get-Location }
$RootDir = Split-Path -Path $ScriptDir -Parent

$TargetPathWebP = Join-Path $RootDir "run.bat"
$TargetPathInteractive = Join-Path $RootDir "run_interactive.bat"
$TargetPathUI = Join-Path $RootDir "start-ui.bat"

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
$Shortcut1.WorkingDirectory = $RootDir
$Shortcut1.Description = "批量转换图片为 WebP 格式"
$Shortcut1.IconLocation = "shell32.dll, 225"
$Shortcut1.Save()

# 创建转成更多图片格式快捷方式
$Shortcut2 = $Shell.CreateShortcut($ShortcutPathInteractive)
$Shortcut2.TargetPath = $TargetPathInteractive
$Shortcut2.WorkingDirectory = $RootDir
$Shortcut2.Description = "交互式选择转换图片格式 (WebP/PNG/AVIF/MozJPEG/抠图等)"
$Shortcut2.IconLocation = "shell32.dll, 321" # 修改一下图标以示区别
$Shortcut2.Save()

# 创建交互式 UI 界面切割快捷方式
$Shortcut3 = $Shell.CreateShortcut($ShortcutPathUI)
$Shortcut3.TargetPath = $TargetPathUI
$Shortcut3.WorkingDirectory = $RootDir
$Shortcut3.Description = "启动可视化界面进行自定义分割并切图"
$Shortcut3.IconLocation = "shell32.dll, 25" # 图标使用剪刀或其他合适的
$Shortcut3.Save()

Write-Host "✅ [成功] 安装已顺利完成！" -ForegroundColor Green
Write-Host "👉 [提示] 多选图片后，请使用 '显示更多选项' -> '发送到' 功能进行处理，也可单张发送到[界面切图]。" -ForegroundColor Gray

# 弹出原生成功对话框
Add-Type -AssemblyName System.Windows.Forms
$msgStr = "安装已成功完成！`n`n您可以选中一张或多张图片，右键选择 [发送到] 系统菜单中的相应选项来使用本工具。`n若选择[界面切图]将自动弹出功能界面。"
$msgResult = [System.Windows.Forms.MessageBox]::Show($msgStr, "SmartImage-Toolkit 安装成功", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
