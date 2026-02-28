const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { removeBackground } = require('@imgly/background-removal-node');

// 导入美化组件
const ora = require('ora');
const chalk = require('chalk');

// 支持的图片扩展名
const SUPPORTED_EXTS = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.gif', '.webp'];

async function getFiles(inputPath) {
    try {
        const stats = fs.statSync(inputPath);
        if (stats.isFile()) {
            return SUPPORTED_EXTS.includes(path.extname(inputPath).toLowerCase()) ? [inputPath] : [];
        } else if (stats.isDirectory()) {
            let results = [];
            const list = fs.readdirSync(inputPath);
            for (const file of list) {
                const fullPath = path.join(inputPath, file);
                results = results.concat(await getFiles(fullPath));
            }
            return results;
        }
        return [];
    } catch (err) {
        console.error(chalk.red(`⚠️ [读取跳过] 无法访问路径: ${inputPath}`));
        return [];
    }
}

async function convertImage(filePath, format, isInteractive, spinnerInstance) {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);

    let outputExt = '';
    let suffix = '';
    let sharpInstance = sharp(filePath);

    switch (format) {
        case 'webp':
            outputExt = '.webp';
            if (ext.toLowerCase() === '.webp') return { status: 'skipped', file: filePath, reason: '已经是该格式' };
            sharpInstance = sharpInstance.webp({ quality: 80, effort: 6 });
            break;
        case 'png':
            outputExt = '.png';
            suffix = '_optimized';
            sharpInstance = sharpInstance.png({ quality: 75, colors: 256, dither: 1.0, effort: 8 });
            break;
        case 'avif':
            outputExt = '.avif';
            if (ext.toLowerCase() === '.avif') return { status: 'skipped', file: filePath, reason: '已经是该格式' };
            sharpInstance = sharpInstance.avif({ quality: 75, effort: 7 });
            break;
        case 'mozjpeg':
            outputExt = '.jpg';
            suffix = '_optimized';
            sharpInstance = sharpInstance.jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:4:4' });
            break;
        case 'rmbg_solid':
            outputExt = ext.toLowerCase() === '.webp' ? '.webp' : '.png';
            suffix = '_nobg';
            // 内存防漏保护变量
            let normalizedBuffer = null;
            let finalBuffer = null;

            try {
                if (spinnerInstance) {
                    spinnerInstance.text = chalk.blue(`[AI 引擎就绪] 正在读取并准备提取: ${name}`);
                    spinnerInstance.render();
                }

                // 细化前置错误捕获（针对格式异常/图片损坏）
                try {
                    normalizedBuffer = await sharp(filePath).png().toBuffer();
                } catch (sharpErr) {
                    throw new Error(`图片文件解析失败 (文件可能已损坏或不支持此处理): ${sharpErr.message}`);
                }

                // 手动构造无类型歧义的强类型 Blob，绕过底层解析 Bug
                const { Blob } = require('buffer');
                const inputBlob = new Blob([normalizedBuffer], { type: 'image/png' });

                const blob = await removeBackground(inputBlob, {
                    output: {
                        type: 'image/png',
                        quality: 0.8
                    },
                    progress: (key, current, total) => {
                        const percent = ((current / total) * 100).toFixed(1);
                        if (spinnerInstance) {
                            spinnerInstance.text = chalk.yellow(`🧠 [AI 处理中] 图像: ${name} | 模型加载与计算: ${percent}%`);
                            spinnerInstance.render();
                        }
                    }
                });

                if (spinnerInstance) {
                    spinnerInstance.text = chalk.green(`✨ [AI 抠图完成] 图像: ${name} 处理成功，正在保存...`);
                    spinnerInstance.render();
                }

                // 性能优化：剔除冗余的 sharp 实例化
                const arrayBuffer = await blob.arrayBuffer();
                const aiResultBuffer = Buffer.from(arrayBuffer);

                let resultSharp = sharp(aiResultBuffer);
                if (outputExt === '.webp') {
                    resultSharp = resultSharp.webp({ lossless: true, effort: 6 });
                } else {
                    resultSharp = resultSharp.png({ effort: 8 });
                }

                finalBuffer = await resultSharp.toBuffer();
                sharpInstance = sharp(finalBuffer);

            } catch (err) {
                return { status: 'error', file: filePath, reason: err.message.includes('图片文件解析失败') ? err.message : `AI 处理异常: ${err.message}` };
            } finally {
                normalizedBuffer = null;
            }
            break;
        default:
            return { status: 'error', file: filePath, reason: '不支持的目标格式' };
    }

    // 自动重命名逻辑：检测文件是否存在，如果存在则添加 (1), (2) 后缀
    let outputPath = path.join(dir, `${name}${suffix}${outputExt}`);
    let counter = 1;
    while (fs.existsSync(outputPath)) {
        outputPath = path.join(dir, `${name}${suffix}(${counter})${outputExt}`);
        counter++;
    }

    try {
        await sharpInstance.toFile(outputPath);
        return { status: 'success', file: filePath };
    } catch (err) {
        return { status: 'error', file: filePath, reason: err.message };
    }
}

