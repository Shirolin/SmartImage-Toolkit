# SmartImage-Toolkit

一个轻量级、智能的图片批量处理及格式转换工具链。支持 `WebP`、`PNG`、`AVIF`、`MozJPEG` 等现代与主流格式的相互转换，并内建本地 AI 智能背景移除。

## 核心特性

- **多格式转换**：在 `WebP`、`PNG`、`AVIF`、`MozJPEG` 之间无损或有损互转
- **AI 智能抠图**：基于 [imgly/background-removal-node](https://github.com/imgly/background-removal-node) 本地运行，内置 `Medium (均衡)` 与 `Small (极速)` 两种量化模型
- **切片 / 缩放 / 裁剪**：网格切片（自定义切割线）、按宽高/百分比缩放、智能去边与精确裁剪、主体居中
- **双交互入口**：拖拽静默转换 + 命令行交互菜单，另附浏览器版 Web UI 预览切图
- **高性能底层**：基于 [Sharp](https://github.com/lovell/sharp)，多文件并发处理
- **工程化保障**：TypeScript 源码，ESLint + Prettier 门禁，Vitest 单元测试

## 项目结构

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
│   ├── install.ps1             # 绿色版安装到系统右键菜单
│   ├── uninstall.ps1           # 从右键菜单卸载
│   ├── make_dist.ps1           # 开发者打包工具（生成免环境便携包）
│   └── dist_readme.txt         # 便携包说明模板
├── bootstrap.js                # Web UI 启动器（免编译直跑 TS 服务）
├── run.bat                     # 静默转换入口（拖拽图片即可）
├── run_interactive.bat         # 交互模式入口
└── start-ui.bat                # Web UI 入口
```

> `lib/` 为 TypeScript 编译产物，由构建流程自动生成，不纳入版本管理。

## 安装与使用（源码模式）

1. 安装 [Node.js](https://nodejs.org/) LTS 版本。
2. 克隆仓库并安装依赖：

    ```bash
    cd SmartImage-Toolkit
    npm install
    ```

3. 无需手动编译，直接使用：
    - **静默模式**：将图片或文件夹拖放到 `run.bat`，默认转换为 WebP
    - **交互模式**：将图片拖放到 `run_interactive.bat`，按数字键选择功能
    - **Web UI**：先执行 `npm run build` 生成 `lib/`，再双击 `start-ui.bat`，在浏览器中可视化预览与调整切割线

## 开发

```bash
npm run lint        # ESLint 检查
npm run format      # Prettier 格式化
npm run type-check  # tsc --noEmit 类型检查
npm test            # Vitest 单元测试
npm run build       # 完整门禁 + 编译输出至 lib/
npm run ui          # 启动 Web UI 服务
```

## 制作免环境分发包（绿色版）

1. 在项目根目录执行 `scripts/make_dist.ps1`（PowerShell）。
2. 脚本会依次执行 Lint & Format 检查与 TypeScript 编译，随后拉取 Windows 版 Node.js 便携环境，整合编译产物与内置 AI 模型，生成 `dist/` 文件夹。
3. 将整个 `dist/` 打包发送；接收方解压后用 PowerShell 执行 `scripts/install.ps1` 即可集成到系统图片右键菜单。

## 许可证及致谢

- 依赖库支持：[Sharp](https://github.com/lovell/sharp)、[imgly/background-removal-node](https://github.com/imgly/background-removal-node)
- 协议：[ISC License](./LICENSE)
