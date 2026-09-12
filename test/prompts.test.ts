import { describe, it, expect, afterEach } from 'vitest';
import { Readable, Writable } from 'stream';
import type { Choice } from '../src/prompts';
import { askQuestion, askResizeConfig, askSplitConfig, customSelect } from '../src/prompts';
import { CancelError } from '../src/config-types';

/**
 * prompts.ts 的交互采集直接读写 process.stdin / process.stdout。
 * 这里用非 TTY 的伪流替换两者：既能脱离真实终端确定地驱动流程，也不会把菜单渲染刷进测试输出。
 * 答案必须等对应提示写出之后再喂——readline 会把提前到达的行缓冲起来，
 * 而菜单按键只能在菜单自己的 keypress 监听期间送达，提前送入会落到别的提问上。
 */

class FakeStdin extends Readable {
    isTTY = false;
    private ended = false;

    _read(): void {
        // 数据全部由用例通过 feed / eof 主动推入
    }

    feed(data: string): void {
        this.push(Buffer.from(data, 'utf8'));
    }

    eof(): void {
        if (this.ended) return;
        this.ended = true;
        this.push(null);
    }
}

class FakeStdout extends Writable {
    isTTY = false;
    columns = 80;
    rows = 24;
    onWrite: ((text: string) => void) | null = null;

    _write(chunk: Buffer | string, _encoding: BufferEncoding, done: (err?: Error | null) => void): void {
        this.onWrite?.(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        done();
    }
}

interface Step {
    /** 该步对应的提示文案：stdout 中出现即认为交互已推进到该提问 */
    prompt: string;
    /** 答案：带换行按整行回答（askQuestion），不带换行按单键选择（customSelect） */
    reply: string;
}

class FakeSession {
    readonly stdin = new FakeStdin();
    readonly stdout = new FakeStdout();
    private readonly steps: Step[];
    private cursor = 0;
    private pending = '';
    private readonly stdinDescriptor: PropertyDescriptor;
    private readonly stdoutDescriptor: PropertyDescriptor;

    constructor(steps: Step[]) {
        this.steps = steps;
        this.stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')!;
        this.stdoutDescriptor = Object.getOwnPropertyDescriptor(process, 'stdout')!;
    }

    install(): this {
        Object.defineProperty(process, 'stdin', { value: this.stdin, configurable: true });
        Object.defineProperty(process, 'stdout', { value: this.stdout, configurable: true });
        this.stdout.onWrite = (text) => this.advance(text);
        return this;
    }

    /** 已命中的脚本步数：等于脚本长度时才说明流程在每个交互点都按预期推进（如非法值确实被重问） */
    get consumed(): number {
        return this.cursor;
    }

    restore(): void {
        // 结束 stdin 以释放可能仍挂着的会话级 readline 单例，避免残留 reader 串到下一个用例
        this.stdin.eof();
        this.stdout.onWrite = null;
        Object.defineProperty(process, 'stdin', this.stdinDescriptor);
        Object.defineProperty(process, 'stdout', this.stdoutDescriptor);
    }

