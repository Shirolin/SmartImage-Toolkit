import chalk from 'chalk';
import type { TrimConfig, CropConfig } from '../../config-types';
import type { Choice, PromptDriver } from '../driver';
import { getDefaultPromptDriver } from '../driver';
import { askInput } from '../helpers';

export type TrimCropAnswer =
    { kind: 'trim'; trimConfig: TrimConfig } | { kind: 'crop'; cropConfig: CropConfig } | 'back';

/**
 * 边缘修剪（智能去边 / 手动裁剪）全流程采集向导
 */
export async function askTrimCrop(driver: PromptDriver = getDefaultPromptDriver()): Promise<TrimCropAnswer> {
    driver.renderHeader('主界面 > 边缘修剪 (第 1 步) - 修剪模式');
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

    const trimMode = await driver.select(trimModeMessage, trimModeChoices);
    if (trimMode === 'back') return 'back';

    let cropConfig: CropConfig | undefined;
    let trimConfig: TrimConfig | undefined;

    if (trimMode === 'auto') {
        driver.renderHeader('主界面 > 边缘修剪 (第 2 步) - 边向筛选');

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
            { key: '0', title: '返回主菜单', description: '已填参数将丢弃', value: 'back', titleColor: chalk.gray }
        ];

        const sides = await driver.select(sidesMessage, sidesChoices);
        if (sides === 'back') return 'back';

        driver.renderHeader('主界面 > 边缘修剪 (第 3 步) - 容差设定');
        driver.notify(chalk.cyan('🧠 【智能去边】将基于图片边缘颜色(包含全透或纯白)向内试探...'));

        const threshold = (await askInput<number>(driver, {
            prompt: chalk.gray('  ? 【色差容忍度】(1-100，默认直接回车为 10，防轻微渐变阻挡): '),
            default: '10',
            validate: (raw) => {
                const parsed = parseInt(raw, 10);
                if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
                    return true;
                }
                return '❌ 无效的输入。请输入 1-100 之间的整数。';
            },
            transform: (raw) => parseInt(raw, 10)
        })) as number;

        trimConfig = { threshold, sides };
    } else {
        driver.renderHeader('主界面 > 边缘修剪 (第 2 步) - 裁剪边界');
        driver.notify(
            chalk.cyan('📏 请分别输入上、下、左、右四个方向需要向内切除的像素数值 (如果不需要切则输入 0 或直接敲回车):')
        );

        const askEdge = async (label: string): Promise<number> => {
            const result = await askInput<number>(driver, {
                prompt: chalk.gray(`  ? ${label} 切除像素数: `),
                default: '0',
                validate: (raw) => {
                    const v = Number(raw);
                    return Number.isInteger(v) && v >= 0 ? true : '❌ 请输入不小于 0 的整数';
                },
                transform: Number
            });
            return result as number;
        };

        let top = 0;
        let bottom = 0;
        let left = 0;
        let right = 0;

        while (true) {
            top = await askEdge('顶部 (Top)');
            bottom = await askEdge('底部 (Bottom)');
            left = await askEdge('左部 (Left)');
            right = await askEdge('右部 (Right)');
            if (top + bottom + left + right > 0) break;
            driver.notify(chalk.red('❌ 上/下/左/右不能全为 0，请至少一个方向大于 0。'), 'error');
        }

        cropConfig = { top, bottom, left, right };
    }

    driver.renderHeader(`主界面 > 边缘修剪 (第 ${trimMode === 'auto' ? 4 : 3} 步) - 最终输出格式`);
    const formatMessage = `${chalk.yellow.bold('📦 请选择修剪后文件的最终导出格式')}:\n${chalk.gray('  ? 导出格式:')}`;
    const formatChoices: Choice<'original' | 'webp' | 'png' | 'mozjpeg' | 'back'>[] = [
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
        { key: '0', title: '返回主菜单', description: '已填参数将丢弃', value: 'back', titleColor: chalk.gray }
    ];

    const outFormat = await driver.select(formatMessage, formatChoices);
    if (outFormat === 'back') return 'back';

    driver.clear();
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
