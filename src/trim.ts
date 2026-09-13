import sharp from 'sharp';
import path from 'path';
import { promises as fsp } from 'fs';

import { TrimConfig, CropConfig } from './cli';
import type { OpResult } from './shared/results';
import { ensureDir, allocateFilePath } from './shared/output-naming';
import { orientedSize } from './shared/orientation';
import { applyEncoding } from './shared/encode';
import { normalizeExt } from './shared/formats';

// trim 专属结果：成功时附带 residue 报告（实际切量 + 探测口径分类 + 置信度）
// cuts 是 sides 过滤后实际执行的切除；kinds 走全量探测口径——被 sides 滤掉的边也会如实标注，方便发现“故意保留的残留”
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
            if (
                Math.abs(data[i]! - bgR) <= tol &&
                Math.abs(data[i + 1]! - bgG) <= tol &&
                Math.abs(data[i + 2]! - bgB) <= tol &&
                Math.abs(data[i + 3]! - bgA) <= tol
            ) {
                similar++;
            }
            const a = data[i + 3]!;
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
export function processTrimOrCrop(
    filePath: string,
    action: 'trim',
    config: TrimConfig,
    formatExt: string | null
): Promise<TrimResult>;
export function processTrimOrCrop(
    filePath: string,
    action: 'crop',
    config: CropConfig,
    formatExt: string | null
): Promise<TrimResult>;
export async function processTrimOrCrop(
    filePath: string,
    action: 'trim' | 'crop',
    config: TrimConfig | CropConfig,
    formatExt: string | null
): Promise<TrimResult> {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);

    // 输出扩展名归一化（小写；.jpeg→.jpg），未知格式原样透传
    const actualExt = normalizeExt(formatExt || ext);
    const isTrim = action === 'trim';
    const subDirName = isTrim ? 'trimmed' : 'cropped';
    const outDir = path.join(dir, subDirName);

    // 占位路径声明：allocate 移到全部参数校验之后，校验早退时尚无占位可泄漏
    let outputPath = '';

    try {
        // 元数据只读一次，trim/crop 分支复用
        // metadata() 返回未旋转的原始宽高，orientation 5~8 需互换；
        // 后续 trim 偏移量与 crop 裁剪框都在摆正后的坐标系里，故用摆正尺寸
        const oriented = await orientedSize(filePath);
        const originalW = oriented.width;
        const originalH = oriented.height;

        // rotate() 无参时按 EXIF Orientation 自动摆正，必须在 extract 之前应用，
        // 否则裁剪坐标与摆正后的探测结果不一致
        let sharpInstance = sharp(filePath).rotate();
        // residue 报告载体：crop 分支保持缺席，trim 分支在下方赋值
        let residue: TrimResidue | undefined;

        // 关键逻辑分支：trim vs crop（重载签名保证配对，in 守卫再收窄）
        if (action === 'trim') {
            if (!('threshold' in config)) {
                return { status: 'error', file: filePath, reason: 'trim 配置缺少 threshold。' };
            }
            const trimCfg = config;
            residue = {
                cuts: { top: 0, bottom: 0, left: 0, right: 0 },
                kinds: { top: 'none', bottom: 'none', left: 'none', right: 'none' },
                confidence: 1
            };

            // --- 智能边向选择探底方案 ---
            // 隐式测试：仅在内存中执行全方位 Trim 看能切出什么边界
            // 探测必须与最终流水线同样先 rotate()，否则 trimOffset 基于未摆正坐标系，extract 会整体错位
            // 探测只要边界信息：raw() 输出的 info 同样带 trimOffsetLeft/Top 与裁后宽高，
            // 省掉一次全图编码往返，避免大图批量处理时的 CPU 与内存峰值翻倍（见缺陷 4）
            const { info: probeInfo } = await sharp(filePath)
                .rotate()
                .trim({ threshold: trimCfg.threshold })
                .raw()
                .toBuffer({ resolveWithObject: true });

            // 仅当确实发生切除行为（尺寸变化）才进入后续运算，否则按原图保存
            if (probeInfo.width !== originalW || probeInfo.height !== originalH) {
                // 解析出系统探测认为应当剔除的四个方位像素量
                // trimOffsetLeft / trimOffsetTop 是被裁切后剩余图像相对于原图左上角的偏移，本质上就是左边和上边被切掉的像素数
                const cutLeft = -(probeInfo.trimOffsetLeft || 0);
                const cutTop = -(probeInfo.trimOffsetTop || 0);

                // 右边的切去量 = 原宽度 - cutLeft - 裁切后的结果新宽度
                const cutRight = originalW - cutLeft - probeInfo.width;
                // 底部的切去量 = 原高度 - cutTop - 裁切后的结果新高度
                const cutBottom = originalH - cutTop - probeInfo.height;

                // 3. 构建我们自己的 extract 方框，决定接纳哪些边的切除建议
                const activeSides = trimCfg.sides || ['top', 'bottom', 'left', 'right'];

                const finalTop = activeSides.includes('top') ? cutTop : 0;
                const finalLeft = activeSides.includes('left') ? cutLeft : 0;
                const finalBottom = activeSides.includes('bottom') ? cutBottom : 0;
                const finalRight = activeSides.includes('right') ? cutRight : 0;

                const newWidth = originalW - finalLeft - finalRight;
                const newHeight = originalH - finalTop - finalBottom;

                if (newWidth <= 0 || newHeight <= 0) {
                    return { status: 'error', file: filePath, reason: '容差计算结果为空或越界。' };
                }

                // 过滤筛选后等价于一刀没切时直接跳过 extract
                if (newWidth !== originalW || newHeight !== originalH) {
                    sharpInstance = sharpInstance.extract({
                        left: finalLeft,
                        top: finalTop,
                        width: newWidth,
                        height: newHeight
                    });
                }
                // residue 报告：分析失败则保持缺席（未知不瞎报）；kinds 全量探测口径，cuts 只记实际执行
                residue = await buildTrimResidue(
                    filePath,
                    originalW,
                    originalH,
                    { top: cutTop, bottom: cutBottom, left: cutLeft, right: cutRight },
                    { top: finalTop, bottom: finalBottom, left: finalLeft, right: finalRight },
                    trimCfg.threshold
                ).catch(() => undefined);
            }
        } else {
            if (!('top' in config)) {
                return { status: 'error', file: filePath, reason: 'crop 配置缺少边距。' };
            }
            const cropCfg = config;
            // 复用已读元数据，防止切除过度报错
            const newWidth = originalW - cropCfg.left - cropCfg.right;
            const newHeight = originalH - cropCfg.top - cropCfg.bottom;

            if (newWidth <= 0 || newHeight <= 0) {
                return { status: 'error', file: filePath, reason: '裁剪范围大于原图尺寸，将导致图像消失！' };
            }

            sharpInstance = sharpInstance.extract({
                left: cropCfg.left,
                top: cropCfg.top,
                width: newWidth,
                height: newHeight
            });
        }

        // O_EXCL 独占占位命名：全部参数校验通过后才建占位，早退路径无残留
        // 建目录同样在 try 内：目录不可写/路径过长/磁盘满时按 OpResult 报错，不让 reject 逃出契约（见缺陷 3）
        await ensureDir(outDir);
        outputPath = await allocateFilePath(outDir, name, actualExt);
        // 统一编码后落盘（未知扩展原样透传）
        sharpInstance = applyEncoding(sharpInstance, actualExt);

        await sharpInstance.toFile(outputPath);
        return { status: 'success', file: filePath, ...(residue ? { residue } : {}) };
    } catch (err: unknown) {
        // 占位由本进程独占创建：失败时删同路径幽灵空文件，不碰目录；早退前无占位则跳过
        if (outputPath) await fsp.unlink(outputPath).catch(() => {});
        let errMsg = '未知错误';
        if (err instanceof Error) {
            errMsg = err.message;
        }
        return { status: 'error', file: filePath, reason: errMsg };
    }
}
