import path from 'path';
import { promises as fsp } from 'fs';
import ora from 'ora';
import chalk from 'chalk';

import { getFiles } from './utils';
import { askFormat, CancelError } from './cli';
import type { TargetFormat, AiModel, SplitConfig, ResizeConfig, TrimConfig, CropConfig, CenterConfig } from './cli';
import { convertImage } from './core';
import { splitImage } from './split';
import { resizeImage } from './resize';
import { processTrimOrCrop } from './trim';
import { processCenter } from './center';
import { BATCH_SIZE, EXIT_CANCEL } from './shared/constants';
import { resolveImageExt } from './shared/formats';

// 第一性原理：入口只做三件事——解析参数、收集文件、分批调度；
// 顶层不再执行副作用，导出 main(argv) 供测试与复用，进程退出码由 require.main 守卫内的入口统一翻译。

/** main 的纯结果汇总（成功数 / 跳过数 / 失败数）；canceled 为真表示用户主动取消，与「零产出」是两种语义 */
export interface ConvertSummary {
    success: number;
    skip: number;
    failed: number;
    canceled?: boolean;
}

const KNOWN_FORMATS: readonly TargetFormat[] = [
    'webp',
    'png',
    'avif',
    'mozjpeg',
    'rmbg_solid',
    'split',
    'resize',
    'trim',
    'crop',
    'center'
];

function isTargetFormat(value: string): value is TargetFormat {
    return KNOWN_FORMATS.some((f) => f === value);
}

function isAiModel(value: string): value is AiModel {
    return value === 'medium' || value === 'small';
}

function printHelp(): void {
    console.log(chalk.cyan('\n用法: smart-image <图片/目录...> [选项]\n'));
    console.log(chalk.gray('  --interactive     进入交互模式（上下键选择特效方案）'));
    console.log(chalk.gray('  --format <格式>   直接指定格式：webp/png/avif/mozjpeg/trim/center/...'));
    console.log(chalk.gray('  --ai-model <档位> AI 抠图精度：medium（默认）/ small'));
    console.log(chalk.gray('  --help, -h        显示本帮助并退出\n'));
}

