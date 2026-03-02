# SmartImage-Toolkit 🚀

一个轻量级、智能的图片批量处理及格式转换工具链。专为简化多格式图片之间的无损或有损转换而设计，不仅支持现代化的 WebP 和 AVIF 格式，还内建了实用的 AI 智能背景移除功能。

## 🌟 核心特性

- **多格式支持**：轻松在 `WebP`, `PNG`, `AVIF`, `MozJPEG` 等主流和现代图像格式间做转化。
- **操作简便**：支持拖拽式一键转换（静默模式）以及按需选择的交互模式。
- **智能排队引擎**：底层基于 Sharp 高性能图像处理框架搭建，支持多文件并发。
- **原生无损 AI 抠图**：本地利用 AI 模型智能分离主体，输出去除背景的极清透明图像。内置 `Medium (均衡模式)` 与 `Small (闪电极速)` 两种量化模型，按需取舍画质与性能。
- **现代化工程体系**：核心代码基于严谨的 **TypeScript** 编写，配套 ESLint 与 Prettier 的极致代码合规检查流水线。
- **绿色便携打包**：自带免环境跨平台编译打包脚本，一键生成无级降维体验的离线分发包，极简安装至右键菜单。

---

## 📂 项目结构

```text
SmartImage-Toolkit/
├── src/
│   └── convert.ts          # TypeScript 核心转换引擎源码
├── lib/
│   └── convert.js          # (编译后自动生成) 供生产环境与分发运行的成品
├── scripts/
│   ├── install.ps1         # 绿色版快速安装到系统右键菜单脚本
│   ├── uninstall.ps1       # 从系统右键菜单卸载绿色版脚本
│   ├── make_dist.ps1       # 开发者打包工具 (生成免环境便携包)
│   └── dist_readme.txt     # 便携包的说明文档引导模板
├── eslint.config.mjs       # ESLint 代码书写检查规则
├── tsconfig.json           # TypeScript 编译结构配置
├── run.bat                 # 静默转换启动入口
└── run_interactive.bat     # 交互模式启动入口
```

---

## 🛠️ 安装与使用

### 开发/源码模式使用

1. **环境准备**: 请确保已经安装了 [Node.js](https://nodejs.org/) (建议 LTS 版本)。
2. **克隆/下载项目**:
   将代码保存至本地并进入项目根目录：
   ```bash
   cd SmartImage-Toolkit
   npm install
   ```
3. **开始转换**:
   由于源码使用 TypeScript，开发者无需手动编译，双击或拖拽图片到以下批处理，内部会自动通过 `ts-node` JIT 直接运行：
   - **静默模式**: 直接将你的图片（或包含图片的文件夹）拖放到 `run.bat` 文件上，程序将默认采用最高效的配置转换为 WebP。
   - **交互模式**: 将图片拖放到 `run_interactive.bat` 文件上，然后在弹出的命令行窗口中按数字键盘选取所需的强大功能。

---

## 📦 制作免环境分发包 (绿色版)

如果你想把这个好用的工具发送给不懂得如何配置环境的朋友体验，你可以使用内置极强自动化打包流。

1. 在项目根目录下，找到并用 PowerShell 执行 `scripts/make_dist.ps1`。
2. 脚本会自动执行严格的代码质量筛查 (`Lint & Format`) 和 `TypeScript` 终极编译！
3. 随后会从官网拉取适用于 Windows 的 Node.js 便携环境，整合编译好的 `lib/` 源码以及重构后的模块与内置几百兆的 AI 模型。
4. 等待打包结束，项目下会生成一个高聚合的 `dist/` 文件夹。将这整个 `dist/` 文件夹打包发给你的朋友即可！
5. 朋友解压后右键用 PowerShell 执行 `scripts/install.ps1`，就可以将这套工具完美集成系统系统的图片右键菜单中了！

---

## 📝 许可证及致谢

- 依赖库支持：[Sharp](https://github.com/lovell/sharp), [imgly/background-removal-node](https://github.com/imgly/background-removal-node)
- 协议: ISC License
