"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.askFormat = askFormat;
const readline_1 = __importDefault(require("readline"));
const chalk_1 = __importDefault(require("chalk"));
function renderHeader(breadcrumb) {
    console.clear();
    console.log(chalk_1.default.gray('====================================================================================='));
    console.log(chalk_1.default.bold.white('   🎨 SmartImage-Toolkit (交互模式版)'));
    console.log(chalk_1.default.gray('=====================================================================================\n'));
    console.log(`${chalk_1.default.gray('📍 当前位置:')} ${chalk_1.default.cyan(breadcrumb)}\n`);
}
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
    const message = `\n${chalk_1.default.cyan.bold('🎨 上下键浏览，数字键直达，回车确认')}:\n${chalk_1.default.gray('  ? 特效方案:')}`;
    const formatChoices = [
        {
            key: '1',
            title: 'WebP',
            description: '体积与画质平衡，推荐',
            value: 'webp',
            titleColor: chalk_1.default.green.bold
        },
        {
            key: '2',
            title: 'PNG',
            description: '无损压缩，保留透明度',
            value: 'png',
            titleColor: chalk_1.default.green.bold
        },
        {
            key: '3',
            title: 'AVIF',
            description: '顶级压缩率，适合现代设备',
            value: 'avif',
            titleColor: chalk_1.default.green.bold
        },
        {
            key: '4',
            title: 'MozJPEG',
            description: 'JPG 有损压缩，兼容性最高',
            value: 'mozjpeg',
            titleColor: chalk_1.default.green.bold
        },
        {
            key: '5',
            title: 'AI 抠图',
            description: '智能去除背景，输出透明图',
            value: 'rmbg_solid',
            titleColor: chalk_1.default.magenta.bold
        },
        {
            key: '6',
            title: '图像切片',
            description: '表情包/雪碧图按网格切分',
            value: 'split',
            titleColor: chalk_1.default.cyan.bold
        },
        {
            key: '0',
            title: '取消退出',
            description: '退出程序',
            value: 'cancel',
            titleColor: chalk_1.default.red.bold
        }
    ];
    while (true) {
        renderHeader('主界面');
        const selectedFormat = await customSelect(message, formatChoices);
        if (selectedFormat === 'cancel') {
            console.clear();
            console.log(chalk_1.default.red('👋 操作已取消。'));
            process.exit(0);
        }
        if (selectedFormat === 'rmbg_solid') {
            renderHeader('主界面 > AI 抠图');
            const aiMessage = `${chalk_1.default.magenta.bold('🧠 选择 AI 抠图精细度')}:\n${chalk_1.default.gray('  ? 运行级别:')}`;
            const aiChoices = [
                {
                    key: '1',
                    title: '均衡模式 (Medium)',
                    description: '适合复杂边缘和人像',
                    value: 'medium',
                    titleColor: chalk_1.default.white.bold
                },
                {
                    key: '2',
                    title: '极速模式 (Small)',
                    description: '速度快，适合大批量',
                    value: 'small',
                    titleColor: chalk_1.default.white.bold
                },
                {
                    key: '0',
                    title: '返回上一级',
                    description: '重新选择特效方案',
                    value: 'back',
                    titleColor: chalk_1.default.gray
                }
            ];
            const aiModel = await customSelect(aiMessage, aiChoices);
            if (aiModel === 'back')
                continue;
            console.clear();
            return { format: 'rmbg_solid', aiModel: aiModel };
        }
        if (selectedFormat === 'split') {
            renderHeader('主界面 > 图像切片 (1/4) - 阵列范围');
            console.log(chalk_1.default.cyan.bold('✂️ 请依次输入切片的【列数(X轴)】与【行数(Y轴)】 (若要返回上级菜单，请输入 0 并回车):\n'));
            const colStr = await askQuestion(chalk_1.default.cyan('  ? 【列数】: 横向有几列表情？(也就是 X 轴，直接回车默认 4): '));
            if (colStr.trim() === '0')
                continue;
            const cols = parseInt(colStr, 10) || 4;
            const rowStr = await askQuestion(chalk_1.default.cyan('  ? 【行数】: 纵向有几排表情？(也就是 Y 轴，直接回车默认 4): '));
            if (rowStr.trim() === '0')
                continue;
            const rows = parseInt(rowStr, 10) || 4;
            renderHeader('主界面 > 图像切片 (2/4) - 导出格式');
            console.log(chalk_1.default.cyan.bold(`✔️ 已确认该图包含: 横向 ${cols} 列 × 纵向 ${rows} 排 (行)，将为您精准切割。\n`));
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
            if (exportFormat === 'back')
                continue;
            renderHeader('主界面 > 图像切片 (3/4) - 智能居中设定');
            const centerMessage = `${chalk_1.default.cyan.bold('🎯 是否对切片进行智能居中？')}:\n${chalk_1.default.gray('  ? 居中模式:')}`;
            const centerChoices = [
                {
                    key: '1',
                    title: '不居中 (原样切除)',
                    description: '保持物理网格原样输出',
                    value: 'none',
                    titleColor: chalk_1.default.white
                },
                {
                    key: '2',
                    title: '居中 - 保持原比例',
                    description: '主体居中，保持原宽高',
                    value: 'keep_ratio',
                    titleColor: chalk_1.default.green.bold
                },
                {
                    key: '3',
                    title: '居中 - 正方形输出',
                    description: '主体居中，输出为正方形',
                    value: 'square',
                    titleColor: chalk_1.default.cyan.bold
                },
                {
                    key: '0',
                    title: '返回上一级',
                    description: '重新选择导出格式',
                    value: 'back',
                    titleColor: chalk_1.default.gray
                }
            ];
            const centerMode = await customSelect(centerMessage, centerChoices);
            if (centerMode === 'back')
                continue;
            let edgeShave = 0;
            if (centerMode !== 'none') {
                renderHeader('主界面 > 图像切片 (4/4) - 边缘去噪保护');
                console.log(chalk_1.default.cyan.bold('🔪 是否需要向内收缩切片边缘？\n'));
                const shaveMessage = chalk_1.default.gray('? 边缘去噪保护:');
                const shaveChoices = [
                    {
                        key: '1',
                        title: '不收缩 (默认)',
                        description: '图案间隙干净，无残留',
                        value: 0,
                        titleColor: chalk_1.default.green.bold
                    },
                    {
                        key: '2',
                        title: '收缩 2 像素',
                        description: '去除极细微的边缘伪影',
                        value: 2,
                        titleColor: chalk_1.default.yellow.bold
                    },
                    {
                        key: '3',
                        title: '自定义收缩距离',
                        description: '切到邻居图案时加大此值',
                        value: -1,
                        titleColor: chalk_1.default.red.bold
                    }
                ];
                const shaveChoice = await customSelect(shaveMessage, shaveChoices);
                if (shaveChoice === -1) {
                    let validPad = false;
                    while (!validPad) {
                        const padInput = await askQuestion(chalk_1.default.cyan.bold('\n🔪 输入收缩像素数 ') + chalk_1.default.gray('(1-100，建议 5~20): '));
                        const padParsed = parseInt(padInput, 10);
                        if (!isNaN(padParsed) && padParsed >= 1 && padParsed <= 100) {
                            edgeShave = padParsed;
                            validPad = true;
                        }
                        else {
                            console.log(chalk_1.default.red('❌ 无效的输入。请输入 1-100 之间的整数。'));
                        }
                    }
                }
                else {
                    edgeShave = shaveChoice;
                }
            }
            let debugGrid = false;
            // 因为生成参照图很有用，所以独立于中心居中作为最后一步提问
            renderHeader(`主界面 > 图像切片 (${centerMode !== 'none' ? '5/5' : '4/4'}) - 辅助诊断模式`);
            console.log(chalk_1.default.cyan.bold('🩺 是否额外生成一张切割对齐参考图？\n'));
            const debugMessage = chalk_1.default.gray('? 附带生成辅助对齐网格:');
            const debugChoices = [
                {
                    key: '1',
                    title: '不需要 (默认)',
                    description: '仅输出切好的图',
                    value: false,
                    titleColor: chalk_1.default.white
                },
                {
                    key: '2',
                    title: '生成标尺参考图',
                    description: '排查切割是否对齐',
                    value: true,
                    titleColor: chalk_1.default.yellow.bold
                }
            ];
            debugGrid = await customSelect(debugMessage, debugChoices);
            console.clear();
            return {
                format: 'split',
                splitConfig: {
                    rows,
                    cols,
                    exportFormat: exportFormat,
                    centerMode: centerMode,
                    edgeShave,
                    debugGrid
                }
            };
        }
        console.clear();
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
