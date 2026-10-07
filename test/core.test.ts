import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// AI 抠图依赖体积大且会触发模型加载，核心转换用例不需要它——直接 mock 掉
vi.mock('@imgly/background-removal-node', () => ({ removeBackground: vi.fn() }));

import { convertImage } from '../src/core';
import { transcodeImage } from '../src/transcode';
import { processMatting } from '../src/matting';
import { removeBackground } from '@imgly/background-removal-node';
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

describe('transcodeImage 格式转码算子', () => {
    it('PNG 转 WebP 成功并生成 .webp 文件', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'photo.png');
        await createPng(src, 64, 48);

        const result = await transcodeImage(src, { format: 'webp' });
        expect(result.status).toBe('success');
        expect(fs.existsSync(path.join(dir, 'photo.webp'))).toBe(true);
    });

    it('PNG 转 PNG 走优化通道并生成 _optimized 后缀文件', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'shot.png');
        await createPng(src, 32, 32);

        const result = await transcodeImage(src, { format: 'png' });
        expect(result.status).toBe('success');
        expect(fs.existsSync(path.join(dir, 'shot_optimized.png'))).toBe(true);
    });

    it('转 MozJPEG 生成 _optimized.jpg 文件', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'pic.png');
        await createPng(src, 40, 40);

        const result = await transcodeImage(src, { format: 'mozjpeg' });
        expect(result.status).toBe('success');
        expect(fs.existsSync(path.join(dir, 'pic_optimized.jpg'))).toBe(true);
    });

    it('目标格式与源格式相同时返回 skipped', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'real.webp');
        await sharp({ create: { width: 16, height: 16, channels: 3, background: '#f00' } })
            .webp()
            .toFile(src);

        const result = await transcodeImage(src, { format: 'webp' });
        expect(result.status).toBe('skipped');
    });

    it('输入文件不存在时返回 error 且带原因', async () => {
        const dir = makeTempDir();
        const missing = path.join(dir, 'ghost.png');
        const result = await transcodeImage(missing, { format: 'webp' });
        expect(result.status).toBe('error');
        expect(result.reason).toBeTruthy();
        // 占位无残留：同名 .webp 幽灵空文件必须被清理
        expect(fs.existsSync(path.join(dir, 'ghost.webp'))).toBe(false);
    });

    it('orientation=6 的竖拍图转换后按摆正方向落盘', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'phone.jpg');
        // 存储 100x50、orientation=6 → 摆正后 50x100
        await sharp({ create: { width: 100, height: 50, channels: 3, background: { r: 200, g: 40, b: 40 } } })
            .jpeg()
            .withMetadata({ orientation: 6 })
            .toFile(src);

        const result = await transcodeImage(src, { format: 'png' });

        expect(result.status).toBe('success');
        const meta = await sharp(path.join(dir, 'phone_optimized.png')).metadata();
        expect(meta.width).toBe(50);
        expect(meta.height).toBe(100);
    });
});

describe('processMatting AI 抠图算子', () => {
    // 回归：抠图链路（本仓构造的 Blob 与 @imgly 内部）曾隐式依赖全局 Blob，
    // 在缺该全局的运行时上整条链路只剩 "AI 处理异常: Blob is not defined"
    it('全局 Blob 缺失时抠图仍成功（用 buffer 实现补齐）', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'cutout.png');
        await createPng(src, 24, 24);

        const fakeResult = new Blob([new Uint8Array(24 * 24 * 4)], { type: 'image/x-rgba8' });
        vi.mocked(removeBackground).mockResolvedValue(fakeResult);

        const original = globalThis.Blob;
        Reflect.deleteProperty(globalThis, 'Blob');
        try {
            const result = await processMatting(src, { aiModel: 'small', spinner: null });
            expect(result).toEqual({ status: 'success', file: src });
            expect(fs.existsSync(path.join(dir, 'cutout_nobg.png'))).toBe(true);
        } finally {
            Reflect.set(globalThis, 'Blob', original);
        }
    });

    it('sharp 解析失败时不叠加「AI 处理异常:」双前缀', async () => {
        const dir = trackedTempDir();
        const bad = path.join(dir, 'broken.png');
        fs.writeFileSync(bad, 'this is not an image');

        const result = await processMatting(bad, { spinner: null });

        expect(result.status).toBe('error');
        expect(result.reason).toMatch(/^图片文件解析失败/);
        expect(result.reason).not.toContain('AI 处理异常');
    });

    it('未标记的抠图错误仍带「AI 处理异常:」前缀', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'cutout-fail.png');
        await createPng(src, 24, 24);
        vi.mocked(removeBackground).mockRejectedValueOnce(new Error('模型加载失败'));

        const result = await processMatting(src, { aiModel: 'small', spinner: null });

        expect(result.status).toBe('error');
        expect(result.reason).toContain('AI 处理异常');
        expect(result.reason).toContain('模型加载失败');
    });
});

describe('convertImage 向后兼容适配器', () => {
    it('兼容旧版网关调用转码与抠图', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'compat.png');
        await createPng(src, 16, 16);

        const transcodeResult = await convertImage(src, 'webp', null);
        expect(transcodeResult.status).toBe('success');

        const fakeResult = new Blob([new Uint8Array(16 * 16 * 4)], { type: 'image/x-rgba8' });
        vi.mocked(removeBackground).mockResolvedValue(fakeResult);
        const mattingResult = await convertImage(src, 'rmbg_solid', null, 'small');
        expect(mattingResult.status).toBe('success');
    });
});
