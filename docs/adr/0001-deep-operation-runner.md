# ADR 0001: 收敛算子 I/O 到深层执行管线 (Deepen Operator Execution Pipeline)

- **状态 (Status)**: 已接受 (Accepted)
- **日期 (Date)**: 2026-10-06
- **上下文 (Context)**: Candidate 1 架构审查与 Design-It-Twice 双重设计

## 背景 (Context)

在既有代码库中，`center.ts`、`pad-aspect.ts`、`trim.ts`、`resize.ts` 和 `core.ts` 各自作为浅模块存在。每个算子均包含了大量重复的底层文件系统样板逻辑：

1. 目标目录解析与创建 (`ensureDir`)
2. 文件路径独占原子占位 (`allocateFilePath` / `O_EXCL`)
3. EXIF 视向纠偏与自动旋转 (`sharp.rotate()`)
4. 统一编码参数注入 (`applyEncoding`)
5. 异步落盘驱动 (`toFile`)
6. 失败捕获与 0 字节幽灵文件回滚清除 (`fsp.unlink`)
7. `OpResult` 错误信封组装

上述重复导致代码库维护局部性（Locality）差。任何针对独占命名竞争、幽灵空文件清理或 EXIF 旋转的修复都需要在 5 个算子文件中同步修改。

## 决策 (Decision)

我们采用 **方案 A（算子工厂定义）与 方案 C（批量调度）的混合架构 (Hybrid)**：

1. **下沉深层执行管线模块**：
   在 `src/shared/pipeline.ts` 中建立 `executePipeline` 与 `defineOperator`，在接缝（Seam）后完整吸收文件 I/O、独占占位、EXIF 摆正、格式编码与失败回滚。
2. **算子退化为纯配方 (Recipe)**：
   算子通过 `defineOperator` 声明其纯内存 Sharp 变换逻辑，输入始终为经 EXIF 纠偏后的标准坐标系实例，输出纯 Sharp 变换管道。算子内部不再接触文件读写与落盘。
3. **保持算子领域独立性，避免大单体 Spec**：
   不引入中心化的 `OperatorSpec` 联合类型，各算子的专有参数与几何算法留在各自模块内（如 `center.ts`, `pad-aspect.ts`）。
4. **对 1 对 N 切片（`split.ts`）实施拓扑隔离**：
   `split.ts` 因生成 N 个文件与目录隔离的特殊性，不强行塞入 1 对 1 单图管道，继续复用 `allocateDir` 独立运行，保护主管道接口的精简性。

## 后果 (Consequences)

### 正向影响 (Positive)

- **消除样板代码**：5 个算子模块的代码量预计缩减 60%~75%，净删除数百行重复 I/O 逻辑。
- **高局部性 (High Locality)**：并发独占占位与幽灵文件清理机制集中于一处，彻底消除脏文件残留与并发竞争漏洞。
- **单测杠杆提升**：算子的几何变换支持纯内存断言，无需触碰真实文件系统；执行管线针对文件回滚做集中门禁验证。

### 负向影响与代价 (Trade-offs)

- 新增一个内部抽象层（`pipeline.ts`），初期重构需调整算子实现结构并确保全仓单测绿灯。

## 进展追踪 (Progress)

- **2026-10-06 (Round 1)**：创建 `src/shared/pipeline.ts`，首批迁移 `center.ts` 与 `pad-aspect.ts` 并通过验证。
- **2026-10-06 (Round 3)**：全面收官单图算子迁移，将 `resize.ts` 与 `trim.ts`（包含 `processTrim` 与 `processCrop`）完全重构为纯配方，保留 `processTrimOrCrop` 适配器向下兼容。全部单图算子（`center`, `pad-aspect`, `resize`, `trim`, `crop`）的底层 I/O、独占占位、EXIF 摆正与幽灵清理逻辑现已 100% 归拢至执行管线接缝之后。