function askFormat() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        console.log(`\n${chalk.cyan.bold('🎨 请选择要转换的目标格式')} ${chalk.gray('(输入对应数字并回车)')}:`);
        console.log(chalk.gray('━'.repeat(50)));
        console.log(`  ${chalk.green.bold('1.')} ${chalk.white.bold('WebP')}      ${chalk.gray('=> 极佳的体积和画质平衡，推荐用于网页')}`);
        console.log(`  ${chalk.green.bold('2.')} ${chalk.white.bold('PNG')}       ${chalk.gray('=> 极度压缩版本，最高系统兼容性并保留透明度')}`);
        console.log(`  ${chalk.green.bold('3.')} ${chalk.white.bold('AVIF')}      ${chalk.gray('=> 最硬核顶级压缩率，体积最小，适合现代设备')}`);
        console.log(`  ${chalk.green.bold('4.')} ${chalk.white.bold('MozJPEG')}   ${chalk.gray('=> 最好的 JPG 有损压缩，AI 和旧设备 100% 兼容')}`);
        console.log(`  ${chalk.green.bold('5.')} ${chalk.white.bold('AI 抠图')}   ${chalk.gray('=> 智能分离主体，输出去除背景的极佳透明图片')}`);
        console.log(`  ${chalk.red.bold('0.')} ${chalk.red('取消退出')}  ${chalk.gray('=> 放弃转换并退出程序')}`);
        console.log(chalk.gray('━'.repeat(50)));

        const question = () => {
            rl.question(chalk.yellow('💬 请输入对应数字: '), (answer) => {
                switch (answer.trim()) {
                    case '0':
                        console.log(chalk.red('👋 操作已取消。'));
                        rl.close();
                        process.exit(0);
                        break;
                    case '1':
                        rl.close();
                        resolve('webp');
                        break;
                    case '2':
                        rl.close();
                        resolve('png');
                        break;
                    case '3':
                        rl.close();
                        resolve('avif');
                        break;
                    case '4':
                        rl.close();
                        resolve('mozjpeg');
                        break;
                    case '5':
                        rl.close();
                        resolve('rmbg_solid');
                        break;
                    default:
                        console.log(chalk.red('❌ 无效输入，请重新输入 0-5 之间的数字。'));
                        question();
                        break;
                }
            });
        };
        question();
    });
}

(async () => {
    let args = process.argv.slice(2);
    let isInteractive = false;
    let targetFormat = 'webp'; // 默认格式

    if (args.includes('--interactive')) {
        isInteractive = true;
        args = args.filter(arg => arg !== '--interactive');
    } else {
        const formatIndex = args.indexOf('--format');
        if (formatIndex !== -1 && args[formatIndex + 1]) {
            targetFormat = args[formatIndex + 1];
            args.splice(formatIndex, 2);
        }
    }

    if (args.length === 0) {
        console.log(chalk.yellow('⚠️ 请拖拽图片或包含图片的文件夹到此脚本上运行。'));
        return;
    }

    if (isInteractive) {
        targetFormat = await askFormat();
    }

    console.log(chalk.cyan('\n=================================================='));
    console.log(chalk.yellow('🔍 正在检索系统文件，如果文件较多可能需要一点时间...'));
    console.log(chalk.cyan('==================================================\n'));

    let allFiles = [];
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

    console.log(chalk.white(`📝 合计找到 ${chalk.cyan.bold(allFiles.length)} 个待处理文件，准备转换为 ${chalk.green.bold(targetFormat.toUpperCase())} 格式。\n`));

    let successCount = 0;
    let errorLogs = [];
    let skipCount = 0;

    const batchSize = 5;

    // 初始化顺滑的动画器
    const spinner = ora({
        text: chalk.blue(`🚀 [流水线] 正在提速处理... (0/${allFiles.length})`),
        spinner: 'dots'
    }).start();

    for (let i = 0; i < allFiles.length; i += batchSize) {
        const batch = allFiles.slice(i, i + batchSize);

        // 确保 spinner 在 batch 中的传递
        const results = await Promise.all(batch.map(file => convertImage(file, targetFormat, isInteractive, spinner)));

        for (const res of results) {
            if (res.status === 'success') successCount++;
            else if (res.status === 'error') {
                errorLogs.push(`[${new Date().toLocaleString()}] 文件: ${res.file} | 错误: ${res.reason}`);
            }
            else if (res.status === 'skipped') skipCount++;
        }

        const currentProgress = Math.min(i + batchSize, allFiles.length);
        spinner.text = chalk.blue(`🚀 [流水线] 正在提速处理... (${currentProgress}/${allFiles.length})`);
    }

    spinner.succeed(chalk.green.bold(`✨ 魔法完成！所有图片均已通过极速引擎处理完毕。`));

    console.log(chalk.gray('━'.repeat(50)));
    console.log(`  ${chalk.green('✅ 成功转换:')} ${chalk.green.bold(successCount)} 个`);
    console.log(`  ${chalk.yellow('⏩ 智能跳过:')} ${chalk.yellow.bold(skipCount)} 个 ${chalk.gray('(格式本身符合目标，无需二次渲染)')}`);
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
            console.log(chalk.yellow(`\n⚠️ 注意: 已将 ${errorLogs.length} 条失败情况的原因详细记录至日志: \n🔗 ${logPath}`));
        } catch (err) {
            console.error(chalk.red('\n写入错误日志失败:'), err.message);
        }
    }

})();
