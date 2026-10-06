import chalk from 'chalk';
import type { CenterConfig } from '../../config-types';
import type { Choice, PromptDriver } from '../driver';
import { getDefaultPromptDriver } from '../driver';
import { askInput } from '../helpers';

/**
 * 智能居中全流程采集向导
 */
export async function askCenterConfig(driver: PromptDriver = getDefaultPromptDriver()): Promise<CenterConfig | 'back'> {
    driver.renderHeader('主界面 > 自动居中 (1/3) - 灵敏度设定');
    driver.notify(chalk.cyan('🎯 【智能居中】将基于背景色探测主体内容 Bounding Box...'));

    const threshold = (await askInput<number>(driver, {
        prompt: chalk.gray('  ? 【色差容忍度】(1-100，默认回车 10): '),
        default: '10',
        validate: (raw) => {
            const parsed = parseInt(raw, 10);
            if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
                return true;
            }
            return '❌ 无效输入。请输入 1-100 整数。';
        },
        transform: (raw) => parseInt(raw, 10)
    })) as number;

    driver.renderHeader('主界面 > 自动居中 (2/3) - 填充背景');
    driver.notify(chalk.cyan('🎨 【背景色】当内容偏离中心时，系统将在对向补齐背景色。'));
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
        { key: '0', title: '返回主菜单', description: '已填参数将丢弃', value: 'back', titleColor: chalk.gray }
    ];

    let fillColor = await driver.select(`${chalk.yellow.bold('📦 请选择补白颜色')}:`, fillChoices);
    if (fillColor === 'back') return 'back';
    if (fillColor === 'custom') {
        const customColor = await askInput<string>(driver, {
            prompt: chalk.gray('  ? 请输入十六进制色值码(如 #FF0000): '),
            validate: (raw) => {
                if (/^#[0-9a-fA-F]{6}$/.test(raw) || raw.toLowerCase() === 'transparent') {
                    return true;
                }
                return '❌ 无效的颜色。请输入 #RRGGBB 格式（如 #FF0000）或 transparent。';
            },
            transform: (raw) => (raw.toLowerCase() === 'transparent' ? 'transparent' : raw)
        });
        fillColor = customColor as string;
    }

    driver.renderHeader('主界面 > 自动居中 (3/3) - 最终输出格式');
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
        { key: '0', title: '返回主菜单', description: '已填参数将丢弃', value: 'back', titleColor: chalk.gray }
    ];
    const finalFormatChoice = await driver.select(
        `${chalk.yellow.bold('📦 请选择最终导出格式')}:`,
        formatChoicesCenter
    );
    if (finalFormatChoice === 'back') return 'back';

    const centerConfig: CenterConfig = {
        threshold,
        fillColor,
        outputFormat: finalFormatChoice === 'original' ? undefined : finalFormatChoice
    };
    return centerConfig;
}
