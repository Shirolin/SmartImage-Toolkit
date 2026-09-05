# SmartImage-Toolkit 反模式审计报告

日期：2026-09-05；范围：`src/` 全量、`ui/app.js`、`bootstrap.js`、`package.json`、`tsconfig`、`eslint` 配置、`test/`、`scripts/` 入口。
基线：`tsc --noEmit` 通过；`eslint .` 通过（规则已放宽，见 P2-7）；`vitest` 28/28 通过；`git status` 干净（`lib/`、`log/`、`ts_error.log` 均被 ignore，未入库）。

> 结论先行：P0 有真实功能 bug（`mozjpeg` 落盘扩展名与内容不一致、切片幽灵文件、输出命名竞争），P1 有任意文件读与命令拼接面，其余是重复代码与同步 IO 拖慢并发链路。修 P0+P1 即止血。

## P0：功能正确性

### 1. `mozjpeg` 导出生成 `.mozjpeg` 裸文件（内容与扩展名不一致）
- 位置：`src/convert.ts:150,159-162`；`src/split.ts:28,194-200`；`src/resize.ts:110-122`；`src/trim.ts:119-130`；`src/center.ts:112-123`。
- 证据：`convert.ts:150` 用 `` `.${exportFormat}` `` 拼出 `.mozjpeg` 再 `as '.webp'|'.png'|'.jpg'` 强转；`split.ts` 编码分支只认 `.webp/.png/.jpg`，`.mozjpeg` 落空分支直接原样写盘，但文件名仍是 `.mozjpeg`。`resize/trim/center` 同理无 `.mozjpeg` 分支。
- 危害：用户选 MozJPEG 切片/缩放得到系统不识别的 `.mozjpeg` 文件，且未经 jpeg 编码。
- 修复：统一一处 `resolveOutputExt()`：`mozjpeg→.jpg`，删掉所有调用点 `as` 强转；补一个 `mozjpeg` 端到端用例。

### 2. 切片先入账后落盘，单片失败污染整批
- 位置：`src/split.ts:202-210,216`。
- 证据：`generatedFiles.push(outputPath)` 在 `pipeline.toFile()` 之前；`promises` 任一 reject 即 `Promise.all` 全抛，已落盘碎片无清理，调用方 `server.ts:82` / `convert.ts:157` 拿到的文件清单不可信。
- 修复：`toFile` 成功后再 push；失败收集为单片 error 而非整图 error；成功清单与失败清单分开返回。

### 3. 输出命名存在检查与创建竞争（TOCTOU）
- 位置：`src/core.ts:170-173`；`src/resize.ts:127-130`；`src/trim.ts:34-36`；`src/center.ts:31-33`；`src/split.ts:54-58`；放大器 `src/convert.ts:144-185`（batchSize=5 并发）。
- 证据：`while (fs.existsSync(outputPath)) counter++` 后再 `toFile`，两步非原子；同名文件并发进入即覆盖或交错。
- 修复：抽公共 `allocateOutputPath()`，改用 `O_CREAT|O_EXCL` 独占创建或进程内命名锁；至少把重命名收敛到一处。

### 4. 缩放跳过判断别名失效
- 位置：`src/resize.ts:38,56,63,69,84`。
- 证据：`.jpeg` 与 `.jpg` 字符串不等，`.mozjpeg` 永远不等 `ext`，`percent=100 + mozjpeg` 本应转码却可能误判；`.JPG` 大写特判只做了一半。
- 修复：比较前全部归一化（小写 + `jpeg→jpg` + `mozjpeg→jpg`），单函数单测覆盖。

## P1：安全与可用性

### 5. 本地服务任意文件读取
- 位置：`src/server.ts:35-46`。
- 证据：`/api/load-image?path=` 仅 `path.resolve` + `existsSync` 即 `sendFile`，无根目录白名单，任何可猜路径文件可读。
- 修复：限定可读目录（如仅输入图所在目录树），拒绝目录外路径；关闭目录列表；非图片 MIME 直接拒绝。

### 6. 切图接口参数零校验
- 位置：`src/server.ts:48-89`。
- 证据：`cutX/cutY` 只判非空即进 `splitImage`，未校验数字类型、升序、长度≥2、越界；`centerConfig` 直透 `processCenter`。
- 修复：服务端做 zod/手写守卫：长度上限、单调递增、坐标 within 宽高；非法返回 400。

### 7. 命令拼接与 shell 注入面
- 位置：`src/server.ts:121,156`（`exec(string)`）；`bootstrap.js:8-9,25-27`（`shell:true` + 手工加引号）；`src/server.ts:13`（`cors()` 全开）。
- 证据：文件对话框与自动开浏览器均为字符串拼 `exec`；bootstrap 用 `shell:true` 跑用户拖拽路径，引号包裹挡不住 `& | $()` 类元字符。
- 修复：`execFile/powershell -Command` 数组传参，`spawn(cmd,args,{shell:false})`；cors 收紧到 `http://localhost:*`；浏览器打开改 `open` 包或 `execFile`。

### 8. 心跳架空闲置退出，服务实际永不退出
- 位置：`src/server.ts:18,91-97`；`ui/app.js:724-726`。
- 证据：服务端 5 分钟无请求退出，但前端每 60s 固定心跳刷新 `lastActiveTime`，开着页面即永活，与“闲置休眠”注释矛盾。
- 修复：心跳只保活页面状态不刷新退出计时，或改退出条件为“无真实任务 + 无窗口”，二选一写进注释。

## P2：结构与可维护性

