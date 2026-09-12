# BACKLOG（待办池）

本文件登记 SmartImage-Toolkit 代码审查（第 2 轮）确认、但**本轮迭代未修复**的非阻断项：按严重度分组，另设「测试与工程一致性」一节收拢测试覆盖缺口、文案措辞与交互一致性问题；已在本轮修复并验证的项不在此列。

最近更新：2026-09-12（代码审查第 2 轮）

> 来源：RevCore（core.ts + shared/*）、RevCli（convert.ts / cli.ts / utils.ts / bootstrap.js / bat）、RevOps（split / resize / trim / center）、RevPrompts（prompts.ts / config-types.ts）、RevServer（server.ts + ui/*）。
> 标注 `[INFERENCE]` 的条目为代码与探针推断、未完整实机复现；其余条目的现象均经实测（见对应报告证据）。行号以 2026-09-12 工作区为准。

## 阻断

本轮无。唯一阻断项（customSelect 缺 stdin EOF 处理，RevPrompts#1）已在本次迭代修复。

## 高

本轮无（四个算子缺 EXIF 方向已在同轮修复并验证，故不登记）。

| 文件:行 | 问题 | 影响 | 建议 |
| --- | --- | --- | --- |

## 中

| 文件:行 | 问题 | 影响 | 建议 |
| --- | --- | --- | --- |
| `src/convert.ts:409-416` | 顶层直接执行 `main(process.argv.slice(2))`，无 `require.main` 守卫（仓库既有约定见 `src/server.ts:419-422`）：import 本模块即真实执行 CLI；catch 内 `process.exit(1)` 把退出码与输出写进宿主进程（RevCli#6，已验证） | vitest 等宿主 import 时会被执行一遍 CLI（污染输出）；`node -e "require('./lib/convert.js')" x.png package.json` 会把宿主进程以退出码 1 终止，与文件头「顶层不再执行副作用」的注释矛盾 | 用 `if (require.main === module) { ... }` 包住入口（可辅以 `process.env.VITEST` 兜底），并把 `process.exit(1)` 收敛回 `process.exitCode = 1` |
| `start-ui.bat:7,37-41` | `setlocal enabledelayedexpansion` 下，`%~1` 展开出的拖拽路径会被二次延迟展开：落单 `!` 被丢弃、成对 `!x!` 被当变量展开为空（RevCli#7，已验证） | 路径含 `!`（如 `C:\pics\a!b\x.png`）时 bootstrap 收到被改写的路径，用户看到空白 UI 或 404，无从归因 | 文件内并未使用 `!var!`，把第 7 行改为 `setlocal`（或 `setlocal disabledelayedexpansion`）即可，其余逻辑不变 |
| `src/utils.ts:8`（复用点 `src/server.ts:108,228`） | SUPPORTED_EXTS 含 `.tiff` 但缺 `.tif`，也未收 `.jfif`，而 sharp 对同族扩展名一视同仁（RevCli#8，已验证） | `.tif`/`.jfif` 作为唯一输入时 CLI 报「未找到任何受支持的图片文件。」并以退出码 1 结束（bat 弹错误框）；Web UI 上传同样被 400「仅支持图片文件」拒绝 | 扩展白名单补全为 `.jpg .jpeg .jfif .png .bmp .tif .tiff .gif .webp .avif` |
| `src/utils.ts:43-56` | 入口路径先 lstat、是符号链接即跳过，未区分「用户显式传入」与「深层条目」（后者才有防环需求）（RevCli#9，已验证） | 软链/目录联接（Windows `mklink /J` 常见）作为显式输入时零产出并报「未找到图片」+ 退出码 1，看起来像崩溃；入口链接目录内的普通图片也全部被拒 | 仅入口跟随链接：`stats = currentDepth === 0 ? await fs.promises.stat(inputPath) : await fs.promises.lstat(inputPath);`，深层继续 lstat 防环 |
| `src/resize.ts:69-78`；`src/prompts.ts:434-460` | 缩放目标尺寸无上界：by_percent 只钳下界（`if (targetWidth < 1)`），by_width/by_height/custom 同样无上限，prompts 输入也只校验 `> 0`（RevOps#8，已验证） | 手滑输入 100000 会真的渲染 3e10 像素级巨图，进程长时间占满 CPU/磁盘；产出的巨型图超过 sharp 默认 limitInputPixels，后续算子（trim/center/再 resize）无法再读回 | resizeImage 入口设上限（如 MAX_DIM=30000、percent<=1000）并在 allocateFilePath 之前返回 error；prompts 同步补上限文案 |
| `src/prompts.ts:152-186` | askQuestion 每次调用都新建 readline 并在回调里 `rl.close()`，同一 stdin chunk 内已缓冲的后续行被丢弃（RevPrompts#5，已验证） | 预写多行答案（例如把 `alpha`、`beta` 两行一次写入 stdin 再启动）时，第二问立即变成 CancelError「用户中断输入」，管道驱动的多步问答无法自动化走完 | 会话内共享惰性单例 readline（不逐问 close），用 `rl.question` 串行提问，保留接口内部的待处理行 |

## 低

| 文件:行 | 问题 | 影响 | 建议 |
| --- | --- | --- | --- |
| `src/core.ts:188-189,200` | AI 分支先 `resultSharp.toBuffer()` 编码一次，再 `sharp(finalBuffer)` 交给 toFile 解码并重新编码；finally 里 `finalBuffer = null` 并不会提前释放内存（RevCore#6，已验证） | 大图多出一次完整编解码的 CPU/内存开销；置空是无效操作、易误导维护者 | 直接 `sharpInstance = applyEncoding(...)` 后落盘（保留已有 palette:false 处理），删除 finalBuffer 声明与置空 |
| `src/utils.ts:82-95` | 深度超限判定写在 for 循环体内：逐 entry onWarn 且逐条 continue，函数必然返回空（RevCli#10，已验证） | 某第 11 层目录含 N 个条目时刷屏 N 条相同黄字告警；因深度被排除的文件既不计 skip 也不计 failed，汇总仍报成功、退出码 0（静默产出缺口） | 深度判断提到循环外，一次告警一次返回；如需可见性，可把被截断文件在入口计一次汇总 |
| `src/convert.ts:149-150,164-167`；`run_interactive.bat:55-60`；`run.bat:66-71` | 无参数与用户取消（CancelError）都 `return idle`、退出码保持 0（代码注释声明取消保持 0），随后 bat 打印「Done. This window closes in 5 seconds...」（RevCli#11，已验证） | 「操作已取消」与「Done」同屏，语义自相矛盾；脚本/调用方无法区分「完成」与「取消」 | 取消用独立退出码（如 2）并在 bat 里只打印中性说明「Session cancelled.」；或把成功文案改成中性的「Session finished.」。不要混入 :RUN_ERROR 弹框 |
| `src/center.ts:26-31`；`src/trim.ts:41-46` | ensureDir 与 allocateFilePath 位于 try 之外（对照 `src/resize.ts:43,118` 均在 try 内），异常以 reject 逃出 OpResult 契约（RevOps#9，已验证） | 输出目录不可写/路径过长/磁盘满时，processCenter 直接 reject 而非返回 `{status:'error'}`；当前调用方恰好都有 catch，新调用方漏写即未处理拒绝 | 把 `center.ts:26-29` 与 `trim.ts:41` 移入 try，或整体包一层把异常转成 error 结果 |
| `src/prompts.ts:540-541,626,714,778,829`；`src/cli.ts:120,127,133,139,146`；编号 `src/prompts.ts:236,247,272,309,358` 与 `:561,594,632,655` | 返回项文案写「返回修改缩放参数 / 上一步 / 返回重新选择」，实际 cli.ts 一律 `continue` 回主菜单并丢弃已填参数；步骤编号不一致：切片开居中时前四步标 /4、末步却 5/5；边缘修剪为 1/3 → 2/4、3/4 或 2/3（RevPrompts#6，已验证） | 用户按提示期待回上一步，实际被抛回主菜单、已填参数作废需重走；编号跳变让流程显得混乱 | 文案改为与行为一致（如「返回主菜单（已填参数将丢弃）」）或实现真正的回退；统一编号分母（或去掉分母） |
| `src/server.ts:81-95` | isPathAllowed 仍是纯字符串前缀比较（大小写已归一），不做 realpath，而 fsp.access/sendFile 会跟随链接（RevServer#14，[INFERENCE]：未实机复现） | 仓库目录内的 junction（`mklink /J`，无需管理员）可读到白名单根外的图片；仍受 SUPPORTED_EXTS 限制且需本机写权限，风险有界 | isPathAllowed 内先 `await fsp.realpath(p)`（失败退回 resolve）再做前缀判断；白名单根启动时 realpath 一次并缓存 |
| `ui/app.js:9-15,39-49` | 空元素守卫只覆盖画布与关键表单元素；工具栏/配置/放大镜元素无守卫，`magnifier.getContext('2d')`（49 行）取空即顶层 TypeError（RevServer#17，已验证） | 模板少一个 id → 顶层抛错中断余下全部脚本，页面所有按钮失灵，且与已建立的守卫约定自相矛盾、排查成本高 | 统一一个 `mustGet` 工具或延续 console.error 守卫并在使用点判空，二选一后全文件统一 |
| `src/trim.ts:63-64`；`src/center.ts:39-40` | trim/center 为拿 bbox 用 `toBuffer({resolveWithObject:true})` 把整图再解码+编码一次（RevOps 报告附注，非当前必修） | 每张图多出一倍 CPU 与内存峰值，大图批量处理时吞吐明显下降 | 复用已有 decode 结果，或改用低开销输出（raw）减少编解码往返 |
| `src/split.ts:145` | `settlement.reason as TileError` 直接断言、未用 instanceof 收窄（RevOps 报告附注） | 一旦有非 TileError 逃出，记账循环抛错会被外层 catch 折成 error + generatedFiles:[]，与「账本失败丢切片」同类风险 | 改为 `instanceof TileError` 收窄，其余按普通错误记账 |
| `src/shared/output-naming.ts:10-19` | O_EXCL 占位设计在进程被 Ctrl-C/崩溃时会残留 0 字节占位文件（RevCore 报告附注，设计已知取舍） | 下次转换会占掉一个编号（目录出现跳号），并留下 0 字节残留文件；不会覆盖或误删文件，危害有限 | 维持现状，或后续加「启动时清理自家 0 字节残占位」的兜底（需谨慎，避免误删用户文件） |

## 测试与工程一致性

| 文件:行 | 问题 | 影响 | 建议 |
| --- | --- | --- | --- |
| `test/`（无 prompts 相关用例） | test/ 下没有任何 prompts / customSelect / askQuestion / CancelError 用例（RevPrompts 报告附注） | 本轮交互层修复（EOF→CancelError、行列 1-512 重问、裁剪四值全 0 拒绝、色值校验）无回归网，后续改动易悄悄破坏 | 至少为 CancelError 冒泡与 askCount/裁剪输入校验补少量最小用例（沿用现有 vitest 结构） |
| `test/`（split / resize / trim 等） | 既有用例未覆盖 rows/cols<=0、切片配置写入失败、EXIF 方向、resize 默认 fit、failedTiles 可见性等路径（RevOps 报告附注，登记备查） | 这些恰是本轮修复/加固过的路径，回归防护缺失 | 按修复项逐条补最小回归用例，断言可观测结果（失败前置、错误信息、产物计数） |
| `src/prompts.ts:312-335,361-377,486-516` | shave / fit / debugGrid 三个子菜单没有 0 号返回项，用户只能 Ctrl+C 整体取消，与其余菜单不一致（RevPrompts 报告附注） | 交互一致性缺口：误入子菜单后无法体面返回，需重走整个流程 | 统一补 0 号「返回主菜单」项（与其它 customSelect 菜单同款） |
| `src/core.ts:196`（结合 `:102`） | 错误前缀去重依赖 `errorDetails.includes('图片文件解析失败')` 对文案的硬编码耦合（RevCore 报告附注） | 当前判断逻辑无误，但改文案即退化成双前缀，属维护陷阱 | 用显式标记/错误类型区分，或在 throw 处统一构造完整文案后不再二次拼接 |
| `run.bat:74-76`；`run_interactive.bat:63-65` | :RUN_ERROR 模态框文案「unexpected error」在「普通部分失败」「空目录/零产出」等可预期场景也会弹出（RevCli 报告附注） | 把可预期的业务失败渲染成崩溃告警，误导用户，与退出码 1 的语义不匹配 | 文案改中性（如「处理未完成，请查看控制台日志」），或按退出码区分「部分失败」与「真错误」 |
