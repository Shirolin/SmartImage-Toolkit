import chalk from 'chalk';
import type { ResizeConfig } from '../../config-types';
import type { Choice, PromptDriver } from '../driver';
import { getDefaultPromptDriver } from '../driver';
import { askDimension, askPercent } from '../helpers';
import { MAX_DIM, MAX_PERCENT } from '../../shared/constants';

/**
 * 批量缩放全流程采集向导
 */
export async function askResizeConfig(driver: PromptDriver = getDefaultPromptDriver()): Promise<ResizeConfig | 'back'> {
    driver.renderHeader('主界面 > 批量缩放 (1/3) - 缩放模式');
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

    const resizeMode = await driver.select(resizeModeMessage, resizeModeChoices);
    if (resizeMode === 'back') return 'back';

    const resizeConfig: ResizeConfig = { mode: resizeMode };

    driver.renderHeader('主界面 > 批量缩放 (2/3) - 尺寸参数');

    if (resizeMode === 'by_width') {
        resizeConfig.width = await askDimension(
            driver,
            chalk.cyan('  ? 【目标宽度】: 请输入想要缩放到的宽度像素值(例如 800): '),
            MAX_DIM
        );
    } else if (resizeMode === 'by_height') {
        resizeConfig.height = await askDimension(
            driver,
            chalk.cyan('  ? 【目标高度】: 请输入想要缩放到的高度像素值(例如 600): '),
            MAX_DIM
        );
    } else if (resizeMode === 'by_percent') {
        resizeConfig.percent = await askPercent(
            driver,
            chalk.cyan('  ? 【缩放百分比】: 请输入百分比数值 (例如 50 代表缩小到一半, 200 代表放大两倍): '),
            MAX_PERCENT
        );
    } else if (resizeMode === 'custom') {
        resizeConfig.width = await askDimension(driver, chalk.cyan('  ? 【目标宽度】: 请输入宽度像素值: '), MAX_DIM);
        resizeConfig.height = await askDimension(driver, chalk.cyan('  ? 【目标高度】: 请输入高度像素值: '), MAX_DIM);

        driver.notify('');
        const fitMessage = `${chalk.blue.bold('📏 对于不匹配的宽高比例，请选择适配策略')}:\n${chalk.gray('  ? 适配策略:')}`;
        const fitChoices: Choice<'cover' | 'contain' | 'fill' | 'inside' | 'back'>[] = [
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
            },
            {
                key: '0',
                title: '返回主菜单',
                description: '已填参数将丢弃',
                value: 'back',
                titleColor: chalk.gray
            }
        ];
        const fit = await driver.select(fitMessage, fitChoices);
        if (fit === 'back') return 'back';
        resizeConfig.fit = fit;
    }

    driver.renderHeader('主界面 > 批量缩放 (3/3) - 最终输出格式');
    const formatMessage = `${chalk.blue.bold('📦 请选择缩放后文件的最终导出格式')}:\n${chalk.gray('  ? 导出格式:')}`;
    const formatChoices: Choice<'original' | 'webp' | 'png' | 'mozjpeg' | 'back'>[] = [
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
            title: '返回主菜单',
            description: '已填缩放参数将丢弃',
            value: 'back',
            titleColor: chalk.gray
        }
    ];
    const outputFormat = await driver.select(formatMessage, formatChoices);
    if (outputFormat === 'back') return 'back';
    resizeConfig.outputFormat = outputFormat;

    driver.clear();
    return resizeConfig;
}
