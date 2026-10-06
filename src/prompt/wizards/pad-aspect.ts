import chalk from 'chalk';
import type { PadAspectConfig } from '../../config-types';
import type { Choice, PromptDriver } from '../driver';
import { getDefaultPromptDriver } from '../driver';
import { askInput, isValidFillColor } from '../helpers';
import { MAX_DIM } from '../../shared/constants';
import { parseAspect as parseAspectChoice } from '../../pad-aspect';

/**
 * 画布扩边 / 比例对齐全流程采集向导
 */
export async function askPadAspectConfig(
    driver: PromptDriver = getDefaultPromptDriver()
): Promise<PadAspectConfig | 'back'> {
    driver.renderHeader('主界面 > 画布扩边 (Pad Aspect) (1/5) - 目标比例');
    const aspectMessage = `${chalk.blue.bold('🖼️ 请选择目标画布比例 (长边默认 1080/1920)')}:\n${chalk.gray('  ? 目标比例:')}`;
    const aspectChoices: Choice<'16:9' | '9:16' | '1:1' | 'custom' | 'back'>[] = [
        {
            key: '1',
            title: '16:9',
            description: '横屏视频 (1920×1080)',
            value: '16:9',
            titleColor: chalk.cyan.bold
        },
        {
            key: '2',
            title: '9:16',
            description: '竖屏视频 (1080×1920)',
            value: '9:16',
            titleColor: chalk.cyan.bold
        },
        {
            key: '3',
            title: '1:1',
            description: '正方形 (1920×1920)',
            value: '1:1',
            titleColor: chalk.cyan.bold
        },
        {
            key: '4',
            title: '自定义 W:H',
            description: '输入如 4:5 两个正整数',
            value: 'custom',
            titleColor: chalk.magenta.bold
        },
        { key: '0', title: '返回主菜单', description: '已填参数将丢弃', value: 'back', titleColor: chalk.gray }
    ];

    const aspectChoice = await driver.select(aspectMessage, aspectChoices);
    if (aspectChoice === 'back') return 'back';

    let aspect: string = aspectChoice;
    if (aspectChoice === 'custom') {
        const customAspect = await askInput<string>(driver, {
            prompt: chalk.cyan('  ? 【自定义比例】请输入 W:H (例如 4:5): '),
            validate: (raw) => {
                const parsed = parseAspectChoice(raw);
                if (parsed) return true;
                return '❌ 无效的输入。请输入 W:H 格式的两个正整数（如 4:5、21:9）。';
            },
            transform: (raw) => {
                const parsed = parseAspectChoice(raw)!;
                return `${parsed.w}:${parsed.h}`;
            }
        });
        aspect = customAspect as string;
    }

    driver.renderHeader(`主界面 > 画布扩边 (Pad Aspect) (2/5) - 主体模式 (${aspect})`);
    const modeMessage = `${chalk.blue.bold('📐 主体如何界定？')}:\n${chalk.gray('  ? 主体模式:')}`;
    const modeChoices: Choice<'full_image' | 'trim_bbox' | 'back'>[] = [
        {
            key: '1',
            title: '整图当主体 (默认)',
            description: '像素角色/纯色底最稳：整张图等比缩小',
            value: 'full_image',
            titleColor: chalk.green.bold
        },
        {
            key: '2',
            title: '探测主体边界 (Trim BBox)',
            description: '先按容差去掉纯色边框，再对主体缩小',
            value: 'trim_bbox',
            titleColor: chalk.yellow
        },
        { key: '0', title: '返回主菜单', description: '已填参数将丢弃', value: 'back', titleColor: chalk.gray }
    ];
    const subjectMode = await driver.select(modeMessage, modeChoices);
    if (subjectMode === 'back') return 'back';

    let threshold: number | undefined;
    if (subjectMode === 'trim_bbox') {
        threshold = (await askInput<number>(driver, {
            prompt: chalk.gray('  ? 【色差容忍度】用于探测纯色边 (1-100，默认回车 10): '),
            default: '10',
            validate: (raw) => {
                const parsed = parseInt(raw, 10);
                if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) return true;
                return '❌ 无效的输入。请输入 1-100 之间的整数。';
            },
            transform: (raw) => parseInt(raw, 10)
        })) as number;
    }

    driver.renderHeader('主界面 > 画布扩边 (Pad Aspect) (3/5) - 主体占比与画布长边');
    const subjectRatio = (await askInput<number>(driver, {
        prompt: chalk.gray('  ? 【主体占画布高度比例】(0.40-0.80，默认回车 0.60，字面 0.4~0.8 也认): '),
        default: '0.6',
        validate: (raw) => {
            const parsed = Number(raw.trim());
            if (!isNaN(parsed) && parsed >= 0.4 && parsed <= 0.8) return true;
            return '❌ 无效的输入。请输入 0.40-0.80 之间的数字（例如 0.6）。';
        },
        transform: (raw) => Number(raw.trim())
    })) as number;

    const longEdge = (await askInput<number>(driver, {
        prompt: chalk.gray(`  ? 【画布长边像素】(上限 ${MAX_DIM}，默认回车 1920): `),
        default: '1920',
        validate: (raw) => {
            const parsed = parseInt(raw, 10);
            if (!isNaN(parsed) && parsed >= 1 && parsed <= MAX_DIM) return true;
            return `❌ 无效的输入。请输入 1-${MAX_DIM} 之间的整数。`;
        },
        transform: (raw) => parseInt(raw, 10)
    })) as number;

    driver.renderHeader('主界面 > 画布扩边 (Pad Aspect) (4/5) - 填充背景');
    const fillMessage = `${chalk.blue.bold('🎨 目标画布四周的空白用什么填充？')}:\n${chalk.gray('  ? 填充方式:')}`;
    const fillChoices: Choice<'transparent' | '#FFFFFF' | 'custom' | 'auto' | 'back'>[] = [
        {
            key: '1',
            title: '全透明 (Transparent)',
            description: '输出 PNG/WebP 保留透明',
            value: 'transparent',
            titleColor: chalk.green
        },
        {
            key: '2',
            title: '纯白 (#FFFFFF)',
            description: 'JPG 适用',
            value: '#FFFFFF',
            titleColor: chalk.white
        },
        {
            key: '3',
            title: '取图边缘主色 (Auto)',
            description: '按源图一角像素自动补底色',
            value: 'auto',
            titleColor: chalk.cyan
        },
        {
            key: '4',
            title: '自定义 Hex 色值',
            description: '手动输入如 #0088FF',
            value: 'custom',
            titleColor: chalk.blue
        },
        { key: '0', title: '返回主菜单', description: '已填参数将丢弃', value: 'back', titleColor: chalk.gray }
    ];

    const fillPick = await driver.select(fillMessage, fillChoices);
    if (fillPick === 'back') return 'back';

    const config: PadAspectConfig = {
        aspect,
        subjectRatio,
        subjectMode,
        fill: fillPick === 'transparent' ? 'transparent' : 'color'
    };
    if (subjectMode === 'trim_bbox' && threshold !== undefined) config.threshold = threshold;
    config.longEdge = longEdge;

    if (fillPick === 'custom') {
        const customFill = await askInput<string>(driver, {
            prompt: chalk.gray('  ? 请输入十六进制色值码(如 #0088FF)或 transparent: '),
            validate: (raw) => {
                if (isValidFillColor(raw)) return true;
                return '❌ 无效的颜色。请输入 #RRGGBB / #RRGGBBAA（如 #0088FF）或 transparent。';
            },
            transform: (raw) => raw
        });
        config.fillColor = customFill as string;
    } else {
        config.fillColor = fillPick;
    }

    driver.renderHeader('主界面 > 画布扩边 (Pad Aspect) (5/5) - 最终输出格式');
    const formatMessage = `${chalk.blue.bold('📦 请选择扩边后文件的最终导出格式')}:\n${chalk.gray('  ? 导出格式:')}`;
    const formatChoicesPad: Choice<'original' | 'webp' | 'png' | 'mozjpeg' | 'back'>[] = [
        {
            key: '1',
            title: '保持原格式 (默认)',
            description: '沿用修改前文件的扩展名',
            value: 'original',
            titleColor: chalk.white
        },
        { key: '2', title: 'WebP', description: '体积最小，支持透明', value: 'webp', titleColor: chalk.green.bold },
        { key: '3', title: 'PNG', description: '无损画质，保留透明', value: 'png', titleColor: chalk.green.bold },
        {
            key: '4',
            title: 'JPG (MozJPEG)',
            description: '透明将被烘焙为底色',
            value: 'mozjpeg',
            titleColor: chalk.green.bold
        },
        { key: '0', title: '返回主菜单', description: '已填参数将丢弃', value: 'back', titleColor: chalk.gray }
    ];
    const outFormat = await driver.select(formatMessage, formatChoicesPad);
    if (outFormat === 'back') return 'back';
    if (outFormat !== 'original') config.outputFormat = outFormat;

    driver.clear();
    return config;
}
