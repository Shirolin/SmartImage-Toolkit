import readline from 'readline';
import chalk from 'chalk';
import { CancelError } from './config-types';
import type { AiModel, SplitConfig, ResizeConfig, TrimConfig, CropConfig, CenterConfig } from './config-types';

// 第一性原理：按键交互与渲染是可复用的表现层，流程编排（cli.ts）只做调度。
// 本文件自 cli.ts 拆出：原 customSelect/renderHeader/askQuestion 逐行搬迁，
// 唯一行为变更：Ctrl+C 与取消不再直接退出进程，而是抛 CancelError 由入口 main 决定退出码。

export interface Choice<T> {
    title: string;
    description: string;
    value: T;
    key: string;
    titleColor: (text: string) => string;
}

export function renderHeader(breadcrumb: string): void {
    console.clear();
    console.log(chalk.gray('====================================================================================='));
    console.log(chalk.bold.white('   🎨 SmartImage-Toolkit (交互模式版)'));
    console.log(chalk.gray('=====================================================================================\n'));
    console.log(`${chalk.gray('📍 当前位置:')} ${chalk.cyan(breadcrumb)}\n`);
}

export async function customSelect<T>(message: string, choices: Choice<T>[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
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

        const render = (): void => {
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

        const onKeypress = (str: string, key: readline.Key): void => {
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
                // 原先此处直接退出进程；现改为抛信号异常，退出码由入口统一决定
                reject(new CancelError('用户中断选择'));
            } else if (str) {
                const choice = choices.find((c) => c.key === str.trim());
                if (choice) {
                    cleanup();
                    resolve(choice.value);
                }
            }
        };

        const cleanup = (): void => {
            // 每一步都独立容错：恢复终端失败也不应泄漏监听器与 rl
            try {
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                }
            } catch {
                // 终端恢复失败不影响选择结果
            }
            try {
                process.stdin.removeListener('keypress', onKeypress);
            } catch {
                // 监听器移除失败可忽略
            }
            try {
                rl.close();
            } catch {
                // 关闭失败可忽略
            }
            console.log(); // 换行留白，防止下一项覆盖
        };

        process.stdin.on('keypress', onKeypress);
        try {
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
            }
            render(); // 首次渲染
        } catch (err) {
            // setRawMode/首次渲染抛错时恢复终端并拒绝 Promise，避免悬置与吞字符
            cleanup();
            reject(err);
        }
    });
}

// 供简易输入使用的辅助函数（自 cli.ts 逐行搬迁）
// Ctrl+C / EOF 与菜单一致转 CancelError，不直接杀进程，由入口统一决定退出码
export function askQuestion(query: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise<string>((resolve, reject) => {
        let settled = false;
        const cancel = (): void => {
            if (settled) return;
            settled = true;
            try {
                rl.close();
            } catch {
                // 关闭失败可忽略
            }
            reject(new CancelError('用户中断输入'));
        };
        rl.on('SIGINT', cancel);
        // 管道 EOF/界面关闭同样视为取消，避免 Promise 永久悬置
        rl.on('close', cancel);
        rl.question(query, (ans) => {
            if (settled) return;
            settled = true;
            try {
                rl.close();
            } catch {
                // 关闭失败可忽略
            }
            resolve(ans.trim());
        });
    });
}

// —— 以下为各特效分支的交互采集（自 cli.ts askFormat 内逐块搬迁） ——
// 约定：返回 'back' 表示用户选择回到主菜单（原语义即外层 while 的 continue）。

/** AI 抠图档位采集 */
export async function askAiModel(): Promise<AiModel | 'back'> {
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
    if (aiModel === 'back') return 'back';
    console.clear();
    return aiModel;
}

