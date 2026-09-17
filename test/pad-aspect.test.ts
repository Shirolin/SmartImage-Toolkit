import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { processPadAspect, parseAspect, parseFillColor } from '../src/pad-aspect';
import { makeTempDir, createPng, createPngWithBorder } from './helpers';

// 回归用例的临时目录统一登记清理，保证可重复与可并行
const tempDirs: string[] = [];
function trackedTempDir(): string {
    const dir = makeTempDir();
    tempDirs.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
});

const BLUE_BG = { fill: 'color' as const, fillColor: '#0088FF' };

// 计算输出图中与底色不同像素的包围盒：验证主体占比与四周留白
async function contentBBox(file: string) {
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    let minX = info.width,
        minY = info.height,
        maxX = -1,
        maxY = -1;
    // 底色取图左上角（pad 后必为背景）
    const bgR = data[0],
        bgG = data[1],
        bgB = data[2];
    for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
            const i = (y * info.width + x) * ch;
            if (Math.abs(data[i] - bgR) > 8 || Math.abs(data[i + 1] - bgG) > 8 || Math.abs(data[i + 2] - bgB) > 8) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
    }
    return { width: info.width, height: info.height, minX, minY, maxX, maxY, hasContent: maxX >= 0 };
}

describe('parseAspect / parseFillColor', () => {
    it('W:H 两正整数合法，非法输入返回 null', () => {
        expect(parseAspect('16:9')).toEqual({ w: 16, h: 9 });
        expect(parseAspect(' 4 : 5 ')).toEqual({ w: 4, h: 5 });
        // 容忍空格但拒绝 0/负数/分段/缺失
        expect(parseAspect('0:9')).toBeNull();
        expect(parseAspect('16')).toBeNull();
        expect(parseAspect('16:0')).toBeNull();
        expect(parseAspect('a:b')).toBeNull();
    });

    it('六位与八位 hex 合法，其余拒绝', () => {
        expect(parseFillColor('#0088FF')).toMatchObject({ r: 0, g: 0x88, b: 0xff, alpha: 1 });
        const eight = parseFillColor('#0088FF80');
        expect(eight?.alpha).toBeCloseTo(0x80 / 255);
        expect(parseFillColor('#0088F')).toBeNull();
        expect(parseFillColor('auto')).toBeNull();
        expect(parseFillColor('#')).toBeNull();
    });
});

