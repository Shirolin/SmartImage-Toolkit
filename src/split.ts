import sharp from 'sharp';
import path from 'path';
import { writeFile } from 'fs/promises';

import type { SplitResult } from './shared/results';
import { allocateDir } from './shared/output-naming';
import { applyEncoding } from './shared/encode';
import { SPLIT_TRIM_THRESHOLD } from './shared/constants';

// 兼容旧名：统一复用共享结果类型
export type { SplitResult };

export interface SplitOptions {
    rows: number;
    cols: number;
    cutX?: number[]; // 自定义垂直切割线 (X坐标), 升序排列，例如 [0, 300, 700, 1000]
    cutY?: number[]; // 自定义水平切割线 (Y坐标), 升序排列，例如 [0, 500, 1000]
    centerMode?: 'none' | 'keep_ratio' | 'square';
    edgeShave?: number;
    debugGrid?: boolean;
}

// SVG 属性转义：防特殊字符破坏 debug 覆盖层
function escapeXml(value: string | number): string {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 核心切割引擎
 */
export async function splitImage(
    filePath: string,
    options: SplitOptions,
    formatExt: '.webp' | '.png' | '.jpg' = '.webp'
): Promise<SplitResult> {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);
    const generatedFiles: string[] = [];
    // 非切片产物（排查标尺图、split_config.json）：不计入 success 计数与后处理
    const artifacts: string[] = [];

    try {
        // 源图只读一次：解码得 buffer 并复用 info 尺寸，后续切片全走内存 buffer
        const { data: srcBuffer, info: srcInfo } = await sharp(filePath).toBuffer({ resolveWithObject: true });
        const width = srcInfo.width || 0;
        const height = srcInfo.height || 0;

        if (!width || !height) {
            throw new Error('无法读取图像尺寸');
        }

        // --- 物理网格绝对定位 (Physical Grid Alignment) ---
        // 废弃原先不稳定的“全景寻边”算法。对于带边线的 AI 图，自动寻边会捕捉错误的边界
        // 导致整体网格收缩漂移。现在强制回归物理真实的 100% 原始尺寸进行切分。
        const contentWidth = width;
        const contentHeight = height;
        const offsetLeft = 0;
        const offsetTop = 0;

        // 输出目录按 name(1) 递增独占分配，杜绝并发命名竞争
        const outDir = await allocateDir(path.join(dir, name));

        // 单片失败记账：只记不断整批
        const failedTiles: Array<{ row: number; col: number; reason: string }> = [];
        // trim 回退备注（单片 trim 失败后仍用原碎片跑通，仅留痕排查）
        const trimFallbacks: Array<{ row: number; col: number; reason: string }> = [];

        let svgLines = '';
        if (options.debugGrid) {
            svgLines = `<svg width="${escapeXml(width)}" height="${escapeXml(height)}">
                <rect x="${escapeXml(offsetLeft)}" y="${escapeXml(offsetTop)}" width="${escapeXml(contentWidth)}" height="${escapeXml(contentHeight)}" fill="none" stroke="red" stroke-width="4"/>`;
        }

        const useCustomCuts =
            Array.isArray(options.cutX) &&
            Array.isArray(options.cutY) &&
            options.cutX.length >= 2 &&
            options.cutY.length >= 2;
        const totalRows = useCustomCuts ? options.cutY!.length - 1 : options.rows;
        const totalCols = useCustomCuts ? options.cutX!.length - 1 : options.cols;
        // 分片失败携带坐标的错误类型（供 allSettled 后归因记账）
        class TileError extends Error {
            constructor(
                readonly row: number,
                readonly col: number,
                reason: string
            ) {
                super(reason);
            }
        }

        const tileJobs: Array<Promise<string>> = [];

        for (let row = 0; row < totalRows; row++) {
            for (let col = 0; col < totalCols; col++) {
                // 结合两大核武级别防偏算法:
                // 1. 限定在 offsetLeft/Top 计算的 "内容封包区" 内部运作
                // 2. 采用针对 contentWidth/Height 的百分比端点映射计算，根绝浮点像素吃边漂移
                let innerLeft, innerRight, innerTop, innerBottom;
                if (useCustomCuts) {
                    innerLeft = options.cutX![col];
                    innerRight = options.cutX![col + 1];
                    innerTop = options.cutY![row];
                    innerBottom = options.cutY![row + 1];
                } else {
                    innerLeft = Math.round((col * contentWidth) / options.cols);
                    innerRight = Math.round(((col + 1) * contentWidth) / options.cols);
                    innerTop = Math.round((row * contentHeight) / options.rows);
                    innerBottom = Math.round(((row + 1) * contentHeight) / options.rows);
                }

                const left = offsetLeft + innerLeft;
                const top = offsetTop + innerTop;
                const tileWidth = innerRight - innerLeft;
                const tileHeight = innerBottom - innerTop;

                // 容错：越界或零尺寸格子记账跳过，不中断整批
                if (left + tileWidth > width || top + tileHeight > height || tileWidth <= 0 || tileHeight <= 0) {
                    failedTiles.push({
                        row,
                        col,
                        reason: `切片越界或尺寸非法(left=${left},top=${top},width=${tileWidth},height=${tileHeight})`
                    });
                    continue;
                }

                if (options.debugGrid) {
                    svgLines += `<rect x="${escapeXml(left)}" y="${escapeXml(top)}" width="${escapeXml(tileWidth)}" height="${escapeXml(tileHeight)}" fill="none" stroke="blue" stroke-width="2"/>`;
                }

                // 命名格式：原图名_行_列
                const rName = String(row + 1).padStart(2, '0');
                const cName = String(col + 1).padStart(2, '0');
                const suffix = `_r${rName}_c${cName}`;

                const outputPath = path.join(outDir, `${name}${suffix}${formatExt}`);

                // 单片任务：构建→落盘；失败抛 TileError（携带坐标供 allSettled 归因）
                const tileJob: Promise<string> = (async () => {
                    try {
                        // 从内存源 buffer 切片，不再重复读源文件
                        const tileBuffer = await sharp(srcBuffer)
                            .extract({ left, top, width: tileWidth, height: tileHeight })
                            .toBuffer();

                        let pipeline = sharp(tileBuffer);

                        // 智能居中逻辑
                        if (options.centerMode && options.centerMode !== 'none') {
                            try {
                                // 0. 边缘杂边消除 (Edge Shaving)
                                // 若原图含有不易察觉的切分线网格 (如极淡的灰色1px线条)，会阻碍 trim 的寻路
                                // 依据用户选择，安全向内剃去指定的边缘像素厚度
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

                                // --- 修正采样逻辑：从“剃肉”后的干净 Buffer 中提取背景色 ---
                                const { data, info } = await sharp(shavedBuffer)
                                    .extract({ left: 0, top: 0, width: 1, height: 1 })
                                    .raw()
                                    .toBuffer({ resolveWithObject: true });

                                const r = data[0];
                                const g = data[1];
                                const b = data[2];
                                const alpha = info.channels === 4 ? data[3] : 255;

                                // 1. 修剪空白边缘 (此步骤丢弃所有纯白或透明的边缘填充)
                                // SPLIT_TRIM_THRESHOLD 容差吃掉肉眼看不见但阻碍判空的 WebP/JPEG 压缩噪波点 (如 #Fdfdfd)
                                const trimmedBuffer = await sharp(shavedBuffer)
                                    .trim({
                                        background: { r, g, b, alpha },
                                        threshold: SPLIT_TRIM_THRESHOLD
                                    })
                                    .toBuffer();

                                const trimMeta = await sharp(trimmedBuffer).metadata();
                                const coreWidth = trimMeta.width || tileWidth;
                                const coreHeight = trimMeta.height || tileHeight;

                                // 2. 根据用户要求的最终长宽重新扩展画布
                                let finalCanvasWidth = tileWidth;
                                let finalCanvasHeight = tileHeight;

                                if (options.centerMode === 'square') {
                                    const maxSize = Math.max(tileWidth, tileHeight);
                                    finalCanvasWidth = maxSize;
                                    finalCanvasHeight = maxSize;
                                }

                                // 3. 计算在目标大画布中的安全留白并拓展
                                const extendLeft = Math.floor((finalCanvasWidth - coreWidth) / 2);
                                const extendRight = finalCanvasWidth - coreWidth - extendLeft;
                                const extendTop = Math.floor((finalCanvasHeight - coreHeight) / 2);
                                const extendBottom = finalCanvasHeight - coreHeight - extendTop;

                                pipeline = sharp(trimmedBuffer).extend({
                                    top: extendTop,
                                    bottom: extendBottom,
                                    left: extendLeft,
                                    right: extendRight,
                                    background: { r, g, b, alpha }
                                });
                            } catch (trimErr: unknown) {
                                // trim 失败记因留痕，回退原始碎片继续跑，保证单片不断
                                const trimReason = trimErr instanceof Error ? trimErr.message : String(trimErr);
                                trimFallbacks.push({ row, col, reason: trimReason });
                                pipeline = sharp(tileBuffer);
                            }
                        }

                        // 统一编码（webp/png/jpg 参数收敛到共享 applyEncoding）
                        pipeline = applyEncoding(pipeline, formatExt);

                        await pipeline.toFile(outputPath);
                        return outputPath;
                    } catch (err: unknown) {
                        const errMsg = err instanceof Error ? err.message : String(err);
                        throw new TileError(row, col, `保存切片 ${suffix} 失败: ${errMsg}`);
                    }
                })();

                tileJobs.push(tileJob);
            }
        }

        // 先落盘后记账：toFile 成功才 push，失败记 failedTiles 继续跑
        const settlements = await Promise.allSettled(tileJobs);
        for (const settlement of settlements) {
            if (settlement.status === 'fulfilled') {
                generatedFiles.push(settlement.value);
            } else {
                const tileErr = settlement.reason as TileError;
                failedTiles.push({ row: tileErr.row, col: tileErr.col, reason: tileErr.message });
            }
        }

        // 整批全失败才 error（成功数为零且确实有分片任务）；部分失败仍 success 但带失败分项
        if (totalRows * totalCols > 0 && generatedFiles.length === 0) {
            const summary = failedTiles.map((t) => `r${t.row + 1}c${t.col + 1}:${t.reason}`).join('；');
            return {
                status: 'error',
                file: filePath,
                reason: `全部分片失败(${failedTiles.length}片): ${summary}`,
                generatedFiles: [],
                artifacts,
                failedTiles
            };
        }

        // 排查标尺图 best-effort：失败不影响切片结果；记 artifacts 不计 success
        if (options.debugGrid) {
            try {
                svgLines += `</svg>`;
                const debugFilePath = path.join(outDir, `${name}_debug_grid${formatExt}`);
                await sharp(srcBuffer)
                    .composite([{ input: Buffer.from(svgLines), top: 0, left: 0 }])
                    .toFile(debugFilePath);
                artifacts.push(debugFilePath);
            } catch (debugErr: unknown) {
                // 排查图生成失败仅跳过，整批结果不受影响；留痕供排查
                console.warn(
                    `[split] 排查标尺图生成失败，已跳过: ${debugErr instanceof Error ? debugErr.message : String(debugErr)}`
                );
            }
        }

        // 保存用户切割配置（含失败记账，供排查）
        const configPath = path.join(outDir, 'split_config.json');
        await writeFile(
            configPath,
            JSON.stringify(
                {
                    source: filePath,
                    options: options,
                    failedTiles,
                    trimFallbacks
                },
                null,
                2
            ),
            'utf-8'
        );
        artifacts.push(configPath);

        return {
            status: 'success',
            file: filePath,
            generatedFiles,
            artifacts,
            ...(failedTiles.length > 0 ? { failedTiles } : {})
        };
    } catch (error: unknown) {
        let errorDetails = '';
        if (error instanceof Error) {
            errorDetails = error.message;
        }
        return {
            status: 'error',
            file: filePath,
            reason: `图片切割异常: ${errorDetails}`,
            generatedFiles: [],
            artifacts: []
        };
    }
}