    private advance(text: string): void {
        const step = this.steps[this.cursor];
        if (!step) return;
        this.pending += text;
        if (!this.pending.includes(step.prompt)) return;
        this.pending = '';
        this.cursor++;
        // 延后一拍再喂：提问方挂载监听与读取缓冲都发生在本次输出之后
        setImmediate(() => this.stdin.feed(step.reply));
    }
}

describe('prompts 交互采集', () => {
    let session: FakeSession | null = null;

    afterEach(async () => {
        session?.restore();
        session = null;
        // 让出一个事件循环回合（非计时等待）：等 readline 的 close 事件落地，
        // 模块单例 reader 必须确认已释放，否则会污染后续用例
        await new Promise<void>((resolve) => setImmediate(resolve));
    });

    function script(steps: Step[]): FakeSession {
        session = new FakeSession(steps).install();
        return session;
    }

    it('stdin 直接结束时提问抛 CancelError，而不是返回空串或悬置', async () => {
        script([]);

        const pending = askQuestion('请输入内容: ');
        session!.stdin.eof();

        await expect(pending).rejects.toBeInstanceOf(CancelError);
    });

    it('管道 EOF 时菜单选择抛 CancelError，而不是永久挂起', async () => {
        script([]);
        const choices: Choice<'a'>[] = [
            { key: '1', title: '选项', description: '说明', value: 'a', titleColor: (t) => t }
        ];

        const pending = customSelect('请选择: ', choices);
        session!.stdin.eof();

        await expect(pending).rejects.toBeInstanceOf(CancelError);
    });

    it('同一批预写的多行答案可依次回答多个提问', async () => {
        // 一次写入两行：修复前首个提问关闭 readline 时会丢掉后续行，第二问只能等到 EOF
        const s = script([{ prompt: '第一问', reply: 'alpha\nbeta\n' }]);

        const first = await askQuestion('第一问: ');
        const second = await askQuestion('第二问: ');

        expect(first).toBe('alpha');
        expect(second).toBe('beta');
        s.stdin.eof();
    });

    it('缩放宽度超过 MAX_DIM 被拒绝并重问，合法值才进入配置', async () => {
        const s = script([
            { prompt: '请选择批量缩放的基准模式', reply: '1' },
            { prompt: '【目标宽度】', reply: '99999\n' },
            { prompt: '【目标宽度】', reply: '800\n' },
            { prompt: '请选择缩放后文件的最终导出格式', reply: '1' }
        ]);

        const config = await askResizeConfig();

        expect(config).toMatchObject({ mode: 'by_width', width: 800, outputFormat: 'original' });
        expect(s.consumed).toBe(4);
    });

    it('缩放百分比超过 MAX_PERCENT 被拒绝并重问，合法值才进入配置', async () => {
        const s = script([
            { prompt: '请选择批量缩放的基准模式', reply: '3' },
            { prompt: '【缩放百分比】', reply: '5000\n' },
            { prompt: '【缩放百分比】', reply: '50\n' },
            { prompt: '请选择缩放后文件的最终导出格式', reply: '1' }
        ]);

        const config = await askResizeConfig();

        expect(config).toMatchObject({ mode: 'by_percent', percent: 50 });
        expect(s.consumed).toBe(4);
    });

    it('缩放自定义模式的适配策略菜单含 0 号返回项', async () => {
        const s = script([
            { prompt: '请选择批量缩放的基准模式', reply: '4' },
            { prompt: '【目标宽度】', reply: '800\n' },
            { prompt: '【目标高度】', reply: '600\n' },
            { prompt: '适配策略', reply: '0' }
        ]);

        await expect(askResizeConfig()).resolves.toBe('back');
        expect(s.consumed).toBe(4);
    });

    it('切片边缘去噪菜单含 0 号返回项', async () => {
        // 先选「居中-正方形」才会经过边缘去噪这一步
        const s = script([
            { prompt: '【列数】', reply: '2\n' },
            { prompt: '【行数】', reply: '2\n' },
            { prompt: '切片文件的最终导出格式', reply: '1' },
            { prompt: '是否对切片进行智能居中', reply: '3' },
            { prompt: '边缘去噪保护', reply: '0' }
        ]);

        await expect(askSplitConfig()).resolves.toBe('back');
        expect(s.consumed).toBe(5);
    });

    it('切片辅助对齐网格菜单含 0 号返回项', async () => {
        const s = script([
            { prompt: '【列数】', reply: '2\n' },
            { prompt: '【行数】', reply: '2\n' },
            { prompt: '切片文件的最终导出格式', reply: '1' },
            { prompt: '是否对切片进行智能居中', reply: '1' },
            { prompt: '附带生成辅助对齐网格', reply: '0' }
        ]);

        await expect(askSplitConfig()).resolves.toBe('back');
        expect(s.consumed).toBe(5);
    });
});
