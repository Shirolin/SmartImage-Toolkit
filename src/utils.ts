import fs from 'fs';
import path from 'path';

// 第一性原理：目录遍历是纯数据工作，着色与打印是表现层职责——本模块只返数据，
// 调用方（convert.ts）经 onWarn 回调决定如何呈现警告。

// 支持的图片扩展名
export const SUPPORTED_EXTS: string[] = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.gif', '.webp', '.avif'];

/** 遍历过程中被跳过的路径信息（替代原来的 chalk 直接打印） */
export interface FilesWarning {
    kind: 'symlink' | 'depth' | 'error';
    path: string;
    message: string;
}

export type FilesWarnCallback = (warn: FilesWarning) => void;

/**
 * 安全地获取给定路径下的所有受支持格式的图片文件
 * @param inputPath 输入的文件或文件夹路径
 * @param maxDepth 最大允许的递归搜索深度
 * @param currentDepth 内部使用的当前递归深度状态
 * @param onWarn 跳过/失败时的通知回调（不传则静默跳过）
 */
export async function getFiles(
    inputPath: string,
    maxDepth: number = 10,
    currentDepth: number = 0,
    onWarn?: FilesWarnCallback
): Promise<string[]> {
    if (currentDepth > maxDepth) {
        onWarn?.({
            kind: 'depth',
            path: inputPath,
            message: `路径层级超过最大的 ${maxDepth} 层限制，已跳过更深层级的检索`
        });
        return [];
    }

    let stats: fs.Stats;
    try {
        stats = await fs.promises.lstat(inputPath); // 使用 lstat 提取软链接信息（比 stat 更全面）
    } catch (err: unknown) {
        onWarn?.({
            kind: 'error',
            path: inputPath,
            message: err instanceof Error ? err.message : '未知错误'
        });
        return [];
    }

    if (stats.isSymbolicLink()) {
        onWarn?.({ kind: 'symlink', path: inputPath, message: '检测到软链接，为防止死循环已跳过' });
        return [];
    }

    if (stats.isFile()) {
        return SUPPORTED_EXTS.includes(path.extname(inputPath).toLowerCase()) ? [inputPath] : [];
    }

    if (!stats.isDirectory()) {
        return [];
    }

    let entries: fs.Dirent[];
    try {
        // 一次 readdir 拿到类型信息，避免逐文件 lstat 的系统调用风暴
        entries = await fs.promises.readdir(inputPath, { withFileTypes: true });
    } catch (err: unknown) {
        onWarn?.({
            kind: 'error',
            path: inputPath,
            message: err instanceof Error ? err.message : '未知错误'
        });
        return [];
    }

    // 文件直接收敛，子目录并行下钻；push 累积避免 concat 反复复制数组
    // depth 语义与旧版逐层递归逐行对齐：每个目录项（含文件/链接）一律视为
    // currentDepth+1，超深即在入口判 >maxDepth 的等价前移处跳过并告警
    const childDepth = currentDepth + 1;
    const depthExceeded = childDepth > maxDepth;
    const results: string[] = [];
    const subTasks: Promise<string[]>[] = [];
    for (const entry of entries) {
        const fullPath = path.join(inputPath, entry.name);
        if (depthExceeded) {
            onWarn?.({
                kind: 'depth',
                path: fullPath,
                message: `路径层级超过最大的 ${maxDepth} 层限制，已跳过更深层级的检索`
            });
            continue;
        }
        if (entry.isSymbolicLink()) {
            onWarn?.({ kind: 'symlink', path: fullPath, message: '检测到软链接，为防止死循环已跳过' });
            continue;
        }
        if (entry.isFile()) {
            if (SUPPORTED_EXTS.includes(path.extname(entry.name).toLowerCase())) {
                results.push(fullPath);
            }
            continue;
        }
        if (entry.isDirectory()) {
            subTasks.push(getFiles(fullPath, maxDepth, childDepth, onWarn));
            continue;
        }
        // 其它类型（socket、FIFO 等）直接忽略
    }
    const subResults = await Promise.all(subTasks);
    for (const sub of subResults) {
        results.push(...sub);
    }
    return results;
}
