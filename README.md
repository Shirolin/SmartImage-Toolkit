# SmartImage-Toolkit 🚀

一个轻量级、智能的图片批量处理及格式转换工具链。专为简化多格式图片之间的无损或有损转换而设计，不仅支持现代化的 WebP 和 AVIF 格式，还内建了实用的 AI 智能背景移除功能。

## 🌟 核心特性

- **多格式支持**：轻松在 `WebP`, `PNG`, `AVIF`, `MozJPEG` 等主流和现代图像格式间做转化。
- **操作简便**：支持拖拽式一键转换（静默模式）以及按需选择的交互模式。
- **智能排队引擎**：底层基于 Sharp 高性能图像处理框架搭建，支持多文件并发。
- **AI 背景移除**：无需上传云端，本地直接利用 AI 模型智能提取人物/物体主体并生成透明背景图像。
- **绿色便携打包**：自带免环境安装打包脚本，支持分发给非程序员直接作为“右键菜单工具”使用。

---

## 📂 项目结构

```text
SmartImage-Toolkit/
├── src/
│   └── convert.js          # 核心转换引擎代码
├── scripts/
│   ├── install.ps1         # 绿色版快速安装到系统右键菜单脚本
│   ├── uninstall.ps1       # 从系统右键菜单卸载绿色版脚本
│   ├── make_dist.ps1       # 开发者打包工具 (生成免环境便携包)
│   └── dist_readme.txt     # 便携包说明文档模板
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
   - **静默模式**: 直接将你的图片（或包含图片的文件夹）拖放到 `run.bat` 文件上，程序将默认采用最高效的配置将其转换为 WebP。
   - **交互模式**: 将图片拖放到 `run_interactive.bat` 文件上，然后在弹出的命令行窗口中按数字键盘选择目标格式或需要的功能。

---

## 📦 制作免环境分发包 (绿色版)

如果你想把这个好用的工具发送给你的朋友，但他们又不懂得如何安装 Node.js 和配置环境，你可以使用内置的打包脚本。

1. 在项目根目录下，找到并用 PowerShell 执行 `scripts/make_dist.ps1`。
2. 脚本会自动从官网拉取适用于 Windows 的 Node.js 便携版，整合源码和所有需要的依赖。
3. 稍等片刻，项目下会生成一个 `dist/` 文件夹。将这整个 `dist/` 文件夹（可以打个 ZIP 压缩包）发给你的朋友即可。
4. 你的朋友解压后，只需要右键允许 `install.ps1`，就可以将转换器集成到他的图片右键菜单中了！

---

## 📝 许可证及致谢

- 依赖库支持：[Sharp](https://github.com/lovell/sharp), [imgly/background-removal-node](https://github.com/imgly/background-removal-node)
- 协议: ISC License
