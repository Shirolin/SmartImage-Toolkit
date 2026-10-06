import sharp from 'sharp';
import type { TrimConfig, CropConfig } from './config-types';
import type { OpResult } from './shared/results';
import { defineOperator } from './shared/pipeline';

// trim 专属结果：成功时附带 residue 报告（实际切量 + 探测口径分类 + 置信度）
// cuts 是 sides 过滤后实际执行的切除；kinds 走全量探测口径——被 sides 滤掉的边也会如实标注，方便发现“故意保留的残留”
// feathered/content 为防御分支：常规输入 probe 切除带恒自洽（只走 uniform/noisy），仅在探测与分类口径分歧时触发
export type TrimSideKind = 'uniform' | 'feathered' | 'noisy' | 'content' | 'none';
export interface TrimCuts {
    top: number;
    bottom: number;
    left: number;
    right: number;
}
export type TrimSideMap = Record<'top' | 'bottom' | 'left' | 'right', TrimSideKind>;
export interface TrimResidue {
    cuts: TrimCuts;
    kinds: TrimSideMap;
    confidence: number;
}
export interface TrimResult extends OpResult {
    residue?: TrimResidue;
}

// 单边条带分类：bg 取全图左上角像素，alpha 一并计入距离
function classifyStrip(
    data: Buffer,
    imgW: number,
    x0: number,
    y0: number,
    w: number,
    h: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    tol: number
): TrimSideKind {
    if (w <= 0 || h <= 0) return 'none';
    let similar = 0;
    let partialAlpha = 0;
    const total = w * h;
    for (let y = y0; y < y0 + h; y++) {
        const rowBase = y * imgW * 4;
        for (let x = x0; x < x0 + w; x++) {
            const i = rowBase + x * 4;
            const r = data[i] ?? bgR;
            const g = data[i + 1] ?? bgG;
            const b = data[i + 2] ?? bgB;
            const a = data[i + 3] ?? bgA;
            if (
                Math.abs(r - bgR) <= tol &&
                Math.abs(g - bgG) <= tol &&
                Math.abs(b - bgB) <= tol &&
                Math.abs(a - bgA) <= tol
            ) {
                similar++;
            }
            if (a > 0 && a < 255) partialAlpha++;
        }
    }
    const similarFrac = similar / total;
    if (similarFrac >= 0.98) return 'uniform';
    if (similarFrac >= 0.9) return 'noisy';
    if (partialAlpha / total >= 0.15) return 'feathered';
    return 'content';
}

// residue 组装：单次 raw 解码摆正后的原图并逐边分类；调用方只在确实发生切除时进入
async function buildTrimResidue(
    filePath: string,
    width: number,
    height: number,
    probeCuts: TrimCuts,
    appliedCuts: TrimCuts,
    threshold: number
): Promise<TrimResidue> {
    const { data, info } = await sharp(filePath).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width || width;
    const h = info.height || height;
    const bgR = data[0] ?? 0;
    const bgG = data[1] ?? 0;
    const bgB = data[2] ?? 0;
    const bgA = data[3] ?? 0;
    // 分类容差：复用用户 threshold（1-100）映射到 0-255 通道差
    const tol = Math.max(1, Math.round(threshold * 2.55));
    const kinds: TrimSideMap = { top: 'none', bottom: 'none', left: 'none', right: 'none' };
    if (probeCuts.left > 0) kinds.left = classifyStrip(data, w, 0, 0, probeCuts.left, h, bgR, bgG, bgB, bgA, tol);
    if (probeCuts.right > 0)
        kinds.right = classifyStrip(data, w, w - probeCuts.right, 0, probeCuts.right, h, bgR, bgG, bgB, bgA, tol);
    const midW = w - probeCuts.left - probeCuts.right;
    if (probeCuts.top > 0)
        kinds.top = classifyStrip(data, w, probeCuts.left, 0, midW, probeCuts.top, bgR, bgG, bgB, bgA, tol);
    if (probeCuts.bottom > 0)
        kinds.bottom = classifyStrip(
            data,
            w,
            probeCuts.left,
            h - probeCuts.bottom,
            midW,
            probeCuts.bottom,
            bgR,
            bgG,
            bgB,
            bgA,
            tol
        );
    // 置信度只统计实际执行的边：羽化 -0.3/边、内容 -0.4/边、噪点 -0.1/边
    let confidence = 1;
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
        if (appliedCuts[side] <= 0) continue;
        const k = kinds[side];
        if (k === 'feathered') confidence -= 0.3;
        else if (k === 'content') confidence -= 0.4;
        else if (k === 'noisy') confidence -= 0.1;
    }
    confidence = Math.max(0, Math.round(confidence * 100) / 100);
    return { cuts: { ...appliedCuts }, kinds, confidence };
}

