import sharp from 'sharp';
import path from 'path';
import url from 'url';
import chalk from 'chalk';
import { promises as fsp } from 'fs';
import { Blob as NodeBlob } from 'buffer';
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
 * AI 链路内已构造完整用户文案的错误标记：外层 catch 凭类型判断是否还需要加 `AI 处理异常:` 前缀，
 * 不再靠 `includes('图片文件解析失败')` 这类文案匹配（改文案即退化成双前缀）。
 */
class AiPipelineError extends Error {}

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
    // .rotate() 无参即按 EXIF Orientation 自动定向：sharp 默认不会旋转，且输出会剥离元数据，
    // 手机竖拍图（orientation 6/8）会被转成横躺的成品。orientation=1 时这是 no-op。
    let sharpInstance = sharp(filePath).rotate();

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

            try {
                // AI 抠图链路（本仓与 @imgly 内部）依赖 Web 标准全局：Node 18+ 才同时提供 fetch/Blob。
                // 被裁剪过的运行时或受第三方全局补丁影响的会话可能只剩 fetch 而丢了 Blob，
                // 此时用 node:buffer 的等价实现补回；两者都缺则直接给可操作的版本提示，
                // 不让 "Blob is not defined" 这类晦涩 ReferenceError 冒到用户面前。
                if (typeof globalThis.fetch !== 'function' || typeof globalThis.Response !== 'function') {
                    throw new Error(
                        `当前运行时 ${process.version} 缺少全局 fetch/Response，AI 抠图需要 Node 18 及以上，请升级 Node 后重试`
                    );
                }
                if (typeof globalThis.Blob === 'undefined') {
                    Reflect.set(globalThis, 'Blob', NodeBlob);
                }

                if (spinnerInstance) {
                    spinnerInstance.text = chalk.blue(`[AI 引擎就绪] 正在读取并准备提取: ${name}`);
                    spinnerInstance.render();
                }

                try {
                    // 与转换链路一致：AI 输入也要按 EXIF 摆正，否则抠图基于躺倒的像素做推理
                    normalizedBuffer = await sharp(filePath).rotate().png().toBuffer();
                } catch (sharpErr: unknown) {
                    let errMsg = '未知 Sharp 处理错误';
                    if (sharpErr instanceof Error) {
                        errMsg = sharpErr.message;
                    }
                    throw new AiPipelineError(`图片文件解析失败 (文件可能已损坏或不支持此处理): ${errMsg}`);
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

                // 尺寸以返回体自带的 mime 参数为准（@imgly 会写成 image/x-rgba8;width=W;height=H），
                // 解析不到才退回输入尺寸：sharp 对超长 raw 只静默截断，一旦上游尺寸漂移
                // 就会写出「尺寸正确但像素错位」的图并记成功。长度不符时明确失败。
                const blobDims = /width=(\d+);height=(\d+)/.exec(blob.type);
                const outWidth = blobDims ? Number(blobDims[1]) : (metadata.width ?? 0);
                const outHeight = blobDims ? Number(blobDims[2]) : (metadata.height ?? 0);
                if (outWidth > 0 && outHeight > 0 && aiResultBuffer.length !== outWidth * outHeight * 4) {
                    throw new Error(
                        `AI 输出尺寸异常: 期望 ${outWidth}x${outHeight}x4=${outWidth * outHeight * 4} 字节，实际 ${aiResultBuffer.length}`
                    );
                }

                let resultSharp = sharp(aiResultBuffer, {
                    raw: {
                        width: outWidth,
                        height: outHeight,
                        channels: 4 // RGBA 4通道
                    }
                });

                // AI 出的 RGBA 必须保真：png({quality}) 隐含 palette:true（缩到 ≤256 色并抖动），
                // 会破坏抠图的半透明边缘与渐变色（实测 74.7% 像素被改动、最大偏差 250）。
                // 普通 --format png 的量化优化通道保持不变，只在这里显式关闭调色板。
                resultSharp =
                    outputExt === '.png'
                        ? resultSharp.png({ compressionLevel: 9, effort: 8, palette: false })
                        : applyEncoding(resultSharp, outputExt);

                // 直接把编码管线交给后续 toFile 落盘：此前的 toBuffer() + sharp(finalBuffer) 会
                // 让同一张图多一次完整编解码，且 finally 里的 finalBuffer = null 并不能提前释放内存
                sharpInstance = resultSharp;
            } catch (err: unknown) {
                // 非 Error 抛出（native 层、自定义 polyfill 常见）也要留下可见原因，不能只剩空串
                const errorDetails = err instanceof Error ? err.message : String(err) || '未知错误';
                return {
                    status: 'error',
                    file: filePath,
                    // 内层已构造完整用户文案时按类型放行，不再二次加前缀（与文案解耦）
                    reason: err instanceof AiPipelineError ? errorDetails : `AI 处理异常: ${errorDetails}`
                };
            } finally {
                normalizedBuffer = null;
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
