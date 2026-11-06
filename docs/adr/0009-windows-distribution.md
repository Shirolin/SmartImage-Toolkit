# ADR 0009: 用 mygo build 分发 Windows 安装包

- **状态 (Status)**: 已接受 (Accepted)
- **日期 (Date)**: 2026-11-06
- **上下文 (Context)**: P6 分发；应用需要 worker、模型与 VC++ 运行库，且必须按用户安装、可卸载、可右键使用

## 背景 (Context)

主程序是纯 Go 单文件，但抠图把运行时拆成了三部分：`matting-worker.exe`（22 MB）、`models/`（172 MB）与 Microsoft Visual C++ 2015–2022 x64 运行库。手写 PowerShell 安装器要自己维护快捷方式、卸载项、文件关联与升级，容易与主程序版本脱节。MyGo 自带的生产构建已经提供 Windows 安装器（NSIS）、资源随包分发、文件关联与卸载项，是受支持的扩展点。

## 决策 (Decision)

1. **构建入口**：`go tool mygo build`（CLI 以 `tool` 固定在 `go.mod`），配置在根目录 `mygo.json`：名称、`io.github.shirolin.smartimage`、版本、`main: ./cmd/smartimage`、资源、文件关联与安装器钩子。`scripts/package.ps1` 负责先补齐 worker、模型与 VC++ 运行库，再调用构建。
2. **安装方式**：NSIS 按用户安装到 `%LOCALAPPDATA%\Programs\SmartImage`，无需管理员；安装器创建开始菜单快捷方式与「设置 → 应用」卸载项；卸载只删程序目录，保留 `%APPDATA%\SmartImage\settings.json`。
3. **资源布局**：`models/` 与 `bin/matting-worker.exe` 通过 `mygo.json` 的 `resources` 复制到 exe 同级；运行时优先用 `mygo.App.Path(mygo.PathResources)` 查找，再回退到 exe 目录与仓库开发路径。VC++ 运行库放在 `resources/windows-amd64/`，只进 Windows 包。
4. **右键入口**：`scripts/installer.nsh` 在 `customInstall` 写入 `HKCU\Software\Classes\SystemFileAssociations\image\shell` 两项——「用 SmartImage 打开」与「转成 WebP (SmartImage)」；卸载时删除。文件关联另由 `mygo.json` 注册为「打开方式」候选，不抢占默认程序。多选时资源管理器逐个启动进程，主程序用单实例转发并排队，批次结束后再处理。
5. **运行库**：安装器检查 `HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64`，缺失时静默安装随包的 `vc_redist.x64.exe`（Microsoft 官方签名，`scripts/fetch-vcredist.ps1` 按签名校验下载），安装后从程序目录删除。
6. **更新**：暂不启用 mygo 的自动更新（需要更新签名密钥与发布渠道）；升级方式是运行新版本安装器覆盖安装，卸载项与设置保留。
7. **签名**：暂未配置代码签名证书，SmartScreen 会提示；签名接入点是 `mygo.json` 的 `windows.certificate` 或 `windows.signCommand`。

## 后果 (Consequences)

### 正向影响 (Positive)

- 安装、卸载、快捷方式、文件关联与版本信息由官方构建链维护，脚本只补业务资源。
- 主程序仍可在仓库内用 `go run` 开发；打包产物与开发路径共用同一套资源查找逻辑。
- 安装包自带 worker、两档模型与运行库，干净机器装完即可离线抠图。

### 负向影响与代价 (Trade-offs)

- 安装包约 195 MB，构建需要下载 NSIS（首次）与模型（约 172 MB）。
- 未签名，首次运行有 SmartScreen 警告；对外分发前应购买证书。
- 右键菜单是经典菜单，Windows 11 需在「显示更多选项」中使用。
- 文件关联注册为候选打开方式；用户若把 SmartImage 设为图片默认程序，双击图片会打开工作台而不是查看器。
- 安装器钩子只在安装时运行，自动更新（若以后启用）不会重写右键菜单；新增入口需要安装器版本或单独的注册步骤。
