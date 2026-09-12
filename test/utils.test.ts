import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { SUPPORTED_EXTS, getFiles, type FilesWarning } from '../src/utils';
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

describe('SUPPORTED_EXTS', () => {
    it('包含主流与现代化图片格式', () => {
        expect(SUPPORTED_EXTS).toContain('.png');
        expect(SUPPORTED_EXTS).toContain('.webp');
        expect(SUPPORTED_EXTS).toContain('.avif');
    });

    it('扩展名全部为小写且带点前缀', () => {
        for (const ext of SUPPORTED_EXTS) {
            expect(ext).toBe(ext.toLowerCase());
            expect(ext.startsWith('.')).toBe(true);
        }
    });
});

describe('getFiles', () => {
    it('单个受支持文件返回其自身路径', async () => {
        const dir = makeTempDir();
        const file = path.join(dir, 'a.png');
        await createPng(file, 10, 10);
        expect(await getFiles(file)).toEqual([file]);
    });

    it('不受支持的扩展名被过滤', async () => {
        const dir = makeTempDir();
        const file = path.join(dir, 'note.txt');
        fs.writeFileSync(file, 'hello');
        expect(await getFiles(file)).toEqual([]);
    });

    it('目录递归查找嵌套图片', async () => {
        const dir = makeTempDir();
        const nested = path.join(dir, 'sub', 'deep');
        fs.mkdirSync(nested, { recursive: true });
        const f1 = path.join(dir, 'root.webp');
        const f2 = path.join(nested, 'deep.jpg');
        await createPng(f1, 8, 8);
        await createPng(f2, 8, 8);
        const result = await getFiles(dir);
        expect(result.sort()).toEqual([f1, f2].sort());
    });

    it('不存在的路径返回空数组而不抛异常', async () => {
        const missing = path.join(makeTempDir(), 'nope', 'missing.png');
        expect(await getFiles(missing)).toEqual([]);
    });

    it('超过最大深度后停止检索深层文件', async () => {
        const dir = makeTempDir();
        const nested = path.join(dir, 'level1');
        fs.mkdirSync(nested);
        const deepFile = path.join(nested, 'deep.png');
        await createPng(deepFile, 8, 8);
        // maxDepth=0 时子层级(深度1)超限，应返回空
        expect(await getFiles(dir, 0)).toEqual([]);
    });
});

describe('getFiles depth 语义（与旧版逐层递归对齐）', () => {
    it('maxDepth=1 时二级目录文件被跳过，根文件保留', async () => {
        const dir = makeTempDir();
        const sub = path.join(dir, 'sub');
        fs.mkdirSync(sub);
        const rootFile = path.join(dir, 'root.png');
        await createPng(rootFile, 8, 8);
        await createPng(path.join(sub, 'deep.png'), 8, 8);
        // 旧版：root.png 走 getFiles(·,1,1)保留；deep.png 走 getFiles(·,1,2)超深跳过
        expect(await getFiles(dir, 1)).toEqual([rootFile]);
    });

    it('超深跳过经 onWarn 上报 depth', async () => {
        const dir = makeTempDir();
        const sub = path.join(dir, 'sub');
        fs.mkdirSync(sub);
        await createPng(path.join(sub, 'deep.png'), 8, 8);
        const warns: FilesWarning[] = [];
        expect(await getFiles(dir, 1, 0, (w) => warns.push(w))).toEqual([]);
        expect(warns.some((w) => w.kind === 'depth')).toBe(true);
    });
});

describe('getFiles 受支持扩展名与链接遍历', () => {
    it('单独的 .tif / .jfif 输入能被返回（不再被判为不受支持）', async () => {
        const dir = trackedTempDir();
        const tif = path.join(dir, 'scan.tif');
        await sharp({ create: { width: 8, height: 8, channels: 3, background: '#f00' } })
            .tiff()
            .toFile(tif);
        const jfif = path.join(dir, 'photo.jfif');
        await sharp({ create: { width: 8, height: 8, channels: 3, background: '#f00' } })
            .jpeg()
            .toFile(jfif);

        expect(await getFiles(tif)).toEqual([tif]);
        expect(await getFiles(jfif)).toEqual([jfif]);
    });

    it('入口目录 junction 会被跟随，内部图片照常返回', async () => {
        const root = trackedTempDir();
        const real = path.join(root, 'real');
        fs.mkdirSync(real);
        await createPng(path.join(real, 'inner.png'), 8, 8);
        const link = path.join(root, 'link');
        // 用户显式传入的目录联接（Windows mklink /J）必须展开，否则整批零产出
        fs.symlinkSync(real, link, 'junction');

        expect(await getFiles(link)).toEqual([path.join(link, 'inner.png')]);
    });

    it('深层自环链接被跳过，不会无限递归', async () => {
        const root = trackedTempDir();
        const sub = path.join(root, 'sub');
        fs.mkdirSync(sub);
        const img = path.join(sub, 'deep.png');
        await createPng(img, 8, 8);
        // 深层 junction 指回祖先目录：跟随即死循环
        fs.symlinkSync(root, path.join(sub, 'loop'), 'junction');

        const warns: FilesWarning[] = [];
        expect(await getFiles(root, 10, 0, (w) => warns.push(w))).toEqual([img]);
        expect(warns.some((w) => w.kind === 'symlink')).toBe(true);
    });

    it('深度超限只告警一次，且被截断的受支持图片数进入 skippedFiles', async () => {
        const dir = trackedTempDir();
        const rootFile = path.join(dir, 'root.png');
        await createPng(rootFile, 8, 8);
        const sub = path.join(dir, 'sub');
        fs.mkdirSync(sub);
        await createPng(path.join(sub, 'a.png'), 8, 8);
        await createPng(path.join(sub, 'b.png'), 8, 8);
        await sharp({ create: { width: 8, height: 8, channels: 3, background: '#f00' } })
            .tiff()
            .toFile(path.join(sub, 'c.tif'));
        fs.writeFileSync(path.join(sub, 'note.txt'), 'hello');
        fs.mkdirSync(path.join(sub, 'deeper'));

        const warns: FilesWarning[] = [];
        // maxDepth=1：sub 层整体超限被截断，根层文件不受影响
        expect(await getFiles(dir, 1, 0, (w) => warns.push(w))).toEqual([rootFile]);

        const depthWarns = warns.filter((w) => w.kind === 'depth');
        expect(depthWarns).toHaveLength(1); // 同层多个条目也只告警一次
        expect(depthWarns[0].path).toBe(sub);
        expect(depthWarns[0].skippedFiles).toBe(3); // 仅受支持图片：a.png / b.png / c.tif
    });
});
