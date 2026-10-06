import sharp from 'sharp';
import path from 'path';
import { promises as fsp } from 'fs';

import type { OpResult } from './results';
import { ensureDir, allocateFilePath } from './output-naming';
import { orientedSize } from './orientation';
import { applyEncoding } from './encode';
import { normalizeExt } from './formats';

/** 目标路径规划参数 */
export interface DestinationOptions {
    /** 输出子目录名（如 'centered', 'pad-aspect', 'trimmed'）；缺省表示同级目录 */
    subDir?: string;
    /** 输出文件名后缀（如 '_resized', '_nobg'）；缺省无后缀 */
    suffix?: string;
}

/** 传递给算子变换实现的上下文环境 */
export interface TransformContext<TConfig = void> {
    /** 输入文件绝对路径 */
    filePath: string;
    /** 已经过无参 rotate() 自动摆正的 Sharp 实例 */
    sharp: sharp.Sharp;
    /** 图像在 EXIF 摆正后的正向尺寸 */
    oriented: { width: number; height: number };
    /** 源文件扩展名（已归一化，如 '.jpg'） */
    sourceExt: string;
    /** 最终确定的目标输出扩展名（已归一化） */
    targetExt: string;
    /** 算子专用配置 */
    config: TConfig;
}

/** 算子变换函数的返回值：Sharp 管道、跳过信号、错误信号，或携带附加字段的对象 */
export type TransformOutput<TExtra = Record<string, unknown>> =
    | sharp.Sharp
    | { pipeline: sharp.Sharp; extra?: TExtra }
    | { skip: true; reason: string }
    | { error: string };

/** 底层流水线执行作业规格 */
export interface PipelineJob<TConfig = void, TExtra = Record<string, unknown>> {
    /** 待处理的源图像文件路径 */
    filePath: string;
    /** 算子配置对象（无配置算子可缺省） */
    config: TConfig;
    /** 输出目标扩展名（如 '.webp', '.png', '.jpg'，传入 null 或缺省表示保持原图格式） */
    formatExt?: string | null;
    /** 输出路径规划规则，支持静态声明或基于输入动态生成的计算函数 */
    destination?:
        | DestinationOptions
        | ((ctx: { filePath: string; config: TConfig; targetExt: string }) => DestinationOptions);
    /** 算子纯变换实现 */
    transform: (context: TransformContext<TConfig>) => Promise<TransformOutput<TExtra>> | TransformOutput<TExtra>;
}

/** 算子描述符 */
export interface OperatorDescriptor<TConfig, TExtra = Record<string, unknown>> {
    /** 输出路径规划规则（静态对象或映射函数） */
    destination?:
        | DestinationOptions
        | ((ctx: { filePath: string; config: TConfig; targetExt: string }) => DestinationOptions);
    /** 算子纯变换实现 */
    transform: (context: TransformContext<TConfig>) => Promise<TransformOutput<TExtra>> | TransformOutput<TExtra>;
}

/**
 * 底层执行管线：承载原子占位、EXIF 摆正、格式编码与失败回滚
 */
export async function executePipeline<TConfig = void, TExtra = Record<string, unknown>>(
    job: PipelineJob<TConfig, TExtra>
): Promise<OpResult & TExtra> {
    const { filePath, config, formatExt } = job;
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);

    const sourceExt = normalizeExt(ext);
    const targetExt = normalizeExt(formatExt || ext);

    let outputPath = '';

    try {
        const oriented = await orientedSize(filePath);
        if (!oriented.width || !oriented.height) {
            return {
                status: 'error',
                file: filePath,
                reason: '无法读取图片元数据(宽高)'
            } as OpResult & TExtra;
        }

        const baseSharp = sharp(filePath).rotate();

        const transformOutput = await job.transform({
            filePath,
            sharp: baseSharp,
            oriented,
            sourceExt,
            targetExt,
            config
        });

        let pipeline: sharp.Sharp;
        let extra = {} as TExtra;

        if ('skip' in transformOutput) {
            return {
                status: 'skipped',
                file: filePath,
                reason: transformOutput.reason
            } as OpResult & TExtra;
        } else if ('error' in transformOutput) {
            return {
                status: 'error',
                file: filePath,
                reason: transformOutput.error
            } as OpResult & TExtra;
        } else if ('pipeline' in transformOutput) {
            pipeline = transformOutput.pipeline;
            if (transformOutput.extra) {
                extra = transformOutput.extra;
            }
        } else {
            pipeline = transformOutput;
        }

        let destOpts: DestinationOptions = {};
        if (typeof job.destination === 'function') {
            destOpts = job.destination({ filePath, config, targetExt });
        } else if (job.destination) {
            destOpts = job.destination;
        }

        const outDir = destOpts.subDir ? path.join(dir, destOpts.subDir) : dir;
        const baseName = `${name}${destOpts.suffix ?? ''}`;

        await ensureDir(outDir);
        outputPath = await allocateFilePath(outDir, baseName, targetExt);

        const encodedPipeline = applyEncoding(pipeline, targetExt);
        await encodedPipeline.toFile(outputPath);

        return {
            status: 'success',
            file: filePath,
            ...extra
        } as OpResult & TExtra;
    } catch (err: unknown) {
        if (outputPath) {
            await fsp.unlink(outputPath).catch(() => {});
        }
        let errMsg = '未知错误';
        if (err instanceof Error) {
            errMsg = err.message;
        }
        return {
            status: 'error',
            file: filePath,
            reason: errMsg
        } as OpResult & TExtra;
    }
}

/**
 * 算子定义工厂：将纯内存变换配方柯里化为标准算子调用接口
 */
export function defineOperator<TConfig, TExtra = Record<string, unknown>>(
    descriptor: OperatorDescriptor<TConfig, TExtra>
): (filePath: string, config: TConfig, formatExt?: string | null) => Promise<OpResult & TExtra> {
    return (filePath: string, config: TConfig, formatExt?: string | null) =>
        executePipeline<TConfig, TExtra>({
            filePath,
            config,
            formatExt,
            destination: descriptor.destination,
            transform: descriptor.transform
        });
}

/** 批处理选项 */
export interface BatchOptions {
    batchSize?: number;
    onProgress?: (completed: number, total: number) => void;
}

/**
 * 批处理调度器：受控并发窗口与进度统计
 */
export async function executeBatch<TConfig, TExtra = Record<string, unknown>>(
    files: string[],
    operator: (filePath: string, config: TConfig, formatExt?: string | null) => Promise<OpResult & TExtra>,
    config: TConfig,
    formatExt?: string | null,
    options?: BatchOptions
): Promise<Array<OpResult & TExtra>> {
    const batchSize = options?.batchSize ?? 4;
    const allResults: Array<OpResult & TExtra> = [];

    for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const batchTasks = batch.map((file) =>
            operator(file, config, formatExt).catch(
                (err: unknown) =>
                    ({
                        status: 'error' as const,
                        file,
                        reason: err instanceof Error ? err.message : '未知错误'
                    }) as OpResult & TExtra
            )
        );
        const results = await Promise.all(batchTasks);
        allResults.push(...results);
        options?.onProgress?.(Math.min(i + batchSize, files.length), files.length);
    }

    return allResults;
}
