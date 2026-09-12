import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { main } from '../src/convert';
import { EXIT_CANCEL } from '../src/shared/constants';
import { makeTempDir, createPng } from './helpers';

// 回归用例的临时目录统一登记清理，保证可重复与可并行
const tempDirs: string[] = [];
function trackedTempDir(): string {
    const dir = makeTempDir();
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    vi.restoreAllMocks();
    // Windows 上 sharp 的写盘句柄可能短暂滞留，删除临时目录带重试
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
});

/** 当天错误日志路径（与 convert.ts 内计算口径一致） */
function todayLogPath(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return path.join(process.cwd(), 'log', `error_${yyyy}-${mm}-${dd}.log`);
}

// —— 入口守卫与退出码 ——
// vitest 内 import convert.ts 会被 TS 的 CJS 包装改写，「谁是 require.main」与真实 CLI 不同，
// 故用 ts-node 转译后在子进程里验证：进程入口身份与退出码只有真跑一遍才可信。
const REPO_ROOT = process.cwd();
const TS_NODE_REGISTER = path.join(REPO_ROOT, 'node_modules', 'ts-node', 'register', 'transpile-only.js');
const CONVERT_ENTRY = path.join(REPO_ROOT, 'src', 'convert.ts');

/** 把 convert.ts 当入口在子进程里跑一遍，返回退出码与输出 */
function runConvertEntry(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const res = spawnSync(process.execPath, ['-r', TS_NODE_REGISTER, CONVERT_ENTRY, ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        input: '' // stdin 立即 EOF：交互菜单据此判定为用户取消
    });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
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

describe('convert 入口守卫与退出码', () => {
    it('import convert 模块不执行 CLI、不写宿主退出码', () => {
        const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sit-guard-'));
        const script = path.join(scriptDir, 'import-guard.cjs');
        fs.writeFileSync(
            script,
            `require(${JSON.stringify(CONVERT_ENTRY)});\n` +
                `process.stdout.write('IMPORT_DONE exitCode=' + process.exitCode + '\\n');\n`
        );
        try {
            // argv 故意带一个必然失败的 CLI 调用：守卫失效时 main 会真跑并把退出码置 1
            const res = spawnSync(
                process.execPath,
                ['-r', TS_NODE_REGISTER, script, '--format', 'bogus', 'ghost.png'],
                { cwd: REPO_ROOT, encoding: 'utf8' }
            );
            expect(res.status).toBe(0);
            expect(res.stdout).toContain('IMPORT_DONE');
            expect(res.stdout).toMatch(/exitCode=(undefined|0)\b/);
            expect(res.stderr).not.toContain('未知的目标格式');
        } finally {
            fs.rmSync(scriptDir, { recursive: true, force: true });
        }
    }, 30000);

    it('作为入口运行时失败退出码为 1', () => {
        const res = runConvertEntry(['--format', 'bogus', 'ghost.png']);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('未知的目标格式');
    }, 30000);

    it('交互模式 stdin 结束（用户取消）退出码为 EXIT_CANCEL', () => {
        // 必须带一个路径参数，否则 main 在「无输入」分支提前返回、走不到交互菜单
        const res = runConvertEntry(['--interactive', path.join(os.tmpdir(), 'sit-cancel-target')]);
        expect(EXIT_CANCEL).toBe(2);
        expect(res.status).toBe(EXIT_CANCEL);
    }, 30000);
});

describe('convert 深度截断记账', () => {
    it('深度截断的图片计入 skip，汇总不再「报成功却零产出」', async () => {
        const dir = trackedTempDir();
        await createPng(path.join(dir, 'top.png'), 16, 16);
        // convert 固定 maxDepth=10：第 10 层目录内的图片会被截断，只有根层图片被真正处理
        let deep = dir;
        for (let i = 1; i <= 10; i++) {
            deep = path.join(deep, `l${i}`);
        }
        fs.mkdirSync(deep, { recursive: true });
        await createPng(path.join(deep, 'buried.png'), 16, 16);

        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const summary = await main([dir]);

        expect(summary.success).toBe(1);
        expect(summary.skip).toBe(1);
        expect(summary.failed).toBe(0);
    });
});
