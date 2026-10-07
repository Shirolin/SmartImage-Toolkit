import { describe, it, expect } from 'vitest';
import {
    partitionGrid,
    isValidCutArray,
    countSplitTiles,
    escapeXml,
    generateDebugGridSvg
} from '../src/shared/geometry';
import { MAX_TILES } from '../src/shared/constants';

describe('geometry.ts 纯几何模块', () => {
    describe('isValidCutArray 切分线守卫', () => {
        it('合法严格递增非负整数数组通过', () => {
            expect(isValidCutArray([0, 100, 200])).toBe(true);
            expect(isValidCutArray([0, 1])).toBe(true);
            expect(isValidCutArray(Array.from({ length: 100 }, (_, i) => i))).toBe(true);
        });

        it('非数组或非常规类型拒绝', () => {
            expect(isValidCutArray(null)).toBe(false);
            expect(isValidCutArray(undefined)).toBe(false);
            expect(isValidCutArray('0,100')).toBe(false);
            expect(isValidCutArray({})).toBe(false);
        });

        it('长度不足 2 或超过 100 拒绝', () => {
            expect(isValidCutArray([])).toBe(false);
            expect(isValidCutArray([0])).toBe(false);
            expect(isValidCutArray(Array.from({ length: 101 }, (_, i) => i))).toBe(false);
        });

        it('非有限数字、负数与小数拒绝', () => {
            expect(isValidCutArray([0, NaN, 100])).toBe(false);
            expect(isValidCutArray([0, Infinity, 100])).toBe(false);
            expect(isValidCutArray([-1, 100])).toBe(false);
            expect(isValidCutArray([0, 10.5, 100])).toBe(false);
        });

        it('非严格递增拒绝', () => {
            expect(isValidCutArray([0, 0, 100])).toBe(false);
            expect(isValidCutArray([200, 100, 0])).toBe(false);
        });
    });

    describe('countSplitTiles 切片计数', () => {
        it('正确计算切片总数', () => {
            expect(countSplitTiles([0, 100, 200], [0, 100, 200])).toBe(4);
            expect(countSplitTiles([0, 50, 100, 150], [0, 50, 100])).toBe(6);
        });
    });

    describe('escapeXml 字符串转义', () => {
        it('正确转义 XML 特殊字符', () => {
            expect(escapeXml('<tag attr="val" & \'more\'>')).toBe("&lt;tag attr=&quot;val&quot; &amp; 'more'&gt;");
        });
    });

    describe('partitionGrid 几何切分', () => {
        it('无 canvas 时仅做规格预检并返回格数汇总', () => {
            const res = partitionGrid({ rows: 3, cols: 4 });
            expect(res.ok).toBe(true);
            if (res.ok) {
                expect(res.totalRows).toBe(3);
                expect(res.totalCols).toBe(4);
                expect(res.totalTiles).toBe(12);
                expect(res.tiles).toBeUndefined();
            }
        });

        it('均匀网格 2x2 正确划分 400x200 画布', () => {
            const res = partitionGrid({ rows: 2, cols: 2 }, { width: 400, height: 200 });
            expect(res.ok).toBe(true);
            if (res.ok) {
                expect(res.tiles).toHaveLength(4);
                expect(res.tiles!.every((t) => t.isValid)).toBe(true);
                expect(res.tiles![0]).toMatchObject({
                    row: 0,
                    col: 0,
                    left: 0,
                    top: 0,
                    width: 200,
                    height: 100,
                    isValid: true
                });
                expect(res.tiles![3]).toMatchObject({
                    row: 1,
                    col: 1,
                    left: 200,
                    top: 100,
                    width: 200,
                    height: 100,
                    isValid: true
                });
            }
        });

        it('防浮点吃边漂移：奇数尺寸 100x100 按 3x3 均匀切分无缝隙且右下严格贴合', () => {
            const res = partitionGrid({ rows: 3, cols: 3 }, { width: 100, height: 100 });
            expect(res.ok).toBe(true);
            if (res.ok) {
                const tiles = res.tiles!;
                expect(tiles).toHaveLength(9);
                expect(tiles.every((t) => t.isValid)).toBe(true);

                // 验证第 0 行列相邻无缝衔接
                const r0c0 = tiles[0];
                const r0c1 = tiles[1];
                const r0c2 = tiles[2];
                expect(r0c0.left + r0c0.width).toBe(r0c1.left);
                expect(r0c1.left + r0c1.width).toBe(r0c2.left);
                expect(r0c2.left + r0c2.width).toBe(100); // 边缘完全闭合，无像素吃边

                // 垂直轴也完全闭合
                const r2c0 = tiles[6];
                expect(r2c0.top + r2c0.height).toBe(100);
            }
        });

        it('自定义物理切割线正确推导瓦片尺寸', () => {
            const res = partitionGrid({ cutX: [0, 150, 400], cutY: [0, 200] }, { width: 400, height: 200 });
            expect(res.ok).toBe(true);
            if (res.ok) {
                expect(res.tiles).toHaveLength(2);
                expect(res.tiles![0]).toMatchObject({
                    row: 0,
                    col: 0,
                    left: 0,
                    top: 0,
                    width: 150,
                    height: 200,
                    isValid: true
                });
                expect(res.tiles![1]).toMatchObject({
                    row: 0,
                    col: 1,
                    left: 150,
                    top: 0,
                    width: 250,
                    height: 200,
                    isValid: true
                });
            }
        });

        it('超小图像容错：3x1 图切 2x2 时坏片标记为 isValid=false', () => {
            const res = partitionGrid({ rows: 2, cols: 2 }, { width: 3, height: 1 });
            expect(res.ok).toBe(true);
            if (res.ok) {
                expect(res.tiles).toHaveLength(4);
                const validTiles = res.tiles!.filter((t) => t.isValid);
                const invalidTiles = res.tiles!.filter((t) => !t.isValid);
                expect(validTiles).toHaveLength(2);
                expect(invalidTiles).toHaveLength(2);
                expect(invalidTiles[0].invalidReason).toContain('切片越界或尺寸非法');
            }
        });

        it('非法切割线包含零宽区域时坏片标记为 isValid=false', () => {
            const res = partitionGrid({ cutX: [0, 400, 400], cutY: [0, 200] }, { width: 400, height: 200 });
            expect(res.ok).toBe(true);
            if (res.ok) {
                expect(res.tiles).toHaveLength(2);
                expect(res.tiles![0].isValid).toBe(true);
                expect(res.tiles![1].isValid).toBe(false);
                expect(res.tiles![1]).toMatchObject({ row: 0, col: 1, width: 0 });
            }
        });

        it('参数非法时直接返回 ok=false', () => {
            // rows/cols 为 0 或负数
            expect(partitionGrid({ rows: 0, cols: 2 }).ok).toBe(false);
            expect(partitionGrid({ rows: 2, cols: -1 }).ok).toBe(false);

            // cutX/cutY 仅提供单边
            expect(partitionGrid({ cutX: [0, 100] }).ok).toBe(false);

            // 切片总数超过上限
            const overSpec = { rows: 30, cols: 30 }; // 900 > 500
            const overRes = partitionGrid(overSpec);
            expect(overRes.ok).toBe(false);
            if (!overRes.ok) {
                expect(overRes.error).toContain(`切片总数超限：最多 ${MAX_TILES} 张`);
            }
        });

        it('debugGrid 生成符合规范的 SVG', () => {
            const res = partitionGrid({ rows: 1, cols: 2 }, { width: 200, height: 100 }, { debugGrid: true });
            expect(res.ok).toBe(true);
            if (res.ok) {
                expect(res.svgContent).toBeDefined();
                expect(res.svgContent).toContain('<svg width="200" height="100">');
                expect(res.svgContent).toContain('stroke="red"');
                expect(res.svgContent).toContain('stroke="blue"');
            }
        });

        it('generateDebugGridSvg 纯函数测试', () => {
            const svg = generateDebugGridSvg({ width: 100, height: 100 }, [
                { row: 0, col: 0, left: 0, top: 0, width: 50, height: 50, isValid: true }
            ]);
            expect(svg).toContain('<svg width="100" height="100">');
            expect(svg).toContain('<rect x="0" y="0" width="50" height="50"');
        });
    });
});
