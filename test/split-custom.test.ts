import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { executeSplitCustom } from '../src/server/split-custom';
import { PathSandbox } from '../src/server/guard';
import { makeTempDir, createPng } from './helpers';

sharp.cache(false);

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

describe('executeSplitCustom 编排器', () => {
    it('非法入参返回 400', async () => {
        const sandbox = new PathSandbox();
        const res = await executeSplitCustom({}, sandbox);
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('越权路径返回 403', async () => {
        const sandbox = new PathSandbox();
        const res = await executeSplitCustom(
            {
                filePath: path.resolve(process.cwd(), '../outside_image.png'),
                cutX: [0, 100],
                cutY: [0, 100]
            },
            sandbox
        );
        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it('标准自定义切图并生成切片与契约回包', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'grid.png');
        await createPng(src, 200, 200);

        const sandbox = new PathSandbox();
        sandbox.authorize(src);

        const res = await executeSplitCustom(
            {
                filePath: src,
                cutX: [0, 100, 200],
                cutY: [0, 100, 200],
                smartCenter: false
            },
            sandbox
        );

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        if (res.body.success) {
            expect(res.body.files).toHaveLength(4);
            expect(res.body.failedTiles).toEqual([]);
            expect(res.body.centerFailures).toEqual([]);
        }
    });

    it('开启 smartCenter 时成功触发居中后处理', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'center_grid.png');
        await createPng(src, 200, 200);

        const sandbox = new PathSandbox();
        sandbox.authorize(src);

        const res = await executeSplitCustom(
            {
                filePath: src,
                cutX: [0, 100, 200],
                cutY: [0, 100, 200],
                smartCenter: true,
                centerConfig: { threshold: 10, fillColor: 'transparent' }
            },
            sandbox
        );

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        if (res.body.success) {
            expect(res.body.files).toHaveLength(4);
            expect(res.body.centerFailures).toEqual([]);
        }
    });
});
