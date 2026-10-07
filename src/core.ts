import type { TargetFormat, AiModel } from './config-types';
import type { OpResult } from './shared/results';
import { transcodeImage } from './transcode';
import { processMatting, type SpinnerLike } from './matting';

// 旧名兼容：统一结果类型
export type ConvertResult = OpResult;
export type { SpinnerLike };

/**
 * 图像处理核心网关兼容适配器（Adapter）
 * @deprecated 核心管线已下沉，生产环境已直调 transcodeImage 与 processMatting 纯算子。
 * 本函数作为向后兼容适配器保留，消除全部手动文件 I/O 并统一路由至对应算子。
 */
export async function convertImage(
    filePath: string,
    format: TargetFormat,
    spinnerInstance: SpinnerLike | null,
    aiModel: AiModel = 'medium'
): Promise<ConvertResult> {
    if (format === 'rmbg_solid') {
        return processMatting(filePath, { aiModel, spinner: spinnerInstance });
    }
    if (format === 'webp' || format === 'png' || format === 'avif' || format === 'mozjpeg') {
        return transcodeImage(filePath, { format });
    }
    return {
        status: 'error',
        file: filePath,
        reason: '不支持的目标格式'
    };
}
