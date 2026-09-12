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
        // 不存在的路径 → 零产出：main 直接抛错（退出码 1），而不是返回一个看着像成功的汇总
        await expect(main(['--ai-model', 'large', missing])).rejects.toThrow('未找到任何受支持的图片文件');
        const warned = logSpy.mock.calls.some((args) =>
            args.some((a) => String(a).includes('large') && String(a).includes('medium'))
        );
        expect(warned).toBe(true);
    });

    it('--ai-model 合法值不警告', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const missing = path.join(makeTempDir(), 'ghost.png');
        // 路径不存在 → 零产出抛错；这里只关心没有出现「未知的 AI 模型」警告
        await expect(main(['--ai-model', 'small', missing])).rejects.toThrow('未找到任何受支持的图片文件');
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

    it('--format resize 缺配置时抛错并指向交互模式', async () => {
        // 回归：非交互下曾一路走到 core 的 default 分支，报出误导性的「不支持的目标格式」
        await expect(main(['--format', 'resize', 'ghost.png'])).rejects.toThrow('需要缩放参数');
    });

    it('拼错的选项抛错，不静默按默认格式转换', async () => {
        // 回归：--fromat 曾被当成文件名忽略，用户要 png 却拿到 webp 且退出码 0
        await expect(main(['--fromat', 'png', 'ghost.png'])).rejects.toThrow('未知选项');
    });

    it('选项取值不能是另一个选项', async () => {
        // 回归：--ai-model --format webp x.png 曾把图片路径当模型档位吞掉，图片被完全忽略
        await expect(main(['--ai-model', '--format', 'webp', 'ghost.png'])).rejects.toThrow('--ai-model 缺少取值');
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
