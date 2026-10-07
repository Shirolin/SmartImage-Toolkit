# ADR 0005: 解耦纯网格几何计算与切片单阶段生命周期 (Decouple Pure Grid Partitioning and Slicing Lifecycle)

- **状态 (Status)**: 已接受 (Accepted)
- **日期 (Date)**: 2026-10-07
- **上下文 (Context)**: 架构优化第六轮审查与 Design-It-Twice (剥离纯几何网格数学计算，消除 Web 服务端切图居中的二次磁盘回环)

## 背景 (Context)

在原有的切图实现中，存在明显的职责过度聚合与双轨 I/O 放大问题：

1. **`src/split.ts` 职责纠缠**：
   - `splitImage` 单个函数同时承担了源图解码与 EXIF 摆正、端点百分比防浮点漂移取整算法、自定义切割线差分计算、Sharp 内存切片抽取、Ad-hoc 居中尝试 (`centerTileBuffer`)、统一编码落盘、受控并发滑动窗口 (`BATCH_SIZE = 4`)、空目录原子清理、排查标尺图 (`_debug_grid`) 生成与配置文件写入。
   - 纯网格计算逻辑无法在脱离 Sharp 与磁盘文件系统的情况下进行毫秒级单测覆盖。
2. **双轨分歧与二次磁盘回环（Double Disk Roundtrip）**：
   - **CLI 模式**：在 `splitImage` 内部的内存流中调用 `centerTileBuffer`，一次性落盘居中切片；
   - **Web 模式 (`src/server/split-custom.ts`)**：调用 `splitImage` 时传入 `{ rows: 0, cols: 0 }` 伪参数，先将未居中的原始切片全部写入磁盘；随后在外部再次调用 `executeBatch(generatedFiles, processCenter, ...)`，从磁盘重新读取这些切片执行居中变换，并输出到 `centered/` 子目录；
   - **代价**：在生成 25 张切片的典型场景下，引发 **50 次磁盘文件操作**（25 次未居中文件写入 + 25 次居中重读与再写）以及 **50 次 Sharp 编解码流程**，同时在磁盘上留下了冗余的未居中临时切片文件。

## 决策 (Decision)

我们采用 **纯几何深模块与单阶段流式切图管线 (Pure Geometry Module & Single-Pass Slicing Pipeline)**：

1. **抽离深度纯计算模块 (`src/shared/geometry.ts`)**：
   - 零 Sharp 依赖、零文件系统 I/O；
   - 导出 `partitionGrid(spec, canvas?, options?): GridPartitionResult`；
   - 统管切分线严格单调递增性校验（`isValidCutArray`）、切片总数防爆上限核验（`MAX_TILES`）、端点百分比防浮点吃边漂移取整算法（`Math.round((i * W) / total)`）、瓦片越界与零宽异常边界标记，以及排查标尺图矢量 SVG 生成；
   - 在 `src/server/guard.ts` 中提供超薄兼容导出，实现单点事实源。
2. **统一内存居中变换 (`src/center.ts:centerTileBuffer`)**：
   - 扩展 `centerTileBuffer` 接口，同时支持 CLI 经典模式（`TileCenterOptions`）与 Web 智能居中模式（`CenterConfig`）；
   - 纯内存输入输出，返回就绪的 Sharp 管道，杜绝落地磁盘。
3. **收敛切图生命周期为深模块 (`src/split.ts`)**：
   - `splitImage` 深度集成 `centerConfig`；
   - 在内存流中直接串联：源图单次解码摆正 $\to$ 瓦片内存抽取 $\to$ 内存居中变换 $\to$ 单次编码落盘；
   - 居中失败时就地留痕至 `centerFailures` 并自动降级为保存原始切片，100% 保持契约兼容；
   - 单片失败记账不断整批，全部分片失败或零有效切片时原子清理输出空目录；
   - 副产物写入（`_debug_grid` 与 `split_config.json`）独立为尽力而为（Best-effort）事务。
4. **精简 Web 编排适配器 (`src/server/split-custom.ts`)**：
   - 移除二道批处理调用，代码量由 81 行缩减至 35 行，单次直调 `splitImage` 完成物理切片与智能居中。

## 后果 (Consequences)

### 正向影响 (Positive)

- **I/O 吞吐翻倍与零中间垃圾文件**：彻底消灭二次磁盘回环，磁盘写操作减少 50%，磁盘读操作减少 100%，不再在磁盘上留存冗余的未居中切片。
- **几何计算毫秒级极速单测**：新增 `test/geometry.test.ts`（16 个用例），在 20ms 内完成奇数尺寸、越界、漂移边界全覆盖，脱离真实图像文件与 Sharp 运行时约束。
- **调用端复杂度大幅收敛**：消灭 `{ rows: 0, cols: 0 }` 伪参数，Web 端调度逻辑精简超过 55%。
- **100% 契约兼容**：保持现有 `SplitResult` 与 `buildSplitCustomSuccess` 回包结构完全一致，前端 `ui/app.js` 与全部既有测试 100% 绿灯。

### 负向影响与代价 (Trade-offs)

- 内存瞬时驻留周期微增：单个并发 Worker 需在内存中接续完成居中探测与画布拓展，但通过现有的 `BATCH_SIZE = 4` 并发滑动窗口严格受控。