### 9. 上帝文件 `cli.ts`（917 行）
- 类型定义、菜单渲染、按键处理、九种格式分支全塞一文件，`askFormat` 内 `while(true)` + `process.exit(0)`（`cli.ts:246-254`），无法单测、无法复用。
- 修复：拆 `config-types.ts` / `prompts.ts` / `resolvers/*.ts`；`cancel` 改抛异常或返回，由 `convert.ts` 决定退出码。

### 10. 入口顶层副作用不可测试
- 位置：`src/convert.ts:23,237`（顶层 IIFE）；`src/cli.ts:146,253`（`process.exit`）。
- 修复：入口只做 `main(argv).catch()`，导出 `main` 供测试注入。

### 11. 五处复制粘贴
- 重命名循环（core/resize/trim/center/split 各一）；`Convert/Resize/Trim/Center/SplitResult` 同构五份；格式编码 switch 五份且参数打架（webp quality 80 vs 90，png 75 vs 80 vs 90，effort 各异）。
- 修复：抽 `results.ts`（一种 `OpResult`）、`output-naming.ts`、`encode.ts`（一处质量表）。

### 12. 异步链路里混同步阻塞 IO（约 15 处）
- `existsSync/mkdirSync/writeFileSync/appendFileSync` 见 `core/resize/trim/center/split/convert:225/bootstrap:14`。5 并发下主线程被 stat/mkdir 串行卡住。
- 修复：换 `fs/promises`；目录创建启动时一次备好；日志走追加流。

### 13. 目录遍历串行 + concat 方差
- 位置：`src/utils.ts:35-38`；表现层耦合 `chalk`（`utils.ts:3,17,26,47`）。
- 证据：`for` 内 `await getFiles` 逐个串行，`results.concat` 每次复制数组，大目录 O(n²)。
- 修复：`readdir(withFileTypes)` + 子任务并行（限并发）+ `push(...子结果)`；`chalk` 移到调用方，工具只返数据。

### 14. 同一文件反复解码
- `trim.ts:48-54`（metadata + 全量 probe 各解码一次）、`center.ts:37-45` 同理；`split.ts:116-118` 在行列双循环内串行 `await sharp(filePath).extract().toBuffer()`，百切片即百次顺序读盘。
- 修复：一次 `metadata` 复用；切片先整图进内存一次再切 buffer；或读→解码→分发流水线化。

### 15. 类型门禁自废
- `eslint.config.mjs:12-14` 关闭 `no-explicit-any/ban-ts-comment`；`core.ts:97,126` 双 `as unknown as WebBlob`；`server.ts:162` `(e:any)`；`trim.ts:44,97` `as` 断言；`convert.ts:150,162` 跨层格式 `as`（已在 P0 兑现为 bug）。
- 修复：逐个打开规则，用守卫函数/判别联合替代断言；`mozjpeg` 处先修类型再修逻辑。

## P3：工程一致性

- `package.json:14`：`build = format && lint && type-check && tsc`，构建含写操作，非幂等，CI 必脏。拆 `build`（只校验+编译）与 `fix`（写操作）。
- `package.json:8`：`start = node lib/convert.js` 实为需拖拽参数的 CLI，`npm start` 裸跑即“未找到图片”退出。改 `start` 指向 UI 或补 `--help` 可用退出码。
- 版本错位：`sharp@0.32` 配 `@types/node@25`，`engines>=20` 无上限；`tsconfig` 仅含 `src`，`test/` 在类型门禁外（`ts_error.log` 历史 3 条即例证，现已修但机制未补）。`include` 加 `test`，锁 `engines` 上限或 CI 矩阵验证。
- 死代码与静默吞错：`center.ts:54-56`、`trim.ts:57-58,85-86` 空 if；`split.ts:188-191`、`server.ts:157-159`、`app.js:201,648` 空 catch；`core.ts:158-160` finally 只清一半 buffer。删空分支，catch 至少记文件名+原因。
- 日志与魔法数：`convert.ts:225` `appendFileSync` 无轮转无锁；阈值 `40（split:157）` vs `10` 各处、`batchSize 5`、`quality/effort` 散落。收敛到 `constants.ts`，日志加按日轮转或体积上限。
- 前后端隐式契约：心跳 60s / 检查 30s / 超时 5min 三处硬编码；`split.ts:105,220-224` svg 字符串拼接无转义。抽共享常量，svg 走转义或 DOM 构造。

## 复现与验证记录

- `npx tsc --noEmit`：通过（`ts_error.log` 为历史残留，当前 `trimConfig.sides` 已补）。
- `npx eslint .`：通过（因上述三条规则关闭，通过≠干净）。
- `npx vitest run`：5 文件 28 用例全过；AI 抠图被 mock，未覆盖真实模型路径（与 `log/error_2026-03-01.log` 的 `publicPath /models/large` 失败对应，属已知外部依赖问题，不计入本次代码反模式）。
- `mozjpeg` bug 可复现：任一 PNG 走切片/`resize` 选 `mozjpeg`，观察落盘 `.mozjpeg` 文件；修复后应为 `.jpg` 且为 jpeg 编码。

## 修复优先级

1. P0 四项（先 `resolveOutputExt` + 切片记账 + 命名锁 + 跳过归一化，补回归单测）。
2. P1 三项（文件读白名单、参数守卫、`execFile`/关 shell）。
3. P2 抽公共模块（`encode/output-naming/results/constants`）+ `cli.ts` 拆分 + `fs/promises` 化。
4. P3 构建语义与轮转日志收尾。
