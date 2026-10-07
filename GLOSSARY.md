# GLOSSARY

本项目采用的领域与架构词汇规范。在 issue 标题、代码重构方案、单测与架构评审中请统一使用以下词汇，避免使用同义词漂移。

## 领域核心词汇

### Operator（算子）

对图像执行特定几何或像素变换的领域功能单元（例如 `center` 居中、`pad_aspect` 比例扩边、`trim` 去边、`resize` 缩放、`rmbg_solid` AI 抠图、`split` 切片）。算子对外提供纯变换逻辑。

### Recipe（变换配方）

算子提供给执行底座的纯内存变换函数。输入为经过视向摆正的 Sharp 实例与正向尺寸，输出为变换后的 Sharp 管道。不直接接触文件系统 I/O。

### Operation Runner（执行管线）

深层执行模块（`executePipeline` / `defineOperator`），统管文件输入输出生命周期。在接缝（Seam）后完整吸收原子独占占位、EXIF 视向摆正、格式编码与失败回滚。

### Exclusive Allocation（独占占位）

利用操作系统底层的 `O_EXCL`（`open` 的 `wx` 标志）独占原子创建 0 字节文件占位，同名文件自动递增 `(1)`，杜绝并发批处理时的重名覆写与竞争。

### Ghost File（幽灵文件）

独占占位阶段创建的 0 字节临时文件。若编码或落盘因故失败，执行管线必须立即执行 `unlink` 清理，确保磁盘零残留。

### Orientation（视向摆正）

在任何几何运算（裁剪、边距、切网格）或元数据读取前，必须先行根据 EXIF Orientation 标签执行 `.rotate()` 摆正，使计算始终基于正向笛卡尔坐标系。

### Sidecar（副产物）

非主输出图的附加文件（如切片时的排查标尺图 `_debug_grid`、配置 `split_config.json` 或 `trim` 的 `residue` 报告）。

### ImageTask（图像任务）

统一规范的不可变纯数据标签联合（Discriminated Union），每个任务变体显式绑定其所需配置与目标格式，消灭松散可选包袱。

### Batch Orchestrator（批处理协调器）

深层批处理调度引擎（`runBatch` / `orchestrator.ts`），统管受控并发窗口滑动、终端进度动画更新、单文件错误隔离、错误日志按日持久化与结果聚合。

### PathSandbox（路径沙箱）

管理受信任的根目录白名单并执行物理路径安全核验（`PathSandbox` / `guard.ts`）。完整展开 Windows Junction 与符号链接，消除盘符大小写与末尾斜杠差异，杜绝路径穿越攻击。

### Split Orchestrator（切图编排器）

切图与后处理领域级编排模块（`executeSplitCustom` / `split-custom.ts`）。统摄入参防御性核验、物理网格切图、受控并发居中批处理、双阶段失败归集与回包拼装。

### PromptDriver（交互驱动器）

本地可替换（Local-substitutable）的深模块接缝（`src/prompt/driver.ts`），仅呈现 `select`、`input`、`notify` 极简入口。在接缝后完整吸收 ANSI 光标回退擦除、TTY rawMode 状态维护、会话级 Readline 缓冲队列与就地校验重问循环。

### Wizard Workflow（向导工作流）

纯领域的交互配置采集工作流（`src/prompt/wizards/`）。接收 `PromptDriver` 驱动实例，专注完成多步参数引导、回退分支跳转与强类型配置对象构建，对具体终端流与输入载体零感知。

### GridGeometry（纯网格几何计算）

纯纯函数级几何计算模块（`src/shared/geometry.ts`），零 I/O、零 Sharp 依赖。统管切分线单调性校验、端点百分比防浮点漂移取整算法（`Math.round((i * W) / total)`）、瓦片拓扑边界有效性核验、切片总数防爆上限拦截（`MAX_TILES`）与排查标尺 SVG 渲染。

### Single-Pass Slicing（单阶段切图管线）

在内存 Sharp 管道内直接串联瓦片提取、居中修剪扩边（CLI 模式或 Web 端 `CenterConfig`）与格式编码，单次落盘至目标目录，彻底消灭二次磁盘读写往返与中间未居中临时文件。

### Input Discovery（输入扫描摄取管线）

统一深度文件摄取与扫描模块（`discoverInputs` / `src/utils.ts`）。在接缝后完整吸收单/多目标路径归一化、系统级可访问性检查（`fsp.access`）、目录树递归探测、符号链接防自引用死循环、递归深度超限截断与未决图片数记账（`truncatedCount`），以及集合去重。调用方无需在外部编写遍历循环与闭包状态维护。

