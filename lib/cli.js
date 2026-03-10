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
            key: '7',
            title: '批量缩放',
            description: '按比例或像素批量调整大小',
            value: 'resize',
            titleColor: chalk_1.default.blue.bold
        },
        {
            key: '8',
            title: '边缘修剪 (Trim/Crop)',
            description: '自动去白边或手动像素级切除',
            value: 'trim',
            titleColor: chalk_1.default.yellow
        },
        {
            key: '9',
            title: '自动居中 (Smart Center)',
            description: '探测主体位置并平衡边距，使内容完美居中',
            value: 'center',
            titleColor: chalk_1.default.magenta.bold
        },
        {
            key: '0',
            title: '退出程序',
            description: '结束当前会话',
            value: 'cancel', // Changed from 'exit' as any to 'cancel' to match existing logic
            titleColor: chalk_1.default.gray
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
        if (selectedFormat === 'resize') {
            renderHeader('主界面 > 批量缩放 (1/3) - 缩放模式');
            const resizeModeMessage = `${chalk_1.default.blue.bold('📏 请选择批量缩放的基准模式')}:\n${chalk_1.default.gray('  ? 缩放模式:')}`;
            const resizeModeChoices = [
                {
                    key: '1',
                    title: '按宽度缩放',
                    description: '指定宽度，高度等比自适应',
                    value: 'by_width',
                    titleColor: chalk_1.default.cyan.bold
                },
                {
                    key: '2',
                    title: '按高度缩放',
                    description: '指定高度，宽度等比自适应',
                    value: 'by_height',
                    titleColor: chalk_1.default.cyan.bold
                },
                {
                    key: '3',
                    title: '按百分比缩放',
                    description: '等比例缩放整体大小',
                    value: 'by_percent',
                    titleColor: chalk_1.default.cyan.bold
                },
                {
                    key: '4',
                    title: '自定义宽高',
                    description: '强制指定宽高度 (含多种适配策略)',
                    value: 'custom',
                    titleColor: chalk_1.default.magenta.bold
                },
                {
                    key: '0',
                    title: '返回上一级',
                    description: '重新选择特效方案',
                    value: 'back',
                    titleColor: chalk_1.default.gray
                }
            ];
            const resizeMode = await customSelect(resizeModeMessage, resizeModeChoices);
            if (resizeMode === 'back')
                continue;
            const resizeConfig = {
                mode: resizeMode
            };
            renderHeader('主界面 > 批量缩放 (2/3) - 尺寸参数');
            if (resizeMode === 'by_width') {
                while (true) {
                    const ans = await askQuestion(chalk_1.default.cyan('  ? 【目标宽度】: 请输入想要缩放到的宽度像素值(例如 800): '));
                    const val = parseInt(ans, 10);
                    if (!isNaN(val) && val > 0) {
                        resizeConfig.width = val;
                        break;
                    }
                    console.log(chalk_1.default.red('❌ 无效的输入。请输入大于 0 的数字。'));
                }
            }
            else if (resizeMode === 'by_height') {
                while (true) {
                    const ans = await askQuestion(chalk_1.default.cyan('  ? 【目标高度】: 请输入想要缩放到的高度像素值(例如 600): '));
                    const val = parseInt(ans, 10);
                    if (!isNaN(val) && val > 0) {
                        resizeConfig.height = val;
                        break;
                    }
                    console.log(chalk_1.default.red('❌ 无效的输入。请输入大于 0 的数字。'));
                }
            }
            else if (resizeMode === 'by_percent') {
                while (true) {
                    const ans = await askQuestion(chalk_1.default.cyan('  ? 【缩放百分比】: 请输入百分比数值 (例如 50 代表缩小到一半, 200 代表放大两倍): '));
                    const val = parseInt(ans, 10);
                    if (!isNaN(val) && val > 0) {
                        resizeConfig.percent = val;
                        break;
                    }
                    console.log(chalk_1.default.red('❌ 无效的输入。请输入大于 0 的数字。'));
                }
            }
            else if (resizeMode === 'custom') {
                while (true) {
                    const ansW = await askQuestion(chalk_1.default.cyan('  ? 【目标宽度】: 请输入宽度像素值: '));
                    const valW = parseInt(ansW, 10);
                    if (!isNaN(valW) && valW > 0) {
                        resizeConfig.width = valW;
                        break;
                    }
                    console.log(chalk_1.default.red('❌ 无效的输入。请输入大于 0 的数字。'));
                }
                while (true) {
                    const ansH = await askQuestion(chalk_1.default.cyan('  ? 【目标高度】: 请输入高度像素值: '));
                    const valH = parseInt(ansH, 10);
                    if (!isNaN(valH) && valH > 0) {
                        resizeConfig.height = valH;
                        break;
                    }
                    console.log(chalk_1.default.red('❌ 无效的输入。请输入大于 0 的数字。'));
                }
                console.log();
                const fitMessage = `${chalk_1.default.blue.bold('📏 对于不匹配的宽高比例，请选择适配策略')}:\n${chalk_1.default.gray('  ? 适配策略:')}`;
                const fitChoices = [
                    {
                        key: '1',
                        title: 'Cover (默认)',
                        description: '等比缩放并裁剪多余边缘以填满尺寸',
                        value: 'cover',
                        titleColor: chalk_1.default.white
                    },
                    {
                        key: '2',
                        title: 'Contain',
                        description: '等比缩放完整保留内容，可能出现透明留白',
                        value: 'contain',
                        titleColor: chalk_1.default.white
                    },
                    {
                        key: '3',
                        title: 'Fill',
                        description: '无视比例，强制拉伸或挤压至指定尺寸',
                        value: 'fill',
                        titleColor: chalk_1.default.white
                    },
                    {
                        key: '4',
                        title: 'Inside',
                        description: '保留比例但决不超出，类似按最大边缩放',
                        value: 'inside',
                        titleColor: chalk_1.default.white
                    }
                ];
                resizeConfig.fit = await customSelect(fitMessage, fitChoices);
            }
            renderHeader('主界面 > 批量缩放 (3/3) - 最终输出格式');
            const formatMessage = `${chalk_1.default.blue.bold('📦 请选择缩放后文件的最终导出格式')}:\n${chalk_1.default.gray('  ? 导出格式:')}`;
            const formatChoices3 = [
                {
                    key: '1',
                    title: '保持原格式 (默认)',
                    description: '沿用修改前文件的扩展名',
                    value: 'original',
                    titleColor: chalk_1.default.white
                },
                { key: '2', title: 'WebP', description: '体积最小', value: 'webp', titleColor: chalk_1.default.green.bold },
                { key: '3', title: 'PNG', description: '无损与兼容', value: 'png', titleColor: chalk_1.default.green.bold },
                {
                    key: '4',
                    title: 'JPG (MozJPEG)',
                    description: '照片常用',
                    value: 'mozjpeg',
                    titleColor: chalk_1.default.green.bold
                },
                {
                    key: '0',
                    title: '返回重新填写参数',
                    description: '返回修改缩放参数',
                    value: 'back',
                    titleColor: chalk_1.default.gray
                }
            ];
            const outputFormat = await customSelect(formatMessage, formatChoices3);
            if (outputFormat === 'back')
                continue;
            resizeConfig.outputFormat = outputFormat;
            console.clear();
            return {
                format: 'resize',
                resizeConfig
            };
        }
        if (selectedFormat === 'trim') {
            renderHeader('主界面 > 边缘修剪 (1/3) - 修剪模式');
            const trimModeMessage = `${chalk_1.default.yellow.bold('✂️ 请选择边缘修剪方式')}:\n${chalk_1.default.gray('  ? 修剪模式:')}`;
            const trimModeChoices = [
                {
                    key: '1',
                    title: '智能去边 (Auto Trim)',
                    description: '自动分析四周边缘纯色(含透明)并精确剥除',
                    value: 'auto',
                    titleColor: chalk_1.default.cyan.bold
                },
                {
                    key: '2',
                    title: '手动指定裁剪 (Manual Crop)',
                    description: '指定上下左右想要切除的独立像素数值',
                    value: 'manual',
                    titleColor: chalk_1.default.cyan.bold
                },
                {
                    key: '0',
                    title: '返回上一级',
                    description: '重新选择特效方案',
                    value: 'back',
                    titleColor: chalk_1.default.gray
                }
            ];
            const trimMode = await customSelect(trimModeMessage, trimModeChoices);
            if (trimMode === 'back')
                continue;
            let cropConfig;
            let trimConfig;
            if (trimMode === 'auto') {
                renderHeader('主界面 > 边缘修剪 (2/4) - 边向筛选');
                const sidesMessage = `${chalk_1.default.cyan.bold('🧠 【智能去边】请选择需要自动裁切的边 (支持多向联合)')}:\n${chalk_1.default.gray('  ? 修剪方向:')}`;
                const sidesChoices = [
                    {
                        key: '1',
                        title: '全向 (四周)',
                        description: '上下左右皆自动剥离废边',
                        value: ['top', 'bottom', 'left', 'right'],
                        titleColor: chalk_1.default.green.bold
                    },
                    {
                        key: '2',
                        title: '仅修剪底部 (Bottom)',
                        description: '保留其他，只去底边',
                        value: ['bottom'],
                        titleColor: chalk_1.default.yellow.bold
                    },
                    {
                        key: '3',
                        title: '仅修剪上下 (Top & Bottom)',
                        description: '去除顶部与底部',
                        value: ['top', 'bottom'],
                        titleColor: chalk_1.default.white
                    },
                    {
                        key: '4',
                        title: '仅修剪左右 (Left & Right)',
                        description: '去除左右两侧边',
                        value: ['left', 'right'],
                        titleColor: chalk_1.default.white
                    },
                    { key: '0', title: '返回重新选模式', description: '', value: 'back', titleColor: chalk_1.default.gray }
                ];
                const sides = await customSelect(sidesMessage, sidesChoices);
                if (sides === 'back')
                    continue;
                renderHeader('主界面 > 边缘修剪 (3/4) - 容差设定');
                console.log(chalk_1.default.cyan('🧠 【智能去边】将基于图片边缘颜色(包含全透或纯白)向内试探...'));
                let validThreshold = false;
                let threshold = 10; // 默认
                while (!validThreshold) {
                    const thresholdInput = await askQuestion(chalk_1.default.gray('  ? 【色差容忍度】(1-100，默认直接回车为 10，防轻微渐变阻挡): '));
                    if (thresholdInput.trim() === '') {
                        validThreshold = true;
                    }
                    else {
                        const parsed = parseInt(thresholdInput, 10);
                        if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
                            threshold = parsed;
                            validThreshold = true;
                        }
                        else {
                            console.log(chalk_1.default.red('❌ 无效的输入。请输入 1-100 之间的整数。'));
                        }
                    }
                }
                trimConfig = { threshold, sides: sides };
            }
            else {
                renderHeader('主界面 > 边缘修剪 (2/3) - 裁剪边界');
                console.log(chalk_1.default.cyan('📏 请分别输入上、下、左、右四个方向需要向内切除的像素数值 (如果不需要切则输入 0 或直接敲回车):'));
                const parseVal = (input) => {
                    const val = parseInt(input, 10);
                    return !isNaN(val) && val > 0 ? val : 0;
                };
                const tStr = await askQuestion(chalk_1.default.gray('  ? 顶部 (Top) 切除像素数: '));
                const top = parseVal(tStr);
                const bStr = await askQuestion(chalk_1.default.gray('  ? 底部 (Bottom) 切除像素数: '));
                const bottom = parseVal(bStr);
                const lStr = await askQuestion(chalk_1.default.gray('  ? 左部 (Left) 切除像素数: '));
                const left = parseVal(lStr);
                const rStr = await askQuestion(chalk_1.default.gray('  ? 右部 (Right) 切除像素数: '));
                const right = parseVal(rStr);
                cropConfig = { top, bottom, left, right };
            }
            // 最后导出格式
            renderHeader(`主界面 > 边缘修剪 (${trimMode === 'auto' ? '4/4' : '3/3'}) - 最终输出格式`);
            const formatMessage = `${chalk_1.default.yellow.bold('📦 请选择修剪后文件的最终导出格式')}:\n${chalk_1.default.gray('  ? 导出格式:')}`;
            const formatChoices4 = [
                {
                    key: '1',
                    title: '保持原格式 (默认)',
                    description: '沿用修改前文件的扩展名',
                    value: 'original',
                    titleColor: chalk_1.default.white
                },
                { key: '2', title: 'WebP', description: '体积最小', value: 'webp', titleColor: chalk_1.default.green.bold },
                { key: '3', title: 'PNG', description: '无损与透明', value: 'png', titleColor: chalk_1.default.green.bold },
                {
                    key: '4',
                    title: 'JPG (MozJPEG)',
                    description: '舍弃透明背景',
                    value: 'mozjpeg',
                    titleColor: chalk_1.default.green.bold
                },
                { key: '0', title: '返回重新选择', description: '', value: 'back', titleColor: chalk_1.default.gray }
            ];
            const outFormat = await customSelect(formatMessage, formatChoices4);
            if (outFormat === 'back')
                continue;
            const finalFormat = outFormat;
            console.clear();
            if (trimMode === 'auto' && trimConfig) {
                trimConfig.outputFormat = finalFormat;
                return { format: 'trim', trimConfig };
            }
            else if (cropConfig) {
                cropConfig.outputFormat = finalFormat;
                return { format: 'crop', cropConfig };
            }
        }
        if (selectedFormat === 'center') {
            renderHeader('主界面 > 自动居中 (1/3) - 灵敏度设定');
            console.log(chalk_1.default.cyan('🎯 【智能居中】将基于背景色探测主体内容 Bounding Box...'));
            let validThreshold = false;
            let threshold = 10;
            while (!validThreshold) {
                const thresholdInput = await askQuestion(chalk_1.default.gray('  ? 【色差容忍度】(1-100，默认回车 10): '));
                if (thresholdInput.trim() === '') {
                    validThreshold = true;
                }
                else {
                    const parsed = parseInt(thresholdInput, 10);
                    if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
                        threshold = parsed;
                        validThreshold = true;
                    }
                    else {
                        console.log(chalk_1.default.red('❌ 无效输入。请输入 1-100 整数。'));
                    }
                }
            }
            renderHeader('主界面 > 自动居中 (2/3) - 填充背景');
            console.log(chalk_1.default.cyan('🎨 【背景色】当内容偏离中心时，系统将在对向补齐背景色。'));
            const fillChoices = [
                {
                    key: '1',
                    title: '全透明 (Transparent)',
                    description: '推荐用于 WebP/PNG 表情包',
                    value: 'transparent',
                    titleColor: chalk_1.default.green
                },
                {
                    key: '2',
                    title: '纯白色 (#FFFFFF)',
                    description: '推荐用于 JPG 修复',
                    value: '#FFFFFF',
                    titleColor: chalk_1.default.white
                },
                {
                    key: '3',
                    title: '自定义 Hex 色值',
                    description: '手动输入如 #FAFAFA',
                    value: 'custom',
                    titleColor: chalk_1.default.blue
                },
                { key: '0', title: '上一步', description: '', value: 'back', titleColor: chalk_1.default.gray }
            ];
            let fillColor = await customSelect(`${chalk_1.default.yellow.bold('📦 请选择补白颜色')}:`, fillChoices);
            if (fillColor === 'back')
                continue;
            if (fillColor === 'custom') {
                fillColor = (await askQuestion(chalk_1.default.gray('  ? 请输入十六进制色值码(如 #FF0000): '))) || 'transparent';
            }
            renderHeader('主界面 > 自动居中 (3/3) - 最终输出格式');
            const formatChoicesCenter = [
                {
                    key: '1',
                    title: '保持原格式',
                    description: '不改变图片封装',
                    value: 'original',
                    titleColor: chalk_1.default.green
                },
                {
                    key: '2',
                    title: '导出为 WebP',
                    description: '高压缩率，支持透明 (推荐)',
                    value: 'webp',
                    titleColor: chalk_1.default.cyan
                },
                {
                    key: '3',
                    title: '导出为 PNG',
                    description: '无损画质，支持透明',
                    value: 'png',
                    titleColor: chalk_1.default.blue
                },
                {
                    key: '4',
                    title: '导出为 MozJPEG',
                    description: '网页兼容性极佳',
                    value: 'mozjpeg',
                    titleColor: chalk_1.default.red
                },
                { key: '0', title: '上一步', description: '', value: 'back', titleColor: chalk_1.default.gray }
            ];
            const finalFormatChoice = await customSelect(`${chalk_1.default.yellow.bold('📦 请选择最终导出格式')}:`, formatChoicesCenter);
            if (finalFormatChoice === 'back')
                continue;
            const centerConfig = {
                threshold,
                fillColor: fillColor,
                outputFormat: finalFormatChoice === 'original' ? undefined : finalFormatChoice
            };
            return { format: 'center', centerConfig };
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
