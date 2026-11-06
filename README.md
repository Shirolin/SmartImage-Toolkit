<div align="center">

# SmartImage-Toolkit

**轻量级、智能的图片批量处理与格式转换工具链**

转换 · 抠图 · 切片 · 缩放 · 裁剪 —— 拖拽即用，本地运行，无需上传

![License](https://img.shields.io/badge/license-ISC-green)
![Node](https://img.shields.io/badge/node-%E2%89%A520.x-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Tests](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)

</div>

支持 `WebP`、`PNG`、`AVIF`、`MozJPEG` 等现代与主流格式的相互转换，内建本地 AI 智能背景移除——图像数据不出本机。

## ✨ 功能总览

| 功能           | 说明                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔄 多格式转换  | `WebP` / `PNG` / `AVIF` / `MozJPEG` 互转，自动处理命名冲突                                                                                           |
| 🧠 AI 智能抠图 | 基于 [imgly/background-removal-node](https://github.com/imgly/background-removal-node) 本地推理，内置 `Medium (均衡)` 与 `Small (极速)` 两种量化模型 |
| ✂️ 网格切片    | 均分切割或自定义切割线坐标，附浏览器可视化调线界面                                                                                                   |
| 📐 图像缩放    | 按宽度 / 高度 / 百分比等比缩放，或自定义宽高精确适配                                                                                                 |
| 🎯 去边与裁剪  | 容差可调的智能去边、四边独立的精确裁剪、主体居中                                                                                                     |
| 🖼️ 画布扩边    | 对齐目标比例 (16:9 / 9:16 / 1:1 / 自定义) 并缩小主体居中，四周留安全边距：Feed Flow/Omni 等图生视频前的预品处理                                      |
| ⚡ 批量并发    | 基于 [Sharp](https://github.com/lovell/sharp) 的多文件并发处理引擎                                                                                   |

## 📦 环境要求

- [Node.js](https://nodejs.org/) **20 LTS 或更高**（声明于 `package.json` 的 `engines` 字段）
- 仓库根 `.nvmrc` 固定到 `22.20.0`：vfox / nvm / fnm 进入目录后会自动切到该版本（AI 抠图依赖 Node 18+ 的 `Blob`/`fetch`，详见「常见问题」）
- Windows 10/11（右键菜单集成与打包脚本依赖 PowerShell）

## 🚀 快速开始

```bash
git clone https://github.com/Shirolin/SmartImage-Toolkit.git
cd SmartImage-Toolkit
npm install
```

无需手动编译，三种方式直接使用：

| 方式         | 操作                                                      | 适用场景                        |
| ------------ | --------------------------------------------------------- | ------------------------------- |
| **静默模式** | 将图片或文件夹拖放到 `run.bat`                            | 一键批量转 WebP                 |
| **交互模式** | 将图片拖放到 `run_interactive.bat`，按数字键选择功能      | 转换 / 切片 / 缩放 / 抠图全功能 |
| **Web UI**   | 先执行 `npm run build` 生成 `lib/`，再双击 `start-ui.bat` | 可视化预览并调整切割线          |

### 集成到右键菜单（可选）

以 PowerShell 执行 `scripts/install.ps1`，会在系统「发送到」菜单注册三个入口：

- **转成 WebP** —— 多选图片一键静默转换
- **更多图片转换处理** —— 多选图片进入交互模式
- **界面切图 (SmartImage)** —— 启动 Web UI 切图界面

卸载请执行 `scripts/uninstall.ps1`。

## 🦫 原生 Go 重写（进行中）

桌面端正在按功能切片重写为 Go 原生应用（MyGo + Onevra），要求 Go **1.27.3+**。Node 实现仍是当前稳定版本，直到各切片验收完成。

```bash
go run ./cmd/smartimage                              # 原生桌面 UI
go run ./cmd/smartimage --quick webp <路径...>        # 打开并立即转 WebP
go run ./cmd/smartimage <路径...>                     # 打开并导入文件/文件夹
go run ./cmd/smartimage-cli -format webp <路径...>   # 命令行转换（含目录递归）
go test ./...                                        # Go 质量门禁
```

构建并安装「发送到」快捷方式（当前用户，无需管理员）：

```powershell
go build -trimpath -ldflags "-s -w" -o bin/smartimage.exe ./cmd/smartimage
pwsh -File scripts/build-matting-worker.ps1   # 需要 Rust 工具链
pwsh -File scripts/fetch-matting-models.ps1   # 约 172 MB，验 SHA-256
pwsh -File scripts/install-sendto.ps1
# 移除：pwsh -File scripts/install-sendto.ps1 -Uninstall
```

制作安装包（worker、模型与 VC++ 运行库随包，约 195 MB）：

```powershell
pwsh -File scripts/package.ps1
# 产物：dist\windows-amd64\smartimage-setup-0.6.0-amd64.exe
```

安装包按用户安装到 `%LOCALAPPDATA%\Programs\SmartImage`，无需管理员；在「设置 → 应用」卸载，用户设置保留在 `%APPDATA%\SmartImage`。安装器注册图片「打开方式」与两项右键菜单（「用 SmartImage 打开」「转成 WebP」）；未签名，首次运行会有 SmartScreen 提示。

抠图需要 `matting-worker.exe` 与 `models/` 与主程序放在同一目录（开发时 `models/` 在仓库根目录亦可）。未安装时其他功能照常使用，「抠图」页会给出缺少文件的提示。

生成两个入口：「转成 WebP (SmartImage)」直接转换选中的图片；「SmartImage 图片工具」打开工作台并导入选中的图片。

P1 已完成：工作台、文件队列与缩略图、4 格式快速转换、体积变化、取消/重试、输出策略记忆、发送到入口。

P2 已完成：缩放（按宽/高/百分比/自定义，支持 cover/contain/fill/inside）、智能去边（容差 + 修剪方向）、手动裁剪（四边像素）；三者与转换共用队列、进度与取消，运行前在队列行内预览目标尺寸。

P3 已完成：智能居中（容差 + 参与边 + 填充色，画布尺寸不变）、画布扩边（16:9 / 9:16 / 1:1 / 4:5 / 自定义比例，长边、主体占比与填充色可调，预览目标画布）。

P4 已完成：原生切图编辑器——竖线/横线/平移模式，点击加线、Alt 反向、拖动移动、双击删除、吸附、滚轮缩放与平移，等分行列，最多 500 片实时计数，每片可选智能居中；导出为原图命名的新文件夹（`_rNN_cNN`）。

P5 已完成：本地 AI 抠图——独立 Rust worker + ONNX Runtime + U2-Net（快速/精细两档），完全离线；边缘羽化只作用于 alpha，透明通道保留，JPEG 自动回落 PNG；统一队列、进度、取消与输出规则（`_nobg`）。worker 与模型许可、分发方式见 [`docs/adr/0008-matting-worker.md`](docs/adr/0008-matting-worker.md)。架构决策见 [`docs/adr/0007-native-go-rewrite.md`](docs/adr/0007-native-go-rewrite.md)。

P6 已完成：Windows 安装包——`go tool mygo build` 生成按用户安装的 NSIS 安装器，自带 worker、模型与 VC++ 运行库；注册开始菜单、卸载项、图片「打开方式」与右键菜单（「用 SmartImage 打开」「转成 WebP」），卸载保留用户设置。分发决策见 [`docs/adr/0009-windows-distribution.md`](docs/adr/0009-windows-distribution.md)。

## 🛠️ 开发

| 命令                 | 说明                                     |
| -------------------- | ---------------------------------------- |
| `npm run lint`       | ESLint 全仓库检查                        |
| `npm run format`     | Prettier 全仓库格式化                    |
| `npm run type-check` | `tsc --noEmit` 类型检查                  |
| `npm test`           | Vitest 单元测试（28 个用例覆盖核心模块） |
| `npm run build`      | 完整质量门禁 + 编译输出至 `lib/`         |
| `npm run ui`         | 直接启动 Web UI 服务                     |

提交 PR 前请确保 `npm run build` 与 `npm test` 全绿。

### 项目结构

```text
SmartImage-Toolkit/
├── src/                        # TypeScript 源码
│   ├── cli.ts                  # 交互模式菜单与各操作的配置类型定义
│   ├── convert.ts              # CLI 主入口：参数解析与任务分发
│   ├── core.ts                 # 格式转换核心引擎（含 AI 抠图通道）
│   ├── resize.ts               # 图像缩放引擎
│   ├── split.ts                # 网格切片引擎
│   ├── trim.ts                 # 智能去边 (trim) 与精确裁剪 (crop)
│   ├── center.ts               # 主体居中引擎
│   ├── pad-aspect.ts           # 画布扩边 / 比例对齐引擎 (Pad Aspect)
│   ├── server.ts               # Web UI 本地服务（Express）
│   └── utils.ts                # 文件遍历等通用工具
├── ui/                         # 浏览器端切图预览界面（HTML/CSS/JS）
├── test/                       # Vitest 单元测试
├── scripts/
│   ├── install.ps1             # 注册「发送到」右键菜单快捷方式
│   ├── uninstall.ps1           # 移除已注册的快捷方式
│   ├── make_dist.ps1           # 开发者打包工具（生成免环境便携包）
│   └── dist_readme.txt         # 便携包说明模板
├── bootstrap.js                # Web UI 启动器（优先 lib/，回退 ts-node 直跑源码）
├── run.bat                     # 静默转换入口（拖拽图片即可）
├── run_interactive.bat         # 交互模式入口
└── start-ui.bat                # Web UI 入口
```

> `lib/` 为 TypeScript 编译产物，由构建流程自动生成，不纳入版本管理。

## 📤 制作免环境分发包（绿色版）

1. 在项目根目录执行 `scripts/make_dist.ps1`。
2. 脚本依次执行 Lint & Format 检查与 TypeScript 编译，随后拉取 Windows 版 Node.js 便携环境，整合编译产物与内置 AI 模型，生成 `dist/` 文件夹。
3. 将整个 `dist/` 打包发送；接收方解压后执行 `scripts/install.ps1` 即可集成到系统「发送到」菜单。

## ❓ 常见问题

**Q：双击 `start-ui.bat` 后浏览器页面无法访问？**
Web UI 依赖编译产物，请先执行 `npm run build` 再启动。

**Q：右键图片没看到工具入口？**
入口注册在「发送到」子菜单：右键图片 → 显示更多选项 → 发送到。若仍不存在，重新执行 `scripts/install.ps1`。

**Q：AI 抠图首次运行很慢？**
首次使用时需要加载模型文件，之后会复用本地缓存；对速度敏感可选择 `Small (极速)` 模型。

**Q：AI 抠图报 `Blob is not defined`，或提示缺少全局 `fetch`？**
抠图链路依赖 Node 18+ 才提供的 Web 标准全局（`Blob`/`fetch`）。有些工具（IDE、微信开发者工具等）会把自己携带的老 `node.exe` 写进 PATH，其优先级可能高于你安装的 Node——双击脚本时会命中那个老版本。
`run.bat` / `run_interactive.bat` 会自动跳过 PATH 中的旧 Node、优先挑选 18 及以上的版本；若机器上确实没有，请安装 Node 18+ 或把正确版本排到 PATH 前面。

## 📄 许可证及致谢

- 依赖库支持：[Sharp](https://github.com/lovell/sharp)、[imgly/background-removal-node](https://github.com/imgly/background-removal-node)
- 协议：[ISC License](./LICENSE)
