import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

/** 创建隔离的临时目录 */
export function makeTempDir(prefix = 'sit-test-'): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** 生成纯色 PNG 测试图 */
export async function createPng(
    filePath: string,
    width: number,
    height: number,
    background: sharp.Color = { r: 255, g: 0, b: 0 }
): Promise<void> {
    await sharp({ create: { width, height, channels: 3, background } })
        .png()
        .toFile(filePath);
}

/** 生成带纯色边框的 PNG（中心为红、边框为白），用于 trim 场景 */
export async function createPngWithBorder(
    filePath: string,
    contentW: number,
    contentH: number,
    borderX: number,
    borderY: number
): Promise<void> {
    const center = await sharp({
        create: { width: contentW, height: contentH, channels: 3, background: { r: 220, g: 30, b: 30 } }
    })
        .png()
        .toBuffer();
    await sharp(center)
        .extend({
            top: borderY,
            bottom: borderY,
            left: borderX,
            right: borderX,
            background: { r: 255, g: 255, b: 255 }
        })
        .png()
        .toFile(filePath);
}

/** 列出目录下的图片文件（排除指定名） */
export function listImages(dir: string, exclude: string[] = []): string[] {
    return fs
        .readdirSync(dir)
        .filter((f) => !exclude.includes(f) && /\.(png|jpe?g|webp|avif)$/i.test(f))
        .map((f) => path.join(dir, f));
}
