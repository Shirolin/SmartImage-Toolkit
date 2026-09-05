import sharp from 'sharp';
import path from 'path';
import url from 'url';
import chalk from 'chalk';
import { promises as fsp } from 'fs';
import { removeBackground } from '@imgly/background-removal-node';

import type { TargetFormat, AiModel } from './cli';
import { resolveImageExt, equalExt } from './shared/formats';
import { applyEncoding } from './shared/encode';
import { allocateFilePath } from './shared/output-naming';
import type { OpResult } from './shared/results';

// 旧名兼容：统一结果类型
export type ConvertResult = OpResult;

// 定义一个基础 Spinner 类型接口，由于不想让核心层强依赖特定 UI 库
export interface SpinnerLike {
    text: string;
    render(): void;
}

// 是否为可用 Blob（带 arrayBuffer 方法）
function isBlobLike(value: unknown): value is Blob {
    return typeof value === 'object' && value !== null && typeof (value as Blob).arrayBuffer === 'function';
}

/**
 * 图像处理核心网关引擎
 */
export async function convertImage(
    filePath: string,
    format: TargetFormat,
    spinnerInstance: SpinnerLike | null,
    aiModel: AiModel = 'medium'
): Promise<ConvertResult> {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);

    let outputExt = '';
    let suffix = '';
    let sharpInstance = sharp(filePath);

    switch (format) {
        case 'webp':
            outputExt = resolveImageExt('webp', ext);
            if (equalExt(ext, '.webp')) return { status: 'skipped', file: filePath, reason: '已经是该格式' };
            sharpInstance = applyEncoding(sharpInstance, outputExt);
            break;
        case 'png':
            outputExt = resolveImageExt('png', ext);
            suffix = '_optimized';
            sharpInstance = applyEncoding(sharpInstance, outputExt);
            break;
        case 'avif':
            outputExt = '.avif';
            if (equalExt(ext, '.avif')) return { status: 'skipped', file: filePath, reason: '已经是该格式' };
            sharpInstance = sharpInstance.avif({ quality: 75, effort: 7 });
            break;
        case 'mozjpeg':
            outputExt = resolveImageExt('mozjpeg', ext);
            suffix = '_optimized';
            sharpInstance = applyEncoding(sharpInstance, outputExt);
            break;
        case 'rmbg_solid': {
            outputExt = equalExt(ext, '.webp') ? resolveImageExt('webp', ext) : resolveImageExt('png', ext);
            suffix = '_nobg';
            let normalizedBuffer: Buffer | null = null;
            let finalBuffer: Buffer | null = null;

            try {
                if (spinnerInstance) {
                    spinnerInstance.text = chalk.blue(`[AI 引擎就绪] 正在读取并准备提取: ${name}`);
                    spinnerInstance.render();
                }

                try {
                    normalizedBuffer = await sharp(filePath).png().toBuffer();
                } catch (sharpErr: unknown) {
                    let errMsg = '未知 Sharp 处理错误';
                    if (sharpErr instanceof Error) {
                        errMsg = sharpErr.message;
                    }
                    throw new Error(`图片文件解析失败 (文件可能已损坏或不支持此处理): ${errMsg}`);
                }

                // 全局 Blob 即 DOM 标准类型，直接满足 removeBackground 入参
                const inputBlob = new Blob([new Uint8Array(normalizedBuffer)], {
                    type: 'image/png'
                });

                // 模型资源先验存在性：缺失时给明确报错而非 removeBackground 的晦涩异常
                // （lib 产物布局下 __dirname=dist/lib，.. 后即 dist/node_modules，dist 包自带）
                const modelDir = path.join(
                    __dirname,
                    '..',
                    'node_modules',
                    '@imgly',
                    'background-removal-node',
                    'dist'
                );
                try {
                    await fsp.access(modelDir);
                } catch {
                    throw new Error(`AI 模型资源缺失: ${modelDir} 不存在，请先执行 npm install 安装依赖后重试`);
                }

                const blob: Blob = await removeBackground(inputBlob, {
                    publicPath: url.pathToFileURL(modelDir).href + '/',
                    model: aiModel,
                    output: {
                        format: 'image/x-rgba8',
                        quality: 1.0
                    },
                    progress: (key: string, current: number, total: number) => {
                        try {
                            const percent = ((current / total) * 100).toFixed(1);
                            if (spinnerInstance) {
                                spinnerInstance.text = chalk.yellow(
                                    `🧠 [AI 处理中] 图像: ${name} | 模型(${aiModel}): ${percent}%`
                                );
                                spinnerInstance.render();
                            }
                        } catch {
                            // 进度渲染失败不污染 AI 推理本身（并发批处理共用 spinner）
                        }
                    }
                });

                if (spinnerInstance) {
                    spinnerInstance.text = chalk.green(`✨ [AI 抠图完成] 图像: ${name} 处理成功，正在保存...`);
                    spinnerInstance.render();
                }

                if (!isBlobLike(blob)) {
                    throw new Error('AI 处理异常: 返回结果缺少 arrayBuffer');
                }
                const arrayBuffer = await blob.arrayBuffer();
                const aiResultBuffer = Buffer.from(arrayBuffer);
                const metadata = await sharp(normalizedBuffer).metadata();

                let resultSharp = sharp(aiResultBuffer, {
                    raw: {
                        width: metadata.width ?? 0,
                        height: metadata.height ?? 0,
                        channels: 4 // RGBA 4通道
                    }
                });

                resultSharp = applyEncoding(resultSharp, outputExt);

                finalBuffer = await resultSharp.toBuffer();
                sharpInstance = sharp(finalBuffer);
            } catch (err: unknown) {
                let errorDetails = '';
                if (err instanceof Error) {
                    errorDetails = err.message;
                }
                return {
                    status: 'error',
                    file: filePath,
                    reason: errorDetails.includes('图片文件解析失败') ? errorDetails : `AI 处理异常: ${errorDetails}`
                };
            } finally {
                normalizedBuffer = null;
                finalBuffer = null;
            }
            break;
        }
        default:
            return { status: 'error', file: filePath, reason: '不支持的目标格式' };
    }

    // 独占命名：占位后直接落盘，避免并发重名
    const outputPath = await allocateFilePath(dir, `${name}${suffix}`, outputExt);

    try {
        await sharpInstance.toFile(outputPath);
        return { status: 'success', file: filePath };
    } catch (err: unknown) {
        // 占位由本进程独占创建：编码失败时删同路径幽灵空文件，不碰目录
        await fsp.unlink(outputPath).catch(() => {});
        let saveErr = '未能保存文件';
        if (err instanceof Error) {
            saveErr = err.message;
        }
        return { status: 'error', file: filePath, reason: saveErr };
    }
}
