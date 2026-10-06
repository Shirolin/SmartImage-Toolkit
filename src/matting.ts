import sharp from 'sharp';
import path from 'path';
import url from 'url';
import chalk from 'chalk';
import { promises as fsp } from 'fs';
import { Blob as NodeBlob } from 'buffer';
import { removeBackground } from '@imgly/background-removal-node';

import type { AiModel } from './config-types';
import type { OpResult } from './shared/results';
import { defineOperator } from './shared/pipeline';
import { resolveImageExt, equalExt } from './shared/formats';
import { applyEncoding } from './shared/encode';

/** 终端 Spinner 接口抽象（解除对具体 UI 库的硬依赖） */
export interface SpinnerLike {
    text: string;
    render(): void;
}

/** AI 抠图算子配置接口 */
export interface MattingConfig {
    aiModel?: AiModel;
    spinner?: SpinnerLike | null;
}

export type MattingResult = OpResult;

/**
 * AI 链路内已构造完整用户文案的错误标记：外层依据此标记放行原始文案，
 * 避免叠加重复的「AI 处理异常:」前缀。
 */
export class AiPipelineError extends Error {}

function isBlobLike(value: unknown): value is Blob {
    return typeof value === 'object' && value !== null && typeof (value as Blob).arrayBuffer === 'function';
}

/**
 * AI 神经网络背景抠图纯算子配方
 * I/O、独占占位、EXIF 摆正与异常回滚已下沉至 shared/pipeline
 */
export const processMatting = defineOperator<MattingConfig>({
    resolveTargetExt: ({ sourceExt }) =>
        equalExt(sourceExt, '.webp') ? resolveImageExt('webp', sourceExt) : resolveImageExt('png', sourceExt),
    destination: {
        suffix: '_nobg'
    },
    encode: (pipeline, targetExt) => {
        // AI 出的 RGBA 必须保真：png 显式关闭调色板，防止半透明边缘与渐变色被有损量化破坏
        if (targetExt === '.png') {
            return pipeline.png({ compressionLevel: 9, effort: 8, palette: false });
        }
        return applyEncoding(pipeline, targetExt);
    },
    formatError: (err, stage) => {
        const errorDetails = err instanceof Error ? err.message : String(err) || '未知错误';
        if (err instanceof AiPipelineError) {
            return errorDetails;
        }
        if (stage === 'orient') {
            return `图片文件解析失败 (文件可能已损坏或不支持此处理): ${errorDetails}`;
        }
        if (stage === 'save') {
            return errorDetails;
        }
        return `AI 处理异常: ${errorDetails}`;
    },
    transform: async ({ filePath, sharp: baseSharp, config }) => {
        const { aiModel = 'medium', spinner } = config;
        const name = path.basename(filePath, path.extname(filePath));

        // 1. Web 标准运行时环境断言
        if (typeof globalThis.fetch !== 'function' || typeof globalThis.Response !== 'function') {
            throw new Error(
                `当前运行时 ${process.version} 缺少全局 fetch/Response，AI 抠图需要 Node 18 及以上，请升级 Node 后重试`
            );
        }
        if (typeof globalThis.Blob === 'undefined') {
            Reflect.set(globalThis, 'Blob', NodeBlob);
        }

        if (spinner) {
            spinner.text = chalk.blue(`[AI 引擎就绪] 正在读取并准备提取: ${name}`);
            spinner.render();
        }

        let normalizedBuffer: Buffer | null = null;
        try {
            // baseSharp 已经过管线无参 rotate() 摆正，正向提取为 PNG buffer
            normalizedBuffer = await baseSharp.png().toBuffer();
        } catch (sharpErr: unknown) {
            const errMsg = sharpErr instanceof Error ? sharpErr.message : '未知 Sharp 处理错误';
            throw new AiPipelineError(`图片文件解析失败 (文件可能已损坏或不支持此处理): ${errMsg}`);
        }

        const inputBlob = new Blob([new Uint8Array(normalizedBuffer)], {
            type: 'image/png'
        });

        // 2. 模型资源存在性预检
        const modelDir = path.join(__dirname, '..', 'node_modules', '@imgly', 'background-removal-node', 'dist');
        try {
            await fsp.access(modelDir);
        } catch {
            throw new Error(`AI 模型资源缺失: ${modelDir} 不存在，请先执行 npm install 安装依赖后重试`);
        }

        // 3. 调用 ONNX 推理引擎
        const blob: Blob = await removeBackground(inputBlob, {
            publicPath: url.pathToFileURL(modelDir).href + '/',
            model: aiModel,
            output: {
                format: 'image/x-rgba8',
                quality: 1.0
            },
            progress: (_key: string, current: number, total: number) => {
                try {
                    const percent = ((current / total) * 100).toFixed(1);
                    if (spinner) {
                        spinner.text = chalk.yellow(`🧠 [AI 处理中] 图像: ${name} | 模型(${aiModel}): ${percent}%`);
                        spinner.render();
                    }
                } catch {
                    // 进度渲染失败不污染 AI 推理本身
                }
            }
        });

        if (spinner) {
            spinner.text = chalk.green(`✨ [AI 抠图完成] 图像: ${name} 处理成功，正在保存...`);
            spinner.render();
        }

        if (!isBlobLike(blob)) {
            throw new Error('返回结果缺少 arrayBuffer');
        }

        const arrayBuffer = await blob.arrayBuffer();
        const aiResultBuffer = Buffer.from(arrayBuffer);
        const metadata = await sharp(normalizedBuffer).metadata();

        // 4. 解析与校验尺寸（以返回体携带尺寸为准，解析不到退回输入尺寸）
        const blobDims = /width=(\d+);height=(\d+)/.exec(blob.type);
        const outWidth = blobDims ? Number(blobDims[1]) : (metadata.width ?? 0);
        const outHeight = blobDims ? Number(blobDims[2]) : (metadata.height ?? 0);

        if (outWidth > 0 && outHeight > 0 && aiResultBuffer.length !== outWidth * outHeight * 4) {
            throw new Error(
                `AI 输出尺寸异常: 期望 ${outWidth}x${outHeight}x4=${outWidth * outHeight * 4} 字节，实际 ${aiResultBuffer.length}`
            );
        }

        // 5. 构造纯内存 Sharp 管道交还管线接缝完成编码落盘
        return sharp(aiResultBuffer, {
            raw: {
                width: outWidth,
                height: outHeight,
                channels: 4
            }
        });
    }
});
