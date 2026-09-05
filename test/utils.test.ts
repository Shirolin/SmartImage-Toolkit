import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SUPPORTED_EXTS, getFiles, type FilesWarning } from '../src/utils';
import { makeTempDir, createPng } from './helpers';

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
