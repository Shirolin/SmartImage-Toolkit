import sharp from 'sharp';
import path from 'path';
import { promises as fsp } from 'fs';

import { CenterConfig } from './cli';
import type { OpResult } from './shared/results';
import { ensureDir, allocateFilePath } from './shared/output-naming';
import { applyEncoding } from './shared/encode';
import { normalizeExt } from './shared/formats';

// 兼容旧名：统一复用共享操作结果类型
export type CenterResult = OpResult;

export async function processCenter(
    filePath: string,
    config: CenterConfig,
    formatExt: string | null
): Promise<CenterResult> {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);

    // 输出扩展名归一化（小写；.jpeg→.jpg），未知格式原样透传
    const actualExt = normalizeExt(formatExt || ext);
    const outDir = path.join(dir, 'centered');
    await ensureDir(outDir);

    // 独占占位命名，杜绝先判后写竞争
    const outputPath = await allocateFilePath(outDir, name, actualExt);

    try {
        const originalImage = sharp(filePath);
        const metadata = await originalImage.metadata();
        const originalW = metadata.width || 0;
        const originalH = metadata.height || 0;

        // 1. 探测主体内容 (Bounding Box)
        // 我们利用 trim() 的探测能力来寻找主体，但要在内存中拿到结果
        const probe = sharp(filePath).trim({ threshold: config.threshold });
        const { info: probeInfo } = await probe.toBuffer({ resolveWithObject: true });

        // probeInfo.trimOffsetLeft 和 trimOffsetTop 是负值，代表左侧和顶部被切掉的像素
        const contentLeft = Math.abs(probeInfo.trimOffsetLeft || 0);
        const contentTop = Math.abs(probeInfo.trimOffsetTop || 0);
        const contentW = probeInfo.width;
        const contentH = probeInfo.height;

        // 探测出内容即全图时无需特殊处理，直接走统一居中流水线

        // 2. 计算轴向总可用边距 (Total Margins)
        const totalHorizontalMargin = originalW - contentW;
        const totalVerticalMargin = originalH - contentH;

        const allowedSides = config.sides || ['top', 'bottom', 'left', 'right'];
        const hasTop = allowedSides.includes('top');
        const hasBottom = allowedSides.includes('bottom');
        const hasLeft = allowedSides.includes('left');
        const hasRight = allowedSides.includes('right');

        // 3. 应用轴向分配逻辑 (Alignment Distribution)
        // 核心逻辑：不选哪边，哪边不留白。选了哪边，哪边承接边距。
        // 若对向均选，则平分（居中）；若均不选，则画布收缩至内容尺寸。
        const padding = {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0
        };

        // 垂直轴处理
        if (hasTop && hasBottom) {
            padding.top = Math.floor(totalVerticalMargin / 2);
            padding.bottom = totalVerticalMargin - padding.top;
        } else if (hasTop) {
            padding.top = totalVerticalMargin;
        } else if (hasBottom) {
            padding.bottom = totalVerticalMargin;
        }

        // 水平轴处理
        if (hasLeft && hasRight) {
            padding.left = Math.floor(totalHorizontalMargin / 2);
            padding.right = totalHorizontalMargin - padding.left;
        } else if (hasLeft) {
            padding.left = totalHorizontalMargin;
        } else if (hasRight) {
            padding.right = totalHorizontalMargin;
        }

        // 4. 构建处理流水线
        let pipeline = sharp(filePath)
            .extract({
                left: contentLeft,
                top: contentTop,
                width: contentW,
                height: contentH
            })
            .extend({
                ...padding,
                background: config.fillColor === 'transparent' ? { r: 0, g: 0, b: 0, alpha: 0 } : config.fillColor
            });

        // 统一编码后落盘（未知扩展原样透传）
        pipeline = applyEncoding(pipeline, actualExt);

        await pipeline.toFile(outputPath);
        return { status: 'success', file: filePath };
    } catch (err: unknown) {
        // 占位由本进程独占创建：失败时删同路径幽灵空文件，不碰目录
        await fsp.unlink(outputPath).catch(() => {});
        let errMsg = '未知错误';
        if (err instanceof Error) {
            errMsg = err.message;
        }
        return { status: 'error', file: filePath, reason: errMsg };
    }
}
