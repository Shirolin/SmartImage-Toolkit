import chalk from 'chalk';
import type { SplitConfig } from '../../config-types';
import type { Choice, PromptDriver } from '../driver';
import { getDefaultPromptDriver } from '../driver';
import { askCount, askInput } from '../helpers';

/**
 * 图像切片全流程采集向导
 */
export async function askSplitConfig(driver: PromptDriver = getDefaultPromptDriver()): Promise<SplitConfig | 'back'> {
    driver.renderHeader('主界面 > 图像切片 (第 1 步) - 阵列范围');
    driver.notify(
        chalk.cyan.bold('✂️ 请依次输入切片的【列数(X轴)】与【行数(Y轴)】 (若要返回上级菜单，请输入 0 并回车):\n')
    );

    const cols = await askCount(driver, chalk.cyan('  ? 【列数】: 横向有几列表情？(也就是 X 轴，直接回车默认 4): '), 4);
    if (cols === 'back') return 'back';

    const rows = await askCount(driver, chalk.cyan('  ? 【行数】: 纵向有几排表情？(也就是 Y 轴，直接回车默认 4): '), 4);
    if (rows === 'back') return 'back';

    driver.renderHeader('主界面 > 图像切片 (第 2 步) - 导出格式');
    driver.notify(chalk.cyan.bold(`✔️ 已确认该图包含: 横向 ${cols} 列 × 纵向 ${rows} 排 (行)，将为您精准切割。\n`));

    const formatMessage = `${chalk.cyan.bold('📦 请选择切片文件的最终导出格式')}:\n${chalk.gray('  ? 导出格式:')}`;
    const formatChoices: Choice<'webp' | 'png' | 'mozjpeg' | 'back'>[] = [
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
            title: '返回主菜单',
            description: '已填参数将丢弃',
            value: 'back',
            titleColor: chalk.gray
        }
    ];
    const exportFormat = await driver.select(formatMessage, formatChoices);
    if (exportFormat === 'back') return 'back';

    driver.renderHeader('主界面 > 图像切片 (第 3 步) - 智能居中设定');
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
            title: '返回主菜单',
            description: '已填参数将丢弃',
            value: 'back',
            titleColor: chalk.gray
        }
    ];
    const centerMode = await driver.select(centerMessage, centerChoices);
    if (centerMode === 'back') return 'back';

    let edgeShave = 0;
    if (centerMode !== 'none') {
        driver.renderHeader('主界面 > 图像切片 (第 4 步) - 边缘去噪保护');
        driver.notify(chalk.cyan.bold('🔪 是否需要向内收缩切片边缘？\n'));
        const shaveMessage = chalk.gray('? 边缘去噪保护:');
        const shaveChoices: Choice<number | 'back'>[] = [
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
            },
            {
                key: '0',
                title: '返回主菜单',
                description: '已填参数将丢弃',
                value: 'back',
                titleColor: chalk.gray
            }
        ];
        const shaveChoice = await driver.select(shaveMessage, shaveChoices);
        if (shaveChoice === 'back') return 'back';

        if (shaveChoice === -1) {
            const padResult = await askInput<number>(driver, {
                prompt: chalk.cyan.bold('\n🔪 输入收缩像素数 ') + chalk.gray('(1-100，建议 5~20): '),
                validate: (raw) => {
                    const parsed = parseInt(raw, 10);
                    if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
                        return true;
                    }
                    return '❌ 无效的输入。请输入 1-100 之间的整数。';
                },
                transform: (raw) => parseInt(raw, 10)
            });
            edgeShave = padResult as number;
        } else {
            edgeShave = shaveChoice;
        }
    }

    driver.renderHeader(`主界面 > 图像切片 (第 ${centerMode !== 'none' ? 5 : 4} 步) - 辅助诊断模式`);
    driver.notify(chalk.cyan.bold('🩺 是否额外生成一张切割对齐参考图？\n'));
    const debugMessage = chalk.gray('? 附带生成辅助对齐网格:');
    const debugChoices: Choice<boolean | 'back'>[] = [
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
        },
        {
            key: '0',
            title: '返回主菜单',
            description: '已填参数将丢弃',
            value: 'back',
            titleColor: chalk.gray
        }
    ];
    const debugGridChoice = await driver.select(debugMessage, debugChoices);
    if (debugGridChoice === 'back') return 'back';

    driver.clear();
    return { rows, cols, exportFormat, centerMode, edgeShave, debugGrid: debugGridChoice };
}
