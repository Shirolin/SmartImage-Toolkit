import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { resizeImage } from '../src/resize';
import { makeTempDir, createPng } from './helpers';

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
