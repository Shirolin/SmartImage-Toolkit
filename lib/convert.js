"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ora_1 = __importDefault(require("ora"));
const chalk_1 = __importDefault(require("chalk"));
const utils_1 = require("./utils");
const cli_1 = require("./cli");
const core_1 = require("./core");
const split_1 = require("./split");
const resize_1 = require("./resize");
(async () => {
    let args = process.argv.slice(2);
    let isInteractive = false;
    let targetFormat = 'webp'; // 默认格式
    let aiModelConfig = 'medium'; // 默认模型
    let splitConfig;
    let resizeConfig;
    if (args.includes('--interactive')) {
        isInteractive = true;
        args = args.filter((arg) => arg !== '--interactive');
    }
    else {
        const formatIndex = args.indexOf('--format');
        if (formatIndex !== -1 && args[formatIndex + 1]) {
            targetFormat = args[formatIndex + 1];
            args.splice(formatIndex, 2);
        }
        const aiModelIndex = args.indexOf('--ai-model');
        if (aiModelIndex !== -1 && args[aiModelIndex + 1]) {
            aiModelConfig = args[aiModelIndex + 1];
            args.splice(aiModelIndex, 2);
        }
    }
    if (args.length === 0) {
        console.log(chalk_1.default.yellow('⚠️ 请拖拽图片或包含图片的文件夹到此脚本上运行。'));
        return;
    }
    if (isInteractive) {
        const resolution = await (0, cli_1.askFormat)();
        targetFormat = resolution.format;
        if (resolution.aiModel)
            aiModelConfig = resolution.aiModel;
        if (resolution.splitConfig)
            splitConfig = resolution.splitConfig;
        if (resolution.resizeConfig)
            resizeConfig = resolution.resizeConfig;
    }
    console.log(chalk_1.default.cyan('\n====================================================================================='));
    console.log(chalk_1.default.yellow('🔍 正在检索系统文件，如果文件较多可能需要一点时间...'));
    console.log(chalk_1.default.cyan('=====================================================================================\n'));
    let allFiles = [];
    for (const arg of args) {
        if (fs_1.default.existsSync(arg)) {
            const files = await (0, utils_1.getFiles)(arg);
            allFiles = allFiles.concat(files);
        }
    }
    allFiles = [...new Set(allFiles)];
    if (allFiles.length === 0) {
        console.log(chalk_1.default.red('❌ 未找到任何受支持的图片文件。'));
        return;
    }
    console.log(chalk_1.default.white(`📝 合计找到 ${chalk_1.default.cyan.bold(allFiles.length)} 个待处理文件，准备执行 ${targetFormat === 'split'
        ? chalk_1.default.cyan.bold(`[智能网格切割] -> ${splitConfig?.exportFormat.toUpperCase()}`)
        : targetFormat === 'resize'
            ? chalk_1.default.blue.bold(`[批量缩放] -> ${resizeConfig?.outputFormat === 'original' ? '保持原格式' : resizeConfig?.outputFormat?.toUpperCase()}`)
            : chalk_1.default.green.bold(`[格式转换] -> ${targetFormat.toUpperCase()}`)}。`));
    let successCount = 0;
    const errorLogs = [];
    let skipCount = 0;
    const batchSize = 5;
    // 初始化顺滑的动画器
    const spinner = (0, ora_1.default)({
        text: chalk_1.default.blue(`🚀 [流水线] 正在提速处理... (0/${allFiles.length})`),
        spinner: 'dots'
    }).start();
    // 根据 ora 的实例创建符合我们核心库定义的 SpinnerLike 接口
    const coreSpinner = {
        get text() {
            return spinner.text;
        },
        set text(value) {
            spinner.text = value;
        },
        render: () => spinner.render()
    };
    for (let i = 0; i < allFiles.length; i += batchSize) {
        const batch = allFiles.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(async (file) => {
            if (targetFormat === 'split' && splitConfig) {
                const ext = `.${splitConfig.exportFormat}`;
                const splitRes = await (0, split_1.splitImage)(file, splitConfig, ext);
                return {
                    status: splitRes.status,
                    file: splitRes.file,
                    reason: splitRes.reason,
                    generatedCount: splitRes.generatedFiles.length
                };
            }
            else if (targetFormat === 'resize' && resizeConfig) {
                const formatExt = resizeConfig.outputFormat === 'original'
                    ? null
                    : `.${resizeConfig.outputFormat}`;
                const res = await (0, resize_1.resizeImage)(file, resizeConfig, formatExt);
                return {
                    status: res.status,
                    file: res.file,
                    reason: res.reason
                };
            }
            else {
                return await (0, core_1.convertImage)(file, targetFormat, coreSpinner, aiModelConfig);
            }
        }));
        for (const res of results) {
            if (res.status === 'success') {
                if ('generatedCount' in res && typeof res.generatedCount === 'number') {
                    successCount += res.generatedCount; // 切片模式下增加的是碎片总数
                }
                else {
                    successCount++;
                }
            }
            else if (res.status === 'error') {
                errorLogs.push(`[${new Date().toLocaleString()}] 文件: ${res.file} | 错误: ${res.reason}`);
            }
            else if (res.status === 'skipped')
                skipCount++;
        }
        const currentProgress = Math.min(i + batchSize, allFiles.length);
        spinner.text = chalk_1.default.blue(`🚀 [流水线] 正在提速处理... (${currentProgress}/${allFiles.length})`);
    }
    spinner.succeed(chalk_1.default.green.bold(`✨ 魔法完成！所有图片均已通过极速引擎处理完毕。`));
    console.log(chalk_1.default.gray('━'.repeat(85)));
    console.log(`  ${chalk_1.default.green('✅ 成功转换:')} ${chalk_1.default.green.bold(successCount)} 个`);
    console.log(`  ${chalk_1.default.yellow('⏩ 智能跳过:')} ${chalk_1.default.yellow.bold(skipCount)} 个 ${chalk_1.default.gray('(格式本身符合目标，无需二次渲染)')}`);
    console.log(`  ${chalk_1.default.red('❌ 转换失败:')} ${chalk_1.default.red.bold(errorLogs.length)} 个`);
    console.log(chalk_1.default.gray('━'.repeat(85)));
    if (errorLogs.length > 0) {
        const logDir = path_1.default.join(process.cwd(), 'log');
        if (!fs_1.default.existsSync(logDir)) {
            fs_1.default.mkdirSync(logDir, { recursive: true });
        }
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const logPath = path_1.default.join(logDir, `error_${dateStr}.log`);
        try {
            fs_1.default.appendFileSync(logPath, errorLogs.join('\n') + '\n\n', 'utf8');
            console.log(chalk_1.default.yellow(`\n⚠️ 注意: 已将 ${errorLogs.length} 条失败情况的原因详细记录至日志: \n🔗 ${logPath}`));
        }
        catch (err) {
            let logErr = '未知日志写入错误';
            if (err instanceof Error) {
                logErr = err.message;
            }
            console.error(chalk_1.default.red('\n写入错误日志失败:'), logErr);
        }
    }
})();
