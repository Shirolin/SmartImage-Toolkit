import type { OpResult } from './shared/results';
import { defineOperator } from './shared/pipeline';
import { resolveImageExt, equalExt } from './shared/formats';

/** 支持的轻量级转码格式目标 */
export type TranscodeFormat = 'webp' | 'png' | 'avif' | 'mozjpeg';

/** 转码算子专属配置接口 */
export interface TranscodeConfig {
    readonly format: TranscodeFormat;
}

export type TranscodeResult = OpResult;

/**
 * 图像格式转码纯算子配方
 * I/O、独占占位、EXIF 摆正与异常回滚已下沉至 shared/pipeline
 */
export const transcodeImage = defineOperator<TranscodeConfig>({
    resolveTargetExt: ({ config }) => resolveImageExt(config.format, '.jpg'),
    destination: ({ config }) => ({
        suffix: config.format === 'png' || config.format === 'mozjpeg' ? '_optimized' : ''
    }),
    transform: ({ sourceExt, targetExt, sharp, config }) => {
        // webp 与 avif 在源格式与目标格式相同时跳过冗余处理
        if ((config.format === 'webp' || config.format === 'avif') && equalExt(sourceExt, targetExt)) {
            return { skip: true, reason: '已经是该格式' };
        }
        return sharp;
    }
});
