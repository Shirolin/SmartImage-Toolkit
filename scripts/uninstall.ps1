$SendToPath = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\SendTo")
$ShortcutPathWebP = Join-Path $SendToPath "转成 WebP.lnk"
$ShortcutPathInteractive = Join-Path $SendToPath "更多图片转换处理.lnk"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  🗑️ SmartImage-Toolkit 卸载向导" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "⚙️ [处理中] 正在干净地移除组件..." -ForegroundColor Cyan

# 1. 移除 SendTo 快捷方式
if (Test-Path $ShortcutPathWebP) {
    Remove-Item $ShortcutPathWebP -Force
    Write-Host "🧹 [清理] 已移除 '发送到 -> 转成 WebP' 快捷方式" -ForegroundColor Gray
}

if (Test-Path $ShortcutPathInteractive) {
    Remove-Item $ShortcutPathInteractive -Force
    Write-Host "🧹 [清理] 已移除 '发送到 -> 更多图片转换处理' 快捷方式" -ForegroundColor Gray
}

# 兼容性清理：移除旧版本遗留的名为“转成更多图片格式”的快捷方式
$ShortcutPathOld = Join-Path $SendToPath "转成更多图片格式.lnk"
if (Test-Path $ShortcutPathOld) {
    Remove-Item $ShortcutPathOld -Force
    Write-Host "🧹 [清理] 已移除旧版本的 '发送到 -> 转成更多图片格式' 快捷方式" -ForegroundColor Gray
}

# 2. 也是为了以防万一，清理掉刚才可能写入的残留注册表项
function Remove-ContextMenu {
    param (
        [string]$PathType,
        [string]$KeyName
    )
    $RegPath = "HKCU:\Software\Classes\$PathType\shell\$KeyName"
    if (Test-Path $RegPath) {
        Remove-Item -Path $RegPath -Recurse -Force
        Write-Host "🧹 [清理] 已移除历史注册表项: $PathType\$KeyName" -ForegroundColor Gray
    }
}

# 老版本名称（用于向下兼容清理）
Remove-ContextMenu -PathType "SystemFileAssociations\image" -KeyName "WebPConverter"
Remove-ContextMenu -PathType "SystemFileAssociations\image" -KeyName "WebPConverterInteractive"
Remove-ContextMenu -PathType "Directory" -KeyName "WebPConverter"
Remove-ContextMenu -PathType "Directory" -KeyName "WebPConverterInteractive"

# 新版本名称
Remove-ContextMenu -PathType "SystemFileAssociations\image" -KeyName "SmartImageToolkit"
Remove-ContextMenu -PathType "SystemFileAssociations\image" -KeyName "SmartImageToolkitInteractive"
Remove-ContextMenu -PathType "Directory" -KeyName "SmartImageToolkit"
Remove-ContextMenu -PathType "Directory" -KeyName "SmartImageToolkitInteractive"

Write-Host ""
Write-Host "✅ [成功] 卸载完成！感谢您的使用~" -ForegroundColor Green

# 弹出原生提示框
Add-Type -AssemblyName System.Windows.Forms
$msgResult = [System.Windows.Forms.MessageBox]::Show(
    "所有注册的快捷方式及相关配置已彻底清除。`n`n由于是绿色软件，如果您想完全删除本工具，只需直接删除本文件夹即可。", 
    "SmartImage-Toolkit 卸载成功", 
    [System.Windows.Forms.MessageBoxButtons]::OK, 
    [System.Windows.Forms.MessageBoxIcon]::Information
)