export async function main(argv: string[]): Promise<ConvertSummary> {
    const idle: ConvertSummary = { success: 0, skip: 0, failed: 0 };
    const args = [...argv];

    if (args.includes('--help') || args.includes('-h')) {
        printHelp();
        return idle;
    }

    let isInteractive = false;
    let targetFormat: string = 'webp'; // 默认格式
    let aiModelConfig: AiModel = 'medium'; // 默认模型
    let splitConfig: SplitConfig | undefined;
    let resizeConfig: ResizeConfig | undefined;
    let trimConfig: TrimConfig | undefined;
    let cropConfig: CropConfig | undefined;
    let centerConfig: CenterConfig | undefined;

    // 取值校验必须在摘除任何参数**之前**完成：否则 --ai-model --format webp x.png 里
    // --format 会先被摘掉，轮到 --ai-model 时它的下一个 token 变成图片路径并被静默吞掉。
    for (const opt of ['--format', '--ai-model']) {
        const at = args.indexOf(opt);
        const value: string | undefined = at === -1 ? undefined : args[at + 1];
        if (value !== undefined && value.startsWith('-')) {
            throw new Error(
                opt === '--format'
                    ? '❌ --format 缺少取值，请传入 webp/png/avif/mozjpeg 等（可用 --help 查看支持列表）。'
                    : '❌ --ai-model 缺少取值，请传入 medium 或 small。'
            );
        }
    }

    if (args.includes('--interactive')) {
        isInteractive = true;
        for (let i = args.length - 1; i >= 0; i--) {
            if (args[i] === '--interactive') args.splice(i, 1);
        }
    } else {
        const formatIndex = args.indexOf('--format');
        if (formatIndex !== -1) {
            const rawFormat: string | undefined = args[formatIndex + 1];
            // 取值不能本身是选项：否则 --format --ai-model small x.png 会把 '--ai-model' 当格式，
            // 报出误导性的「未知的目标格式」，真正原因是 --format 缺取值
            if (rawFormat === undefined || rawFormat.startsWith('-')) {
                throw new Error('❌ --format 缺少取值，请传入 webp/png/avif/mozjpeg 等（可用 --help 查看支持列表）。');
            }
            targetFormat = rawFormat;
            args.splice(formatIndex, 2);

            if (targetFormat === 'trim') {
                trimConfig = {
                    threshold: 10,
                    sides: ['top', 'bottom', 'left', 'right'],
                    outputFormat: 'original'
                };
            }
            if (targetFormat === 'center') {
                centerConfig = {
                    threshold: 10,
                    fillColor: 'transparent',
                    outputFormat: 'original'
                };
            }
        }

        const aiModelIndex = args.indexOf('--ai-model');
        if (aiModelIndex !== -1) {
            const rawModel: string | undefined = args[aiModelIndex + 1];
            // 同上：否则 --ai-model --format webp x.png 会把图片路径当模型档位吞掉，
            // 图片被静默忽略、退出码 0，调用方却以为转换成功
            if (rawModel === undefined || rawModel.startsWith('-')) {
                throw new Error('❌ --ai-model 缺少取值，请传入 medium 或 small。');
            }
            if (isAiModel(rawModel)) {
                aiModelConfig = rawModel;
            } else {
                console.log(
                    chalk.yellow(`⚠️ 未知的 AI 模型: ${rawModel}，已回落为 medium（可用 --help 查看支持档位）。`)
                );
            }
            args.splice(aiModelIndex, 2);
        }
    }

    // 剩余 token 只应是路径：拼错的选项不能被当成文件名静默忽略，
    // 否则会按默认格式产出用户没要的结果（--fromat png 曾静默输出 webp）
    for (const arg of args) {
        if (arg.startsWith('-')) {
            throw new Error(`❌ 未知选项: ${arg}（可用 --help 查看支持列表）。`);
        }
    }

    if (args.length === 0) {
        console.log(chalk.yellow('⚠️ 请拖拽图片或包含图片的文件夹到此脚本上运行。'));
        return idle;
    }

    if (isInteractive) {
        try {
            const resolution = await askFormat();
            targetFormat = resolution.format;
            if (resolution.aiModel) aiModelConfig = resolution.aiModel;
            if (resolution.splitConfig) splitConfig = resolution.splitConfig;
            if (resolution.resizeConfig) resizeConfig = resolution.resizeConfig;
            if (resolution.trimConfig) trimConfig = resolution.trimConfig;
            if (resolution.cropConfig) cropConfig = resolution.cropConfig;
            if (resolution.centerConfig) centerConfig = resolution.centerConfig;
        } catch (err: unknown) {
            // 用户取消：与「无参数/零产出」的 idle 不同语义，标记 canceled 由入口翻译成 EXIT_CANCEL，
            // 让 bat/脚本能区分「完成」与「取消」（此前两者都是退出码 0，故会出现「操作已取消」与 Done 同屏）
            if (err instanceof CancelError) {
                console.log(chalk.red('👋 操作已取消。'));
                return { ...idle, canceled: true };
            }
            throw err;
        }
    }

    if (!isTargetFormat(targetFormat)) {
        // 拼写错误必须非常零退出：外层 catch 打印并 exit(1)，脚本调用方可感知失败
        throw new Error(`❌ 未知的目标格式: ${targetFormat}，可用 --help 查看支持列表。`);
    }
    const format: TargetFormat = targetFormat;

    // split/resize/crop 的产出完全由参数决定：非交互模式拿不到配置就无从开工。
    // 在这里早失败并指出替代入口，避免落到 core 的 default 分支、
    // 报出误导性的「不支持的目标格式」让用户以为是格式本身不受支持。
    if (format === 'split' && !splitConfig) {
        throw new Error('❌ --format split 需要切割参数：请使用 --interactive（或 run_interactive.bat）选择切割方式。');
    }
    if (format === 'resize' && !resizeConfig) {
        throw new Error(
            '❌ --format resize 需要缩放参数：请使用 --interactive（或 run_interactive.bat）选择缩放方式。'
        );
    }
    if (format === 'crop' && !cropConfig) {
        throw new Error('❌ --format crop 需要裁剪参数：请使用 --interactive（或 run_interactive.bat）指定裁剪区域。');
    }

    console.log(chalk.cyan('\n====================================================================================='));
    console.log(chalk.yellow('🔍 正在检索系统文件，如果文件较多可能需要一点时间...'));
    console.log(chalk.cyan('=====================================================================================\n'));
    let allFiles: string[] = [];
    // 被深度限制截断的文件数：utils 只报一次数字，这里累计后计入 skip 汇总，
    // 否则整层未处理的产出缺口会被「成功 0 / 失败 0 / 退出码 0」掩盖
    let truncatedCount = 0;
    for (const arg of args) {
        try {
            await fsp.access(arg);
        } catch {
            // 静默跳过会让用户误以为文件被处理了：至少告诉他哪个路径没进去
            console.warn(chalk.yellow(`⚠️ 路径不存在或不可访问，已跳过: ${arg}`));
            continue;
        }
        // 着色只在本层做：utils 只返数据，警告经回调在此统一渲染
        const files = await getFiles(arg, 10, 0, (warn) => {
            if (warn.kind === 'error') {
                console.error(chalk.red(`⚠️ [读取跳过] 无法访问路径: ${warn.path} | 错误信息: ${warn.message}`));
            } else if (warn.kind === 'symlink') {
                console.warn(chalk.yellow(`⚠️ [链接跳过] 检测到软链接，为防止死循环已跳过: ${warn.path}`));
            } else {
                if (typeof warn.skippedFiles === 'number') truncatedCount += warn.skippedFiles;
                console.warn(chalk.yellow(`⚠️ [深度限制] ${warn.message}: ${warn.path}`));
            }
        });
        allFiles.push(...files);
    }

    allFiles = [...new Set(allFiles)];

    if (allFiles.length === 0) {
        // 给了路径却一个可处理的文件都没有：这是零产出的失败。
        // 走异常而非返回值，既不改 ConvertSummary 的既有形状，又能让退出码如实反映失败。
        throw new Error('❌ 未找到任何受支持的图片文件。');
    }

    console.log(
        chalk.white(
            `📝 合计找到 ${chalk.cyan.bold(allFiles.length)} 个待处理文件，准备执行 ${
                format === 'split'
                    ? chalk.cyan.bold(`[智能网格切割] -> ${splitConfig?.exportFormat.toUpperCase()}`)
                    : format === 'resize'
                      ? chalk.blue.bold(
                            `[批量缩放] -> ${resizeConfig?.outputFormat === 'original' ? '保持原格式' : resizeConfig?.outputFormat?.toUpperCase()}`
                        )
                      : format === 'trim'
                        ? chalk.yellow.bold(`[智能去边(Trim)]`)
                        : format === 'crop'
                          ? chalk.yellow.bold(`[手动裁剪(Crop)]`)
                          : format === 'center'
                            ? chalk.magenta.bold(`[智能居中(Smart Center)]`)
                            : chalk.green.bold(`[格式转换] -> ${format.toUpperCase()}`)
            }。`
        )
    );

    let successCount = 0;
    const errorLogs: string[] = [];
    let skipCount = 0;

    // 并发批大小收敛自共享常量（与服务端同源，改一处即全局生效）
    const batchSize = BATCH_SIZE;

    // 初始化顺滑的动画器
    const spinner = ora({
        text: chalk.blue(`🚀 [流水线] 正在提速处理... (0/${allFiles.length})`),
        spinner: 'dots'
    }).start();

    // 根据 ora 的实例创建符合我们核心库定义的 SpinnerLike 接口
    const coreSpinner = {
        get text() {
            return spinner.text;
        },
        set text(value: string) {
            spinner.text = value;
        },
        render: () => spinner.render()
    };

    let processingDone = false;
    try {
        for (let i = 0; i < allFiles.length; i += batchSize) {
            const batch = allFiles.slice(i, i + batchSize);

            // 单文件兜底：引擎内外任何抛异常（非 error 结果，如占位分配失败）都只记
            // error，不 reject 本批、不中断后续批次
            const fileTasks = batch.map(async (file) => {
                if (format === 'split' && splitConfig) {
                    // mozjpeg 在共享层统一归一为 .jpg：重载返回窄类型，无需拼接与强转
                    const ext = resolveImageExt(splitConfig.exportFormat, '.jpg');
                    const splitRes = await splitImage(file, splitConfig, ext);
                    return {
                        status: splitRes.status,
                        file: splitRes.file,
                        reason: splitRes.reason,
                        generatedCount: splitRes.generatedFiles.length,
                        // 切片的部分失败也要带上来：否则少写的那几片既无提示也不进退出码
                        failedTileCount: splitRes.failedTiles?.length ?? 0
                    };
                } else if (format === 'resize' && resizeConfig) {
                    const resizeOut = resizeConfig.outputFormat;
                    const resizeExt =
                        resizeOut === undefined || resizeOut === 'original' ? null : resolveImageExt(resizeOut, '.jpg');
                    const resizeRes = await resizeImage(file, resizeConfig, resizeExt);
                    return {
                        status: resizeRes.status,
                        file: resizeRes.file,
                        reason: resizeRes.reason
                    };
                } else if (format === 'trim' && trimConfig) {
                    const trimOut = trimConfig.outputFormat;
                    const trimExt =
                        trimOut === undefined || trimOut === 'original' ? null : resolveImageExt(trimOut, '.jpg');
                    const trimRes = await processTrimOrCrop(file, 'trim', trimConfig, trimExt);
                    return trimRes;
                } else if (format === 'crop' && cropConfig) {
                    const cropOut = cropConfig.outputFormat;
                    const cropExt =
                        cropOut === undefined || cropOut === 'original' ? null : resolveImageExt(cropOut, '.jpg');
                    const cropRes = await processTrimOrCrop(file, 'crop', cropConfig, cropExt);
                    return cropRes;
                } else if (format === 'center' && centerConfig) {
                    const centerOut = centerConfig.outputFormat;
                    const centerExt =
                        centerOut === undefined || centerOut === 'original' ? null : resolveImageExt(centerOut, '.jpg');
                    const centerRes = await processCenter(file, centerConfig, centerExt);
                    return centerRes;
                } else {
                    return await convertImage(file, format, coreSpinner, aiModelConfig);
                }
            });
            const results = await Promise.all(
                fileTasks.map((task, index) =>
                    task.catch((err: unknown) => ({
                        status: 'error' as const,
                        file: batch[index],
                        reason: err instanceof Error ? err.message : '未知错误'
                    }))
                )
            );

            for (const res of results) {
                if (res.status === 'success') {
                    if ('generatedCount' in res && typeof res.generatedCount === 'number') {
                        successCount += res.generatedCount; // 切片模式下增加的是碎片总数
                        // 部分分片失败不能吞：进汇总、进日志、进退出码，用户才知道切图不完整
                        const failedTiles =
                            'failedTileCount' in res && typeof res.failedTileCount === 'number'
                                ? res.failedTileCount
                                : 0;
                        if (failedTiles > 0) {
                            errorLogs.push(
                                `[${new Date().toLocaleString()}] 文件: ${res.file} | 错误: ${failedTiles} 张切片未写出`
                            );
                        }
                    } else {
                        successCount++;
                    }
                } else if (res.status === 'error') {
                    errorLogs.push(`[${new Date().toLocaleString()}] 文件: ${res.file} | 错误: ${res.reason}`);
                } else if (res.status === 'skipped') skipCount++;
            }

            const currentProgress = Math.min(i + batchSize, allFiles.length);
            spinner.text = chalk.blue(`🚀 [流水线] 正在提速处理... (${currentProgress}/${allFiles.length})`);
        }

        // 结束语必须与结果一致：整批失败时还喊「魔法完成」，脚本与用户都会误判成功
        if (errorLogs.length > 0) {
            spinner.fail(chalk.red.bold(`⚠️ 处理结束: ${errorLogs.length} 个文件失败，详见下方汇总与日志。`));
        } else {
            spinner.succeed(chalk.green.bold(`✨ 魔法完成！所有图片均已通过极速引擎处理完毕。`));
        }
        processingDone = true;
    } finally {
        // 批处理抛未捕获异常时仍停转，避免终端 spinner 残留
        if (!processingDone) spinner.stop();
    }

    // 深度截断的文件并入 skip：它们确实存在于输入中、只是未参与处理，汇总必须如实反映
    skipCount += truncatedCount;

    console.log(chalk.gray('━'.repeat(85)));
    console.log(`  ${chalk.green('✅ 成功转换:')} ${chalk.green.bold(successCount)} 个`);
    console.log(
        `  ${chalk.yellow('⏩ 智能跳过:')} ${chalk.yellow.bold(skipCount)} 个 ${chalk.gray('(格式本身符合目标或超出深度限制，未做二次渲染)')}`
    );
    console.log(`  ${chalk.red('❌ 转换失败:')} ${chalk.red.bold(errorLogs.length)} 个`);
    console.log(chalk.gray('━'.repeat(85)));

    if (errorLogs.length > 0) {
        const logDir = path.join(process.cwd(), 'log');
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const logPath = path.join(logDir, `error_${dateStr}.log`);
        try {
            // mkdir 入 try：只读目录等场景下只降级为一条写入失败提示，不丢汇总
            await fsp.mkdir(logDir, { recursive: true });
            await fsp.appendFile(logPath, errorLogs.join('\n') + '\n\n', 'utf8');
            console.log(
                chalk.yellow(`\n⚠️ 注意: 已将 ${errorLogs.length} 条失败情况的原因详细记录至日志: \n🔗 ${logPath}`)
            );
        } catch (err: unknown) {
            let logErr = '未知日志写入错误';
            if (err instanceof Error) {
                logErr = err.message;
            }
            console.error(chalk.red('\n写入错误日志失败:'), logErr);
        }
    }

    return { success: successCount, skip: skipCount, failed: errorLogs.length };
}

// 顶层只做两件事：跑 main；把汇总翻译成退出码（用户取消 EXIT_CANCEL / 有失败项 1）。
// require.main 守卫与 server.ts 既有约定一致：被单测或其它模块 import 时不执行 CLI，
// 也不把退出码写进宿主进程（vitest import 不再污染输出、不再以退出码 1 终止）。
if (require.main === module) {
    main(process.argv.slice(2))
        .then((summary) => {
            if (summary.canceled) {
                process.exitCode = EXIT_CANCEL;
            } else if (summary.failed > 0) {
                process.exitCode = 1;
            }
        })
        .catch((err: unknown) => {
            console.error(err instanceof Error ? err.message : err);
            // 收敛为 exitCode：import 该模块的宿主进程不应被强制终止
            process.exitCode = 1;
        });
}
