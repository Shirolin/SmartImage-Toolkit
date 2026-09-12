import sharp from 'sharp';
import path from 'path';
import { writeFile, rm } from 'fs/promises';

import type { SplitResult } from './shared/results';
import { allocateDir } from './shared/output-naming';
import { applyEncoding } from './shared/encode';
import { SPLIT_TRIM_THRESHOLD, MAX_TILES, BATCH_SIZE } from './shared/constants';

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
    // 输出目录外置声明：catch 需据此清理失败留下的空目录
    let outDir: string | undefined;

    // 入口参数校验：必须在建目录/解码前拦下非法 rows/cols 或切割线，
    // 否则双层循环 0 次会产出空切片却仍报 success（见缺陷 1）
    const useCustomCuts =
        Array.isArray(options.cutX) &&
        Array.isArray(options.cutY) &&
        options.cutX.length >= 2 &&
        options.cutY.length >= 2;
    const hasAnyCustomCuts = Array.isArray(options.cutX) || Array.isArray(options.cutY);
    if (hasAnyCustomCuts) {
        if (!useCustomCuts) {
            return {
                status: 'error',
                file: filePath,
                reason: '自定义切割线非法：cutX/cutY 需同时提供，且各自至少包含 2 个坐标点',
                generatedFiles: [],
                artifacts: []
            };
        }
    } else if (
        !Number.isInteger(options.rows) ||
        options.rows < 1 ||
        !Number.isInteger(options.cols) ||
        options.cols < 1
    ) {
        return {
            status: 'error',
            file: filePath,
            reason: `行列数非法：rows/cols 必须为不小于 1 的整数(当前 rows=${options.rows}, cols=${options.cols})`,
            generatedFiles: [],
            artifacts: []
        };
    }

    const totalRows = useCustomCuts ? options.cutY!.length - 1 : options.rows;
    const totalCols = useCustomCuts ? options.cutX!.length - 1 : options.cols;
    // 总量上限与服务端 /api/split-custom 同口径（MAX_TILES），避免超大任务把内存打爆（见缺陷 4）
    if (totalRows * totalCols > MAX_TILES) {
        return {
            status: 'error',
            file: filePath,
            reason: `切片总数超限：最多 ${MAX_TILES} 张(当前 ${totalRows * totalCols} 张)`,
            generatedFiles: [],
            artifacts: []
        };
    }

    try {
        // 源图只读一次：解码得 buffer 并复用 info 尺寸，后续切片全走内存 buffer
        // rotate() 无参时按 EXIF Orientation 自动摆正：手机竖拍图（orientation 5~8）必须先摆正，
        // 否则 info 宽高仍是横躺的原始尺寸，网格切割线会整体错位
        const { data: srcBuffer, info: srcInfo } = await sharp(filePath).rotate().toBuffer({ resolveWithObject: true });
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
        outDir = await allocateDir(path.join(dir, name));

        // 单片失败记账：只记不断整批
        const failedTiles: Array<{ row: number; col: number; reason: string }> = [];
        // trim 回退备注（单片 trim 失败后仍用原碎片跑通，仅留痕排查）
        const trimFallbacks: Array<{ row: number; col: number; reason: string }> = [];

        let svgLines = '';
        if (options.debugGrid) {
            svgLines = `<svg width="${escapeXml(width)}" height="${escapeXml(height)}">
                <rect x="${escapeXml(offsetLeft)}" y="${escapeXml(offsetTop)}" width="${escapeXml(contentWidth)}" height="${escapeXml(contentHeight)}" fill="none" stroke="red" stroke-width="4"/>`;
        }

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

        // 分批并发：每批最多 BATCH_SIZE 个切片任务，批内 settle 后再建下一批，
        // 避免一次性为全部格子建管道导致内存打爆（见缺陷 4）
        // 批次条目带上坐标：settle 时机（批满/收尾）与格子循环不同步，用循环变量归因会错行错列
        let tileBatch: Array<{ row: number; col: number; job: Promise<string> }> = [];
        // 先落盘后记账：toFile 成功才 push，失败记 failedTiles 继续跑
        const settleBatch = async (): Promise<void> => {
            if (tileBatch.length === 0) return;
            const settlements = await Promise.allSettled(tileBatch.map((tile) => tile.job));
            for (let i = 0; i < settlements.length; i++) {
                const settlement = settlements[i];
                const { row, col } = tileBatch[i];
                if (settlement.status === 'fulfilled') {
                    generatedFiles.push(settlement.value);
                } else {
                    // 收窄而非断言：非 TileError（如原生层异常）也按普通错误记账，
                    // 否则记账循环自身抛错会被外层折成 error + generatedFiles: []，整批账本全丢（见缺陷 5）
                    const reason = settlement.reason;
                    if (reason instanceof TileError) {
                        failedTiles.push({ row: reason.row, col: reason.col, reason: reason.message });
                    } else {
                        failedTiles.push({
                            row,
                            col,
                            reason: reason instanceof Error ? reason.message : String(reason)
                        });
                    }
                }
            }
            tileBatch = [];
        };

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

                tileBatch.push({ row, col, job: tileJob });
                // 批满即 settle，控制同时在跑的 sharp 管道数量
                if (tileBatch.length >= BATCH_SIZE) {
                    await settleBatch();
                }
            }
        }

        // 收尾：settle 最后不足一批的任务
        await settleBatch();

        // 整批失败或零切片必然 error（成功数为零即失败）；部分失败仍 success 但带失败分项
        if (totalRows * totalCols <= 0 || generatedFiles.length === 0) {
            // 零产出：删除刚分配的空输出目录，反复失败不再堆积 name(1)/name(2)（见缺陷 3）
            await rm(outDir, { recursive: true, force: true }).catch(() => {});
            const summary = failedTiles.map((t) => `r${t.row + 1}c${t.col + 1}:${t.reason}`).join('；');
            return {
                status: 'error',
                file: filePath,
                reason:
                    failedTiles.length > 0
                        ? `全部分片失败(${failedTiles.length}片): ${summary}`
                        : '未生成任何切片：切割线或网格参数未产生有效切片',
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
        // best-effort：切片已落盘，配置写入失败只告警，绝不把整批降级为 error（见缺陷 2）
        const configPath = path.join(outDir, 'split_config.json');
        try {
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
        } catch (configErr: unknown) {
            console.warn(
                `[split] 切割配置写入失败，已跳过: ${configErr instanceof Error ? configErr.message : String(configErr)}`
            );
        }

        return {
            status: 'success',
            file: filePath,
            generatedFiles,
            artifacts,
            ...(failedTiles.length > 0 ? { failedTiles } : {})
        };
    } catch (error: unknown) {
        // 兜底清理：无任何切片成功时删掉刚分配的输出目录（见缺陷 3）
        if (outDir && generatedFiles.length === 0) {
            await rm(outDir, { recursive: true, force: true }).catch(() => {});
        }
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