/** 图像切片全流程采集 */
export async function askSplitConfig(): Promise<SplitConfig | 'back'> {
    renderHeader('主界面 > 图像切片 (1/4) - 阵列范围');
    console.log(
        chalk.cyan.bold('✂️ 请依次输入切片的【列数(X轴)】与【行数(Y轴)】 (若要返回上级菜单，请输入 0 并回车):\n')
    );

    const colStr = await askQuestion(chalk.cyan('  ? 【列数】: 横向有几列表情？(也就是 X 轴，直接回车默认 4): '));
    if (colStr.trim() === '0') return 'back';
    const cols = parseInt(colStr, 10) || 4;

    const rowStr = await askQuestion(chalk.cyan('  ? 【行数】: 纵向有几排表情？(也就是 Y 轴，直接回车默认 4): '));
    if (rowStr.trim() === '0') return 'back';
    const rows = parseInt(rowStr, 10) || 4;

    renderHeader('主界面 > 图像切片 (2/4) - 导出格式');
    console.log(chalk.cyan.bold(`✔️ 已确认该图包含: 横向 ${cols} 列 × 纵向 ${rows} 排 (行)，将为您精准切割。\n`));

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
    if (exportFormat === 'back') return 'back';

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
    if (centerMode === 'back') return 'back';

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
    return { rows, cols, exportFormat, centerMode, edgeShave, debugGrid };
}

