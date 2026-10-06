# ADR 0004: 解耦终端交互驱动器与向导工作流 (Decouple Terminal Prompt Driver from Wizard Workflows)

- **状态 (Status)**: 已接受 (Accepted)
- **日期 (Date)**: 2026-10-07
- **上下文 (Context)**: 架构优化第六轮审查与 Design-It-Twice (拆解 1195 行 prompts.ts 巨石，消除 process.stdin 全局流猴子补丁)

## 背景 (Context)

在原有的代码库中，`src/prompts.ts`（1195 行）是代码库中唯一的千行巨石文件，存在严重的职责纠缠与单测痛点：

1. **三层职责紧密耦合**：
   - 底层 TTY 模式切换（`setRawMode`）、键盘事件监听（`emitKeypressEvents`）与 ANSI 光标擦除渲染（`\x1B[...A`）；
   - 会话级单例 `readline`（`questionReader`）与行缓冲队列（`bufferedLines`）；
   - 6 大领域向导工作流（`askSplitConfig`、`askResizeConfig`、`askTrimCrop`、`askCenterConfig`、`askPadAspectConfig`、`askAiModel`），并在各个向导内部重复手写数值边界校验与 `while(true)` 循环重问。
2. **单测摩擦极大且脆弱**：
   - 在 `test/prompts.test.ts` 中，为了测试数值拦截或 `0` 号返回逻辑，必须通过 `Object.defineProperty` 侵入篡改全局 `process.stdin` 与 `process.stdout` 描述符；
   - 模拟交互依赖异步输出子串模糊匹配配合 `setImmediate` 延后推入输入，容易引起跨用例的事件循环句柄泄露。导致 1195 行代码仅有 8 个单测，大量边缘分支缺乏测试保障。

## 决策 (Decision)

我们采用 **深模块架构与双适配器模式 (Deep Module with Dual Adapters)**：

1. **确立极简深模块接缝 (`src/prompt/driver.ts`)**：
   仅暴露 3 个原子入口：
   - `select<T>(options: SelectOptions<T>): Promise<T>`：离散单选交互；
   - `input<T = string>(options: InputOptions<T>): Promise<T>`：行文本采集，并在驱动内部自闭环完成输入校验（`validate`）、错误高亮重试与类型映射（`transform`）；
   - `notify(message: string, type?: NoticeType): void`：非交互式状态提示。
2. **实现双适配器满足真实终端与纯内存单测**：
   - **`AnsiTerminalDriver`（生产适配器）**：完全吸收 `setRawMode`、ANSI 游标擦除、chalk 着色渲染、共享 Readline 队列以及将 Ctrl+C / EOF 统一转换为 `CancelError`；
   - **`ScriptedPromptDriver`（测试适配器）**：纯内存按键与输入队列驱动，完全摆脱对 Node.js 流和 `Object.defineProperty` 的依赖。
3. **向导解耦为纯编排工作流 (`src/prompt/wizards/`)**：
   将 6 大向导解耦为接收 `PromptDriver` 的纯业务流程，彻底消除向导内重复的 `while(true)` 循环。
4. **常用调用方零成本透明门面 (`src/prompts.ts`)**：
   `src/prompts.ts` 提供向后兼容门面，默认透明绑定 `getDefaultPromptDriver()`，使 `src/cli.ts` 零改动平移。

## 后果 (Consequences)

### 正向影响 (Positive)

- **单测确定性与飞跃式提速**：测试全面转入纯内存运行，毫秒级执行，消灭流竞争与句柄泄露风险。
- **大幅削减重复样板**：`driver.input` 内部消化了 15 处重复的 `while(true)` 验证循环，向导代码行数大幅缩减。
- **局部性极大提升**：终端 ANSI 转义与 TTY 恢复完全集中于 `AnsiTerminalDriver`，业务向导专注领域配置组装。
- **100% 向后兼容**：`src/cli.ts` 无需任何改动。

### 负向影响与代价 (Trade-offs)

- 物理文件增多（拆分为 `driver.ts`、`ansi-driver.ts`、`scripted-driver.ts` 及各向导文件），但换取了极高的内聚性与清晰度。
