import sharp from 'sharp';

import type { PadAspectConfig } from './config-types';
import type { OpResult } from './shared/results';
import { defineOperator } from './shared/pipeline';
import { MAX_DIM, TRIM_THRESHOLD_DEFAULT } from './shared/constants';

// 画布扩边 / 比例对齐引擎：与 center 不同处在于这里是「换画布」——按目标比例新建画布，
// 把主体等比缩小后居中放置，四周统一留安全边距（供图生视频预品，Feed Flow/Omni 前）。
// 几何全程整数像素；合成走单一抽象：sharp create 造底 + composite 贴缩放后主体，
// 不与 extend+resize 路径混用。缩放用 fit:'fill' 的显式宽高——比例是我们逐项算好的整数，
// 不需要 sharp 再做包含/裁剪推断。
// I/O、独占占位、EXIF 摆正与异常回滚已下沉至 shared/pipeline

export type PadAspectResult = OpResult;

/** 解析 'W:H' 比例串：两个正整数（容忍前后空格），非法返回 null 由调用方重问/报错 */
export function parseAspect(aspect: string): { w: number; h: number } | null {
    const m = /^\s*([1-9]\d*)\s*:\s*([1-9]\d*)\s*$/.exec(aspect);
    if (!m) return null;
    const w = Number(m[1]);
    const h = Number(m[2]);
    // Number() 于大位整数才失真，此处断言非空后必然落在安全整数范围
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) return null;
    return { w, h };
}

/** 解析填充色：#RRGGBB / #RRGGBBAA → rgba 对象；非法返回 null */
export function parseFillColor(input: string): { r: number; g: number; b: number; alpha: number } | null {
    const m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(input);
    if (!m) return null;
    const hex = m[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, alpha };
}

/** fill=color 且 fillColor='auto' 时取源图一眼色像素（左上角）当底色：角落全透时沿用其 alpha（等效透明填充）；失败时回落纯白 */
async function pickCornerColor(baseSharp: sharp.Sharp): Promise<{ r: number; g: number; b: number; alpha: number }> {
    try {
        const { data } = await baseSharp
            .clone()
            .extract({ left: 0, top: 0, width: 1, height: 1 })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        return { r: data[0], g: data[1], b: data[2], alpha: Math.round((data[3] / 255) * 100) / 100 };
    } catch {
        return { r: 255, g: 255, b: 255, alpha: 1 };
    }
}

/**
 * 画布扩边算子实现
 */
export const processPadAspect = defineOperator<PadAspectConfig>({
    destination: { subDir: 'pad-aspect' },
    transform: async ({ sharp: baseSharp, oriented, config }) => {
        const dims = parseAspect(config.aspect);
        if (!dims) {
            return {
                error: `无效的目标比例: ${config.aspect}，应为 W:H 两个正整数。`
            };
        }

        const subjectRatio = config.subjectRatio ?? 0.6;
        if (subjectRatio < 0.4 || subjectRatio > 0.8) {
            return { error: `主体占比超范围: ${subjectRatio}，应在 0.40~0.80。` };
        }

        const longEdge = Math.round(config.longEdge ?? 1920);
        if (longEdge < 1 || longEdge > MAX_DIM) {
            return { error: `画布长边超限: ${longEdge}，应在 1~${MAX_DIM}。` };
        }

        // 目标画布：长边贴 longEdge，另一边按比例折算；统一向下取整到偶数
        let canvasW: number;
        let canvasH: number;
        if (dims.w >= dims.h) {
            canvasW = longEdge;
            canvasH = Math.round((longEdge * dims.h) / dims.w);
        } else {
            canvasH = longEdge;
            canvasW = Math.round((longEdge * dims.w) / dims.h);
        }
        if (canvasW < 1 || canvasH < 1) {
            return { error: '目标画布尺寸过小，请调整比例或长边。' };
        }
        canvasW -= canvasW % 2;
        canvasH -= canvasH % 2;
        if (canvasW > MAX_DIM || canvasH > MAX_DIM) {
            return {
                error: `目标画布超限: ${canvasW}x${canvasH}，单边最大 ${MAX_DIM}px。`
            };
        }

        // 填充底色：transparent（fill 字段或 fillColor='transparent' 任一为真）→ 全透；
        // color → 解析 fillColor（支持 auto 取源图边缘主色）。'transparent' 字符串分流是为了
        // 与 center.fillColor: string | 'transparent' 的交互习惯对齐，省得用户两种问法得到不同结果；透明优先于色值
        let background: { r: number; g: number; b: number; alpha: number };
        const fillColorLower = (config.fillColor ?? '').toLowerCase();
        if (config.fill === 'transparent' || fillColorLower === 'transparent') {
            background = { r: 0, g: 0, b: 0, alpha: 0 };
        } else if (fillColorLower === 'auto') {
            background = await pickCornerColor(baseSharp);
        } else {
            const parsed = parseFillColor(config.fillColor ?? '#FFFFFF');
            if (!parsed) {
                return {
                    error: `无效的填充色: ${config.fillColor}，应为 #RRGGBB(AA)。`
                };
            }
            background = parsed;
        }

        // 取主体：full_image → 整张摆正图整体当主体；trim_bbox → 复用 trim 探测 bbox 后 extract
        const subjectMode = config.subjectMode ?? 'full_image';
        let subject: sharp.Sharp;
        let rawW: number;
        let rawH: number;

        if (subjectMode === 'trim_bbox') {
            // 探测与最终 extract 基于已 rotate 管道，坐标系一致
            const { info: probeInfo } = await baseSharp
                .clone()
                .trim({ threshold: config.threshold ?? TRIM_THRESHOLD_DEFAULT })
                .raw()
                .toBuffer({ resolveWithObject: true });
            const trimLeft = Math.abs(probeInfo.trimOffsetLeft || 0);
            const trimTop = Math.abs(probeInfo.trimOffsetTop || 0);
            rawW = probeInfo.width;
            rawH = probeInfo.height;
            if (rawW < 1 || rawH < 1) {
                return { error: '主体探测结果为空，请增大容差或改用整图模式。' };
            }
            subject = baseSharp.clone().extract({
                left: trimLeft,
                top: trimTop,
                width: rawW,
                height: rawH
            });
        } else {
            rawW = oriented.width;
            rawH = oriented.height;
            subject = baseSharp.clone();
        }

        if (rawW < 1 || rawH < 1) {
            return { error: '无法读取图片元数据(宽高)' };
        }

        // 等比缩放：主体高度 = 画布高 × subjectRatio；宽度因此超过画布 95% 时改为按宽限高，仍保持等比
        const scaleByHeight = (canvasH * subjectRatio) / rawH;
        const maxWidth = canvasW * 0.95;
        const drivenByWidth = Math.round(rawW * scaleByHeight) > maxWidth;
        const scale = drivenByWidth ? maxWidth / rawW : scaleByHeight;
        const subjectH = Math.max(1, Math.round(rawH * scale));
        const subjectW = Math.max(1, Math.round(rawW * scale));

        const subjectPng = await subject
            .resize({ width: subjectW, height: subjectH, fit: 'fill' })
            // 中转统一 PNG：保住源图 alpha，合成到底色时半透明边缘才不被烘焙进黑底
            .png()
            .toBuffer();

        // 造画布 + 居中合成 → 返回 Sharp 管道由流水线统一编码落盘
        return sharp({
            create: { width: canvasW, height: canvasH, channels: 4, background }
        }).composite([
            {
                input: subjectPng,
                left: Math.floor((canvasW - subjectW) / 2),
                top: Math.floor((canvasH - subjectH) / 2)
            }
        ]);
    }
});