describe('processPadAspect 几何', () => {
    it('16:9 + subjectRatio=0.6：画布比例正确，主体高约 60% 且四周有留白', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'char.png');
        // 主体红块几乎贴满 100x100（full_image 模式整图即主体）
        await createPng(src, 100, 100, { r: 220, g: 30, b: 30 });

        const result = await processPadAspect(
            src,
            { aspect: '16:9', ...BLUE_BG, longEdge: 160, outputFormat: 'png' },
            '.png'
        );
        expect(result.status).toBe('success');

        const out = path.join(dir, 'pad-aspect', 'char.png');
        expect(fs.existsSync(out)).toBe(true);
        const bbox = await contentBBox(out);
        expect(bbox.width).toBe(160);
        expect(bbox.height).toBe(90); // 16:9，长边 160 → 160x90
        // 主体高度占比 = (maxY-minY+1)/90 ≈ 0.6
        const ratioH = (bbox.maxY - bbox.minY + 1) / bbox.height;
        expect(Math.abs(ratioH - 0.6)).toBeLessThanOrEqual(0.02);
        // 四周均留非零安全边距
        expect(bbox.minX).toBeGreaterThan(0);
        expect(bbox.minY).toBeGreaterThan(0);
        expect(bbox.width - 1 - bbox.maxX).toBeGreaterThan(0);
        expect(bbox.height - 1 - bbox.maxY).toBeGreaterThan(0);
        // 底色为指定蓝且连续无黑边：四角与边中线像素一致
        const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
        const stride = info.channels;
        const px = (x: number, y: number): number[] => {
            const i = (y * info.width + x) * stride;
            return [data[i], data[i + 1], data[i + 2]];
        };
        for (const [x, y] of [
            [0, 0],
            [159, 0],
            [0, 89],
            [159, 89],
            [80, 0],
            [80, 89],
            [0, 45],
            [159, 45]
        ]) {
            expect(px(x, y)).toEqual([0, 0x88, 0xff]);
        }
    });

    it('9:16 竖屏：输出 90x160 (longEdge=160)', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'char.png');
        await createPng(src, 80, 80);

        const result = await processPadAspect(
            src,
            { aspect: '9:16', ...BLUE_BG, longEdge: 160, outputFormat: 'png' },
            '.png'
        );
        expect(result.status).toBe('success');
        const meta = await sharp(path.join(dir, 'pad-aspect', 'char.png')).metadata();
        expect(meta.width).toBe(90);
        expect(meta.height).toBe(160);
    });

    it('transparent 填充：PNG 四角 alpha 为 0，主体未被填色', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'char.png');
        await createPng(src, 100, 100, { r: 220, g: 30, b: 30 });

        const result = await processPadAspect(
            src,
            { aspect: '1:1', fill: 'transparent', longEdge: 160, subjectRatio: 0.5, outputFormat: 'png' },
            '.png'
        );
        expect(result.status).toBe('success');
        const out = path.join(dir, 'pad-aspect', 'char.png');
        const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const stride = info.channels; // ensureAlpha() 后恒为 4
        // 左上角透明
        expect(data[3]).toBe(0);
        // 中心 (80,80) 仍是主体红色，没有被误填底色（主体 50x50 左上角在 (55,55)）
        const mid = (80 * info.width + 80) * stride;
        expect(data[mid]).toBeCloseTo(220, -1);
        expect(data[mid + 1]).toBeCloseTo(30, -1);
    });

    it('subjectRatio 变小后主体包围盒占画布高度比例同步变小', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'char.png');
        await createPng(src, 100, 100, { r: 220, g: 30, b: 30 });

        const run = (ratio: number) =>
            processPadAspect(
                src,
                { aspect: '16:9', ...BLUE_BG, longEdge: 160, subjectRatio: ratio, outputFormat: 'png' },
                '.png'
            );
        expect((await run(0.6)).status).toBe('success');
        expect((await run(0.4)).status).toBe('success');
        // 第二次输出因 allocateFilePath 独占命名落到 char(1).png
        const tall = await contentBBox(path.join(dir, 'pad-aspect', 'char.png'));
        const small = await contentBBox(path.join(dir, 'pad-aspect', 'char(1).png'));
        const ratioT = (tall.maxY - tall.minY + 1) / tall.height;
        const ratioS = (small.maxY - small.minY + 1) / small.height;
        expect(ratioT).toBeGreaterThan(ratioS + 0.1);
    });

    it('trim_bbox 模式对纯色边图先去边再缩放（主体不再包住白边）', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'char.png');
        // 红块 60x60 + 白边 20 → 100x100
        await createPngWithBorder(src, 60, 60, 20, 20);

        const result = await processPadAspect(
            src,
            {
                aspect: '1:1',
                fill: 'transparent',
                subjectMode: 'trim_bbox',
                threshold: 10,
                longEdge: 160,
                subjectRatio: 0.6,
                outputFormat: 'png'
            },
            '.png'
        );
        expect(result.status).toBe('success');
        // 探测主体为 60x60 红块：占画布 60% 高（160*0.6=96px），白边不应计入主体尺寸
        const bbox = await contentBBox(path.join(dir, 'pad-aspect', 'char.png'));
        const ratioH = (bbox.maxY - bbox.minY + 1) / bbox.height;
        // 若白边被算进主体，比例会混入白色而明显低于 0.6
        expect(Math.abs(ratioH - 0.6)).toBeLessThanOrEqual(0.05);
    });

    it('fillColor 字符串 transparent 与 fill:transparent 同效（center 交互习惯对齐）', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'char.png');
        await createPng(src, 100, 100, { r: 220, g: 30, b: 30 });

        const result = await processPadAspect(
            src,
            {
                aspect: '1:1',
                fill: 'color',
                fillColor: 'transparent',
                longEdge: 160,
                subjectRatio: 0.5,
                outputFormat: 'png'
            },
            '.png'
        );
        expect(result.status).toBe('success');
        const { data } = await sharp(path.join(dir, 'pad-aspect', 'char.png'))
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        // 左上角全透
        expect(data[3]).toBe(0);
    });

    it('非法 aspect 返回 error 且不产生输出', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'char.png');
        await createPng(src, 50, 50);

        const result = await processPadAspect(src, { aspect: '16x9', ...BLUE_BG, longEdge: 160 }, '.png');
        expect(result.status).toBe('error');
        expect(result.reason).toBeTruthy();
        expect(fs.readdirSync(dir)).toEqual(['char.png']);
    });
});
