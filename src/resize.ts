import sharp from 'sharp';
import path from 'path';
import { promises as fsp } from 'fs';

import { normalizeExt, equalExt } from './shared/formats';
import { applyEncoding } from './shared/encode';
import { allocateFilePath } from './shared/output-naming';
import type { OpResult } from './shared/results';

export interface ResizeOptions {
    mode: 'by_width' | 'by_height' | 'by_percent' | 'custom';
    width?: number;
    height?: number;
    percent?: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside';
}

// 旧名兼容：统一结果类型
export type ResizeResult = OpResult;

/**
 * 图像缩放核心引擎
 * @param filePath 图像路径
 * @param Object resize选项配置
 * @param formatExt 用户选择的输出格式（如果要格式转换则传入 .webp/.png/.jpg 等），不传或 null 表示保持原定格式
 */
export async function resizeImage(
    filePath: string,
    options: ResizeOptions,
    formatExt?: '.webp' | '.png' | '.jpg' | null
): Promise<ResizeResult> {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);

    // 归一化输出扩展名：调用方传入 .jpeg 或大写时统一为 .jpg 等
    const normalizedFormat = formatExt ? normalizeExt(formatExt) : null;
    const outputExt = normalizedFormat ?? normalizeExt(ext);
    const suffix = '_resized';
    // 占位路径外置声明：元数据失败时尚未占位，catch 需守卫
    let outputPath: string | undefined;

    try {
        const metadata = await sharp(filePath).metadata();
        let targetWidth: number | undefined = undefined;
        let targetHeight: number | undefined = undefined;
        const resizeFit = options.fit || 'inside';

        if (!metadata.width || !metadata.height) {
            return { status: 'error', file: filePath, reason: '无法读取图片元数据(宽高)' };
        }

        switch (options.mode) {
            case 'by_width':
                if (!options.width) return { status: 'error', file: filePath, reason: '按宽度缩放缺少宽度参数' };
                targetWidth = Math.round(options.width);
                if (targetWidth === metadata.width && (!normalizedFormat || equalExt(normalizedFormat, ext))) {
                    return { status: 'skipped', file: filePath, reason: '由于宽度未变化且未要求格式转换，已跳过' };
                }
                break;
            case 'by_height':
                if (!options.height) return { status: 'error', file: filePath, reason: '按高度缩放缺少高度参数' };
                targetHeight = Math.round(options.height);
                if (targetHeight === metadata.height && (!normalizedFormat || equalExt(normalizedFormat, ext))) {
                    return { status: 'skipped', file: filePath, reason: '由于高度未变化且未要求格式转换，已跳过' };
                }
                break;
            case 'by_percent':
                // 负数与 0/缺失同等视为非法：钳到 1px 记成功会掩盖参数错误
                if (!options.percent || options.percent <= 0)
                    return { status: 'error', file: filePath, reason: '按比例缩放缺少百分比参数' };
                if (options.percent === 100 && (!normalizedFormat || equalExt(normalizedFormat, ext))) {
                    return { status: 'skipped', file: filePath, reason: '比例为100%且未要求格式转换，已跳过' };
                }
                targetWidth = Math.round(metadata.width * (options.percent / 100));
                // 为了防止四舍五入后变为 0
                if (targetWidth < 1) targetWidth = 1;
                break;
            case 'custom':
                if (!options.width || !options.height)
                    return { status: 'error', file: filePath, reason: '自定义宽高模式参数不完整' };
                targetWidth = Math.round(options.width);
                targetHeight = Math.round(options.height);
                if (
                    targetWidth === metadata.width &&
                    targetHeight === metadata.height &&
                    (!normalizedFormat || equalExt(normalizedFormat, ext))
                ) {
                    return { status: 'skipped', file: filePath, reason: '宽高均未变化且未要求格式转换，已跳过' };
                }
                break;
            default:
                return { status: 'error', file: filePath, reason: '不支持的缩放模式' };
        }

        let sharpInstance = sharp(filePath);

        // 如果是 custom 模式，需要传入 fit 参数。否则 sharp 默认按比例缩放（高度或者宽度适应）
        if (options.mode === 'custom') {
            sharpInstance = sharpInstance.resize({
                width: targetWidth,
                height: targetHeight,
                fit: resizeFit
            });
        } else {
            sharpInstance = sharpInstance.resize({
                width: targetWidth,
                height: targetHeight
            });
        }

        // 统一编码：按目标扩展名应用输出配置
        if (normalizedFormat) {
            sharpInstance = applyEncoding(sharpInstance, normalizedFormat);
        }

        // 独占命名：占位后直接落盘，避免并发重名
        outputPath = await allocateFilePath(dir, `${name}${suffix}`, outputExt);

        await sharpInstance.toFile(outputPath);
        return { status: 'success', file: filePath };
    } catch (err: unknown) {
        // 占位由本进程独占创建：失败时删同路径幽灵空文件，不碰目录
        if (outputPath) await fsp.unlink(outputPath).catch(() => {});
        let saveErr = '未能处理或保存文件';
        if (err instanceof Error) {
            saveErr = err.message;
        }
        return { status: 'error', file: filePath, reason: saveErr };
    }
}
