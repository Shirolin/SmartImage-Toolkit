import path from 'path';
import { realpathSync } from 'fs';
import { MAX_TILES } from '../shared/constants';
import { SUPPORTED_EXTS } from '../utils';
import type { SplitResult } from '../shared/results';

/** 规范化后的安全居中配置 */
export interface ValidatedCenterConfig {
    threshold: number;
    fillColor: string;
    outputFormat: 'original' | 'webp' | 'png' | 'mozjpeg';
    sides: ('top' | 'bottom' | 'left' | 'right')[];
}

/** 经过校验与类型收窄的切图请求纯数据入参 */
export interface SplitCustomRequestParams {
    filePath: string;
    cutX: number[];
    cutY: number[];
    smartCenter: boolean;
    centerConfig?: ValidatedCenterConfig;
}

/** 校验结果判别联合类型 */
export type ValidationOutcome<T> = { ok: true; params: T } | { ok: false; status: 400 | 403; error: string };

/**
 * 取路径的物理真实路径：展开符号链接与 Windows junction（`mklink /J`）到最终目标。
 * 路径不存在（如尚未落盘的切片）或不可访问时退回 path.resolve —— 路由随后还会 stat/sendFile，
 * 不存在的路径最终以 404 收场，不会因为这次退回而放行链接指向的外部目标。
 */
export function realpathOrResolve(p: string): string {
    try {
        return realpathSync(p);
    } catch {
        return path.resolve(p);
    }
}

/** 白名单根 realpath 结果缓存：根集合稳定，每个根规范化一次后复用，避免每次请求都打文件系统 */
const rootRealpathCache = new Map<string, string>();

/** 路径是否落在白名单根内（含根自身），供单测与路由共用 */
export function isPathAllowed(p: string, roots: string[]): boolean {
    // 先取物理路径再比较：白名单目录内的 junction/symlink 可指向根外，纯字符串前缀比较会误放行
    const real = realpathOrResolve(p);
    // Windows 路径大小写不敏感：从别处粘贴来的路径不应因大小写差异被拒
    const resolved = process.platform === 'win32' ? real.toLowerCase() : real;
    return roots.some((root) => {
        let base = rootRealpathCache.get(root);
        if (base === undefined) {
            base = realpathOrResolve(root);
            rootRealpathCache.set(root, base);
        }
        const prefix = process.platform === 'win32' ? base.toLowerCase() : base;
        // 根自身即「盘符根」时其末尾已带分隔符，补一次会拼出 `d:\\` 而漏掉所有子文件
        const childPrefix = prefix.endsWith(path.sep) ? prefix : prefix + path.sep;
        return resolved === prefix || resolved.startsWith(childPrefix);
    });
}

/**
 * 路径沙箱：隔离符号链接穿透与 Windows 路径异构，维护受控目录白名单
 */
export class PathSandbox {
    private extraRoots = new Set<string>();
    private defaultImagePath: string;

    constructor(defaultImagePath: string = '') {
        this.defaultImagePath = defaultImagePath ? path.resolve(defaultImagePath) : '';
    }

    /** 用户显式选择或授权的路径：将所在目录纳入白名单 */
    authorize(targetPath: string): void {
        const resolved = path.resolve(targetPath);
        this.extraRoots.add(path.dirname(resolved));
    }

    /** 获取所有允许访问的根目录清单 */
    getAllowedRoots(): string[] {
        const roots = [process.cwd(), ...this.extraRoots];
        if (this.defaultImagePath) {
            roots.push(path.dirname(this.defaultImagePath));
        }
        return roots;
    }

    /** 检查指定绝对路径是否在沙箱允许范围内 */
    isAllowed(targetPath: string): boolean {
        return isPathAllowed(path.resolve(targetPath), this.getAllowedRoots());
    }
}

/** 切分线守卫：数组、长度 2..100、全为非负整数（须为整数）、严格递增 */
export function isValidCutArray(value: unknown): value is number[] {
    if (!Array.isArray(value)) return false;
    if (value.length < 2 || value.length > 100) return false;
    for (const item of value) {
        if (typeof item !== 'number' || !Number.isFinite(item) || !Number.isInteger(item) || item < 0) return false;
    }
    for (let i = 1; i < value.length; i++) {
        if (value[i] <= value[i - 1]) return false;
    }
    return true;
}

/** 切片总数：(cutX.length-1)*(cutY.length-1)，供路由上限守卫与单测共用 */
export function countSplitTiles(cutX: number[], cutY: number[]): number {
    return (cutX.length - 1) * (cutY.length - 1);
}

const CENTER_SIDES = new Set(['top', 'bottom', 'left', 'right']);
const CENTER_FORMATS = new Set(['original', 'webp', 'png', 'mozjpeg']);

