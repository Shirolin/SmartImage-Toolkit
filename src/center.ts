import sharp from 'sharp';
import type { CenterConfig } from './cli';
import type { OpResult } from './shared/results';
import { defineOperator } from './shared/pipeline';
import { SPLIT_TRIM_THRESHOLD } from './shared/constants';

// 兼容旧名：统一复用共享操作结果类型
export type CenterResult = OpResult;

/** 切片内存级居中配置选项 */
export interface TileCenterOptions {
    centerMode: 'keep_ratio' | 'square';
    edgeShave?: number;
    threshold?: number;
}

/**
 * 专为切片提供的内存级居中变换：
 * 消除边缘杂边、探查背景色、trim 纯色边，并在保持原比例或正方形画布中居中放置
 */
export async function centerTileBuffer(
    tileBuffer: Buffer,
    dimensions: { width: number; height: number },
    options: TileCenterOptions
): Promise<sharp.Sharp> {
    const { width: tileWidth, height: tileHeight } = dimensions;
    const shave = options.edgeShave || 0;
    const shavedBuffer =
        shave > 0 && tileWidth > shave * 2 && tileHeight > shave * 2
            ? await sharp(tileBuffer)
                  .extract({
                      left: shave,
                      top: shave,
                      width: tileWidth - shave * 2,
                      height: tileHeight - shave * 2
                  })
                  .toBuffer()
            : tileBuffer;

    // 从干净 Buffer 提取基准背景色
    const { data, info } = await sharp(shavedBuffer)
        .extract({ left: 0, top: 0, width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true });

    const r = data[0];
    const g = data[1];
    const b = data[2];
    const alpha = info.channels === 4 ? data[3] : 255;

    // 修剪空白边缘
    const trimmedBuffer = await sharp(shavedBuffer)
        .trim({
            background: { r, g, b, alpha },
            threshold: options.threshold ?? SPLIT_TRIM_THRESHOLD
        })
        .toBuffer();

    const trimMeta = await sharp(trimmedBuffer).metadata();
    const coreWidth = trimMeta.width || tileWidth;
    const coreHeight = trimMeta.height || tileHeight;

    let finalCanvasWidth = tileWidth;
    let finalCanvasHeight = tileHeight;

    if (options.centerMode === 'square') {
        const maxSize = Math.max(tileWidth, tileHeight);
        finalCanvasWidth = maxSize;
        finalCanvasHeight = maxSize;
    }

    const extendLeft = Math.floor((finalCanvasWidth - coreWidth) / 2);
    const extendRight = finalCanvasWidth - coreWidth - extendLeft;
    const extendTop = Math.floor((finalCanvasHeight - coreHeight) / 2);
    const extendBottom = finalCanvasHeight - coreHeight - extendTop;

    return sharp(trimmedBuffer).extend({
        top: extendTop,
        bottom: extendBottom,
        left: extendLeft,
        right: extendRight,
        background: { r, g, b, alpha }
    });
}

/**
 * 智能居中算子：探测主体位置并平衡边距，使内容居中
 * I/O、独占占位、EXIF 摆正与异常回滚已下沉至 shared/pipeline
 */
export const processCenter = defineOperator<CenterConfig>({
    destination: { subDir: 'centered' },
    transform: async ({ sharp: sharpPipeline, oriented, config }) => {
        const originalW = oriented.width;
        const originalH = oriented.height;

        // 1. 探测主体内容 (Bounding Box)
        // 利用克隆的已摆正管道做 raw 探测，避免多余全图编解码开销
        const { info: probeInfo } = await sharpPipeline
            .clone()
            .trim({ threshold: config.threshold })
            .raw()
            .toBuffer({ resolveWithObject: true });

        // probeInfo.trimOffsetLeft 和 trimOffsetTop 是负值，代表左侧和顶部被切掉的像素
        const contentLeft = Math.abs(probeInfo.trimOffsetLeft || 0);
        const contentTop = Math.abs(probeInfo.trimOffsetTop || 0);
        const contentW = probeInfo.width;
        const contentH = probeInfo.height;

        // 2. 计算轴向总可用边距 (Total Margins)
        const totalHorizontalMargin = originalW - contentW;
        const totalVerticalMargin = originalH - contentH;

        const allowedSides = config.sides || ['top', 'bottom', 'left', 'right'];
        const hasTop = allowedSides.includes('top');
        const hasBottom = allowedSides.includes('bottom');
        const hasLeft = allowedSides.includes('left');
        const hasRight = allowedSides.includes('right');

        // 3. 应用轴向分配逻辑 (Alignment Distribution)
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

        // 4. 构建并返回变换后 Sharp 管道（编码与落盘由流水线托管）
        return sharpPipeline
            .clone()
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
    }
});
