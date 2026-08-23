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
| ⚡ 批量并发    | 基于 [Sharp](https://github.com/lovell/sharp) 的多文件并发处理引擎                                                                                   |

## 📦 环境要求

- [Node.js](https://nodejs.org/) **20 LTS 或更高**（声明于 `package.json` 的 `engines` 字段）
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

## 📄 许可证及致谢

- 依赖库支持：[Sharp](https://github.com/lovell/sharp)、[imgly/background-removal-node](https://github.com/imgly/background-removal-node)
- 协议：[ISC License](./LICENSE)
