// 输出命名：独占创建占位，杜绝先判存在再落盘的并发竞争
import { promises as fsp } from 'fs';
import path from 'path';

// 确保目录存在
export async function ensureDir(dir: string): Promise<void> {
    await fsp.mkdir(dir, { recursive: true });
}

// 分配文件路径：dir/base/ext 组合，存在则 base(1) 递增；以 O_EXCL 独占建空文件占位后返回
export async function allocateFilePath(dir: string, base: string, ext: string): Promise<string> {
    await ensureDir(dir);
    let candidate = path.join(dir, `${base}${ext}`);
    let counter = 1;
    for (;;) {
        try {
            const handle = await fsp.open(candidate, 'wx');
            await handle.close();
            return candidate;
        } catch (err) {
            if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'EEXIST') {
                candidate = path.join(dir, `${base}(${counter})${ext}`);
                counter += 1;
                continue;
            }
            throw err;
        }
    }
}

// 分配目录：base 已存在则 name(1) 递增
export async function allocateDir(base: string): Promise<string> {
    let candidate = base;
    let counter = 1;
    for (;;) {
        try {
            await fsp.mkdir(candidate);
            return candidate;
        } catch (err) {
            if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'EEXIST') {
                candidate = `${base}(${counter})`;
                counter += 1;
                continue;
            }
            throw err;
        }
    }
}
