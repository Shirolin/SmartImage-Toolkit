import readline from 'readline';
import chalk from 'chalk';

export type TargetFormat = 'webp' | 'png' | 'avif' | 'mozjpeg' | 'rmbg_solid';
export type AiModel = 'medium' | 'small';

export interface InteractiveResolution {
    format: TargetFormat;
    aiModel?: AiModel;
}

interface Choice<T> {
    title: string;
    description: string;
    value: T;
    key: string;
    titleColor: (text: string) => string;
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
            key: '0',
            title: '取消退出  ',
            description: '=> 放弃转换并退出程序',
            value: 'cancel',
            titleColor: chalk.red.bold
        }
    ];

    const selectedFormat = await customSelect(message, formatChoices);

    if (selectedFormat === 'cancel') {
        process.stdout.write('\x1B[1A\x1B[J'); // 清理控制台残余
        console.log(chalk.red('👋 操作已取消。'));
        process.exit(0);
    }

    if (selectedFormat === 'rmbg_solid') {
        const aiMessage = `${chalk.magenta.bold('🧠 请同样地选出您青睐的 AI 抠图精细度')}:\n${chalk.gray('  ? 运行级别:')}`;
        const aiChoices: Choice<AiModel>[] = [
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
            }
        ];
        const aiModel = await customSelect(aiMessage, aiChoices);
        return { format: 'rmbg_solid', aiModel };
    }

    return { format: selectedFormat as TargetFormat };
}
