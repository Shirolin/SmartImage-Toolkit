import path from 'path';
import { promises as fsp } from 'fs';
import ora from 'ora';
import chalk from 'chalk';

import type {
    TargetFormat,
    AiModel,
    SplitConfig,
    ResizeConfig,
    TrimConfig,
    CropConfig,
    CenterConfig,
    PadAspectConfig
} from './config-types';
import { isTargetFormat } from './config-types';
import type { SpinnerLike } from './core';
import { convertImage } from './core';
import { splitImage } from './split';
import { resizeImage } from './resize';
import { processTrim, processCrop } from './trim';
import { processCenter } from './center';
import { processPadAspect } from './pad-aspect';
import { BATCH_SIZE } from './shared/constants';
import { resolveImageExt } from './shared/formats';

/** 统一的图像任务标签联合（只保留严格合法且附带必填配置的不可变对象） */
export type ImageTask =
    | { readonly type: 'convert'; readonly format: 'webp' | 'png' | 'avif' | 'mozjpeg' }
    | { readonly type: 'rmbg_solid'; readonly aiModel: AiModel }
    | { readonly type: 'split'; readonly config: SplitConfig }
    | { readonly type: 'resize'; readonly config: ResizeConfig }
    | { readonly type: 'trim'; readonly config: TrimConfig }
    | { readonly type: 'crop'; readonly config: CropConfig }
    | { readonly type: 'center'; readonly config: CenterConfig }
    | { readonly type: 'pad_aspect'; readonly config: PadAspectConfig };

/** 批处理汇总结果 */
export interface BatchSummary {
    success: number;
    skip: number;
    failed: number;
}

/** 批处理执行参数 */
export interface RunBatchOptions {
    batchSize?: number;
    initialSkipCount?: number;
    logDir?: string;
    silent?: boolean;
}

/** 待解析任务入参（支持交互式或 CLI 传入的松散结构） */
export interface TaskInput {
    format: TargetFormat | string;
    aiModel?: AiModel;
    splitConfig?: SplitConfig;
    resizeConfig?: ResizeConfig;
    trimConfig?: TrimConfig;
    cropConfig?: CropConfig;
    centerConfig?: CenterConfig;
    padAspectConfig?: PadAspectConfig;
}

/** 单文件任务执行结果 */
export type TaskResult =
    | { status: 'success'; file: string; generatedCount?: number; failedTileCount?: number }
    | { status: 'skipped'; file: string; reason?: string }
    | { status: 'error'; file: string; reason?: string };

/**
 * 将松散的任务入参解析并校验为受严格约束的 ImageTask
 * 负责参数合法性早验、缺失报错与默认值注水（Fail Early）
 */
export function resolveTask(input: TaskInput): ImageTask {
    const { format } = input;
    if (!isTargetFormat(format)) {
        throw new Error(`❌ 未知的目标格式: ${format}，可用 --help 查看支持列表。`);
    }

    switch (format) {
        case 'split':
            if (!input.splitConfig) {
                throw new Error(
                    '❌ --format split 需要切割参数：请使用 --interactive（或 run_interactive.bat）选择切割方式。'
                );
            }
            return { type: 'split', config: input.splitConfig };
        case 'resize':
            if (!input.resizeConfig) {
                throw new Error(
                    '❌ --format resize 需要缩放参数：请使用 --interactive（或 run_interactive.bat）选择缩放方式。'
                );
            }
            return { type: 'resize', config: input.resizeConfig };
        case 'crop':
            if (!input.cropConfig) {
                throw new Error(
                    '❌ --format crop 需要裁剪参数：请使用 --interactive（或 run_interactive.bat）指定裁剪区域。'
                );
            }
            return { type: 'crop', config: input.cropConfig };
        case 'pad_aspect':
            if (!input.padAspectConfig) {
                throw new Error(
                    '❌ --format pad_aspect 需要目标比例等参数：请使用 --interactive（或 run_interactive.bat）选择配置。'
                );
            }
            return { type: 'pad_aspect', config: input.padAspectConfig };
        case 'trim':
            return {
                type: 'trim',
                config: input.trimConfig ?? {
                    threshold: 10,
                    sides: ['top', 'bottom', 'left', 'right'],
                    outputFormat: 'original'
                }
            };
        case 'center':
            return {
                type: 'center',
                config: input.centerConfig ?? {
                    threshold: 10,
                    fillColor: 'transparent',
                    outputFormat: 'original'
                }
            };
        case 'rmbg_solid':
            return {
                type: 'rmbg_solid',
                aiModel: input.aiModel ?? 'medium'
            };
        case 'webp':
        case 'png':
        case 'avif':
        case 'mozjpeg':
            return {
                type: 'convert',
                format
            };
    }
}

/**
 * 格式化任务的终端横幅描述
 */
export function describeTask(task: ImageTask): string {
    switch (task.type) {
        case 'split':
            return chalk.cyan.bold(`[智能网格切割] -> ${task.config.exportFormat.toUpperCase()}`);
        case 'resize':
            return chalk.blue.bold(
                `[批量缩放] -> ${task.config.outputFormat === 'original' || !task.config.outputFormat ? '保持原格式' : task.config.outputFormat.toUpperCase()}`
            );
        case 'trim':
            return chalk.yellow.bold('[智能去边(Trim)]');
        case 'crop':
            return chalk.yellow.bold('[手动裁剪(Crop)]');
        case 'center':
            return chalk.magenta.bold('[智能居中(Smart Center)]');
        case 'pad_aspect':
            return chalk.blue.bold(`[画布扩边(Pad Aspect) -> ${task.config.aspect}]`);
        case 'rmbg_solid':
            return chalk.green.bold('[格式转换] -> RMBG_SOLID');
        case 'convert':
            return chalk.green.bold(`[格式转换] -> ${task.format.toUpperCase()}`);
    }
}

