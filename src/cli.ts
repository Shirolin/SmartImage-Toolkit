import readline from 'readline';
import chalk from 'chalk';

export type TargetFormat = 'webp' | 'png' | 'avif' | 'mozjpeg' | 'rmbg_solid' | 'split';
export type AiModel = 'medium' | 'small';

export interface SplitConfig {
    rows: number;
    cols: number;
    exportFormat: 'webp' | 'png' | 'mozjpeg'; // 切片导出格式
    centerMode?: 'none' | 'keep_ratio' | 'square'; // 居中裁剪策略
    edgeShave?: number; // 边缘向内削减像素数
    debugGrid?: boolean; // 是否额外输出带红蓝指示线的可视化排查切分基准图
}

export interface InteractiveResolution {
    format: TargetFormat;
    aiModel?: AiModel;
    splitConfig?: SplitConfig; // 针对切片操作附加参数
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
    console.log(chalk.gray('=================================================================='));
    console.log(chalk.bold.white(' 🎨 SmartImage-Toolkit (交互模式版)'));
    console.log(chalk.gray('==================================================================\n'));
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
    const message = `\n${chalk.cyan.bold('🎨 请使用【上下键(↑↓)】浏览，或按【数字】一步直达，无须回车即可确认')}:\n${chalk.gray('  ? 特效方案:')}`;

    const formatChoices: Choice<TargetFormat | 'cancel'>[] = [
        {
            key: '1',
            title: 'WebP      ',
            description: '=> 极佳的体积和画质平衡，推荐用于网页',
            value: 'webp',
            titleColor: chalk.green.bold
        },
        {
            key: '2',
            title: 'PNG       ',
            description: '=> 极度压缩版本，最高系统兼容性并保留透明度',
            value: 'png',
            titleColor: chalk.green.bold
        },
        {
            key: '3',
            title: 'AVIF      ',
            description: '=> 最硬核顶级压缩率，体积最小，适合现代设备',
            value: 'avif',
            titleColor: chalk.green.bold
        },
        {
            key: '4',
            title: 'MozJPEG   ',
            description: '=> 最好的 JPG 有损压缩，AI 和旧设备 100% 兼容',
            value: 'mozjpeg',
            titleColor: chalk.green.bold
        },
        {
            key: '5',
            title: 'AI 抠图   ',
            description: '=> 智能分离主体，输出去除背景的高清透明图片',
            value: 'rmbg_solid',
            titleColor: chalk.magenta.bold
        },
        {
            key: '6',
            title: '图像切片  ',
            description: '=> 将各种表情包或雪碧图按网格切分成多小块',
            value: 'split',
            titleColor: chalk.cyan.bold
        },
        {
            key: '0',
            title: '取消退出  ',
            description: '=> 放弃转换并退出程序',
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
            const aiMessage = `${chalk.magenta.bold('🧠 请同样地选出您青睐的 AI 抠图精细度')}:\n${chalk.gray('  ? 运行级别:')}`;
            const aiChoices: Choice<AiModel | 'back'>[] = [
                {
                    key: '1',
                    title: '均衡模式 (Medium)',
                    description: '=> 速度与画质绝佳平衡，适合【复杂边缘/一般人像】',
                    value: 'medium',
                    titleColor: chalk.white.bold
                },
                {
                    key: '2',
                    title: '闪电极速 (Small) ',
                    description: '=> 速度极快省资源，适合【简单边界/大批量计算】',
                    value: 'small',
                    titleColor: chalk.white.bold
                },
                {
                    key: '0',
                    title: '返回上一级       ',
                    description: '=> 重新选择特效方案',
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
            const centerMessage = `${chalk.cyan.bold('🎯 是否对每个切片图进行【主体智能居中】？')}:\n${chalk.gray('  ? 居中模式:')}`;
            const centerChoices: Choice<'none' | 'keep_ratio' | 'square' | 'back'>[] = [
                {
                    key: '1',
                    title: '不居中 (原样切除)',
                    description: '保持原图上的物理网格绝对位置',
                    value: 'none',
                    titleColor: chalk.white
                },
                {
                    key: '2',
                    title: '居中 - 保持原比例 (推荐)',
                    description: '自动寻找表情主体并将它重新居中在原本宽高的画布里',
                    value: 'keep_ratio',
                    titleColor: chalk.green.bold
                },
                {
                    key: '3',
                    title: '居中 - 生成正方形 ',
                    description: '自动寻找主体，并强制输出为长宽一致的正方形图片',
                    value: 'square',
                    titleColor: chalk.cyan.bold
                },
                {
                    key: '0',
                    title: '返回上一级        ',
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
                console.log(
                    chalk.cyan.bold('🔪 (高级项) 是否需要向内收缩切片边缘，以摧毁遗留网格线/邻居越界重叠图案？\n')
                );
                const shaveMessage = chalk.gray('? 边缘去噪保护:');
                const shaveChoices: Choice<number>[] = [
                    {
                        key: '1',
                        title: '不需要 (默认，完全保护图案本体)',
                        description: '原画间隙很完美，图案离边界很远，不需要刮肉。',
                        value: 0,
                        titleColor: chalk.green.bold
                    },
                    {
                        key: '2',
                        title: '轻微收缩 (刮去 2 像素)  ',
                        description: '适用于偶尔出现的极细小瑕疵、肉眼看不清的生成图边缘伪影。',
                        value: 2,
                        titleColor: chalk.yellow.bold
                    },
                    {
                        key: '3',
                        title: '自定义强力收缩 (手动输入像素)',
                        description:
                            '【强烈建议】当原画图案拥挤或越界，切出来的图总是带上邻居的手脚时，请使用此项加大收缩。',
                        value: -1,
                        titleColor: chalk.red.bold
                    }
                ];
                const shaveChoice = await customSelect(shaveMessage, shaveChoices);

                if (shaveChoice === -1) {
                    let validPad = false;
                    while (!validPad) {
                        const padInput = await askQuestion(
                            chalk.cyan.bold('\n🔪 请输入要切除的边缘向内收缩范围: ') +
                                chalk.gray('(建议输入 5~20 之间的正整数) ')
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
            console.log(chalk.cyan.bold('🩺 (附加项) 是否需要额外生成一张【全图切割蓝贴标尺参考图】？\n'));
            const debugMessage = chalk.gray('? 附带生成辅助对齐网格:');
            const debugChoices: Choice<boolean>[] = [
                {
                    key: '1',
                    title: '不需要 (默认，仅输出切好的图)',
                    description: '',
                    value: false,
                    titleColor: chalk.white
                },
                {
                    key: '2',
                    title: '额外生成蓝贴标尺参考图 (强推)',
                    description: '如果您怀疑原图排版是歪的，或者行/列数切出来带邻居边缘，可用该图诊断。',
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
