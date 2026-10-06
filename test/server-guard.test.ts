import { describe, it, expect } from 'vitest';
import path from 'path';
import {
    isPathAllowed,
    isValidCutArray,
    isValidCenterConfig,
    countSplitTiles,
    buildSplitCustomSuccess,
    PathSandbox,
    validateSplitCustomBody
} from '../src/server/guard';
import { MAX_TILES } from '../src/shared/constants';

// 服务端守卫单测：路径越权与切图参数非法输入必须被拦截（400/403 的前置判定逻辑）。

describe('isPathAllowed 路径白名单', () => {
    const root = path.resolve('gallery');
    const other = path.resolve('secret');

    it('根内文件放行', () => {
        expect(isPathAllowed(path.join(root, 'a.png'), [root])).toBe(true);
    });

    it('根目录自身放行', () => {
        expect(isPathAllowed(root, [root])).toBe(true);
    });

    it('../ 越权路径拒绝', () => {
        const evil = path.join(root, '..', 'secret', 'passwd');
        expect(isPathAllowed(evil, [root])).toBe(false);
    });

    it('白名单外的绝对路径拒绝', () => {
        expect(isPathAllowed(path.join(other, 'x.png'), [root])).toBe(false);
    });

    it('前缀欺骗拒绝（gallery2 不是 gallery 的子目录）', () => {
        expect(isPathAllowed(`${root}2/a.png`, [root])).toBe(false);
    });

    it('多根之一命中即放行', () => {
        expect(isPathAllowed(path.join(other, 'x.png'), [root, other])).toBe(true);
    });
});

describe('isValidCutArray 切分线守卫', () => {
    it('合法递增数组通过', () => {
        expect(isValidCutArray([0, 100, 200])).toBe(true);
    });

    it('非数组拒绝', () => {
        expect(isValidCutArray('0,100')).toBe(false);
        expect(isValidCutArray(null)).toBe(false);
        expect(isValidCutArray(undefined)).toBe(false);
    });

    it('长度不足 2 拒绝，超过 100 拒绝', () => {
        expect(isValidCutArray([0])).toBe(false);
        expect(isValidCutArray([])).toBe(false);
        expect(isValidCutArray(Array.from({ length: 101 }, (_, i) => i))).toBe(false);
    });

    it('非有限数字与负数拒绝', () => {
        expect(isValidCutArray([0, NaN, 100])).toBe(false);
        expect(isValidCutArray([0, Infinity, 100])).toBe(false);
        expect(isValidCutArray([-1, 100])).toBe(false);
        expect(isValidCutArray([0, '100' as unknown as number, 200])).toBe(false);
    });
    it('非严格递增拒绝', () => {
        expect(isValidCutArray([0, 0, 100])).toBe(false);
        expect(isValidCutArray([200, 100, 0])).toBe(false);
    });

    it('小数坐标拒绝（前端恒发整数，小数视为非法输入）', () => {
        expect(isValidCutArray([0, 10.5, 100])).toBe(false);
        expect(isValidCutArray([0.1, 100])).toBe(false);
        expect(isValidCutArray([0, 100, 200.001])).toBe(false);
    });

    it('整数边界通过', () => {
        expect(isValidCutArray([0, 1])).toBe(true);
        expect(isValidCutArray(Array.from({ length: 100 }, (_, i) => i))).toBe(true);
        expect(isValidCutArray([0, 100, 200])).toBe(true);
    });

    it('切片总数超限拒绝（路由 400 的判定逻辑）', () => {
        // 500 上限：21x26=546 超限，20x25=500 恰好通过
        const overX = Array.from({ length: 22 }, (_, i) => i);
        const overY = Array.from({ length: 27 }, (_, i) => i);
        expect(countSplitTiles(overX, overY)).toBe(21 * 26);
        expect(countSplitTiles(overX, overY) > MAX_TILES).toBe(true);
        const edgeX = Array.from({ length: 21 }, (_, i) => i);
        const edgeY = Array.from({ length: 26 }, (_, i) => i);
        expect(countSplitTiles(edgeX, edgeY)).toBe(20 * 25);
        expect(countSplitTiles(edgeX, edgeY)).toBeLessThanOrEqual(MAX_TILES);
        expect(isValidCutArray(overX)).toBe(true);
        expect(isValidCutArray(overY)).toBe(true);
    });
});