/**
 * 智能去边纯算子配方
 * I/O、独占占位、EXIF 摆正与异常回滚已下沉至 shared/pipeline
 */
export const processTrim = defineOperator<TrimConfig, { residue?: TrimResidue }>({
    destination: { subDir: 'trimmed' },
    transform: async ({ sharp: baseSharp, oriented, filePath, config }) => {
        if (!('threshold' in config) || typeof config.threshold !== 'number') {
            return { error: 'trim 配置缺少 threshold。' };
        }
        const originalW = oriented.width;
        const originalH = oriented.height;

        const defaultResidue: TrimResidue = {
            cuts: { top: 0, bottom: 0, left: 0, right: 0 },
            kinds: { top: 'none', bottom: 'none', left: 'none', right: 'none' },
            confidence: 1
        };

        // 隐式探测：仅在内存中执行全方位 Trim 看能切出什么边界
        // raw() 输出的 info 同样带 trimOffsetLeft/Top 与裁后宽高，省掉一次全图编码往返
        const { info: probeInfo } = await baseSharp
            .clone()
            .trim({ threshold: config.threshold })
            .raw()
            .toBuffer({ resolveWithObject: true });

        // 未发生有效切除：尺寸未变，直接返回原管道与默认零残留
        if (probeInfo.width === originalW && probeInfo.height === originalH) {
            return {
                pipeline: baseSharp,
                extra: { residue: defaultResidue }
            };
        }

        const cutLeft = -(probeInfo.trimOffsetLeft || 0);
        const cutTop = -(probeInfo.trimOffsetTop || 0);
        const cutRight = originalW - cutLeft - probeInfo.width;
        const cutBottom = originalH - cutTop - probeInfo.height;

        const activeSides = config.sides || ['top', 'bottom', 'left', 'right'];
        const finalTop = activeSides.includes('top') ? cutTop : 0;
        const finalLeft = activeSides.includes('left') ? cutLeft : 0;
        const finalBottom = activeSides.includes('bottom') ? cutBottom : 0;
        const finalRight = activeSides.includes('right') ? cutRight : 0;

        const newWidth = originalW - finalLeft - finalRight;
        const newHeight = originalH - finalTop - finalBottom;

        if (newWidth <= 0 || newHeight <= 0) {
            return { error: '容差计算结果为空或越界。' };
        }

        let pipeline = baseSharp;
        if (newWidth !== originalW || newHeight !== originalH) {
            pipeline = baseSharp.clone().extract({
                left: finalLeft,
                top: finalTop,
                width: newWidth,
                height: newHeight
            });
        }

        const residue = await buildTrimResidue(
            filePath,
            originalW,
            originalH,
            { top: cutTop, bottom: cutBottom, left: cutLeft, right: cutRight },
            { top: finalTop, bottom: finalBottom, left: finalLeft, right: finalRight },
            config.threshold
        ).catch(() => undefined);

        return {
            pipeline,
            extra: residue ? { residue } : undefined
        };
    }
});

/**
 * 手动裁剪纯算子配方
 * I/O、独占占位、EXIF 摆正与异常回滚已下沉至 shared/pipeline
 */
export const processCrop = defineOperator<CropConfig>({
    destination: { subDir: 'cropped' },
    transform: ({ sharp: baseSharp, oriented, config }) => {
        if (!('top' in config) || typeof config.top !== 'number') {
            return { error: 'crop 配置缺少边距。' };
        }
        const newWidth = oriented.width - config.left - config.right;
        const newHeight = oriented.height - config.top - config.bottom;

        if (newWidth <= 0 || newHeight <= 0) {
            return { error: '裁剪范围大于原图尺寸，将导致图像消失！' };
        }

        return baseSharp.clone().extract({
            left: config.left,
            top: config.top,
            width: newWidth,
            height: newHeight
        });
    }
});

/**
 * 兼容适配器（Adapter）：维持既有 processTrimOrCrop 签名，分发至 processTrim 或 processCrop
 */
export function processTrimOrCrop(
    filePath: string,
    action: 'trim',
    config: TrimConfig,
    formatExt?: string | null
): Promise<TrimResult>;
export function processTrimOrCrop(
    filePath: string,
    action: 'crop',
    config: CropConfig,
    formatExt?: string | null
): Promise<TrimResult>;
export async function processTrimOrCrop(
    filePath: string,
    action: 'trim' | 'crop',
    config: TrimConfig | CropConfig,
    formatExt?: string | null
): Promise<TrimResult> {
    if (action === 'trim') {
        return processTrim(filePath, config as TrimConfig, formatExt);
    }
    return processCrop(filePath, config as CropConfig, formatExt);
}
