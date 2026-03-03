"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.askFormat = askFormat;
const readline_1 = __importDefault(require("readline"));
const chalk_1 = __importDefault(require("chalk"));
async function customSelect(message, choices) {
    return new Promise((resolve) => {
        let selectedIndex = 0;
        let renderedLines = 0;
        const rl = readline_1.default.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true
        });
        readline_1.default.emitKeypressEvents(process.stdin);
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
                    output += chalk_1.default.gray('  ' + '━'.repeat(50)) + '\n';
                    lines++;
                }
                const prefix = index === selectedIndex ? '❯ ' : '  ';
                const keyStr = `${choice.key}. `;
                let lineStr = '';
                if (index === selectedIndex) {
                    // 选中时，整行反色发光高亮 (形成背景色包裹文字的效果)
                    const content = ` ${prefix}${keyStr}${choice.title}  ${choice.description} `;
                    lineStr = chalk_1.default.bgCyan.black.bold(content);
                }
                else {
                    // 未选中时，保留高对比度设计色彩
                    lineStr = `  ${prefix}${keyStr}${choice.titleColor(choice.title)}  ${chalk_1.default.gray(choice.description)}`;
                }
                output += lineStr + '\n';
                lines++;
            });
            process.stdout.write(output);
            renderedLines = lines;
        };
        const onKeypress = (str, key) => {
            if (key && key.name === 'up') {
                selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
                render();
            }
            else if (key && key.name === 'down') {
                selectedIndex = (selectedIndex + 1) % choices.length;
                render();
            }
            else if (key && (key.name === 'return' || key.name === 'enter')) {
                cleanup();
                resolve(choices[selectedIndex].value);
            }
            else if (key && key.ctrl && key.name === 'c') {
                cleanup();
                process.exit(0);
            }
            else if (str) {
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
async function askFormat() {
    const message = `\n${chalk_1.default.cyan.bold('🎨 请使用【上下键(↑↓)】浏览，或按【数字】一步直达，无须回车即可确认')}:\n${chalk_1.default.gray('  ? 特效方案:')}`;
    const formatChoices = [
        {
            key: '1',
            title: 'WebP      ',
            description: '=> 极佳的体积和画质平衡，推荐用于网页',
            value: 'webp',
            titleColor: chalk_1.default.green.bold
        },
        {
            key: '2',
            title: 'PNG       ',
            description: '=> 极度压缩版本，最高系统兼容性并保留透明度',
            value: 'png',
            titleColor: chalk_1.default.green.bold
        },
        {
            key: '3',
            title: 'AVIF      ',
            description: '=> 最硬核顶级压缩率，体积最小，适合现代设备',
            value: 'avif',
            titleColor: chalk_1.default.green.bold
        },
        {
            key: '4',
            title: 'MozJPEG   ',
            description: '=> 最好的 JPG 有损压缩，AI 和旧设备 100% 兼容',
            value: 'mozjpeg',
            titleColor: chalk_1.default.green.bold
        },
        {
            key: '5',
            title: 'AI 抠图   ',
            description: '=> 智能分离主体，输出去除背景的高清透明图片',
            value: 'rmbg_solid',
            titleColor: chalk_1.default.magenta.bold
        },
        {
            key: '6',
            title: '图像切片  ',
            description: '=> 将各种表情包或雪碧图按网格切分成多小块',
            value: 'split',
            titleColor: chalk_1.default.cyan.bold
        },
        {
            key: '0',
            title: '取消退出  ',
            description: '=> 放弃转换并退出程序',
            value: 'cancel',
            titleColor: chalk_1.default.red.bold
        }
    ];
    while (true) {
        const selectedFormat = await customSelect(message, formatChoices);
        if (selectedFormat === 'cancel') {
            process.stdout.write('\x1B[1A\x1B[J'); // 清理控制台残余
            console.log(chalk_1.default.red('👋 操作已取消。'));
            process.exit(0);
        }
        if (selectedFormat === 'rmbg_solid') {
            const aiMessage = `${chalk_1.default.magenta.bold('🧠 请同样地选出您青睐的 AI 抠图精细度')}:\n${chalk_1.default.gray('  ? 运行级别:')}`;
            const aiChoices = [
                {
                    key: '1',
                    title: '均衡模式 (Medium)',
                    description: '=> 速度与画质绝佳平衡，适合【复杂边缘/一般人像】',
                    value: 'medium',
                    titleColor: chalk_1.default.white.bold
                },
                {
                    key: '2',
                    title: '闪电极速 (Small) ',
                    description: '=> 速度极快省资源，适合【简单边界/大批量计算】',
                    value: 'small',
                    titleColor: chalk_1.default.white.bold
                },
                {
                    key: '0',
                    title: '返回上一级       ',
                    description: '=> 重新选择特效方案',
                    value: 'back',
                    titleColor: chalk_1.default.gray
                }
            ];
            const aiModel = await customSelect(aiMessage, aiChoices);
            if (aiModel === 'back')
                continue;
            return { format: 'rmbg_solid', aiModel: aiModel };
        }
        if (selectedFormat === 'split') {
            console.log(chalk_1.default.cyan.bold('\n✂️ 请依次输入切片的【列数(X轴)】与【行数(Y轴)】 (若要返回上级菜单，请输入 0 并回车):'));
            const colStr = await askQuestion(chalk_1.default.cyan('  ? 【列数】: 横向有几列表情？(也就是 X 轴，直接回车默认 4): '));
            if (colStr.trim() === '0') {
                console.log();
                continue;
            }
            const cols = parseInt(colStr, 10) || 4;
            const rowStr = await askQuestion(chalk_1.default.cyan('  ? 【行数】: 纵向有几排表情？(也就是 Y 轴，直接回车默认 4): '));
            if (rowStr.trim() === '0') {
                console.log(); // 空行过渡
                continue;
            }
            const rows = parseInt(rowStr, 10) || 4;
            console.log(chalk_1.default.green(`✔️ 已确认该图包含: 横向 ${cols} 列 × 纵向 ${rows} 排 (行)，将为您精准切割。\n`));
            const formatMessage = `${chalk_1.default.cyan.bold('📦 请选择切片文件的最终导出格式')}:\n${chalk_1.default.gray('  ? 导出格式:')}`;
            const formatChoices2 = [
                { key: '1', title: 'WebP', description: '体积最小', value: 'webp', titleColor: chalk_1.default.green.bold },
                { key: '2', title: 'PNG', description: '无损与兼容', value: 'png', titleColor: chalk_1.default.green.bold },
                {
                    key: '3',
                    title: 'JPG (MozJPEG)',
                    description: '照片常用',
                    value: 'mozjpeg',
                    titleColor: chalk_1.default.green.bold
                },
                {
                    key: '0',
                    title: '返回上一级   ',
                    description: '返回重填切割数值',
                    value: 'back',
                    titleColor: chalk_1.default.gray
                }
            ];
            const exportFormat = await customSelect(formatMessage, formatChoices2);
            if (exportFormat === 'back') {
                console.log();
                continue;
            }
            const centerMessage = `${chalk_1.default.cyan.bold('🎯 是否对每个切片图进行【主体智能居中】？')}:\n${chalk_1.default.gray('  ? 居中模式:')}`;
            const centerChoices = [
                {
                    key: '1',
                    title: '不居中 (原样切除)',
                    description: '保持原图上的物理网格绝对位置',
                    value: 'none',
                    titleColor: chalk_1.default.white
                },
                {
                    key: '2',
                    title: '居中 - 保持原比例 (推荐)',
                    description: '自动寻找表情主体并将它重新居中在原本宽高的画布里',
                    value: 'keep_ratio',
                    titleColor: chalk_1.default.green.bold
                },
                {
                    key: '3',
                    title: '居中 - 生成正方形 ',
                    description: '自动寻找主体，并强制输出为长宽一致的正方形图片',
                    value: 'square',
                    titleColor: chalk_1.default.cyan.bold
                },
                {
                    key: '0',
                    title: '返回上一级        ',
                    description: '重新选择导出格式',
                    value: 'back',
                    titleColor: chalk_1.default.gray
                }
            ];
            const centerMode = await customSelect(centerMessage, centerChoices);
            if (centerMode === 'back') {
                console.log();
                continue;
            }
            let edgeShave = 0;
            if (centerMode !== 'none') {
                const shaveMessage = `${chalk_1.default.cyan.bold('🔪 (高级项) 是否需要稍微向内收缩 2 个像素，以摧毁遗留的网格线毛刺？')}\n${chalk_1.default.gray('  ? 边缘去噪保护:')}`;
                const shaveChoices = [
                    {
                        key: '1',
                        title: '不需要 (默认，完全保护图案本体)',
                        description: '原画已经足够干净没有瑕疵，或者图案离切边非常近，不能再往内刮。',
                        value: 0,
                        titleColor: chalk_1.default.green.bold
                    },
                    {
                        key: '2',
                        title: '收缩 2 像素以消除微弱网格线  ',
                        description: '有时候 AI 生成图带有肉眼看不清的缝隙网格线，它会阻挡智能居中心算法。这会让其消失。',
                        value: 2,
                        titleColor: chalk_1.default.yellow.bold
                    }
                ];
                edgeShave = await customSelect(shaveMessage, shaveChoices);
                console.log();
            }
            return {
                format: 'split',
                splitConfig: {
                    rows,
                    cols,
                    exportFormat: exportFormat,
                    centerMode: centerMode,
                    edgeShave
                }
            };
        }
        return { format: selectedFormat };
    }
}
// 供简易输入使用的辅助函数
function askQuestion(query) {
    const rl = readline_1.default.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => rl.question(query, (ans) => {
        rl.close();
        resolve(ans.trim());
    }));
}
