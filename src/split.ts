import sharp from 'sharp';
import path from 'path';
import { writeFile, rm } from 'fs/promises';

import type { SplitResult } from './shared/results';
import { allocateDir } from './shared/output-naming';
import { applyEncoding } from './shared/encode';
import { resolveImageExt } from './shared/formats';
import { BATCH_SIZE } from './shared/constants';
import { centerTileBuffer } from './center';
import { partitionGrid } from './shared/geometry';
import type { ValidatedCenterConfig } from './server/guard';
import type { CenterConfig } from './config-types';

// 兼容旧名：统一复用共享结果类型
export type { SplitResult };

export interface SplitOptions {
    rows?: number;
    cols?: number;
    cutX?: number[]; // 自定义垂直切割线 (X坐标), 升序排列，例如 [0, 300, 700, 1000]
    cutY?: number[]; // 自定义水平切割线 (Y坐标), 升序排列，例如 [0, 500, 1000]
    centerMode?: 'none' | 'keep_ratio' | 'square';
    edgeShave?: number;
    centerConfig?: ValidatedCenterConfig | CenterConfig;
    debugGrid?: boolean;
}

/**
 * 核心切割引擎：
 * 统摄规格预检、解码与 EXIF 摆正、原子目录锁定、受控并发滑动窗口切分、内存级居中变换、单次编码写盘与副产物事务归集
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
    const artifacts: string[] = [];
    let outDir: string | undefined;

    // 格式后缀解析：若 centerConfig 显式指定非 original 格式则优先应用
    let resolvedExt = formatExt;
    if (options.centerConfig?.outputFormat && options.centerConfig.outputFormat !== 'original') {
        resolvedExt = resolveImageExt(options.centerConfig.outputFormat, '.jpg');
    }

    // 阶段 1：几何规格快速预检（零 I/O、零 Sharp，非法参数直接返回错误）
    const preCheck = partitionGrid(options);
    if (!preCheck.ok) {
        return {
            status: 'error',
            file: filePath,
            reason: preCheck.error,
            generatedFiles: [],
            artifacts: []
        };
    }

    try {
        // 阶段 2：源图只读一次并按 EXIF 自动物理摆正，规避竖拍图网格整体错位
        const { data: srcBuffer, info: srcInfo } = await sharp(filePath).rotate().toBuffer({ resolveWithObject: true });
        const width = srcInfo.width || 0;
        const height = srcInfo.height || 0;

        if (!width || !height) {
            throw new Error('无法读取图像尺寸');
        }

        // 阶段 3：纯几何网格求值，生成带有效性判别的瓦片拓扑清单与标尺矢量
        const partition = partitionGrid(options, { width, height }, { debugGrid: options.debugGrid });
        if (!partition.ok || !partition.tiles) {
            return {
                status: 'error',
                file: filePath,
                reason: partition.ok ? '网格计算失败' : partition.error,
                generatedFiles: [],
                artifacts: []
            };
        }

        // 阶段 4：输出目录按 name(1) 递增独占原子分配，杜绝并发命名竞争
        outDir = await allocateDir(path.join(dir, name));

        const failedTiles: Array<{ row: number; col: number; reason: string }> = [];
        const trimFallbacks: Array<{ row: number; col: number; reason: string }> = [];
        const centerFailures: Array<{ file: string; reason: string }> = [];

        // 预收录几何求值阶段发现的越界或零宽坏片
        for (const tile of partition.tiles) {
            if (!tile.isValid) {
                failedTiles.push({
                    row: tile.row,
                    col: tile.col,
                    reason: tile.invalidReason || '切片越界或尺寸非法'
                });
            }
        }

        // 阶段 5：受控并发滑动窗口切分（BATCH_SIZE = 4）
        class TileError extends Error {
            constructor(
                readonly row: number,
                readonly col: number,
                reason: string
            ) {
                super(reason);
            }
        }

        let tileBatch: Array<{ row: number; col: number; job: Promise<string> }> = [];
        const settleBatch = async (): Promise<void> => {
            if (tileBatch.length === 0) return;
            const settlements = await Promise.allSettled(tileBatch.map((tile) => tile.job));
            for (let i = 0; i < settlements.length; i++) {
                const settlement = settlements[i];
                const { row, col } = tileBatch[i];
                if (settlement.status === 'fulfilled') {
                    generatedFiles.push(settlement.value);
                } else {
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

        const validTiles = partition.tiles.filter((t) => t.isValid);

        for (const tile of validTiles) {
            const rName = String(tile.row + 1).padStart(2, '0');
            const cName = String(tile.col + 1).padStart(2, '0');
            const suffix = `_r${rName}_c${cName}`;
            const outputPath = path.join(outDir, `${name}${suffix}${resolvedExt}`);

            const tileJob: Promise<string> = (async () => {
                try {
                    // 从摆正后的内存源 buffer 中直接抽取瓦片
                    const tileBuffer = await sharp(srcBuffer)
                        .extract({ left: tile.left, top: tile.top, width: tile.width, height: tile.height })
                        .toBuffer();

                    let pipeline = sharp(tileBuffer);

                    // 纯内存级居中变换：单阶段完成，消除二次磁盘往返
                    if (options.centerConfig) {
                        try {
                            pipeline = await centerTileBuffer(
                                tileBuffer,
                                { width: tile.width, height: tile.height },
                                options.centerConfig
                            );
                        } catch (centerErr: unknown) {
                            const centerReason = centerErr instanceof Error ? centerErr.message : String(centerErr);
                            centerFailures.push({ file: outputPath, reason: centerReason });
                            pipeline = sharp(tileBuffer);
                        }
                    } else if (options.centerMode && options.centerMode !== 'none') {
                        try {
                            pipeline = await centerTileBuffer(
                                tileBuffer,
                                { width: tile.width, height: tile.height },
                                {
                                    centerMode: options.centerMode,
                                    edgeShave: options.edgeShave
                                }
                            );
                        } catch (trimErr: unknown) {
                            const trimReason = trimErr instanceof Error ? trimErr.message : String(trimErr);
                            trimFallbacks.push({ row: tile.row, col: tile.col, reason: trimReason });
                            pipeline = sharp(tileBuffer);
                        }
                    }

                    // 统一编码并单次落盘
                    pipeline = applyEncoding(pipeline, resolvedExt);
                    await pipeline.toFile(outputPath);
                    return outputPath;
                } catch (err: unknown) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    throw new TileError(tile.row, tile.col, `保存切片 ${suffix} 失败: ${errMsg}`);
                }
            })();

            tileBatch.push({ row: tile.row, col: tile.col, job: tileJob });
            if (tileBatch.length >= BATCH_SIZE) {
                await settleBatch();
            }
        }

        // 收尾最后不足一批的任务
        await settleBatch();

        // 阶段 6：零产出检测与独占目录回滚清理
        if (partition.totalTiles <= 0 || generatedFiles.length === 0) {
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

        // 阶段 7：副产物尽力而为（Best-effort）独立写入
        if (options.debugGrid && partition.svgContent) {
            try {
                const debugFilePath = path.join(outDir, `${name}_debug_grid${resolvedExt}`);
                await sharp(srcBuffer)
                    .composite([{ input: Buffer.from(partition.svgContent), top: 0, left: 0 }])
                    .toFile(debugFilePath);
                artifacts.push(debugFilePath);
            } catch (debugErr: unknown) {
                console.warn(
                    `[split] 排查标尺图生成失败，已跳过: ${debugErr instanceof Error ? debugErr.message : String(debugErr)}`
                );
            }
        }

        const configPath = path.join(outDir, 'split_config.json');
        try {
            await writeFile(
                configPath,
                JSON.stringify(
                    {
                        source: filePath,
                        options,
                        failedTiles,
                        trimFallbacks,
                        ...(centerFailures.length > 0 ? { centerFailures } : {})
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
            ...(failedTiles.length > 0 ? { failedTiles } : {}),
            ...(centerFailures.length > 0 ? { centerFailures } : {})
        };
    } catch (error: unknown) {
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