function resolveOutExt(outputFormat?: 'original' | 'webp' | 'png' | 'mozjpeg'): '.webp' | '.png' | '.jpg' | null {
    if (!outputFormat || outputFormat === 'original') {
        return null;
    }
    return resolveImageExt(outputFormat, '.jpg');
}

/**
 * 对单张图片执行指定任务
 */
export async function executeTaskOnFile(
    file: string,
    task: ImageTask,
    spinner: SpinnerLike | null = null
): Promise<TaskResult> {
    switch (task.type) {
        case 'split': {
            const ext = resolveImageExt(task.config.exportFormat, '.jpg');
            const splitRes = await splitImage(file, task.config, ext);
            return {
                status: splitRes.status,
                file: splitRes.file,
                reason: splitRes.reason,
                generatedCount: splitRes.generatedFiles.length,
                failedTileCount: splitRes.failedTiles?.length ?? 0
            };
        }
        case 'resize': {
            const ext = resolveOutExt(task.config.outputFormat);
            return await resizeImage(file, task.config, ext);
        }
        case 'trim': {
            const ext = resolveOutExt(task.config.outputFormat);
            return await processTrim(file, task.config, ext);
        }
        case 'crop': {
            const ext = resolveOutExt(task.config.outputFormat);
            return await processCrop(file, task.config, ext);
        }
        case 'center': {
            const ext = resolveOutExt(task.config.outputFormat);
            return await processCenter(file, task.config, ext);
        }
        case 'pad_aspect': {
            const ext = resolveOutExt(task.config.outputFormat);
            return await processPadAspect(file, task.config, ext);
        }
        case 'rmbg_solid': {
            return await convertImage(file, 'rmbg_solid', spinner, task.aiModel);
        }
        case 'convert': {
            return await convertImage(file, task.format, spinner);
        }
    }
}

/**
 * 批处理运行管线：
 * 承载并发窗口滑动、进度指示器动画、单文件错误隔离、错误日志落地与结果汇总
 */
export async function runBatch(files: string[], task: ImageTask, options?: RunBatchOptions): Promise<BatchSummary> {
    const batchSize = options?.batchSize ?? BATCH_SIZE;
    let successCount = 0;
    const errorLogs: string[] = [];
    let skipCount = options?.initialSkipCount ?? 0;
    const silent = options?.silent ?? false;

    const spinner = silent
        ? null
        : ora({
              text: chalk.blue(`🚀 [流水线] 正在提速处理... (0/${files.length})`),
              spinner: 'dots'
          }).start();

    const coreSpinner: SpinnerLike = spinner
        ? {
              get text() {
                  return spinner.text;
              },
              set text(value: string) {
                  spinner.text = value;
              },
              render: () => spinner.render()
          }
        : {
              text: '',
              render: () => {}
          };

    let processingDone = false;
    try {
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);

            const batchTasks = batch.map((file) =>
                executeTaskOnFile(file, task, coreSpinner).catch((err: unknown) => ({
                    status: 'error' as const,
                    file,
                    reason: err instanceof Error ? err.message : '未知错误'
                }))
            );
            const results = await Promise.all(batchTasks);

            for (const res of results) {
                if (res.status === 'success') {
                    if (typeof res.generatedCount === 'number') {
                        successCount += res.generatedCount;
                        const failedTiles = res.failedTileCount ?? 0;
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
                } else if (res.status === 'skipped') {
                    skipCount++;
                }
            }

            const currentProgress = Math.min(i + batchSize, files.length);
            if (spinner) {
                spinner.text = chalk.blue(`🚀 [流水线] 正在提速处理... (${currentProgress}/${files.length})`);
            }
        }

        if (spinner) {
            if (errorLogs.length > 0) {
                spinner.fail(chalk.red.bold(`⚠️ 处理结束: ${errorLogs.length} 个文件失败，详见下方汇总与日志。`));
            } else {
                spinner.succeed(chalk.green.bold('✨ 魔法完成！所有图片均已通过极速引擎处理完毕。'));
            }
        }
        processingDone = true;
    } finally {
        if (!processingDone && spinner) {
            spinner.stop();
        }
    }

    if (!silent) {
        console.log(chalk.gray('━'.repeat(85)));
        console.log(`  ${chalk.green('✅ 成功转换:')} ${chalk.green.bold(successCount)} 个`);
        console.log(
            `  ${chalk.yellow('⏩ 智能跳过:')} ${chalk.yellow.bold(skipCount)} 个 ${chalk.gray('(格式本身符合目标或超出深度限制，未做二次渲染)')}`
        );
        console.log(`  ${chalk.red('❌ 转换失败:')} ${chalk.red.bold(errorLogs.length)} 个`);
        console.log(chalk.gray('━'.repeat(85)));
    }

    if (errorLogs.length > 0) {
        const logDir = options?.logDir ?? path.join(process.cwd(), 'log');
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const logPath = path.join(logDir, `error_${dateStr}.log`);
        try {
            await fsp.mkdir(logDir, { recursive: true });
            await fsp.appendFile(logPath, errorLogs.join('\n') + '\n\n', 'utf8');
            if (!silent) {
                console.log(
                    chalk.yellow(`\n⚠️ 注意: 已将 ${errorLogs.length} 条失败情况的原因详细记录至日志: \n🔗 ${logPath}`)
                );
            }
        } catch (err: unknown) {
            let logErr = '未知日志写入错误';
            if (err instanceof Error) {
                logErr = err.message;
            }
            if (!silent) {
                console.error(chalk.red('\n写入错误日志失败:'), logErr);
            }
        }
    }

    return { success: successCount, skip: skipCount, failed: errorLogs.length };
}
