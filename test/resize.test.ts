import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { resizeImage } from '../src/resize';
import { makeTempDir, createPng } from './helpers';

// 回归用例的临时目录统一登记清理，保证可重复与可并行
const tempDirs: string[] = [];
function trackedTempDir(): string {
    const dir = makeTempDir();
    tempDirs.push(dir);
    return dir;
}
afterEach(() => {
    // Windows 上 sharp 的写盘句柄可能短暂滞留，删除临时目录带重试
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
});

describe('resizeImage', () => {
    it('by_width 模式按目标宽度等比缩放', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'wide.png');
        await createPng(src, 200, 100);

        const result = await resizeImage(src, { mode: 'by_width', width: 100 });
        expect(result.status).toBe('success');
        const outMeta = await sharp(path.join(dir, 'wide_resized.png')).metadata();
        expect(outMeta.width).toBe(100);
        expect(outMeta.height).toBe(50);
    });

    it('by_height 模式按目标高度等比缩放', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'tall.png');
        await createPng(src, 200, 100);

        const result = await resizeImage(src, { mode: 'by_height', height: 50 });
        expect(result.status).toBe('success');
        const outMeta = await sharp(path.join(dir, 'tall_resized.png')).metadata();
        expect(outMeta.height).toBe(50);
        expect(outMeta.width).toBe(100);
    });

    it('by_percent 模式按百分比缩放', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'half.png');
        await createPng(src, 200, 100);

        const result = await resizeImage(src, { mode: 'by_percent', percent: 50 });
        expect(result.status).toBe('success');
        const outMeta = await sharp(path.join(dir, 'half_resized.png')).metadata();
        expect(outMeta.width).toBe(100);
        expect(outMeta.height).toBe(50);
    });

    it('custom 模式输出精确宽高', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'custom.png');
        await createPng(src, 300, 120);

        const result = await resizeImage(src, { mode: 'custom', width: 64, height: 64, fit: 'cover' });
        expect(result.status).toBe('success');
        const outMeta = await sharp(path.join(dir, 'custom_resized.png')).metadata();
        expect(outMeta.width).toBe(64);
        expect(outMeta.height).toBe(64);
    });

    it('尺寸未变化且无格式转换时返回 skipped', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'same.png');
        await createPng(src, 100, 80);

        const result = await resizeImage(src, { mode: 'by_width', width: 100 });
        expect(result.status).toBe('skipped');
    });

    it('缺少必要参数时返回 error 并说明原因', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'noparam.png');
        await createPng(src, 50, 50);

        const result = await resizeImage(src, { mode: 'by_width' });
        expect(result.status).toBe('error');
        expect(result.reason).toBeTruthy();
    });

    it('输入文件不存在时返回 error', async () => {
        const dir = makeTempDir();
        const result = await resizeImage(path.join(dir, 'ghost.png'), { mode: 'by_width', width: 10 });
        expect(result.status).toBe('error');
    });

    it('指定 formatExt 时同时完成格式转换', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'tojpg.png');
        await createPng(src, 80, 60);

        const result = await resizeImage(src, { mode: 'by_width', width: 40 }, '.jpg');
        expect(result.status).toBe('success');
        const outputs = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg'));
        expect(outputs).toEqual(['tojpg_resized.jpg']);
    });
});

describe('resizeImage by_percent 非法输入', () => {
    it('负数与 0 同等返回 error，不产生 1px 成功文件', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'neg.png');
        await createPng(src, 100, 80);

        const neg = await resizeImage(src, { mode: 'by_percent', percent: -50 });
        expect(neg.status).toBe('error');
        expect(neg.reason).toBeTruthy();

        const zero = await resizeImage(src, { mode: 'by_percent', percent: 0 });
        expect(zero.status).toBe('error');
        expect(fs.readdirSync(dir)).toEqual(['neg.png']);
    });
});

describe('resizeImage 目标尺寸上限', () => {
    it('custom 宽度 100000 超限时返回 error 且不产生任何输出文件', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'huge.png');
        await createPng(src, 100, 50);

        // 高度取小值：上限校验若被移除，sharp 会真的写出 100000x20 的图而不是超时，
        // 本用例因此能稳定地在「校验缺失」时变红
        const result = await resizeImage(src, { mode: 'custom', width: 100000, height: 20, fit: 'cover' });

        expect(result.status).toBe('error');
        expect(result.reason).toBeTruthy();
        // 校验必须先于占位/落盘：输出目录里不能多出任何文件（含幽灵空占位）
        expect(fs.readdirSync(dir)).toEqual(['huge.png']);
    });

    it('by_percent 5000 超限时返回 error 且不产生任何输出文件', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'blowup.png');
        await createPng(src, 40, 20);

        const result = await resizeImage(src, { mode: 'by_percent', percent: 5000 });

        expect(result.status).toBe('error');
        expect(result.reason).toBeTruthy();
        expect(fs.readdirSync(dir)).toEqual(['blowup.png']);
    });

    it('custom 恰好 30000 宽（上限边界）仍被允许', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'edge.png');
        await createPng(src, 100, 50);

        const result = await resizeImage(src, { mode: 'custom', width: 30000, height: 20, fit: 'cover' });

        expect(result.status).toBe('success');
        const meta = await sharp(path.join(dir, 'edge_resized.png')).metadata();
        expect(meta.width).toBe(30000);
        expect(meta.height).toBe(20);
    });
});

describe('resizeImage EXIF 方向', () => {
    it('orientation=6 的竖拍图按摆正后的尺寸缩放', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'phone.jpg');
        // 存储像素 100x50，EXIF orientation=6 表示显示时需旋转 90°：观感尺寸 50x100
        await sharp({ create: { width: 100, height: 50, channels: 3, background: { r: 200, g: 40, b: 40 } } })
            .jpeg()
            .withMetadata({ orientation: 6 })
            .toFile(src);

        const result = await resizeImage(src, { mode: 'by_width', width: 40 });

        expect(result.status).toBe('success');
        const meta = await sharp(path.join(dir, 'phone_resized.jpg')).metadata();
        // 摆正后 50x100 等比缩到宽 40 → 40x80；未摆正会按 100x50 算成 40x20
        expect(meta.width).toBe(40);
        expect(meta.height).toBe(80);
    });
});
