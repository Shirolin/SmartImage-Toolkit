import { promises as fsp } from 'fs';
import chalk from 'chalk';

import { getFiles } from './utils';
import { askFormat, CancelError } from './cli';
import type { AiModel } from './cli';
import { EXIT_CANCEL } from './shared/constants';
import { resolveTask, describeTask, runBatch } from './orchestrator';
import type { TaskInput, BatchSummary } from './orchestrator';

// 第一性原理：入口只做两件事——解析命令行/交互参数并交由协调器执行；
// 顶层不再执行副作用，导出 main(argv) 供测试与复用，进程退出码由 require.main 守卫内的入口统一翻译。

/** main 的纯结果汇总（成功数 / 跳过数 / 失败数）；canceled 为真表示用户主动取消，与「零产出」是两种语义 */
export interface ConvertSummary extends BatchSummary {
    canceled?: boolean;
}

function isAiModel(value: string): value is AiModel {
    return value === 'medium' || value === 'small';
}

function printHelp(): void {
    console.log(chalk.cyan('\n用法: smart-image <图片/目录...> [选项]\n'));
    console.log(chalk.gray('  --interactive     进入交互模式（上下键选择特效方案）'));
    console.log(
        chalk.gray('  --format <格式>   直接指定格式：webp/png/avif/mozjpeg/trim/center/...（pad_aspect 需交互配置）')
    );
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
            if (rawFormat === undefined || rawFormat.startsWith('-')) {
                throw new Error('❌ --format 缺少取值，请传入 webp/png/avif/mozjpeg 等（可用 --help 查看支持列表）。');
            }
            targetFormat = rawFormat;
            args.splice(formatIndex, 2);
        }

        const aiModelIndex = args.indexOf('--ai-model');
        if (aiModelIndex !== -1) {
            const rawModel: string | undefined = args[aiModelIndex + 1];
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

    let taskInput: TaskInput;
    if (isInteractive) {
        try {
            taskInput = await askFormat();
        } catch (err: unknown) {
            if (err instanceof CancelError) {
                console.log(chalk.red('👋 操作已取消。'));
                return { ...idle, canceled: true };
            }
            throw err;
        }
    } else {
        taskInput = {
            format: targetFormat,
            aiModel: aiModelConfig
        };
    }

    // 早解析、早校验任务规格（类型收敛为严格的 ImageTask 标签联合）
    const task = resolveTask(taskInput);

    console.log(chalk.cyan('\n====================================================================================='));
    console.log(chalk.yellow('🔍 正在检索系统文件，如果文件较多可能需要一点时间...'));
    console.log(chalk.cyan('=====================================================================================\n'));

    let allFiles: string[] = [];
    let truncatedCount = 0;
    for (const arg of args) {
        try {
            await fsp.access(arg);
        } catch {
            console.warn(chalk.yellow(`⚠️ 路径不存在或不可访问，已跳过: ${arg}`));
            continue;
        }
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
        throw new Error('❌ 未找到任何受支持的图片文件。');
    }

    console.log(
        chalk.white(`📝 合计找到 ${chalk.cyan.bold(allFiles.length)} 个待处理文件，准备执行 ${describeTask(task)}。`)
    );

    return await runBatch(allFiles, task, { initialSkipCount: truncatedCount });
}

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
            process.exitCode = 1;
        });
}
