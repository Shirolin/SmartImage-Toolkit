import readline from 'readline';
import chalk from 'chalk';

export type TargetFormat = 'webp' | 'png' | 'avif' | 'mozjpeg' | 'rmbg_solid' | 'split' | 'resize';
export type AiModel = 'medium' | 'small';

export interface SplitConfig {
    rows: number;
    cols: number;
    exportFormat: 'webp' | 'png' | 'mozjpeg'; // 切片导出格式
    centerMode?: 'none' | 'keep_ratio' | 'square'; // 居中裁剪策略
    edgeShave?: number; // 边缘向内削减像素数
    debugGrid?: boolean; // 是否额外输出带红蓝指示线的可视化排查切分基准图
}

export interface ResizeConfig {
    mode: 'by_width' | 'by_height' | 'by_percent' | 'custom';
    width?: number;
    height?: number;
    percent?: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside';
    outputFormat?: 'original' | 'webp' | 'png' | 'mozjpeg';
}

export interface InteractiveResolution {
    format: TargetFormat;
    aiModel?: AiModel;
    splitConfig?: SplitConfig; // 针对切片操作附加参数
    resizeConfig?: ResizeConfig; // 针对缩放操作附加参数
}

interface Choice<T> {
    title: string;
    description: string;
    value: T;
    key: string;
    titleColor: (text: string) => string;
}

function renderHeader(breadcrumb: string) {
    console.clear();
    console.log(chalk.gray('====================================================================================='));
    console.log(chalk.bold.white('   🎨 SmartImage-Toolkit (交互模式版)'));
    console.log(chalk.gray('=====================================================================================\n'));
    console.log(`${chalk.gray('📍 当前位置:')} ${chalk.cyan(breadcrumb)}\n`);
}

async function customSelect<T>(message: string, choices: Choice<T>[]): Promise<T> {
    return new Promise((resolve) => {
        let selectedIndex = 0;
        let renderedLines = 0;

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true
        });

        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }

        const render = () => {
            if (renderedLines > 0) {
                process.stdout.write('\x1B[' + renderedLines + 'A');
                process.stdout.write('\x1B[J');
            }

            let output = `${message}\n`;
            let lines = message.split('\n').length;

            choices.forEach((choice, index) => {
                if (choice.key === '0') {
                    output += chalk.gray('  ' + '━'.repeat(50)) + '\n';
                    lines++;
                }

                const prefix = index === selectedIndex ? '❯ ' : '  ';
                const keyStr = `${choice.key}. `;

                let lineStr = '';
                if (index === selectedIndex) {
                    // 选中时，整行反色发光高亮 (形成背景色包裹文字的效果)
                    const content = ` ${prefix}${keyStr}${choice.title}  ${choice.description} `;
                    lineStr = chalk.bgCyan.black.bold(content);
                } else {
                    // 未选中时，保留高对比度设计色彩
                    lineStr = `  ${prefix}${keyStr}${choice.titleColor(choice.title)}  ${chalk.gray(choice.description)}`;
                }

                output += lineStr + '\n';
                lines++;
            });

            process.stdout.write(output);
            renderedLines = lines;
        };

        const onKeypress = (str: string, key: readline.Key) => {
            if (key && key.name === 'up') {
                selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
                render();
            } else if (key && key.name === 'down') {
                selectedIndex = (selectedIndex + 1) % choices.length;
                render();
            } else if (key && (key.name === 'return' || key.name === 'enter')) {
                cleanup();
                resolve(choices[selectedIndex].value);
            } else if (key && key.ctrl && key.name === 'c') {
                cleanup();
                process.exit(0);
            } else if (str) {
                const choice = choices.find((c) => c.key === str.trim());
                if (choice) {
                    cleanup();
                    resolve(choice.value);
                }
            }
        };

        const cleanup = () => {
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
            }
            process.stdin.removeListener('keypress', onKeypress);
            rl.close();
            console.log(); // 换行留白，防止下一项覆盖
        };

        process.stdin.on('keypress', onKeypress);
        render(); // 首次渲染
    });
}

