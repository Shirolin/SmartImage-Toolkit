import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { splitImage } from '../src/split';
import { makeTempDir, createPng, listImages } from './helpers';

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

describe('splitImage', () => {
    it('2x2 均匀切分生成 4 张切片与配置文件', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'grid.png');
        await createPng(src, 400, 200);

        const result = await splitImage(src, { rows: 2, cols: 2 }, '.png');
        expect(result.status).toBe('success');

        const outDir = path.join(dir, 'grid');
        const tiles = listImages(outDir, ['split_config.json']);
        expect(tiles).toHaveLength(4);

        for (const tile of tiles) {
            const meta = await sharp(tile).metadata();
            expect(meta.width).toBe(200);
            expect(meta.height).toBe(100);
        }
        // generatedFiles 只保留切片图；切割配置改记 artifacts
        expect(result.generatedFiles).toHaveLength(4);
        expect(result.artifacts.map((f) => path.basename(f))).toContain('split_config.json');
    });

    it('自定义切割线按坐标切分', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'cuts.png');
        await createPng(src, 400, 200);

        const result = await splitImage(src, { rows: 1, cols: 1, cutX: [0, 150, 400], cutY: [0, 200] }, '.png');
        expect(result.status).toBe('success');

        const outDir = path.join(dir, 'cuts');
        const tiles = listImages(outDir, ['split_config.json']);
        expect(tiles).toHaveLength(2);

        const widths: number[] = [];
        for (const tile of tiles) {
            const meta = await sharp(tile).metadata();
            widths.push(meta.width || 0);
        }
        expect(widths.sort((a, b) => a - b)).toEqual([150, 250]);
    });

    it('无法读取图像时返回 error', async () => {
        const dir = makeTempDir();
        const bad = path.join(dir, 'broken.png');
        // 写入非图片内容但使用图片扩展名
        const fs = (await import('fs')).default;
        fs.writeFileSync(bad, 'this is not an image');

        const result = await splitImage(bad, { rows: 2, cols: 2 }, '.png');
        expect(result.status).toBe('error');
    });
});

describe('splitImage EXIF 方向', () => {
    it('orientation=6 的竖拍图按摆正后的尺寸切分', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'phone.jpg');
        // 存储 100x50、orientation=6 → 摆正后 50x100
        await sharp({ create: { width: 100, height: 50, channels: 3, background: { r: 200, g: 40, b: 40 } } })
            .jpeg()
            .withMetadata({ orientation: 6 })
            .toFile(src);

        const result = await splitImage(src, { rows: 1, cols: 2 }, '.jpg');

        expect(result.status).toBe('success');
        const tiles = listImages(path.join(dir, 'phone'), ['split_config.json']);
        expect(tiles).toHaveLength(2);
        for (const tile of tiles) {
            const meta = await sharp(tile).metadata();
            // 摆正后 50x100 竖切两列 → 25x100；未摆正会按 100x50 切成 50x25
            expect(meta.width).toBe(25);
            expect(meta.height).toBe(100);
        }
    });
});
