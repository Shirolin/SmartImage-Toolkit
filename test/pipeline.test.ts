import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { defineOperator, executeBatch } from '../src/shared/pipeline';
import { makeTempDir, createPng } from './helpers';

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

describe('Operation Runner (shared/pipeline)', () => {
    it('标准流水线执行：成功写入指定子目录与正确格式', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'test-img.png');
        await createPng(src, 100, 100, { r: 255, g: 0, b: 0 });

        const testOp = defineOperator<{ scale: number }>({
            destination: { subDir: 'scaled', suffix: '_half' },
            transform: ({ sharp, oriented, config }) => {
                const targetW = Math.round(oriented.width * config.scale);
                const targetH = Math.round(oriented.height * config.scale);
                return sharp.resize(targetW, targetH);
            }
        });

        const result = await testOp(src, { scale: 0.5 }, '.webp');
        expect(result.status).toBe('success');
        expect(result.file).toBe(src);

        const expectedOutput = path.join(dir, 'scaled', 'test-img_half.webp');
        expect(fs.existsSync(expectedOutput)).toBe(true);

        const meta = await sharp(fs.readFileSync(expectedOutput)).metadata();
        expect(meta.width).toBe(50);
        expect(meta.height).toBe(50);
        expect(meta.format).toBe('webp');
    });

    it('零磁盘副作用跳过：当 transform 返回 skip 时，不创建输出目录亦不分配空占位', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'skip-me.png');
        await createPng(src, 80, 80);

        const skipOp = defineOperator<void>({
            destination: { subDir: 'should-not-exist' },
            transform: () => ({ skip: true, reason: '无需处理已跳过' })
        });

        const result = await skipOp(src, undefined, null);
        expect(result.status).toBe('skipped');
        expect(result.reason).toBe('无需处理已跳过');

        // 输出子目录绝对不存在
        const nonExistentDir = path.join(dir, 'should-not-exist');
        expect(fs.existsSync(nonExistentDir)).toBe(false);
    });

    it('幽灵文件清理不变量：当 transform 抛错或失败时，零残留且已分配文件被立即删除', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'fail-img.png');
        await createPng(src, 60, 60);

        const failOp = defineOperator<void>({
            destination: { subDir: 'failed-run' },
            transform: () => {
                throw new Error('算子计算严重故障');
            }
        });

        const result = await failOp(src, undefined, null);
        expect(result.status).toBe('error');
        expect(result.reason).toBe('算子计算严重故障');

        // 绝不留 0 字节文件
        const outDir = path.join(dir, 'failed-run');
        if (fs.existsSync(outDir)) {
            const files = fs.readdirSync(outDir);
            expect(files.length).toBe(0);
        }
    });

    it('EXIF 视向摆正不变量：手机竖拍图正向传入算子，oriented 为纠偏后坐标', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'vertical-phone.jpg');
        // 存储 120x60，EXIF orientation 6 (顺时针旋转90度) → 视觉上是 60x120 竖图
        await sharp({ create: { width: 120, height: 60, channels: 3, background: { r: 10, g: 200, b: 10 } } })
            .jpeg()
            .withMetadata({ orientation: 6 })
            .toFile(src);

        let receivedWidth = 0;
        let receivedHeight = 0;

        const inspectOp = defineOperator<void>({
            destination: { subDir: 'oriented' },
            transform: ({ sharp, oriented }) => {
                receivedWidth = oriented.width;
                receivedHeight = oriented.height;
                return sharp;
            }
        });

        const result = await inspectOp(src, undefined, '.jpg');
        expect(result.status).toBe('success');
        expect(receivedWidth).toBe(60);
        expect(receivedHeight).toBe(120);
    });

    it('executeBatch 批处理调度器支持进度上报与受控并发', async () => {
        const dir = trackedTempDir();
        const files: string[] = [];
        for (let i = 0; i < 5; i++) {
            const f = path.join(dir, `batch-${i}.png`);
            await createPng(f, 40, 40);
            files.push(f);
        }

        const testOp = defineOperator<void>({
            destination: { subDir: 'batched' },
            transform: ({ sharp }) => sharp
        });

        let progressCalls = 0;
        const results = await executeBatch(files, testOp, undefined, null, {
            batchSize: 2,
            onProgress: () => {
                progressCalls++;
            }
        });

        expect(results.length).toBe(5);
        expect(results.every((r) => r.status === 'success')).toBe(true);
        expect(progressCalls).toBeGreaterThanOrEqual(3); // 5个文件以批大小2至少触发3次
    });
});
