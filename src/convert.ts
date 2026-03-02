import fs from 'fs';
import path from 'path';
import ora from 'ora';
import chalk from 'chalk';

import { getFiles } from './utils';
import { askFormat, TargetFormat, AiModel } from './cli';
import { convertImage } from './core';

(async () => {
    let args = process.argv.slice(2);
    let isInteractive = false;
    let targetFormat: TargetFormat | string = 'webp'; // 默认格式
    let aiModelConfig: AiModel = 'medium'; // 默认模型

    if (args.includes('--interactive')) {
        isInteractive = true;
        args = args.filter((arg) => arg !== '--interactive');
    } else {
        const formatIndex = args.indexOf('--format');
        if (formatIndex !== -1 && args[formatIndex + 1]) {
            targetFormat = args[formatIndex + 1];
            args.splice(formatIndex, 2);
        }

        const aiModelIndex = args.indexOf('--ai-model');
        if (aiModelIndex !== -1 && args[aiModelIndex + 1]) {
            aiModelConfig = args[aiModelIndex + 1] as AiModel;
            args.splice(aiModelIndex, 2);
        }
    }

    if (args.length === 0) {
        console.log(chalk.yellow('⚠️ 请拖拽图片或包含图片的文件夹到此脚本上运行。'));
        return;
    }

    if (isInteractive) {
        const resolution = await askFormat();
        targetFormat = resolution.format;
        if (resolution.aiModel) aiModelConfig = resolution.aiModel;
    }

    console.log(chalk.cyan('\n=================================================='));
    console.log(chalk.yellow('🔍 正在检索系统文件，如果文件较多可能需要一点时间...'));
    console.log(chalk.cyan('==================================================\n'));

    let allFiles: string[] = [];
    for (const arg of args) {
        if (fs.existsSync(arg)) {
            const files = await getFiles(arg);
            allFiles = allFiles.concat(files);
        }
    }

    allFiles = [...new Set(allFiles)];

    if (allFiles.length === 0) {
        console.log(chalk.red('❌ 未找到任何受支持的图片文件。'));
        return;
    }

    console.log(
        chalk.white(
            `📝 合计找到 ${chalk.cyan.bold(allFiles.length)} 个待处理文件，准备转换为 ${chalk.green.bold(targetFormat.toUpperCase())} 格式。\n`
        )
    );

    let successCount = 0;
    const errorLogs: string[] = [];
    let skipCount = 0;

    const batchSize = 5;

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

    for (let i = 0; i < allFiles.length; i += batchSize) {
        const batch = allFiles.slice(i, i + batchSize);

        const results = await Promise.all(
            batch.map((file) => convertImage(file, targetFormat as TargetFormat, coreSpinner, aiModelConfig))
        );

        for (const res of results) {
            if (res.status === 'success') successCount++;
            else if (res.status === 'error') {
                errorLogs.push(`[${new Date().toLocaleString()}] 文件: ${res.file} | 错误: ${res.reason}`);
            } else if (res.status === 'skipped') skipCount++;
        }

        const currentProgress = Math.min(i + batchSize, allFiles.length);
        spinner.text = chalk.blue(`🚀 [流水线] 正在提速处理... (${currentProgress}/${allFiles.length})`);
    }

    spinner.succeed(chalk.green.bold(`✨ 魔法完成！所有图片均已通过极速引擎处理完毕。`));

    console.log(chalk.gray('━'.repeat(50)));
    console.log(`  ${chalk.green('✅ 成功转换:')} ${chalk.green.bold(successCount)} 个`);
    console.log(
        `  ${chalk.yellow('⏩ 智能跳过:')} ${chalk.yellow.bold(skipCount)} 个 ${chalk.gray('(格式本身符合目标，无需二次渲染)')}`
    );
    console.log(`  ${chalk.red('❌ 转换失败:')} ${chalk.red.bold(errorLogs.length)} 个`);
    console.log(chalk.gray('━'.repeat(50)));

    if (errorLogs.length > 0) {
        const logDir = path.join(process.cwd(), 'log');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const logPath = path.join(logDir, `error_${dateStr}.log`);
        try {
            fs.appendFileSync(logPath, errorLogs.join('\n') + '\n\n', 'utf8');
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
})();
