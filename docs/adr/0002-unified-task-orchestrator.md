# ADR 0002: 统一批处理调度与任务标签联合契约 (Unified Task Orchestrator & Discriminated Union)

- **状态 (Status)**: 已接受 (Accepted)
- **日期 (Date)**: 2026-10-06
- **上下文 (Context)**: 架构优化第二轮审查与 Design-It-Twice (收敛 `convert.ts` 的分发总线与松散配置)

## 背景 (Context)

在原有的 `convert.ts` 中，存在明显的架构摩擦与职责过载（461 行）：

1. **松散可选参数袋**：`InteractiveResolution` 包含 9 个可选配置字段。消费方需要手动编写大量运行期类型断言（如 `format === 'split' && !splitConfig`）。
2. **多路分支硬编码分发**：在并发 `batch.map` 循环内部，根据 `format` 展开 6 分支 `if-else`，手动重复拼接后缀三元表达式（如 `resolveImageExt(outputFormat, '.jpg')`），认知负载高。
3. **职责过度集中**：CLI 参数摘除校验、交互菜单呼叫、文件扫描与深度限制统计、Ora 进度动画、算子调用分发、错误日志写入和退出码翻译混杂在同一个主入口中。

## 决策 (Decision)

我们采用 **方案 C（纯数据标签联合 / Data-Driven Discriminated Union）**：

1. **确立纯数据标签联合 `ImageTask`**：
   在 `src/orchestrator.ts` 中声明 `ImageTask` 标签联合类型（`convert`、`rmbg_solid`、`split`、`resize`、`trim`、`crop`、`center`、`pad_aspect`）。每个类型分支强约束其专有配置必填，消灭一切可选判空胶水。
2. **提前解析与早早失败 (Fail Early)**：
   提取 `resolveTask(input: TaskInput): ImageTask`，负责参数合法性校验、默认配置注水（如 `trim` 阈值、`center` 默认透明），并在文件扫描前早早报错，保持与 CLI 既有错误文案严格一致。
3. **下沉深层批处理协调器 (`runBatch`)**：
   将并发滑动窗口 (`BATCH_SIZE`)、Ora Spinner 动画、单文件错误隔离、分片多文件与部分瓦片失败统计、日期轮转错误日志落地 (`log/error_YYYY-MM-DD.log`) 以及结果汇总完整吸收至 `runBatch` 接缝后。
4. **收敛 CLI 入口薄层 (`convert.ts`)**：
   `convert.ts` 纯化为仅负责命令行参数摘除、文件检索、以及调用 `runBatch` 得到汇总后的进程退出码翻译，文件体量从 461 行精简至 ~140 行。

## 后果 (Consequences)

### 正向影响 (Positive)

- **大幅降低复杂性**：`convert.ts` 缩减约 70% 代码，消除了 9 个松散变量与多层嵌套三元表达式。
- **高测试杠杆 (High Test Leverage)**：任务解析与批处理调度可脱离真实 CLI 进程启动与 argv 参数进行高速、独立的单元测试；新增 `test/orchestrator.test.ts`。
- **类型安全保障**：TypeScript 编译期穷尽检查守护所有任务类型，后续增加新特效只需扩展 `ImageTask`。

### 负向影响与代价 (Trade-offs)

- 增加了 `src/orchestrator.ts` 协调层文件，但换取了主入口的高内聚与低耦合。
