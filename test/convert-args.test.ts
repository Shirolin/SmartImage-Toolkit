import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { main } from '../src/convert';
import { makeTempDir, createPng } from './helpers';

afterEach(() => {
    vi.restoreAllMocks();
});

/** 当天错误日志路径（与 convert.ts 内计算口径一致） */
function todayLogPath(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return path.join(process.cwd(), 'log', `error_${yyyy}-${mm}-${dd}.log`);
}

describe('convert 参数边界', () => {
    it('--ai-model 非法值警告并回落 medium', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const missing = path.join(makeTempDir(), 'ghost.png');
        const summary = await main(['--ai-model', 'large', missing]);
        expect(summary).toEqual({ success: 0, skip: 0, failed: 0 });
        const warned = logSpy.mock.calls.some((args) =>
            args.some((a) => String(a).includes('large') && String(a).includes('medium'))
        );
        expect(warned).toBe(true);
    });

    it('--ai-model 合法值不警告', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const missing = path.join(makeTempDir(), 'ghost.png');
        await main(['--ai-model', 'small', missing]);
        const warned = logSpy.mock.calls.some((args) => args.some((a) => String(a).includes('未知的 AI 模型')));
        expect(warned).toBe(false);
    });

    it('未知 --format 抛错（外层转非零退出码）', async () => {
        await expect(main(['--format', 'webpp', 'ghost.png'])).rejects.toThrow('未知');
    });

    it('--format 缺值抛错且不残留进文件列表', async () => {
        await expect(main(['--format'])).rejects.toThrow('缺少');
    });

    it('--ai-model 缺值抛错', async () => {
        await expect(main(['--ai-model'])).rejects.toThrow('缺少');
    });

    it('坏文件只记 error，不中断同批好文件', async () => {
        const dir = makeTempDir();
        await createPng(path.join(dir, 'good.png'), 16, 16);
        fs.writeFileSync(path.join(dir, 'bad.png'), 'this-is-not-an-image');
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const logPath = todayLogPath();
        const before = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : null;
        try {
            const summary = await main([dir]);
            expect(summary.success).toBe(1);
            expect(summary.failed).toBe(1);
            expect(summary.skip).toBe(0);
        } finally {
            // 测试不污染仓库：错误日志恢复原状（不存在则删除）
            if (before === null) {
                if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
            } else {
                fs.writeFileSync(logPath, before);
            }
        }
    });
});
