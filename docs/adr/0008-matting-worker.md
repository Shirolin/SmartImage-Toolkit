# ADR 0008: AI 抠图使用独立 ONNX worker

- **状态 (Status)**: 已接受 (Accepted)
- **日期 (Date)**: 2026-11-06
- **上下文 (Context)**: P5 AI 抠图；旧版使用 `@imgly/background-removal-node`（AGPL-3.0，Node + WASM）

## 背景 (Context)

原生工作台需要本地、离线的背景去除能力。旧实现依赖 Node 运行时与 IMG.LY 的 AGPL 包，权重另有授权约束；直接复用会把许可与运行时问题带进分发。Go 没有成熟的纯 Go ONNX 推理实现，而 cgo 直接嵌 ONNX Runtime 会让主程序失去纯 Go 构建，并把原生库崩溃的风险带进 UI 进程。

## 决策 (Decision)

采用 **独立 worker 进程 + 官方 ONNX Runtime + U2-Net 权重**：

1. **进程边界**：`worker/matting`（Rust + `ort`，ONNX Runtime 静态链接进 worker exe）通过 stdin/stdout 提供最简二进制协议。主程序不加载任何原生推理库；worker 崩溃只影响当前批次。
2. **主程序**：`internal/ops/matting` 负责协议、批量生命周期与输出规则；工作台「抠图」页复用统一队列、进度与取消。取消即终止 worker 进程，下一批重新启动。
3. **并发**：一个批次只启动一个 worker，模型只加载一次，逐张推理；不跟随「同时处理」设置，避免多份模型常驻内存。
4. **模型**：U2-Net（Apache-2.0）两档——快速 `u2netp.onnx`（~4.5 MB）与精细 `u2net.onnx`（~168 MB）。模型不提交到仓库，由 `scripts/fetch-matting-models.ps1` 按 SHA-256 下载；安装包把 worker 与 `models/` 放在程序目录。
5. **许可**：不再使用 AGPL 的 `@imgly` 代码；U2-Net 权重与代码为 Apache-2.0。若引入 ISNet/BiRefNet 等模型，必须单独核对其代码与权重许可后再分发。
6. **图像语义**：输入为已视向摆正的 PNG；输出直通 alpha（不预乘），可在 0–3 px 范围内羽化边缘（只模糊 alpha，不动 RGB）。JPEG 无法承载透明，选 JPEG 时输出 PNG 并在结果说明中提示；源为 WebP/AVIF/PNG 时保留原格式。

## 后果 (Consequences)

### 正向影响 (Positive)

- 主程序保持纯 Go，可交叉编译；UI 进程不受原生推理库崩溃影响。
- 推理速度与内存可控（精细模型单张约 0.4 s，CPU）；模型与引擎可独立升级。
- 无 Node/Python 运行时，完全离线。

### 负向影响与代价 (Trade-offs)

- 分发从单文件变成「主程序 + worker + 模型目录」；安装包体积增加约 190 MB。
- 引入 Rust 工具链作为构建依赖；worker 需按平台构建。
- `ort` 预编译运行时要求 x86-64 AVX2；极旧 CPU 需自建 ONNX Runtime。
- worker 依赖 Microsoft Visual C++ 2015–2022 x64 运行时；P6 安装包需附带 VC++ 运行库（或检测后提示安装）。
- 质量与旧版 IMG.LY 模型不同，需要样张人工验收，不能保证逐像素一致。

## 实施进展 (Progress)

- 2026-11-06：worker 协议（`SIM1` + 长度前缀帧）与 `internal/ops/matting` 完成；工作台「抠图」页、统一输出（`_nobg`、子目录 `matting`）、取消与错误提示接通。快速/精细模型在 640×400 样张上分别约 0.2 s / 0.4 s 推理。
