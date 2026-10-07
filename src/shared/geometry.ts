import { MAX_TILES } from './constants';

/** 切片方盒坐标（正向笛卡尔像素矩形） */
export interface TileBox {
    readonly row: number;
    readonly col: number;
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly isValid: boolean;
    readonly invalidReason?: string;
}

/** 均匀网格切分规格 */
export interface UniformGridSpec {
    readonly rows: number;
    readonly cols: number;
}

/** 自定义切割线切分规格 */
export interface CustomCutSpec {
    readonly cutX: readonly number[];
    readonly cutY: readonly number[];
}

/** 通用切分输入规格（允许两类参数混合传入，适配历史调用） */
export interface GridPartitionSpec {
    readonly rows?: number;
    readonly cols?: number;
    readonly cutX?: readonly number[];
    readonly cutY?: readonly number[];
}

/** 画布尺寸 */
export interface CanvasDimensions {
    readonly width: number;
    readonly height: number;
}

/** 划分配置选项 */
export interface GridPartitionOptions {
    readonly maxTiles?: number;
    readonly debugGrid?: boolean;
}

/** 几何划分成功结果 */
export interface GridPartitionSuccess {
    readonly ok: true;
    readonly totalRows: number;
    readonly totalCols: number;
    readonly totalTiles: number;
    readonly tiles?: readonly TileBox[];
    readonly svgContent?: string;
}

/** 几何划分失败结果 */
export interface GridPartitionFailure {
    readonly ok: false;
    readonly error: string;
    readonly totalRows: 0;
    readonly totalCols: 0;
    readonly totalTiles: 0;
}

export type GridPartitionResult = GridPartitionSuccess | GridPartitionFailure;

/**
 * 校验自定义切割线是否合法：
 * 数组、长度 2..100、全为非负整数、严格单调递增
 */
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

/**
 * 计算自定义切割线构成的切片总数：(cutX.length - 1) * (cutY.length - 1)
 */
export function countSplitTiles(cutX: readonly number[], cutY: readonly number[]): number {
    return (cutX.length - 1) * (cutY.length - 1);
}

/**
 * XML / SVG 字符转义，防止破坏 debug 覆盖层
 */
export function escapeXml(value: string | number): string {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 生成排查标尺图 SVG 内容
 */
export function generateDebugGridSvg(canvas: CanvasDimensions, tiles: readonly TileBox[]): string {
    const { width, height } = canvas;
    let svg = `<svg width="${escapeXml(width)}" height="${escapeXml(height)}">\n  <rect x="0" y="0" width="${escapeXml(width)}" height="${escapeXml(height)}" fill="none" stroke="red" stroke-width="4"/>`;

    for (const tile of tiles) {
        if (tile.isValid) {
            svg += `\n  <rect x="${escapeXml(tile.left)}" y="${escapeXml(tile.top)}" width="${escapeXml(tile.width)}" height="${escapeXml(tile.height)}" fill="none" stroke="blue" stroke-width="2"/>`;
        }
    }
    svg += '\n</svg>';
    return svg;
}

/**
 * 纯几何切分入口：零 I/O、零 Sharp 依赖
 * 负责规格核验、端点百分比防漂移计算、瓦片边界有效性归集与标尺 SVG 渲染
 */
export function partitionGrid(
    spec: GridPartitionSpec,
    canvas?: CanvasDimensions,
    options?: GridPartitionOptions
): GridPartitionResult {
    const maxTiles = options?.maxTiles ?? MAX_TILES;

    const hasCutX = Array.isArray(spec.cutX) && spec.cutX.length >= 2;
    const hasCutY = Array.isArray(spec.cutY) && spec.cutY.length >= 2;
    const useCustomCuts = hasCutX && hasCutY;
    const hasAnyCustomCuts = Array.isArray(spec.cutX) || Array.isArray(spec.cutY);

    let totalRows: number;
    let totalCols: number;

    if (hasAnyCustomCuts) {
        if (!useCustomCuts) {
            return {
                ok: false,
                error: '自定义切割线非法：cutX/cutY 需同时提供，且各自至少包含 2 个坐标点',
                totalRows: 0,
                totalCols: 0,
                totalTiles: 0
            };
        }
        totalRows = spec.cutY!.length - 1;
        totalCols = spec.cutX!.length - 1;
    } else {
        const rows = spec.rows;
        const cols = spec.cols;
        if (
            typeof rows !== 'number' ||
            !Number.isInteger(rows) ||
            rows < 1 ||
            typeof cols !== 'number' ||
            !Number.isInteger(cols) ||
            cols < 1
        ) {
            return {
                ok: false,
                error: `行列数非法：rows/cols 必须为不小于 1 的整数(当前 rows=${rows}, cols=${cols})`,
                totalRows: 0,
                totalCols: 0,
                totalTiles: 0
            };
        }
        totalRows = rows;
        totalCols = cols;
    }

    const totalTiles = totalRows * totalCols;
    if (totalTiles > maxTiles) {
        return {
            ok: false,
            error: `切片总数超限：最多 ${maxTiles} 张(当前 ${totalTiles} 张)`,
            totalRows: 0,
            totalCols: 0,
            totalTiles: 0
        };
    }

    // 若未传入 canvas，仅返回核验与统计结论
    if (!canvas) {
        return {
            ok: true,
            totalRows,
            totalCols,
            totalTiles
        };
    }

    const { width, height } = canvas;
    if (width <= 0 || height <= 0) {
        return {
            ok: false,
            error: '无法读取图像尺寸',
            totalRows: 0,
            totalCols: 0,
            totalTiles: 0
        };
    }

    const tiles: TileBox[] = [];

    for (let row = 0; row < totalRows; row++) {
        for (let col = 0; col < totalCols; col++) {
            let left: number;
            let top: number;
            let tileWidth: number;
            let tileHeight: number;

            if (useCustomCuts) {
                left = spec.cutX![col];
                top = spec.cutY![row];
                tileWidth = spec.cutX![col + 1] - left;
                tileHeight = spec.cutY![row + 1] - top;
            } else {
                left = Math.round((col * width) / totalCols);
                top = Math.round((row * height) / totalRows);
                const nextLeft = Math.round(((col + 1) * width) / totalCols);
                const nextTop = Math.round(((row + 1) * height) / totalRows);
                tileWidth = nextLeft - left;
                tileHeight = nextTop - top;
            }

            if (tileWidth <= 0 || tileHeight <= 0 || left + tileWidth > width || top + tileHeight > height) {
                tiles.push({
                    row,
                    col,
                    left,
                    top,
                    width: tileWidth,
                    height: tileHeight,
                    isValid: false,
                    invalidReason: `切片越界或尺寸非法(left=${left},top=${top},width=${tileWidth},height=${tileHeight})`
                });
            } else {
                tiles.push({
                    row,
                    col,
                    left,
                    top,
                    width: tileWidth,
                    height: tileHeight,
                    isValid: true
                });
            }
        }
    }

    const svgContent = options?.debugGrid ? generateDebugGridSvg(canvas, tiles) : undefined;

    return {
        ok: true,
        totalRows,
        totalCols,
        totalTiles,
        tiles,
        svgContent
    };
}
