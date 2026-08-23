import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// AI 抠图依赖体积大且会触发模型加载，核心转换用例不需要它——直接 mock 掉
vi.mock('@imgly/background-removal-node', () => ({ removeBackground: vi.fn() }));

import { convertImage } from '../src/core';
import { makeTempDir, createPng } from './helpers';

describe('convertImage', () => {
    it('PNG 转 WebP 成功并生成 .webp 文件', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'photo.png');
        await createPng(src, 64, 48);

        const result = await convertImage(src, 'webp', null);
        expect(result.status).toBe('success');
        expect(fs.existsSync(path.join(dir, 'photo.webp'))).toBe(true);
    });

    it('PNG 转 PNG 走优化通道并生成 _optimized 后缀文件', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'shot.png');
        await createPng(src, 32, 32);

        const result = await convertImage(src, 'png', null);
        expect(result.status).toBe('success');
        expect(fs.existsSync(path.join(dir, 'shot_optimized.png'))).toBe(true);
    });

    it('转 MozJPEG 生成 _optimized.jpg 文件', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'pic.png');
        await createPng(src, 40, 40);

        const result = await convertImage(src, 'mozjpeg', null);
        expect(result.status).toBe('success');
        expect(fs.existsSync(path.join(dir, 'pic_optimized.jpg'))).toBe(true);
    });

    it('目标格式与源格式相同时返回 skipped', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'real.webp');
        await sharp({ create: { width: 16, height: 16, channels: 3, background: '#f00' } })
            .webp()
            .toFile(src);

        const result = await convertImage(src, 'webp', null);
        expect(result.status).toBe('skipped');
    });

    it('输入文件不存在时返回 error 且带原因', async () => {
        const dir = makeTempDir();
        const missing = path.join(dir, 'ghost.png');
        const result = await convertImage(missing, 'webp', null);
        expect(result.status).toBe('error');
        expect(result.reason).toBeTruthy();
    });
});
