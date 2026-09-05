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
import { BATCH_SIZE } from './shared/constants';
import { resolveImageExt } from './shared/formats';

// 第一性原理：入口只做三件事——解析参数、收集文件、分批调度；
// 顶层不再执行副作用，导出 main(argv) 供测试与复用，进程退出码由最外层 catch 唯一决定。

/** main 的纯结果汇总（成功数 / 跳过数 / 失败数） */
export interface ConvertSummary {
    success: number;
    skip: number;
    failed: number;
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

    if (args.includes('--interactive')) {
        isInteractive = true;
        for (let i = args.length - 1; i >= 0; i--) {
            if (args[i] === '--interactive') args.splice(i, 1);
        }
    } else {
        const formatIndex = args.indexOf('--format');
        if (formatIndex !== -1) {
            const rawFormat: string | undefined = args[formatIndex + 1];
            if (rawFormat === undefined) {
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
            if (rawModel === undefined) {
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
            // 用户取消：友好提示后按“零产出”正常返回，退出码由外层保持为 0
            if (err instanceof CancelError) {
                console.log(chalk.red('👋 操作已取消。'));
                return idle;
            }
            throw err;
        }
    }

    if (!isTargetFormat(targetFormat)) {
        // 拼写错误必须非常零退出：外层 catch 打印并 exit(1)，脚本调用方可感知失败
        throw new Error(`❌ 未知的目标格式: ${targetFormat}，可用 --help 查看支持列表。`);
    }
    const format: TargetFormat = targetFormat;

    console.log(chalk.cyan('\n====================================================================================='));
    console.log(chalk.yellow('🔍 正在检索系统文件，如果文件较多可能需要一点时间...'));
    console.log(chalk.cyan('=====================================================================================\n'));
    let allFiles: string[] = [];
    for (const arg of args) {
        try {
            await fsp.access(arg);
        } catch {
            continue;
        }
        // 着色只在本层做：utils 只返数据，警告经回调在此统一渲染
        const files = await getFiles(arg, 10, 0, (warn) => {
            if (warn.kind === 'error') {
                console.error(chalk.red(`⚠️ [读取跳过] 无法访问路径: ${warn.path} | 错误信息: ${warn.message}`));
            } else if (warn.kind === 'symlink') {
                console.warn(chalk.yellow(`⚠️ [链接跳过] 检测到软链接，为防止死循环已跳过: ${warn.path}`));
            } else {
                console.warn(chalk.yellow(`⚠️ [深度限制] ${warn.message}: ${warn.path}`));
            }
        });
        allFiles.push(...files);
    }

    allFiles = [...new Set(allFiles)];

    if (allFiles.length === 0) {
        console.log(chalk.red('❌ 未找到任何受支持的图片文件。'));
        return idle;
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
                        generatedCount: splitRes.generatedFiles.length
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

        spinner.succeed(chalk.green.bold(`✨ 魔法完成！所有图片均已通过极速引擎处理完毕。`));
        processingDone = true;
    } finally {
        // 批处理抛未捕获异常时仍停转，避免终端 spinner 残留
        if (!processingDone) spinner.stop();
    }

    console.log(chalk.gray('━'.repeat(85)));
    console.log(`  ${chalk.green('✅ 成功转换:')} ${chalk.green.bold(successCount)} 个`);
    console.log(
        `  ${chalk.yellow('⏩ 智能跳过:')} ${chalk.yellow.bold(skipCount)} 个 ${chalk.gray('(格式本身符合目标，无需二次渲染)')}`
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

// 顶层只做一件事：跑 main，异常决定进程退出码（本 catch 为全仓唯一允许的退出点）
main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
