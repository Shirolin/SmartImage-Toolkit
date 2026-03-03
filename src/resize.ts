import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export interface ResizeOptions {
    mode: 'by_width' | 'by_height' | 'by_percent' | 'custom';
    width?: number;
    height?: number;
    percent?: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside';
}

export interface ResizeResult {
    status: 'success' | 'error' | 'skipped';
    file: string;
    reason?: string;
}

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

    let outputExt = formatExt || ext.toLowerCase();
    const suffix = '_resized';

    // 如果没有明确指定格式，而且是 jpeg，统一转为了 .jpg，也可以保留原本扩展名
    if (!formatExt && (outputExt === '.jpeg' || outputExt === '.JPG' || outputExt === '.JPEG')) {
        outputExt = '.jpg';
    }

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
                if (targetWidth === metadata.width && (!formatExt || formatExt === ext.toLowerCase())) {
                    return { status: 'skipped', file: filePath, reason: '由于宽度未变化且未要求格式转换，已跳过' };
                }
                break;
            case 'by_height':
                if (!options.height) return { status: 'error', file: filePath, reason: '按高度缩放缺少高度参数' };
                targetHeight = Math.round(options.height);
                if (targetHeight === metadata.height && (!formatExt || formatExt === ext.toLowerCase())) {
                    return { status: 'skipped', file: filePath, reason: '由于高度未变化且未要求格式转换，已跳过' };
                }
                break;
            case 'by_percent':
                if (!options.percent) return { status: 'error', file: filePath, reason: '按比例缩放缺少百分比参数' };
                if (options.percent === 100 && (!formatExt || formatExt === ext.toLowerCase())) {
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
                    (!formatExt || formatExt === ext.toLowerCase())
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

        // 处理输出格式转换
        if (formatExt) {
            switch (formatExt) {
                case '.webp':
                    sharpInstance = sharpInstance.webp({ quality: 80, effort: 6 });
                    break;
                case '.png':
                    sharpInstance = sharpInstance.png({ quality: 75, colors: 256, dither: 1.0, effort: 8 });
                    break;
                case '.jpg':
                    sharpInstance = sharpInstance.jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:4:4' });
                    break;
            }
        }

        // 自动重命名逻辑：检测文件是否存在，如果存在则添加 (1), (2) 后缀
        let outputPath = path.join(dir, `${name}${suffix}${outputExt}`);
        let counter = 1;
        while (fs.existsSync(outputPath)) {
            outputPath = path.join(dir, `${name}${suffix}(${counter})${outputExt}`);
            counter++;
        }

        await sharpInstance.toFile(outputPath);
        return { status: 'success', file: filePath };
    } catch (err: unknown) {
        let saveErr = '未能处理或保存文件';
        if (err instanceof Error) {
            saveErr = err.message;
        }
        return { status: 'error', file: filePath, reason: saveErr };
    }
}
