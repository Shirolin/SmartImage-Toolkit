import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { processTrimOrCrop } from '../src/trim';
import { makeTempDir, createPngWithBorder } from './helpers';

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

/** 生成带白边的 JPEG 并写入 EXIF orientation（存储 100x50：内容 80x30，四周白边各 10） */
async function createOrientedBorderedJpeg(filePath: string, orientation: number): Promise<void> {
    const center = await sharp({
        create: { width: 80, height: 30, channels: 3, background: { r: 220, g: 30, b: 30 } }
    })
        .png()
        .toBuffer();
    await sharp(center)
        .extend({ top: 10, bottom: 10, left: 10, right: 10, background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 95 })
        .withMetadata({ orientation })
        .toFile(filePath);
}

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
    it('去除四周全透明边缘并保留内容像素', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'alpha-border.png');
        const center = await sharp({
            create: { width: 80, height: 60, channels: 4, background: { r: 220, g: 30, b: 30, alpha: 1 } }
        })
            .png()
            .toBuffer();
        await sharp(center)
            .extend({ top: 30, bottom: 30, left: 30, right: 30, background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toFile(src);

        const result = await processTrimOrCrop(
            src,
            'trim',
            { threshold: 10, sides: ['top', 'bottom', 'left', 'right'] },
            null
        );
        expect(result.status).toBe('success');

        const outPath = path.join(dir, 'trimmed', 'alpha-border.png');
        expect(fs.existsSync(outPath)).toBe(true);
        const meta = await sharp(outPath).metadata();
        // 140x120 去掉各 30px 透明边 → 内容 80x60，容差与白边用例同口径
        expect(meta.width!).toBeGreaterThanOrEqual(76);
        expect(meta.width!).toBeLessThanOrEqual(84);
        expect(meta.height!).toBeGreaterThanOrEqual(56);
        expect(meta.height!).toBeLessThanOrEqual(64);
        // 内容零损失：统一补齐 alpha 后与原中心逐字节一致
        const outRaw = await sharp(outPath).ensureAlpha().raw().toBuffer();
        const centerRaw = await sharp(center).ensureAlpha().raw().toBuffer();
        expect(Buffer.compare(outRaw, centerRaw)).toBe(0);
    });

    it('全透明图不崩溃并原样落盘', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'full.png');
        await sharp({
            create: { width: 50, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
        })
            .png()
            .toFile(src);

        const result = await processTrimOrCrop(
            src,
            'trim',
            { threshold: 10, sides: ['top', 'bottom', 'left', 'right'] },
            null
        );
        expect(result.status).toBe('success');

        const outPath = path.join(dir, 'trimmed', 'full.png');
        expect(fs.existsSync(outPath)).toBe(true);
        const meta = await sharp(outPath).metadata();
        expect(meta.width).toBe(50);
        expect(meta.height).toBe(40);
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

describe('processTrimOrCrop EXIF 方向', () => {
    it('crop 在摆正后的坐标系里裁剪（左切 10 上切 5）', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'phone.jpg');
        // 存储 100x50、orientation=6 → 摆正后 50x100
        await sharp({ create: { width: 100, height: 50, channels: 3, background: { r: 200, g: 40, b: 40 } } })
            .jpeg()
            .withMetadata({ orientation: 6 })
            .toFile(src);

        const result = await processTrimOrCrop(src, 'crop', { top: 5, bottom: 0, left: 10, right: 0 }, null);

        expect(result.status).toBe('success');
        const meta = await sharp(path.join(dir, 'cropped', 'phone.jpg')).metadata();
        // 摆正后 50x100：宽 50-10=40、高 100-5=95；坐标未摆正会得到 90x45 或因越界直接失败
        expect(meta.width).toBe(40);
        expect(meta.height).toBe(95);
    });

    it('trim 以摆正后的尺寸为基准探测边界', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'bordered-phone.jpg');
        await createOrientedBorderedJpeg(src, 6);

        const result = await processTrimOrCrop(
            src,
            'trim',
            { threshold: 10, sides: ['top', 'bottom', 'left', 'right'] },
            null
        );

        expect(result.status).toBe('success');
        const meta = await sharp(path.join(dir, 'trimmed', 'bordered-phone.jpg')).metadata();
        // 摆正后 50x100、白边 10 → 内容约 30x80；坐标未摆正会得到横躺的约 80x30
        expect(meta.width!).toBeGreaterThanOrEqual(26);
        expect(meta.width!).toBeLessThanOrEqual(34);
        expect(meta.height!).toBeGreaterThanOrEqual(76);
        expect(meta.height!).toBeLessThanOrEqual(84);
    });
});

describe('processTrimOrCrop - residue 报告', () => {
    async function makeTransparentBordered(src: string): Promise<void> {
        const center = await sharp({
            create: { width: 80, height: 60, channels: 4, background: { r: 220, g: 30, b: 30, alpha: 1 } }
        })
            .png()
            .toBuffer();
        await sharp(center)
            .extend({ top: 30, bottom: 30, left: 30, right: 30, background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toFile(src);
    }

    it('透明均匀边报出四边切量与 uniform 分类', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'alpha-residue.png');
        await makeTransparentBordered(src);

        const result = await processTrimOrCrop(
            src,
            'trim',
            { threshold: 10, sides: ['top', 'bottom', 'left', 'right'] },
            null
        );
        expect(result.status).toBe('success');
        expect(result.residue?.cuts).toEqual({ top: 30, bottom: 30, left: 30, right: 30 });
        expect(result.residue?.kinds).toEqual({ top: 'uniform', bottom: 'uniform', left: 'uniform', right: 'uniform' });
        expect(result.residue?.confidence).toBe(1);
    });

    it('全透明图切量为零且分类为 none', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'full-residue.png');
        await sharp({
            create: { width: 50, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
        })
            .png()
            .toFile(src);

        const result = await processTrimOrCrop(
            src,
            'trim',
            { threshold: 10, sides: ['top', 'bottom', 'left', 'right'] },
            null
        );
        expect(result.status).toBe('success');
        expect(result.residue?.cuts).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
        expect(result.residue?.kinds).toEqual({ top: 'none', bottom: 'none', left: 'none', right: 'none' });
        expect(result.residue?.confidence).toBe(1);
    });

    it('被 sides 滤掉的边切量为零但分类仍标注', async () => {
        const dir = trackedTempDir();
        const src = path.join(dir, 'alpha-kept.png');
        await makeTransparentBordered(src);

        const result = await processTrimOrCrop(src, 'trim', { threshold: 10, sides: ['left'] }, null);
        expect(result.status).toBe('success');
        // 实际只执行左边；top/bottom/right 是用户故意保留的残留，kinds 保持探测口径可见
        expect(result.residue?.cuts).toEqual({ top: 0, bottom: 0, left: 30, right: 0 });
        expect(result.residue?.kinds).toEqual({ top: 'uniform', bottom: 'uniform', left: 'uniform', right: 'uniform' });
        expect(result.residue?.confidence).toBe(1);
    });
});
