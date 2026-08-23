import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { processTrimOrCrop } from '../src/trim';
import { makeTempDir, createPngWithBorder } from './helpers';

describe('processTrimOrCrop - trim', () => {
    it('去除四周纯色边框后保留中心内容', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'bordered.png');
        // 内容 80x60 + 四周白边(左右30、上下30) → 原图 140x120
        await createPngWithBorder(src, 80, 60, 30, 30);

        const result = await processTrimOrCrop(
            src,
            'trim',
            { threshold: 10, sides: ['top', 'bottom', 'left', 'right'] },
            null
        );
        expect(result.status).toBe('success');

        const outPath = path.join(dir, 'trimmed', 'bordered.png');
        expect(fs.existsSync(outPath)).toBe(true);
        const meta = await sharp(outPath).metadata();
        // 容差范围内应恰好切到内容边界
        expect(meta.width!).toBeGreaterThanOrEqual(76);
        expect(meta.width!).toBeLessThanOrEqual(84);
        expect(meta.height!).toBeGreaterThanOrEqual(56);
        expect(meta.height!).toBeLessThanOrEqual(64);
    });

    it('sides 白名单只裁掉允许的边', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'oneside.png');
        await createPngWithBorder(src, 80, 60, 20, 20);

        const result = await processTrimOrCrop(src, 'trim', { threshold: 10, sides: ['left'] }, null);
        expect(result.status).toBe('success');

        const meta = await sharp(path.join(dir, 'trimmed', 'oneside.png')).metadata();
        // 仅左边被裁：宽度 120 - 20 = 100，高度保持不变
        expect(meta.width!).toBeGreaterThanOrEqual(96);
        expect(meta.width!).toBeLessThanOrEqual(104);
        expect(meta.height).toBe(100);
    });
});

describe('processTrimOrCrop - crop', () => {
    it('按指定边距精确裁剪', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'crop.png');
        await createPngWithBorder(src, 100, 60, 20, 20); // 140x100

        const result = await processTrimOrCrop(src, 'crop', { top: 10, bottom: 20, left: 5, right: 15 }, null);
        expect(result.status).toBe('success');

        const outMeta = await sharp(path.join(dir, 'cropped', 'crop.png')).metadata();
        expect(outMeta.width).toBe(140 - 5 - 15);
        expect(outMeta.height).toBe(100 - 10 - 20);
    });

    it('formatExt 覆盖输出格式为 webp', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'fmt.png');
        await createPngWithBorder(src, 60, 60, 10, 10);

        const result = await processTrimOrCrop(src, 'crop', { top: 5, bottom: 5, left: 5, right: 5 }, '.webp');
        expect(result.status).toBe('success');

        const files = fs.readdirSync(path.join(dir, 'cropped'));
        expect(files[0]).toMatch(/\.webp$/);
    });

    it('裁剪范围超出原图时报错并拒绝执行', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'tiny.png');
        await createPngWithBorder(src, 20, 20, 0, 0); // 20x20

        const result = await processTrimOrCrop(src, 'crop', { top: 50, bottom: 50, left: 50, right: 50 }, null);
        expect(result.status).toBe('error');
        expect(result.reason).toBeTruthy();
    });
});
