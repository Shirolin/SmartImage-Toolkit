import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import url from 'url';
import chalk from 'chalk';
import { removeBackground } from '@imgly/background-removal-node';

import type { TargetFormat, AiModel } from './cli';

// 解决通过 Node 运行与 Web API blob 类型混合引发的编译错误
// 我们将底层库实际操作的输入视为通用 Blob 接口
interface WebBlob extends Blob {
    readonly size: number;
    readonly type: string;
    arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ConvertResult {
    status: 'success' | 'error' | 'skipped';
    file: string;
    reason?: string;
}

// 定义一个基础 Spinner 类型接口，由于不想让核心层强依赖特定 UI 库
export interface SpinnerLike {
    text: string;
    render(): void;
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
            outputExt = '.webp';
            if (ext.toLowerCase() === '.webp') return { status: 'skipped', file: filePath, reason: '已经是该格式' };
            sharpInstance = sharpInstance.webp({ quality: 80, effort: 6 });
            break;
        case 'png':
            outputExt = '.png';
            suffix = '_optimized';
            sharpInstance = sharpInstance.png({ quality: 75, colors: 256, dither: 1.0, effort: 8 });
            break;
        case 'avif':
            outputExt = '.avif';
            if (ext.toLowerCase() === '.avif') return { status: 'skipped', file: filePath, reason: '已经是该格式' };
            sharpInstance = sharpInstance.avif({ quality: 75, effort: 7 });
            break;
        case 'mozjpeg':
            outputExt = '.jpg';
            suffix = '_optimized';
            sharpInstance = sharpInstance.jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:4:4' });
            break;
        case 'rmbg_solid': {
            outputExt = ext.toLowerCase() === '.webp' ? '.webp' : '.png';
            suffix = '_nobg';
            // 内存防漏保护变量
            let normalizedBuffer: Buffer | null = null;
            let finalBuffer: Buffer | null = null;

            try {
                if (spinnerInstance) {
                    spinnerInstance.text = chalk.blue(`[AI 引擎就绪] 正在读取并准备提取: ${name}`);
                    spinnerInstance.render();
                }

                // 细化前置错误捕获（针对格式异常/图片损坏）
                try {
                    normalizedBuffer = await sharp(filePath).png().toBuffer();
                } catch (sharpErr: unknown) {
                    let errMsg = '未知 Sharp 处理错误';
                    if (sharpErr instanceof Error) {
                        errMsg = sharpErr.message;
                    }
                    throw new Error(`图片文件解析失败 (文件可能已损坏或不支持此处理): ${errMsg}`);
                }

                // 手动构造无类型歧义的强类型 Blob，绕过底层解析 Bug
                const { Blob } = await import('buffer');
                // 使用 Uint8Array 包装 Buffer 以契合 Web 标准 BlobPart 的需要
                const inputBlob = new Blob([new Uint8Array(normalizedBuffer)], {
                    type: 'image/png'
                }) as unknown as WebBlob;

                const blob = await removeBackground(inputBlob as Blob, {
                    publicPath:
                        url.pathToFileURL(
                            path.join(__dirname, '..', 'node_modules', '@imgly', 'background-removal-node', 'dist')
                        ).href + '/',
                    model: aiModel,
                    output: {
                        format: 'image/x-rgba8',
                        quality: 1.0
                    },
                    progress: (key: string, current: number, total: number) => {
                        const percent = ((current / total) * 100).toFixed(1);
                        if (spinnerInstance) {
                            spinnerInstance.text = chalk.yellow(
                                `🧠 [AI 处理中] 图像: ${name} | 模型(${aiModel}): ${percent}%`
                            );
                            spinnerInstance.render();
                        }
                    }
                });

                if (spinnerInstance) {
                    spinnerInstance.text = chalk.green(`✨ [AI 抠图完成] 图像: ${name} 处理成功，正在保存...`);
                    spinnerInstance.render();
                }

                // 通过对未知 blob 再次进行安全转换，以此保障 ArrayBuffer 可以正常调起
                const resultBlob = blob as unknown as WebBlob;
                const arrayBuffer = await resultBlob.arrayBuffer();
                const aiResultBuffer = Buffer.from(arrayBuffer);
                const metadata = await sharp(normalizedBuffer).metadata();

                // 根据底层文档 image/x-rgba8 数据格式提取并直接交给 Sharp 原生组装
                let resultSharp = sharp(aiResultBuffer, {
                    raw: {
                        width: metadata.width ?? 0,
                        height: metadata.height ?? 0,
                        channels: 4 // RGBA 4通道
                    }
                });

                if (outputExt === '.webp') {
                    resultSharp = resultSharp.webp({ lossless: true, effort: 6 });
                } else {
                    resultSharp = resultSharp.png({ effort: 8 });
                }

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
            }
            break;
        }
        default:
            return { status: 'error', file: filePath, reason: '不支持的目标格式' };
    }

    // 自动重命名逻辑：检测文件是否存在，如果存在则添加 (1), (2) 后缀
    let outputPath = path.join(dir, `${name}${suffix}${outputExt}`);
    let counter = 1;
    while (fs.existsSync(outputPath)) {
        outputPath = path.join(dir, `${name}${suffix}(${counter})${outputExt}`);
        counter++;
    }

    try {
        await sharpInstance.toFile(outputPath);
        return { status: 'success', file: filePath };
    } catch (err: unknown) {
        let saveErr = '未能保存文件';
        if (err instanceof Error) {
            saveErr = err.message;
        }
        return { status: 'error', file: filePath, reason: saveErr };
    }
}
