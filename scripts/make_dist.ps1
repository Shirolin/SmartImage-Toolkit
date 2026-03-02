# SmartImage-Toolkit 离线打包工具
# 用途：为非程序员朋友生成一个“解压即用”的绿色安装包

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Get-Location }
$RootDir = Split-Path -Path $ScriptDir -Parent

$DistDir = Join-Path $RootDir "dist"
$BinDir = Join-Path $DistDir "bin"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   📦 SmartImage-Toolkit 绿色便携包一键生成器" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 创建目录结构
if (Test-Path $DistDir) {
    Write-Host "🧹 [清理] 正在移除旧的 dist 目录..." -ForegroundColor Gray
    Remove-Item -Path $DistDir -Recurse -Force
}
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null

# 2. 下载绿色版 Node.exe (Win-x64, v20.11.1 LTS)
$NodeUrl = "https://nodejs.org/dist/v20.11.1/win-x64/node.exe"
$NodeDest = Join-Path $BinDir "node.exe"

Write-Host "🌐 [下载中] 正在从官网获取绿色版 Node.js 运行时 (约 60MB)..." -ForegroundColor Yellow
try {
    Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeDest -ErrorAction Stop
    
    # 获取下载后的文件大小并严谨校验
    $NodeSize = (Get-Item $NodeDest).Length
    if ($NodeSize -lt 50000000) { # 若小于 50MB 极大几率为下载中断损坏件
        Remove-Item $NodeDest -Force
        throw "下载的文件过小 ($([math]::Round($NodeSize/1MB, 2)) MB)，疑似网络中断导致损坏。"
    }

    Write-Host "✅ [成功] Node.js 下载并校验完成！" -ForegroundColor Green
} catch {
    Write-Host "❌ [错误] 无法下载完整版 Node.js: $_" -ForegroundColor Red
    if (Test-Path $NodeDest) { Remove-Item $NodeDest -Force }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("下载 Node.js 失败或文件损坏，请检查网络连接后重试！`n`n错误信息: $_", "打包失败", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
    exit
}

# 3. 复制核心代码和依赖
Write-Host "⚙️ [处理中] 正在打包程序组件和预装依赖 (node_modules)..." -ForegroundColor Yellow

# 编译 TypeScript 生产版本
Write-Host "⚙️ [处理中] 正在执行 TypeScript 终极质量检验与编译..." -ForegroundColor Yellow
Set-Location -Path $RootDir
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ [错误] TypeScript 代码结构未通过规范性或类型检查，打包终止！" -ForegroundColor Red
    pause
    exit
}

# 创建目标二级目录
New-Item -ItemType Directory -Path (Join-Path $DistDir "lib") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $DistDir "scripts") -Force | Out-Null

$ItemsToCopy = @(
    "lib/convert.js",
    "run.bat",
    "run_interactive.bat",
    "scripts/install.ps1",
    "scripts/uninstall.ps1",
    "package.json",
    "package-lock.json",
    "node_modules"
)

foreach ($item in $ItemsToCopy) {
    $src = Join-Path $RootDir $item
    $dest = Join-Path $DistDir $item
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $dest -Recurse -Force
        Write-Host "📄 [打包] 已包含: $item" -ForegroundColor Gray
    } else {
        Write-Host "⚠️ [警告] 找不到待打包文件: $src" -ForegroundColor Yellow
    }
}

# 把预先写好的外部说明文件拷到 dist 里
$ReadmeSrc = Join-Path $ScriptDir "dist_readme.txt"
$ReadmeDest = Join-Path $DistDir "使用说明.txt"
if (Test-Path $ReadmeSrc) {
    Copy-Item -Path $ReadmeSrc -Destination $ReadmeDest -Force
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "🎉 打包完成！请将 '$DistDir' 文件夹打包发送即可。" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show(
    "便携包已成功生成在 'dist' 目录下！`n`n直接将此目录打包发送给朋友即可解压即用，无需配置环境。", 
    "SmartImage-Toolkit 打包成功", 
    [System.Windows.Forms.MessageBoxButtons]::OK, 
    [System.Windows.Forms.MessageBoxIcon]::Information
)

