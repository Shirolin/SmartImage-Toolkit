import type { ResizeConfig } from './config-types';
import type { OpResult } from './shared/results';
import { defineOperator } from './shared/pipeline';
import { equalExt } from './shared/formats';
import { MAX_DIM, MAX_PERCENT } from './shared/constants';

export type ResizeOptions = ResizeConfig;
// 旧名兼容：统一结果类型
export type ResizeResult = OpResult;

/**
 * 图像缩放核心引擎：纯配方模式
 * I/O、独占占位、EXIF 摆正与异常回滚已下沉至 shared/pipeline
 */
export const resizeImage = defineOperator<ResizeOptions>({
    destination: { suffix: '_resized' },
    transform: ({ sharp, oriented, sourceExt, targetExt, config }) => {
        let targetWidth: number | undefined;
        let targetHeight: number | undefined;
        const resizeFit = config.fit || 'cover';
        const isSameFormat = equalExt(targetExt, sourceExt);

        switch (config.mode) {
            case 'by_width':
                if (!config.width) return { error: '按宽度缩放缺少宽度参数' };
                targetWidth = Math.round(config.width);
                if (targetWidth === oriented.width && isSameFormat) {
                    return { skip: true, reason: '由于宽度未变化且未要求格式转换，已跳过' };
                }
                break;
            case 'by_height':
                if (!config.height) return { error: '按高度缩放缺少高度参数' };
                targetHeight = Math.round(config.height);
                if (targetHeight === oriented.height && isSameFormat) {
                    return { skip: true, reason: '由于高度未变化且未要求格式转换，已跳过' };
                }
                break;
            case 'by_percent':
                if (!config.percent || config.percent <= 0) {
                    return { error: '按比例缩放缺少百分比参数' };
                }
                if (config.percent > MAX_PERCENT) {
                    return {
                        error: `缩放百分比超限：最大 ${MAX_PERCENT}%（当前 ${config.percent}%）`
                    };
                }
                if (config.percent === 100 && isSameFormat) {
                    return { skip: true, reason: '比例为100%且未要求格式转换，已跳过' };
                }
                targetWidth = Math.round(oriented.width * (config.percent / 100));
                if (targetWidth < 1) targetWidth = 1;
                break;
            case 'custom':
                if (!config.width || !config.height) {
                    return { error: '自定义宽高模式参数不完整' };
                }
                targetWidth = Math.round(config.width);
                targetHeight = Math.round(config.height);
                if (targetWidth === oriented.width && targetHeight === oriented.height && isSameFormat) {
                    return { skip: true, reason: '宽高均未变化且未要求格式转换，已跳过' };
                }
                break;
            default:
                return { error: '不支持的缩放模式' };
        }

        const projectedWidth =
            targetWidth ?? (targetHeight !== undefined ? (targetHeight * oriented.width) / oriented.height : 0);
        const projectedHeight =
            targetHeight ?? (targetWidth !== undefined ? (targetWidth * oriented.height) / oriented.width : 0);

        if (projectedWidth > MAX_DIM || projectedHeight > MAX_DIM) {
            return {
                error: `目标尺寸超限：单边最大 ${MAX_DIM}px（计算得 ${Math.round(projectedWidth)}x${Math.round(
                    projectedHeight
                )}）`
            };
        }

        if (config.mode === 'custom') {
            return sharp.resize({
                width: targetWidth,
                height: targetHeight,
                fit: resizeFit
            });
        }

        return sharp.resize({
            width: targetWidth,
            height: targetHeight
        });
    }
});
