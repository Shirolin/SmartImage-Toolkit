import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

import { TrimConfig, CropConfig } from './cli';

export interface TrimResult {
    status: 'success' | 'error' | 'skipped';
    file: string;
    reason?: string;
}

export async function processTrimOrCrop(
    filePath: string,
    action: 'trim' | 'crop',
    config: TrimConfig | CropConfig,
    formatExt: string | null
): Promise<TrimResult> {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);

    const actualExt = formatExt || ext.toLowerCase();
    const isTrim = action === 'trim';
    const subDirName = isTrim ? 'trimmed' : 'cropped';
    const outDir = path.join(dir, subDirName);

    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    let outputPath = path.join(outDir, `${name}${actualExt}`);
    let counter = 1;
    while (fs.existsSync(outputPath)) {
        outputPath = path.join(outDir, `${name}(${counter})${actualExt}`);
        counter++;
    }

    try {
        let sharpInstance = sharp(filePath);

        // 关键逻辑分支：trim vs crop
        if (action === 'trim') {
            const trimCfg = config as TrimConfig;

            // --- 智能边向选择探底方案 ---
            // 1. 获取原图尺寸用于对照
            const originalMeta = await sharpInstance.metadata();
            const originalW = originalMeta.width || 0;
            const originalH = originalMeta.height || 0;

            // 2. 隐式测试：仅在内存中执行全方位 Trim 看能切出什么边界
            const testProbe = sharp(filePath).trim({ threshold: trimCfg.threshold });
            const { info: probeInfo } = await testProbe.toBuffer({ resolveWithObject: true });

            // 如果根本没有发生切除行为 (原始尺寸不变)，直接按原图保存跳过后续复杂运算
            if (probeInfo.width === originalW && probeInfo.height === originalH) {
                // 没有被切去白边，无需提取动作
            } else {
                // 解析出系统探测认为应当剔除的四个方位像素量
                // trimOffsetLeft / trimOffsetTop 是被裁切后剩余图像相对于原图左上角的偏移，本质上就是左边和上边被切掉的像素数
                const cutLeft = -(probeInfo.trimOffsetLeft || 0);
                const cutTop = -(probeInfo.trimOffsetTop || 0);

                // 右边的切去量 = 原宽度 - cutLeft - 裁切后的结果新宽度
                const cutRight = originalW - cutLeft - probeInfo.width;
                // 底部的切去量 = 原高度 - cutTop - 裁切后的结果新高度
                const cutBottom = originalH - cutTop - probeInfo.height;

                // 3. 构建我们自己的 extract 方框，决定接纳哪些边的切除建议
                const activeSides = trimCfg.sides || ['top', 'bottom', 'left', 'right'];

                const finalTop = activeSides.includes('top') ? cutTop : 0;
                const finalLeft = activeSides.includes('left') ? cutLeft : 0;
                const finalBottom = activeSides.includes('bottom') ? cutBottom : 0;
                const finalRight = activeSides.includes('right') ? cutRight : 0;

                const newWidth = originalW - finalLeft - finalRight;
                const newHeight = originalH - finalTop - finalBottom;

                if (newWidth <= 0 || newHeight <= 0) {
                    return { status: 'error', file: filePath, reason: '容差计算结果为空或越界。' };
                }

                if (newWidth === originalW && newHeight === originalH) {
                    // 过滤筛选后等价于一刀没切
                } else {
                    sharpInstance = sharpInstance.extract({
                        left: finalLeft,
                        top: finalTop,
                        width: newWidth,
                        height: newHeight
                    });
                }
            }
        } else {
            const cropCfg = config as CropConfig;
            // 需预先知道图片的实际宽高，才能防止切除过度报错
            const metadata = await sharpInstance.metadata();
            const width = metadata.width || 0;
            const height = metadata.height || 0;

            const newWidth = width - cropCfg.left - cropCfg.right;
            const newHeight = height - cropCfg.top - cropCfg.bottom;

            if (newWidth <= 0 || newHeight <= 0) {
                return { status: 'error', file: filePath, reason: '裁剪范围大于原图尺寸，将导致图像消失！' };
            }

            sharpInstance = sharpInstance.extract({
                left: cropCfg.left,
                top: cropCfg.top,
                width: newWidth,
                height: newHeight
            });
        }

        // 根据格式进行最终编码存储
        switch (actualExt) {
            case '.webp':
                sharpInstance = sharpInstance.webp({ quality: 90, effort: 6 });
                break;
            case '.png':
                sharpInstance = sharpInstance.png({ quality: 90, effort: 8 });
                break;
            case '.jpg':
            case '.jpeg':
                sharpInstance = sharpInstance.jpeg({ quality: 90, mozjpeg: true });
                break;
        }

        await sharpInstance.toFile(outputPath);
        return { status: 'success', file: filePath };
    } catch (err: unknown) {
        let errMsg = '未知错误';
        if (err instanceof Error) {
            errMsg = err.message;
        }
        return { status: 'error', file: filePath, reason: errMsg };
    }
}