describe('buildSplitCustomSuccess 成功回包拼装', () => {
    it('无失败时 failedTiles 为空数组', () => {
        const payload = buildSplitCustomSuccess({
            status: 'success',
            file: 'a.png',
            generatedFiles: ['b.png'],
            artifacts: []
        });
        expect(payload.success).toBe(true);
        expect(payload.failedTiles).toEqual([]);
    });

    it('有失败分项时原样透出（与 SplitResult 同形）', () => {
        const failedTiles = [{ row: 0, col: 1, reason: '零宽分片' }];
        const payload = buildSplitCustomSuccess({
            status: 'success',
            file: 'a.png',
            generatedFiles: ['b.png'],
            artifacts: ['split_config.json'],
            failedTiles
        });
        expect(payload.failedTiles).toEqual(failedTiles);
        expect(payload.files).toEqual(['b.png']);
    });
});

describe('isValidCenterConfig 居中配置白名单', () => {
    it('缺省值放行', () => {
        expect(isValidCenterConfig(null)).toBe(true);
        expect(isValidCenterConfig(undefined)).toBe(true);
    });

    it('合法完整配置通过', () => {
        expect(
            isValidCenterConfig({ threshold: 10, fillColor: 'transparent', outputFormat: 'webp', sides: ['top'] })
        ).toBe(true);
    });

    it('非法阈值拒绝', () => {
        expect(isValidCenterConfig({ threshold: 0 })).toBe(false);
        expect(isValidCenterConfig({ threshold: 101 })).toBe(false);
        expect(isValidCenterConfig({ threshold: 'high' })).toBe(false);
    });

    it('非法填充色拒绝', () => {
        expect(isValidCenterConfig({ fillColor: 123 })).toBe(false);
        expect(isValidCenterConfig({ fillColor: 'red' })).toBe(false);
        expect(isValidCenterConfig({ fillColor: '#FFFFFF' })).toBe(true);
    });

    it('非法输出格式拒绝', () => {
        expect(isValidCenterConfig({ outputFormat: 'bmp' })).toBe(false);
        expect(isValidCenterConfig({ outputFormat: 'mozjpeg' })).toBe(true);
    });

    it('非法边向拒绝', () => {
        expect(isValidCenterConfig({ sides: ['top', 'middle'] })).toBe(false);
        expect(isValidCenterConfig({ sides: 'top' })).toBe(false);
    });
});

describe('PathSandbox 路径沙箱', () => {
    it('默认包含 cwd，显式授权目录后允许访问', () => {
        const sandbox = new PathSandbox();
        const currentFile = path.resolve('package.json');
        expect(sandbox.isAllowed(currentFile)).toBe(true);

        const customDir = path.resolve(process.cwd(), '../outside_temp_dir');
        const customFile = path.join(customDir, 'pic.png');
        expect(sandbox.isAllowed(customFile)).toBe(false);

        sandbox.authorize(customFile);
        expect(sandbox.isAllowed(customFile)).toBe(true);
    });
});

describe('validateSplitCustomBody 统一请求体校验', () => {
    it('缺少必要参数或非法切分线返回 400', () => {
        const sandbox = new PathSandbox();
        const emptyRes = validateSplitCustomBody({}, sandbox);
        expect(emptyRes.ok).toBe(false);
        if (!emptyRes.ok) expect(emptyRes.status).toBe(400);

        const badCutRes = validateSplitCustomBody({ filePath: 'a.png', cutX: [0] }, sandbox);
        expect(badCutRes.ok).toBe(false);
        if (!badCutRes.ok) expect(badCutRes.status).toBe(400);
    });

    it('越权路径返回 403', () => {
        const sandbox = new PathSandbox();
        const res = validateSplitCustomBody(
            {
                filePath: path.resolve(process.cwd(), '../unauthorized_secret.png'),
                cutX: [0, 100],
                cutY: [0, 100]
            },
            sandbox
        );
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.status).toBe(403);
    });

    it('合法参数成功收敛并赋予安全默认配置', () => {
        const sandbox = new PathSandbox();
        const targetPath = path.resolve('test/valid.png');
        sandbox.authorize(targetPath);

        const res = validateSplitCustomBody(
            {
                filePath: targetPath,
                cutX: [0, 100, 200],
                cutY: [0, 100, 200],
                smartCenter: true,
                centerConfig: { threshold: 15 }
            },
            sandbox
        );

        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.params.cutX).toEqual([0, 100, 200]);
            expect(res.params.smartCenter).toBe(true);
            expect(res.params.centerConfig?.threshold).toBe(15);
            expect(res.params.centerConfig?.fillColor).toBe('transparent');
        }
    });
});
