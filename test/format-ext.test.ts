import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { normalizeExt, equalExt, resolveImageExt } from '../src/shared/formats';
import { applyEncoding } from '../src/shared/encode';
import sharp from 'sharp';
import { resizeImage } from '../src/resize';
import { makeTempDir, createPng } from './helpers';

describe('normalizeExt', () => {
    it('.jpeg 统一为 .jpg', () => {
        expect(normalizeExt('.jpeg')).toBe('.jpg');
    });

    it('大写 .JPG 归一化为 .jpg', () => {
        expect(normalizeExt('.JPG')).toBe('.jpg');
    });

    it('大写 .JPEG 归一化为 .jpg', () => {
        expect(normalizeExt('.JPEG')).toBe('.jpg');
    });

    it('其他后缀仅转小写', () => {
        expect(normalizeExt('.PNG')).toBe('.png');
        expect(normalizeExt('.WebP')).toBe('.webp');
    });
});

describe('equalExt', () => {
    it('.jpeg 与 .jpg 视为等价', () => {
        expect(equalExt('.jpeg', '.jpg')).toBe(true);
    });

    it('大小写不敏感', () => {
        expect(equalExt('.JPG', '.jpg')).toBe(true);
        expect(equalExt('.PNG', '.png')).toBe(true);
    });

    it('不同格式不等价', () => {
        expect(equalExt('.webp', '.png')).toBe(false);
    });
});

describe('resolveImageExt', () => {
    it('mozjpeg 落盘一律 .jpg', () => {
        expect(resolveImageExt('mozjpeg', '.png')).toBe('.jpg');
        expect(resolveImageExt('mozjpeg', '.webp')).toBe('.jpg');
    });

    it('original 沿用来源并归一化', () => {
        expect(resolveImageExt('original', '.JPEG')).toBe('.jpg');
        expect(resolveImageExt('original', '.PNG')).toBe('.png');
    });
});

describe('resize skipped 别名', () => {
    it('.jpeg 源请求 .jpg 同尺寸视为未变化而跳过', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'alias.jpeg');
        await createPng(src, 100, 80);

        const result = await resizeImage(src, { mode: 'by_width', width: 100 }, '.jpg');
        expect(result.status).toBe('skipped');
    });

    it('.jpg 源请求 .jpg 同尺寸跳过且不产生新文件', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'same.jpg');
        await createPng(src, 100, 80);
        const before = fs.readdirSync(dir).length;

        const result = await resizeImage(src, { mode: 'by_width', width: 100 }, '.jpg');
        expect(result.status).toBe('skipped');
        expect(fs.readdirSync(dir).length).toBe(before);
    });
});

describe('normalizeExt 补点前缀', () => {
    it('无点输入统一补点', () => {
        expect(normalizeExt('webp')).toBe('.webp');
        expect(normalizeExt('JPG')).toBe('.jpg');
        expect(normalizeExt('jpeg')).toBe('.jpg');
    });

    it('空串原样透传', () => {
        expect(normalizeExt('')).toBe('');
    });

    it('无点与带点视为等价', () => {
        expect(equalExt('jpg', '.jpg')).toBe(true);
        expect(equalExt('WEBP', '.webp')).toBe(true);
    });
});

describe('applyEncoding 兼容', () => {
    it("裸 '.jpeg' 输入仍走 jpeg 编码", async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'a.png');
        await createPng(src, 16, 16);
        const buf = await applyEncoding(sharp(src), '.jpeg').toBuffer();
        expect((await sharp(buf).metadata()).format).toBe('jpeg');
    });
});