/** 批量缩放全流程采集 */
export async function askResizeConfig(): Promise<ResizeConfig | 'back'> {
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
    if (resizeMode === 'back') return 'back';

    const resizeConfig: ResizeConfig = { mode: resizeMode };

    renderHeader('主界面 > 批量缩放 (2/3) - 尺寸参数');

    if (resizeMode === 'by_width') {
        while (true) {
            const ans = await askQuestion(chalk.cyan('  ? 【目标宽度】: 请输入想要缩放到的宽度像素值(例如 800): '));
            const val = parseInt(ans, 10);
            if (!isNaN(val) && val > 0) {
                resizeConfig.width = val;
                break;
            }
            console.log(chalk.red('❌ 无效的输入。请输入大于 0 的数字。'));
        }
    } else if (resizeMode === 'by_height') {
        while (true) {
            const ans = await askQuestion(chalk.cyan('  ? 【目标高度】: 请输入想要缩放到的高度像素值(例如 600): '));
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
    if (outputFormat === 'back') return 'back';
    resizeConfig.outputFormat = outputFormat;

    console.clear();
    return resizeConfig;
}

export type TrimCropAnswer =
    | { kind: 'trim'; trimConfig: TrimConfig }
    | { kind: 'crop'; cropConfig: CropConfig }
    | 'back';

/** 边缘修剪（智能去边 / 手动裁剪）全流程采集 */
export async function askTrimCrop(): Promise<TrimCropAnswer> {
    renderHeader('主界面 > 边缘修剪 (1/3) - 修剪模式');
    const trimModeMessage = `${chalk.yellow.bold('✂️ 请选择边缘修剪方式')}:\n${chalk.gray('  ? 修剪模式:')}`;
    const trimModeChoices: Choice<'auto' | 'manual' | 'back'>[] = [
        {
            key: '1',
            title: '智能去边 (Auto Trim)',
            description: '自动分析四周边缘纯色(含透明)并精确剥除',
            value: 'auto',
            titleColor: chalk.cyan.bold
        },
        {
            key: '2',
            title: '手动指定裁剪 (Manual Crop)',
            description: '指定上下左右想要切除的独立像素数值',
            value: 'manual',
            titleColor: chalk.cyan.bold
        },
        {
            key: '0',
            title: '返回上一级',
            description: '重新选择特效方案',
            value: 'back',
            titleColor: chalk.gray
        }
    ];

    const trimMode = await customSelect(trimModeMessage, trimModeChoices);
    if (trimMode === 'back') return 'back';

    let cropConfig: CropConfig | undefined;
    let trimConfig: TrimConfig | undefined;

    if (trimMode === 'auto') {
        renderHeader('主界面 > 边缘修剪 (2/4) - 边向筛选');

        const sidesMessage = `${chalk.cyan.bold('🧠 【智能去边】请选择需要自动裁切的边 (支持多向联合)')}:\n${chalk.gray('  ? 修剪方向:')}`;
        const sidesChoices: Choice<('top' | 'bottom' | 'left' | 'right')[] | 'back'>[] = [
            {
                key: '1',
                title: '全向 (四周)',
                description: '上下左右皆自动剥离废边',
                value: ['top', 'bottom', 'left', 'right'],
                titleColor: chalk.green.bold
            },
            {
                key: '2',
                title: '仅修剪底部 (Bottom)',
                description: '保留其他，只去底边',
                value: ['bottom'],
                titleColor: chalk.yellow.bold
            },
            {
                key: '3',
                title: '仅修剪上下 (Top & Bottom)',
                description: '去除顶部与底部',
                value: ['top', 'bottom'],
                titleColor: chalk.white
            },
            {
                key: '4',
                title: '仅修剪左右 (Left & Right)',
                description: '去除左右两侧边',
                value: ['left', 'right'],
                titleColor: chalk.white
            },
            { key: '0', title: '返回重新选模式', description: '', value: 'back', titleColor: chalk.gray }
        ];

        const sides = await customSelect(sidesMessage, sidesChoices);
        if (sides === 'back') return 'back';

        renderHeader('主界面 > 边缘修剪 (3/4) - 容差设定');
        console.log(chalk.cyan('🧠 【智能去边】将基于图片边缘颜色(包含全透或纯白)向内试探...'));

        let validThreshold = false;
        let threshold = 10; // 默认
        while (!validThreshold) {
            const thresholdInput = await askQuestion(
                chalk.gray('  ? 【色差容忍度】(1-100，默认直接回车为 10，防轻微渐变阻挡): ')
            );
            if (thresholdInput.trim() === '') {
                validThreshold = true;
            } else {
                const parsed = parseInt(thresholdInput, 10);
                if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
                    threshold = parsed;
                    validThreshold = true;
                } else {
                    console.log(chalk.red('❌ 无效的输入。请输入 1-100 之间的整数。'));
                }
            }
        }
        trimConfig = { threshold, sides };
    } else {
        renderHeader('主界面 > 边缘修剪 (2/3) - 裁剪边界');
        console.log(
            chalk.cyan('📏 请分别输入上、下、左、右四个方向需要向内切除的像素数值 (如果不需要切则输入 0 或直接敲回车):')
        );

        const parseVal = (input: string): number => {
            const val = parseInt(input, 10);
            return !isNaN(val) && val > 0 ? val : 0;
        };

        const tStr = await askQuestion(chalk.gray('  ? 顶部 (Top) 切除像素数: '));
        const top = parseVal(tStr);
        const bStr = await askQuestion(chalk.gray('  ? 底部 (Bottom) 切除像素数: '));
        const bottom = parseVal(bStr);
        const lStr = await askQuestion(chalk.gray('  ? 左部 (Left) 切除像素数: '));
        const left = parseVal(lStr);
        const rStr = await askQuestion(chalk.gray('  ? 右部 (Right) 切除像素数: '));
        const right = parseVal(rStr);

        cropConfig = { top, bottom, left, right };
    }

    // 最后导出格式
    renderHeader(`主界面 > 边缘修剪 (${trimMode === 'auto' ? '4/4' : '3/3'}) - 最终输出格式`);
    const formatMessage = `${chalk.yellow.bold('📦 请选择修剪后文件的最终导出格式')}:\n${chalk.gray('  ? 导出格式:')}`;
    const formatChoices4: Choice<'original' | 'webp' | 'png' | 'mozjpeg' | 'back'>[] = [
        {
            key: '1',
            title: '保持原格式 (默认)',
            description: '沿用修改前文件的扩展名',
            value: 'original',
            titleColor: chalk.white
        },
        { key: '2', title: 'WebP', description: '体积最小', value: 'webp', titleColor: chalk.green.bold },
        { key: '3', title: 'PNG', description: '无损与透明', value: 'png', titleColor: chalk.green.bold },
        {
            key: '4',
            title: 'JPG (MozJPEG)',
            description: '舍弃透明背景',
            value: 'mozjpeg',
            titleColor: chalk.green.bold
        },
        { key: '0', title: '返回重新选择', description: '', value: 'back', titleColor: chalk.gray }
    ];

    const outFormat = await customSelect(formatMessage, formatChoices4);
    if (outFormat === 'back') return 'back';

    console.clear();
    if (trimMode === 'auto' && trimConfig) {
        trimConfig.outputFormat = outFormat;
        return { kind: 'trim', trimConfig };
    }
    if (cropConfig) {
        cropConfig.outputFormat = outFormat;
        return { kind: 'crop', cropConfig };
    }
    return 'back';
}

/** 智能居中全流程采集 */
export async function askCenterConfig(): Promise<CenterConfig | 'back'> {
    renderHeader('主界面 > 自动居中 (1/3) - 灵敏度设定');
    console.log(chalk.cyan('🎯 【智能居中】将基于背景色探测主体内容 Bounding Box...'));

    let validThreshold = false;
    let threshold = 10;
    while (!validThreshold) {
        const thresholdInput = await askQuestion(chalk.gray('  ? 【色差容忍度】(1-100，默认回车 10): '));
        if (thresholdInput.trim() === '') {
            validThreshold = true;
        } else {
            const parsed = parseInt(thresholdInput, 10);
            if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
                threshold = parsed;
                validThreshold = true;
            } else {
                console.log(chalk.red('❌ 无效输入。请输入 1-100 整数。'));
            }
        }
    }

    renderHeader('主界面 > 自动居中 (2/3) - 填充背景');
    console.log(chalk.cyan('🎨 【背景色】当内容偏离中心时，系统将在对向补齐背景色。'));
    const fillChoices: Choice<string | 'back'>[] = [
        {
            key: '1',
            title: '全透明 (Transparent)',
            description: '推荐用于 WebP/PNG 表情包',
            value: 'transparent',
            titleColor: chalk.green
        },
        {
            key: '2',
            title: '纯白色 (#FFFFFF)',
            description: '推荐用于 JPG 修复',
            value: '#FFFFFF',
            titleColor: chalk.white
        },
        {
            key: '3',
            title: '自定义 Hex 色值',
            description: '手动输入如 #FAFAFA',
            value: 'custom',
            titleColor: chalk.blue
        },
        { key: '0', title: '上一步', description: '', value: 'back', titleColor: chalk.gray }
    ];

    let fillColor = await customSelect(`${chalk.yellow.bold('📦 请选择补白颜色')}:`, fillChoices);
    if (fillColor === 'back') return 'back';
    if (fillColor === 'custom') {
        fillColor = (await askQuestion(chalk.gray('  ? 请输入十六进制色值码(如 #FF0000): '))) || 'transparent';
    }

    renderHeader('主界面 > 自动居中 (3/3) - 最终输出格式');
    const formatChoicesCenter: Choice<'original' | 'webp' | 'png' | 'mozjpeg' | 'back'>[] = [
        {
            key: '1',
            title: '保持原格式',
            description: '不改变图片封装',
            value: 'original',
            titleColor: chalk.green
        },
        {
            key: '2',
            title: '导出为 WebP',
            description: '高压缩率，支持透明 (推荐)',
            value: 'webp',
            titleColor: chalk.cyan
        },
        {
            key: '3',
            title: '导出为 PNG',
            description: '无损画质，支持透明',
            value: 'png',
            titleColor: chalk.blue
        },
        {
            key: '4',
            title: '导出为 MozJPEG',
            description: '网页兼容性极佳',
            value: 'mozjpeg',
            titleColor: chalk.red
        },
        { key: '0', title: '上一步', description: '', value: 'back', titleColor: chalk.gray }
    ];
    const finalFormatChoice = await customSelect(`${chalk.yellow.bold('📦 请选择最终导出格式')}:`, formatChoicesCenter);
    if (finalFormatChoice === 'back') return 'back';

    const centerConfig: CenterConfig = {
        threshold,
        fillColor,
        outputFormat: finalFormatChoice === 'original' ? undefined : finalFormatChoice
    };
    return centerConfig;
}