/** centerConfig 白名单校验：缺省放行，只校验出现的字段 */
export function isValidCenterConfig(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value !== 'object') return false;
    const cfg = value as Record<string, unknown>;
    if ('threshold' in cfg) {
        const t = cfg['threshold'];
        if (typeof t !== 'number' || !Number.isFinite(t) || t < 1 || t > 100) return false;
    }
    if ('fillColor' in cfg) {
        const c = cfg['fillColor'];
        if (typeof c !== 'string') return false;
        if (c !== 'transparent' && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) return false;
    }
    if ('outputFormat' in cfg) {
        const f = cfg['outputFormat'];
        if (typeof f !== 'string' || !CENTER_FORMATS.has(f)) return false;
    }
    if ('sides' in cfg) {
        const s = cfg['sides'];
        if (!Array.isArray(s)) return false;
        for (const side of s) {
            if (typeof side !== 'string' || !CENTER_SIDES.has(side)) return false;
        }
    }
    return true;
}

/** split-custom 成功回包拼装：failedTiles 与 SplitResult 同形；居中失败单独回报，不发散成假成功 */
export interface SplitCustomSuccessPayload {
    success: true;
    message: string;
    files: string[];
    artifacts: string[];
    failedTiles: Array<{ row: number; col: number; reason: string }>;
    centerFailures: Array<{ file: string; reason: string }>;
}

export function buildSplitCustomSuccess(
    result: SplitResult,
    centerFailures: Array<{ file: string; reason: string }> = []
): SplitCustomSuccessPayload {
    return {
        success: true,
        message: centerFailures.length > 0 ? `切图完成，但有 ${centerFailures.length} 张切片居中失败` : '切图完成！',
        files: result.generatedFiles,
        artifacts: result.artifacts ?? [],
        failedTiles: result.failedTiles ?? [],
        centerFailures
    };
}

/**
 * 切图请求统一校验入口：在接缝处收敛所有 HTTP 入参防御性核验
 */
export function validateSplitCustomBody(
    rawBody: unknown,
    sandbox: PathSandbox
): ValidationOutcome<SplitCustomRequestParams> {
    const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as Record<string, unknown>;
    const { filePath: rawPath, cutX, cutY, smartCenter, centerConfig } = body;

    if (typeof rawPath !== 'string' || !rawPath) {
        return { ok: false, status: 400, error: '缺少必要参数' };
    }
    if (!isValidCutArray(cutX) || !isValidCutArray(cutY)) {
        return { ok: false, status: 400, error: '切分线参数非法：须为 2..100 个严格递增的非负整数' };
    }
    if (countSplitTiles(cutX, cutY) > MAX_TILES) {
        return { ok: false, status: 400, error: `切片总数超限：最多 ${MAX_TILES} 张` };
    }
    if (!isValidCenterConfig(centerConfig)) {
        return { ok: false, status: 400, error: '居中配置参数非法' };
    }

    const filePath = path.resolve(rawPath);
    if (!sandbox.isAllowed(filePath)) {
        return { ok: false, status: 403, error: '路径不在允许范围内' };
    }
    if (!SUPPORTED_EXTS.includes(path.extname(filePath).toLowerCase())) {
        return { ok: false, status: 400, error: '仅支持图片文件' };
    }

    let validatedCenterConfig: ValidatedCenterConfig | undefined;
    if (smartCenter) {
        const rawCfg = (typeof centerConfig === 'object' && centerConfig !== null ? centerConfig : {}) as {
            threshold?: unknown;
            fillColor?: unknown;
            outputFormat?: unknown;
            sides?: unknown;
        };
        validatedCenterConfig = {
            threshold: typeof rawCfg.threshold === 'number' ? rawCfg.threshold : 10,
            fillColor: typeof rawCfg.fillColor === 'string' ? rawCfg.fillColor : 'transparent',
            outputFormat:
                rawCfg.outputFormat === 'webp' || rawCfg.outputFormat === 'png' || rawCfg.outputFormat === 'mozjpeg'
                    ? rawCfg.outputFormat
                    : 'original',
            sides: Array.isArray(rawCfg.sides)
                ? (rawCfg.sides.filter((s) => typeof s === 'string' && CENTER_SIDES.has(s)) as (
                      'top' | 'bottom' | 'left' | 'right'
                  )[])
                : ['top', 'bottom', 'left', 'right']
        };
    }

    return {
        ok: true,
        params: {
            filePath,
            cutX,
            cutY,
            smartCenter: Boolean(smartCenter),
            centerConfig: validatedCenterConfig
        }
    };
}
