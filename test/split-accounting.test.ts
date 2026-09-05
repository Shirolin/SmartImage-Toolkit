import { describe, it, expect } from 'vitest';
import { accessSync, constants } from 'fs';
import path from 'path';
import { splitImage } from '../src/split';
import { makeTempDir, createPng } from './helpers';

/** 清单内文件必须全部真实落盘（无幽灵文件） */
function expectAllListedExist(files: string[]): void {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
        expect(() => accessSync(f, constants.F_OK)).not.toThrow();
    }
}

describe('splitImage 切片记账', () => {
    it('正常切片：成功分片全部落盘且无失败分项', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'ok.png');
        await createPng(src, 200, 200);

        const result = await splitImage(src, { rows: 2, cols: 2 }, '.png');
        expect(result.status).toBe('success');

        const tiles = result.generatedFiles;
        expect(tiles).toHaveLength(4);
        expect(result.artifacts.map((f) => path.basename(f))).toContain('split_config.json');
        expect(result.failedTiles ?? []).toHaveLength(0);
        expectAllListedExist(result.generatedFiles);
        expectAllListedExist(result.artifacts);
    });

    it('超小图：坏片记 failedTiles 且不断整批', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'tiny.png');
        await createPng(src, 3, 1);

        const result = await splitImage(src, { rows: 2, cols: 2 }, '.png');
        expect(result.status).toBe('success');
        expect(result.failedTiles!.length).toBeGreaterThan(0);

        // 成功数 + 失败数 = 总格数；config 已改记 artifacts，不占切片计数
        const tiles = result.generatedFiles;
        expect(tiles.length + result.failedTiles!.length).toBe(2 * 2);
        expect(result.artifacts.map((f) => path.basename(f))).toContain('split_config.json');
    });

    it('非法 cut：零宽分片被记录，整批不断', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'cut.png');
        await createPng(src, 400, 200);

        const result = await splitImage(src, { rows: 1, cols: 1, cutX: [0, 400, 400], cutY: [0, 200] }, '.png');
        expect(result.status).toBe('success');
        expect(result.failedTiles).toHaveLength(1);
        expect(result.failedTiles![0]).toMatchObject({ row: 0, col: 1 });
        expectAllListedExist(result.generatedFiles);
    });

    it('全部分片非法：整图 error', async () => {
        const dir = makeTempDir();
        const src = path.join(dir, 'allbad.png');
        await createPng(src, 100, 100);

        const result = await splitImage(src, { rows: 1, cols: 1, cutX: [0, 0], cutY: [0, 0] }, '.png');
        expect(result.status).toBe('error');
        expect(result.reason).toBeTruthy();
        expect(result.failedTiles).toHaveLength(1);
        expect(result.generatedFiles).toHaveLength(0);
        expect(result.artifacts ?? []).toHaveLength(0);
    });
});
