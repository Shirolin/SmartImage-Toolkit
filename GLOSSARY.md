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
