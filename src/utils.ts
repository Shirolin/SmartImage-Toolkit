import fs from 'fs';
import path from 'path';

// 第一性原理：目录遍历是纯数据工作，着色与打印是表现层职责——本模块只返数据，
// 调用方（convert.ts）经 onWarn 回调决定如何呈现警告。

// 支持的图片扩展名：sharp 对同族扩展名一视同仁，`.tif`/`.jfif` 必须与 `.tiff`/`.jpg` 同等对待，
// 否则它们作为唯一输入时会被判定为「未找到任何受支持的图片文件」。
export const SUPPORTED_EXTS: string[] = [
    '.jpg',
    '.jpeg',
    '.jfif',
    '.png',
    '.bmp',
    '.tif',
    '.tiff',
    '.gif',
    '.webp',
    '.avif'
];

/** 发现/遍历过程中被跳过的路径信息 */
export interface DiscoveryWarning {
    kind: 'inaccessible' | 'symlink' | 'depth' | 'error';
    path: string;
    message: string;
    /** 仅 depth 告警使用：本次被深度限制截断、未纳入处理的受支持图片数（入口据此计入汇总，避免静默产出缺口） */
    skippedFiles?: number;
}

export type DiscoveryWarnCallback = (warn: DiscoveryWarning) => void;

/** 兼容旧版警告类型别名 */
export type FilesWarning = DiscoveryWarning;
export type FilesWarnCallback = DiscoveryWarnCallback;

export interface DiscoveryOptions {
    /** 最大允许的递归搜索深度（默认 10） */
    maxDepth?: number;
    /** 支持的文件扩展名列表（默认 SUPPORTED_EXTS） */
    supportedExts?: readonly string[];
    /** 发现告警通知回调 */
    onWarn?: DiscoveryWarnCallback;
}

export interface DiscoveryResult {
    /** 查找到并去重后的文件绝对/相对路径列表 */
    files: string[];
    /** 因超出最大深度而被截断的受支持图片总数 */
    truncatedCount: number;
    /** 遍历期间收集的所有告警 */
    warnings: DiscoveryWarning[];
}

/** 内部递归目录探索函数 */
async function walkDirectory(
    inputPath: string,
    maxDepth: number,
    currentDepth: number,
    supportedExts: readonly string[],
    onWarn?: DiscoveryWarnCallback
): Promise<string[]> {
    // 深度判定必须在遍历前一次性完成：写在循环体内会对同一层的每个条目重复告警
    // （第 11 层含 N 个条目即刷 N 条同款黄字），且函数必然返回空。
    const childDepth = currentDepth + 1;
    const depthExceeded = childDepth > maxDepth;

    let stats: fs.Stats;
    try {
        // 只有入口（depth 0）跟随链接：用户显式传入的软链/目录联接（Windows `mklink /J`）
        // 应当正常展开，深层条目继续 lstat，靠符号链接判断阻断自引用死循环。
        stats = currentDepth === 0 ? await fs.promises.stat(inputPath) : await fs.promises.lstat(inputPath);
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
        return supportedExts.includes(path.extname(inputPath).toLowerCase()) ? [inputPath] : [];
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

    // 深度超限：readdir 已拿到本层条目，故能一次性告警并给出被截断的受支持图片数，
    // 入口把它计入汇总，避免「成功 0 / 失败 0 / 退出码 0」掩盖整层未处理的产出缺口。
    // 更深层（子目录内）的文件数不遍历则无从得知，此处只统计本层可直接判定的文件。
    if (depthExceeded) {
        const skippedFiles = entries.filter(
            (entry) => entry.isFile() && supportedExts.includes(path.extname(entry.name).toLowerCase())
        ).length;
        onWarn?.({
            kind: 'depth',
            path: inputPath,
            message: `路径层级超过最大的 ${maxDepth} 层限制，已跳过更深层级的检索`,
            skippedFiles
        });
        return [];
    }

    // 文件直接收敛，子目录并行下钻；push 累积避免 concat 反复复制数组
    // depth 语义与旧版逐层递归逐行对齐：每个目录项（含文件/链接）一律视为 currentDepth+1，
    // 超深已在上方一次性拦截，循环内只剩正常条目
    const results: string[] = [];
    const subTasks: Promise<string[]>[] = [];
    for (const entry of entries) {
        const fullPath = path.join(inputPath, entry.name);
        if (entry.isSymbolicLink()) {
            onWarn?.({ kind: 'symlink', path: fullPath, message: '检测到软链接，为防止死循环已跳过' });
            continue;
        }
        if (entry.isFile()) {
            if (supportedExts.includes(path.extname(entry.name).toLowerCase())) {
                results.push(fullPath);
            }
            continue;
        }
        if (entry.isDirectory()) {
            subTasks.push(walkDirectory(fullPath, maxDepth, childDepth, supportedExts, onWarn));
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

/**
 * 统一深度输入扫描与摄取管线
 * 吸收多目标归一化、可访问性核验、目录递归探测、符号链接防环、深度截断记账与集合去重
 *
 * @param targets 单个路径或路径列表
 * @param options 扫描配置（最大深度、受支持扩展名、告警回调）
 */
export async function discoverInputs(
    targets: string | readonly string[],
    options?: DiscoveryOptions
): Promise<DiscoveryResult> {
    const list = typeof targets === 'string' ? [targets] : [...targets];
    const maxDepth = options?.maxDepth ?? 10;
    const supportedExts = options?.supportedExts ?? SUPPORTED_EXTS;
    const warnings: DiscoveryWarning[] = [];
    let truncatedCount = 0;

    const handleWarn: DiscoveryWarnCallback = (warn) => {
        warnings.push(warn);
        if (warn.kind === 'depth' && typeof warn.skippedFiles === 'number') {
            truncatedCount += warn.skippedFiles;
        }
        options?.onWarn?.(warn);
    };

    const allFiles: string[] = [];

    for (const target of list) {
        try {
            await fs.promises.access(target);
        } catch {
            handleWarn({
                kind: 'inaccessible',
                path: target,
                message: '路径不存在或不可访问，已跳过'
            });
            continue;
        }

        const files = await walkDirectory(target, maxDepth, 0, supportedExts, handleWarn);
        allFiles.push(...files);
    }

    return {
        files: [...new Set(allFiles)],
        truncatedCount,
        warnings
    };
}

/**
 * 安全地获取给定路径下的所有受支持格式的图片文件（向后兼容适配器）
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
    return walkDirectory(inputPath, maxDepth, currentDepth, SUPPORTED_EXTS, onWarn);
}