export async function askFormat(): Promise<InteractiveResolution> {
    const message = `\n${chalk.cyan.bold('🎨 上下键浏览，数字键直达，回车确认')}:\n${chalk.gray('  ? 特效方案:')}`;

    const formatChoices: Choice<TargetFormat | 'cancel'>[] = [
        {
            key: '1',
            title: 'WebP',
            description: '体积与画质平衡，推荐',
            value: 'webp',
            titleColor: chalk.green.bold
        },
        {
            key: '2',
            title: 'PNG',
            description: '无损压缩，保留透明度',
            value: 'png',
            titleColor: chalk.green.bold
        },
        {
            key: '3',
            title: 'AVIF',
            description: '顶级压缩率，适合现代设备',
            value: 'avif',
            titleColor: chalk.green.bold
        },
        {
            key: '4',
            title: 'MozJPEG',
            description: 'JPG 有损压缩，兼容性最高',
            value: 'mozjpeg',
            titleColor: chalk.green.bold
        },
        {
            key: '5',
            title: 'AI 抠图',
            description: '智能去除背景，输出透明图',
            value: 'rmbg_solid',
            titleColor: chalk.magenta.bold
        },
        {
            key: '6',
            title: '图像切片',
            description: '表情包/雪碧图按网格切分',
            value: 'split',
            titleColor: chalk.cyan.bold
        },
        {
            key: '7',
            title: '批量缩放',
            description: '按比例或像素批量调整大小',
            value: 'resize',
            titleColor: chalk.blue.bold
        },
        {
            key: '0',
            title: '取消退出',
            description: '退出程序',
            value: 'cancel',
            titleColor: chalk.red.bold
        }
    ];

    while (true) {
        renderHeader('主界面');
        const selectedFormat = await customSelect(message, formatChoices);

        if (selectedFormat === 'cancel') {
            console.clear();
            console.log(chalk.red('👋 操作已取消。'));
            process.exit(0);
        }

        if (selectedFormat === 'rmbg_solid') {
            renderHeader('主界面 > AI 抠图');
            const aiMessage = `${chalk.magenta.bold('🧠 选择 AI 抠图精细度')}:\n${chalk.gray('  ? 运行级别:')}`;
            const aiChoices: Choice<AiModel | 'back'>[] = [
                {
                    key: '1',
                    title: '均衡模式 (Medium)',
                    description: '适合复杂边缘和人像',
                    value: 'medium',
                    titleColor: chalk.white.bold
                },
                {
                    key: '2',
                    title: '极速模式 (Small)',
                    description: '速度快，适合大批量',
                    value: 'small',
                    titleColor: chalk.white.bold
                },
                {
                    key: '0',
                    title: '返回上一级',
                    description: '重新选择特效方案',
                    value: 'back',
                    titleColor: chalk.gray
                }
            ];
            const aiModel = await customSelect(aiMessage, aiChoices);

            if (aiModel === 'back') continue;

            console.clear();
            return { format: 'rmbg_solid', aiModel: aiModel as AiModel };
        }

        if (selectedFormat === 'split') {
            renderHeader('主界面 > 图像切片 (1/4) - 阵列范围');
            console.log(
                chalk.cyan.bold(
                    '✂️ 请依次输入切片的【列数(X轴)】与【行数(Y轴)】 (若要返回上级菜单，请输入 0 并回车):\n'
                )
            );

            const colStr = await askQuestion(
                chalk.cyan('  ? 【列数】: 横向有几列表情？(也就是 X 轴，直接回车默认 4): ')
            );
            if (colStr.trim() === '0') continue;
            const cols = parseInt(colStr, 10) || 4;

            const rowStr = await askQuestion(
                chalk.cyan('  ? 【行数】: 纵向有几排表情？(也就是 Y 轴，直接回车默认 4): ')
            );
            if (rowStr.trim() === '0') continue;
            const rows = parseInt(rowStr, 10) || 4;

            renderHeader('主界面 > 图像切片 (2/4) - 导出格式');
            console.log(
                chalk.cyan.bold(`✔️ 已确认该图包含: 横向 ${cols} 列 × 纵向 ${rows} 排 (行)，将为您精准切割。\n`)
            );

            const formatMessage = `${chalk.cyan.bold('📦 请选择切片文件的最终导出格式')}:\n${chalk.gray('  ? 导出格式:')}`;
            const formatChoices2: Choice<'webp' | 'png' | 'mozjpeg' | 'back'>[] = [
                { key: '1', title: 'WebP', description: '体积最小', value: 'webp', titleColor: chalk.green.bold },
                { key: '2', title: 'PNG', description: '无损与兼容', value: 'png', titleColor: chalk.green.bold },
                {
                    key: '3',
                    title: 'JPG (MozJPEG)',
                    description: '照片常用',
                    value: 'mozjpeg',
                    titleColor: chalk.green.bold
                },
                {
                    key: '0',
                    title: '返回上一级   ',
                    description: '返回重填切割数值',
                    value: 'back',
                    titleColor: chalk.gray
                }
            ];
            const exportFormat = await customSelect(formatMessage, formatChoices2);

            if (exportFormat === 'back') continue;

            renderHeader('主界面 > 图像切片 (3/4) - 智能居中设定');
            const centerMessage = `${chalk.cyan.bold('🎯 是否对切片进行智能居中？')}:\n${chalk.gray('  ? 居中模式:')}`;
            const centerChoices: Choice<'none' | 'keep_ratio' | 'square' | 'back'>[] = [
                {
                    key: '1',
                    title: '不居中 (原样切除)',
                    description: '保持物理网格原样输出',
                    value: 'none',
                    titleColor: chalk.white
                },
                {
                    key: '2',
                    title: '居中 - 保持原比例',
                    description: '主体居中，保持原宽高',
                    value: 'keep_ratio',
                    titleColor: chalk.green.bold
                },
                {
                    key: '3',
                    title: '居中 - 正方形输出',
                    description: '主体居中，输出为正方形',
                    value: 'square',
                    titleColor: chalk.cyan.bold
                },
                {
                    key: '0',
                    title: '返回上一级',
                    description: '重新选择导出格式',
                    value: 'back',
                    titleColor: chalk.gray
                }
            ];
            const centerMode = await customSelect(centerMessage, centerChoices);

            if (centerMode === 'back') continue;

            let edgeShave = 0;
            if (centerMode !== 'none') {
                renderHeader('主界面 > 图像切片 (4/4) - 边缘去噪保护');
                console.log(chalk.cyan.bold('🔪 是否需要向内收缩切片边缘？\n'));
                const shaveMessage = chalk.gray('? 边缘去噪保护:');
                const shaveChoices: Choice<number>[] = [
                    {
                        key: '1',
                        title: '不收缩 (默认)',
                        description: '图案间隙干净，无残留',
                        value: 0,
                        titleColor: chalk.green.bold
                    },
                    {
                        key: '2',
                        title: '收缩 2 像素',
                        description: '去除极细微的边缘伪影',
                        value: 2,
                        titleColor: chalk.yellow.bold
                    },
                    {
                        key: '3',
                        title: '自定义收缩距离',
                        description: '切到邻居图案时加大此值',
                        value: -1,
                        titleColor: chalk.red.bold
                    }
                ];
                const shaveChoice = await customSelect(shaveMessage, shaveChoices);

                if (shaveChoice === -1) {
                    let validPad = false;
                    while (!validPad) {
                        const padInput = await askQuestion(
                            chalk.cyan.bold('\n🔪 输入收缩像素数 ') + chalk.gray('(1-100，建议 5~20): ')
                        );
                        const padParsed = parseInt(padInput, 10);
                        if (!isNaN(padParsed) && padParsed >= 1 && padParsed <= 100) {
                            edgeShave = padParsed;
                            validPad = true;
                        } else {
                            console.log(chalk.red('❌ 无效的输入。请输入 1-100 之间的整数。'));
                        }
                    }
                } else {
                    edgeShave = shaveChoice;
                }
            }

            let debugGrid = false;
            // 因为生成参照图很有用，所以独立于中心居中作为最后一步提问
            renderHeader(`主界面 > 图像切片 (${centerMode !== 'none' ? '5/5' : '4/4'}) - 辅助诊断模式`);
            console.log(chalk.cyan.bold('🩺 是否额外生成一张切割对齐参考图？\n'));
            const debugMessage = chalk.gray('? 附带生成辅助对齐网格:');
            const debugChoices: Choice<boolean>[] = [
                {
                    key: '1',
                    title: '不需要 (默认)',
                    description: '仅输出切好的图',
                    value: false,
                    titleColor: chalk.white
                },
                {
                    key: '2',
                    title: '生成标尺参考图',
                    description: '排查切割是否对齐',
                    value: true,
                    titleColor: chalk.yellow.bold
                }
            ];
            debugGrid = await customSelect(debugMessage, debugChoices);

            console.clear();
            return {
                format: 'split',
                splitConfig: {
                    rows,
                    cols,
                    exportFormat: exportFormat as 'webp' | 'png' | 'mozjpeg',
                    centerMode: centerMode as 'none' | 'keep_ratio' | 'square',
                    edgeShave,
                    debugGrid
                }
            };
        }

        if (selectedFormat === 'resize') {
            renderHeader('主界面 > 批量缩放 (1/3) - 缩放模式');
            const resizeModeMessage = `${chalk.blue.bold('📏 请选择批量缩放的基准模式')}:\n${chalk.gray('  ? 缩放模式:')}`;
            const resizeModeChoices: Choice<'by_width' | 'by_height' | 'by_percent' | 'custom' | 'back'>[] = [
                {
                    key: '1',
                    title: '按宽度缩放',
                    description: '指定宽度，高度等比自适应',
                    value: 'by_width',
                    titleColor: chalk.cyan.bold
                },
                {
                    key: '2',
                    title: '按高度缩放',
                    description: '指定高度，宽度等比自适应',
                    value: 'by_height',
                    titleColor: chalk.cyan.bold
                },
                {
                    key: '3',
                    title: '按百分比缩放',
                    description: '等比例缩放整体大小',
                    value: 'by_percent',
                    titleColor: chalk.cyan.bold
                },
                {
                    key: '4',
                    title: '自定义宽高',
                    description: '强制指定宽高度 (含多种适配策略)',
                    value: 'custom',
                    titleColor: chalk.magenta.bold
                },
                {
                    key: '0',
                    title: '返回上一级',
                    description: '重新选择特效方案',
                    value: 'back',
                    titleColor: chalk.gray
                }
            ];

            const resizeMode = await customSelect(resizeModeMessage, resizeModeChoices);
            if (resizeMode === 'back') continue;

            const resizeConfig: ResizeConfig = {
                mode: resizeMode as 'by_width' | 'by_height' | 'by_percent' | 'custom'
            };

            renderHeader('主界面 > 批量缩放 (2/3) - 尺寸参数');

            if (resizeMode === 'by_width') {
                while (true) {
                    const ans = await askQuestion(
                        chalk.cyan('  ? 【目标宽度】: 请输入想要缩放到的宽度像素值(例如 800): ')
                    );
                    const val = parseInt(ans, 10);
                    if (!isNaN(val) && val > 0) {
                        resizeConfig.width = val;
                        break;
                    }
                    console.log(chalk.red('❌ 无效的输入。请输入大于 0 的数字。'));
                }
            } else if (resizeMode === 'by_height') {
                while (true) {
                    const ans = await askQuestion(
                        chalk.cyan('  ? 【目标高度】: 请输入想要缩放到的高度像素值(例如 600): ')
                    );
                    const val = parseInt(ans, 10);
                    if (!isNaN(val) && val > 0) {
                        resizeConfig.height = val;
                        break;
                    }
                    console.log(chalk.red('❌ 无效的输入。请输入大于 0 的数字。'));
                }
            } else if (resizeMode === 'by_percent') {
                while (true) {
                    const ans = await askQuestion(
                        chalk.cyan('  ? 【缩放百分比】: 请输入百分比数值 (例如 50 代表缩小到一半, 200 代表放大两倍): ')
                    );
                    const val = parseInt(ans, 10);
                    if (!isNaN(val) && val > 0) {
                        resizeConfig.percent = val;
                        break;
                    }
                    console.log(chalk.red('❌ 无效的输入。请输入大于 0 的数字。'));
                }
            } else if (resizeMode === 'custom') {
                while (true) {
                    const ansW = await askQuestion(chalk.cyan('  ? 【目标宽度】: 请输入宽度像素值: '));
                    const valW = parseInt(ansW, 10);
                    if (!isNaN(valW) && valW > 0) {
                        resizeConfig.width = valW;
                        break;
                    }
                    console.log(chalk.red('❌ 无效的输入。请输入大于 0 的数字。'));
                }
                while (true) {
                    const ansH = await askQuestion(chalk.cyan('  ? 【目标高度】: 请输入高度像素值: '));
                    const valH = parseInt(ansH, 10);
                    if (!isNaN(valH) && valH > 0) {
                        resizeConfig.height = valH;
                        break;
                    }
                    console.log(chalk.red('❌ 无效的输入。请输入大于 0 的数字。'));
                }

                console.log();
                const fitMessage = `${chalk.blue.bold('📏 对于不匹配的宽高比例，请选择适配策略')}:\n${chalk.gray('  ? 适配策略:')}`;
                const fitChoices: Choice<'cover' | 'contain' | 'fill' | 'inside'>[] = [
                    {
                        key: '1',
                        title: 'Cover (默认)',
                        description: '等比缩放并裁剪多余边缘以填满尺寸',
                        value: 'cover',
                        titleColor: chalk.white
                    },
                    {
                        key: '2',
                        title: 'Contain',
                        description: '等比缩放完整保留内容，可能出现透明留白',
                        value: 'contain',
                        titleColor: chalk.white
                    },
                    {
                        key: '3',
                        title: 'Fill',
                        description: '无视比例，强制拉伸或挤压至指定尺寸',
                        value: 'fill',
                        titleColor: chalk.white
                    },
                    {
                        key: '4',
                        title: 'Inside',
                        description: '保留比例但决不超出，类似按最大边缩放',
                        value: 'inside',
                        titleColor: chalk.white
                    }
                ];
                resizeConfig.fit = await customSelect(fitMessage, fitChoices);
            }

            renderHeader('主界面 > 批量缩放 (3/3) - 最终输出格式');
            const formatMessage = `${chalk.blue.bold('📦 请选择缩放后文件的最终导出格式')}:\n${chalk.gray('  ? 导出格式:')}`;
            const formatChoices3: Choice<'original' | 'webp' | 'png' | 'mozjpeg' | 'back'>[] = [
                {
                    key: '1',
                    title: '保持原格式 (默认)',
                    description: '沿用修改前文件的扩展名',
                    value: 'original',
                    titleColor: chalk.white
                },
                { key: '2', title: 'WebP', description: '体积最小', value: 'webp', titleColor: chalk.green.bold },
                { key: '3', title: 'PNG', description: '无损与兼容', value: 'png', titleColor: chalk.green.bold },
                {
                    key: '4',
                    title: 'JPG (MozJPEG)',
                    description: '照片常用',
                    value: 'mozjpeg',
                    titleColor: chalk.green.bold
                },
                {
                    key: '0',
                    title: '返回重新填写参数',
                    description: '返回修改缩放参数',
                    value: 'back',
                    titleColor: chalk.gray
                }
            ];
            const outputFormat = await customSelect(formatMessage, formatChoices3);

            if (outputFormat === 'back') continue;
            resizeConfig.outputFormat = outputFormat as 'original' | 'webp' | 'png' | 'mozjpeg';

            console.clear();
            return {
                format: 'resize',
                resizeConfig
            };
        }

        console.clear();
        return { format: selectedFormat as TargetFormat };
    }
}

// 供简易输入使用的辅助函数
function askQuestion(query: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) =>
        rl.question(query, (ans) => {
            rl.close();
            resolve(ans.trim());
        })
    );
}
