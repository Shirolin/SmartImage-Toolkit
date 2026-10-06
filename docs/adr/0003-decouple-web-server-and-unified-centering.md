# ADR 0003: 解耦 Web 服务端与切图编排，统一居中算子 (Decouple Web Server & Unified Centering)

- **状态 (Status)**: 已接受 (Accepted)
- **日期 (Date)**: 2026-10-07
- **上下文 (Context)**: 架构优化第五轮审查与 Design-It-Twice (消灭三路居中算法分裂，解耦 Web 服务端基础设施与切图后处理)

## 背景 (Context)

在原有的代码库中，存在明显的职责纠缠与逻辑重复：

1. **宿主基础设施与领域校验纠缠**：
   `src/server.ts`（448 行）混合了 Express HTTP 服务器配置（CORS、心跳、PowerShell 跨进程调用、定时器）与路径沙箱校验（`isPathAllowed`）及请求体校验。在 `test/server-guard.test.ts` 中引入 `src/server.ts` 时，会不可避免地触发顶层 `express()` 实例化与未清理的 `setInterval` 定时器副作用，导致单测被宿主环境拖累。
2. **居中逻辑三重复刻（Triplicate Centering Paths）**：
    - 路径 1（标准算子）：`src/center.ts` 中基于 `defineOperator` 构建的规范化 `processCenter` 算子；
    - 路径 2（内联复刻）：`src/split.ts`（第 222–293 行）内联了近 80 行 ad-hoc `centerMode` 边缘杂边消除与扩展填充；
    - 路径 3（宿主串行循环）：`src/server.ts` 中的 `runCenter` 函数手写了基于 `for...await` 的逐张单任务串行调用，忽略了受控并发批处理。

## 决策 (Decision)

我们采用 **综合深模块架构 (Deep Module Architecture)**：

1. **提取纯守卫模块 (`src/server/guard.ts`)**：
   封装 `PathSandbox` 路径沙箱，管理动态授权根目录与物理绝对路径安全核验（展开 Windows Junction 与符号链接、抹平大小写与盘符斜杠）。导出纯校验函数 `isValidCutArray`、`isValidCenterConfig`、`countSplitTiles`、`buildSplitCustomSuccess` 与大入口 `validateSplitCustomBody`。该模块无任何 Express/定时器/Sharp 依赖，彻底消除测试副作用。
2. **居中算法统一归口 (`src/center.ts`)**：
   提取专为切片优化的内存级居中变换 `centerTileBuffer`，彻底删除 `src/split.ts` 中内联的 80 行 ad-hoc 裁剪代码，使全库居中逻辑收敛至 `src/center.ts` 这一单一事实源。
3. **建立切图后处理领域级编排 (`src/server/split-custom.ts`)**：
   暴露单一高杠杆率入口 `executeSplitCustom`，统摄入参防御性校验、底层物理网格切图、受控并发居中批处理（基于 `executeBatch`，`BATCH_SIZE = 4`）、网格与居中双阶段失败精确记账以及回包拼装。
4. **精简 Web 宿主为超薄适配器 (`src/server.ts`)**：
   `src/server.ts` 缩减超过 260 行（精简至 ~180 行），仅负责 HTTP 请求转发、并发闸门 (`inFlight`) 与进程生命周期管理，并通过 re-export 保持既有外部契约 100% 向后兼容。

## 后果 (Consequences)

### 正向影响 (Positive)

- **单测零副作用与毫秒级执行**：`test/server-guard.test.ts`（26 项测试）在 14ms 内执行完毕，不再加载 Express 与后台定时器。
- **高局部性与单一算法源**：全库居中算法统一收敛，后续背景色容差或边距算法调整只需维护 `src/center.ts`。
- **内存与吞吐提升**：切图居中从单任务串行循环升级为 `executeBatch` 受控并发窗口调度。
- **接口契约 100% 兼容**：前端 `ui/app.js` 的所有成功、部分失败、全失败逻辑无缝平移，无需任何修改。

### 负向影响与代价 (Trade-offs)

- 增加了 `src/server/guard.ts` 与 `src/server/split-custom.ts` 模块，但换取了宿主层的高内聚与低耦合。
