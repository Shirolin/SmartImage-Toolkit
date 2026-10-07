# ADR 0006: 统一深度输入扫描与摄取管线 (Unify Recursive File Discovery Pipeline)

- **状态 (Status)**: 已接受 (Accepted)
- **日期 (Date)**: 2026-10-07
- **上下文 (Context)**: 架构优化第六轮审查与 Design-It-Twice (收敛 convert.ts 遍历胶水逻辑，统一多目标摄取、可访问性核验、目录递归探测与深度截断记账)

## 背景 (Context)

在原有的入口文件摄取流程中，存在典型的浅接口（Shallow Interface）与调用端胶水蔓延问题：

1. **`src/convert.ts` 承担大量面向过程遍历与状态维护**：
   - 入口必须编写 27 行循环，逐项对命令行参数执行 `fsp.access` 探测；
   - 调用 `getFiles(arg, 10, 0, onWarn)` 时，外部被迫感知内部递归实现细节（`currentDepth: 0`）；
   - 为获知因深度超限而被跳过的文件数（避免「成功 0 / 失败 0 / 退出码 0」的静默缺口），调用端必须在 `onWarn` 回调闭包中手动检查 `warn.kind === 'depth'` 并累加 `truncatedCount += warn.skippedFiles`；
   - 外部还需手动执行多数组合并打平、`new Set` 集合去重与空结果校验，导致入口与文件系统递归探测强耦合。
2. **`getFiles` 接口厚度不足**：
   - 仅接受单一路径字符串，只返回纯文件名数组 `string[]`，无法表达扫描元数据与聚合状态；
   - 强行迫使每个调用端自行处理多路径输入、存在性校验与去重逻辑。

## 决策 (Decision)

我们采用 **统一输入发现与摄取深模块 (Deep Input Discovery Pipeline)**：

1. **统一输入发现接口 (`src/utils.ts:discoverInputs`)**：
   - 签名：`discoverInputs(targets: string | readonly string[], options?: DiscoveryOptions): Promise<DiscoveryResult>`；
   - 入参灵活支持单个路径字符串或只读路径数组；
   - 返回结构体 `DiscoveryResult`，直接提供去重后的 `files`、聚合后的 `truncatedCount` 以及结构化告警列表 `warnings`。
2. **在接缝 (Seam) 后吸收多项横切关注点**：
   - **多目标归一化**：自动将单个路径或数组转为标准列表；
   - **可访问性防御**：在探测目录树前统一做 `fsp.access` 检查，不存在或无权限的路径生成 `inaccessible` 告警并安全跳过，绝不中断整批任务；
   - **目录树递归探测**：通过内部高内聚函数 `walkDirectory` 展开 Windows Junction 首层、探测深层符号链接防死循环、并发下钻子目录；
   - **深度截断统计收敛**：在接缝内部侦听 `depth` 告警并自动累加 `skippedFiles` 到 `truncatedCount`，外部调用端无需再编写闭包累加器；
   - **扩展名过滤与集合去重**：自动使用 `SUPPORTED_EXTS` 过滤非受支持格式，并利用 `Set` 在返回前消除重叠目录或重复参数产生的文件冗余。
3. **保留向后兼容适配器 (`src/utils.ts:getFiles`)**：
   - 保留原有的 `getFiles(inputPath, maxDepth, currentDepth, onWarn)` 签名；
   - 内部直接委托给 `walkDirectory`，保证既有调用方与单元测试 100% 绿灯无损迁移。
4. **彻底精简入口 (`src/convert.ts`)**：
   - 彻底移除 `fs.promises` 导入；
   - 原本 27 行面向过程胶水循环收敛为单次深层调用 `discoverInputs(args, { onWarn: ... })`。

## 后果 (Consequences)

### 正向影响 (Positive)

- **极高调用杠杆 (High Leverage)**：调用方仅需传递 `args` 即可获得现成的文件列表与截断记账，将复杂度完全封闭在接缝之后。
- **职责局部性显著提升 (Locality)**：文件存在性检查、遍历探测、去重与记账逻辑从命令入口剥离，重聚于纯数据摄取模块中。
- **单测覆盖坚实可信**：在 `test/utils.test.ts` 中新增 5 个用例（共 18 个用例），毫秒级覆盖单/多输入、重叠去重、非法路径告警隔离、深度超限记账与自定义扩展名过滤。
- **100% 契约兼容**：既有 15 个测试套件、172 项单元测试全部保持绿灯。

### 负向影响与代价 (Trade-offs)

- 无可感知负向影响。Set 去重在现代运行时中仅消耗极少微秒级 CPU 时间。
