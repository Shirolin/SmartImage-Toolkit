import { describe, it, expect } from 'vitest';
import path from 'path';
import sharp from 'sharp';
import { splitImage } from '../src/split';
import { makeTempDir, createPng, listImages } from './helpers';

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
