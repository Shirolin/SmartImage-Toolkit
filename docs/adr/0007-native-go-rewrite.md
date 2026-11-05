# ADR 0007: 原生 Go 重写（MyGo + Onevra）

- **状态 (Status)**: 已接受 (Accepted)
- **日期 (Date)**: 2026-11-05
- **上下文 (Context)**: 以功能垂直切片重写桌面端，替代 Node + Sharp + Web UI 运行时

## 背景 (Context)

现有实现由 TypeScript 算子、Express 本地服务与浏览器调线界面组成，运行时依赖 Node 与 `sharp`/ONNX。目标是以单二进制原生桌面应用交付，同时保留现有图像处理语义。

## 决策 (Decision)

采用 **MyGo + Onevra 全原生 Go 重写**，按功能切片交付，不按层迁移：

1. **模块布局**：`cmd/smartimage`（桌面 UI）、`cmd/smartimage-cli`（对比/批处理入口）、`internal/imageio`（编解码与视向摆正）、`internal/pipeline`（独占占位与命名）、`internal/ops/<operator>`（纯算子）。
2. **编码矩阵**：WebP/AVIF 由 `gen2brain/webp`、`gen2brain/avif`（wazero，纯 Go）；JPEG 目标由 `gen2brain/jpegli` 输出；PNG 使用标准库最佳压缩。不再保证与 `sharp`/MozJPEG 逐字节一致，质量基线以 golden 语料重新建立。
3. **UI**：`onevra` 仅经薄封装使用；画布类交互直接基于 MyGo `ui` 的 Canvas/Bitmap/手势，不等待上游组件。
4. **切片顺序**：S1 格式转换 → S2 缩放 → S3 去边/裁剪 → S4 居中 → S5 画布扩边 → S6 切片 → S7 原生切图编辑器 → S8 AI 抠图（决策点）→ S9 外壳集成。
5. **共存期**：Node 实现保持可用，作为行为对照与回退；全部切片验收后删除。

## 后果 (Consequences)

### 正向影响 (Positive)

- 单二进制分发，无 Node/Sharp 运行时；编码器的朝上像素尺寸由 `imageio` 统一保证。
- 纯 Go 依赖可在任意平台交叉编译。

### 负向影响与代价 (Trade-offs)

- AI 抠图没有纯 Go 等价物，S8 需在 cgo ONNX Runtime 与独立辅助进程之间决策。
- `onevra` 公开 API 不稳定，升级风险集中在封装层。
- 输出质量与既有 `sharp` 基线不同，需要 golden 图像语料与人工验收。

## 实施进展 (Progress)

- 2026-11-05：P1 工作台闭环完成 `cmd/smartimage` 的 Native 工作台：拖拽/选择文件与文件夹、4 格式快速转换、逐文件缩略图与体积变化、取消/重试/移除、输出策略记忆、`--quick <format>` 一键入口与「发送到」脚本。
- 2026-11-05：P2 尺寸与边缘完成：新增 `internal/ops/resize`、`internal/ops/trim`、`internal/ops/crop`，共用 `internal/ops` 批量调度与 `internal/pipeline` 落盘；工作台按操作页独立保存参数与结果，队列行内预览目标尺寸。
- 2026-11-05：P3 构图完成：新增 `internal/ops/center` 与 `internal/ops/padaspect`，共享 `ops.Fill` 填充色与 trim 的主体包围盒探测；「构图」页以标签切换两个模式，扩边预览目标画布。
- 2026-11-05：P4 切图完成：新增 `internal/ops/split`（纯几何 `Grid`/`EqualDivide` + 切片落盘）与工作台「切图」页的原生画布编辑器；切割线按原图像素保存，预览位图长边最多 2048 px；每片居中复用 `center.Recenter`。
- 后续按 [`docs/product/rewrite-plan.md`](../product/rewrite-plan.md) 的 P5 推进 AI 抠图；P6 为分发。
