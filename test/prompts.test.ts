import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'stream';
import type { Choice } from '../src/prompts';
import {
    AnsiTerminalDriver,
    ScriptedPromptDriver,
    askAiModel,
    askCenterConfig,
    askPadAspectConfig,
    askResizeConfig,
    askSplitConfig,
    askTrimCrop
} from '../src/prompts';
import { CancelError } from '../src/config-types';

class FakeStdin extends Readable {
    isTTY = false;
    private ended = false;

    _read(): void {}

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
    _write(_chunk: Buffer | string, _encoding: BufferEncoding, done: (err?: Error | null) => void): void {
        done();
    }
}

describe('AnsiTerminalDriver (生产终端驱动)', () => {
    it('stdin 直接结束时提问抛 CancelError，而不是返回空串或悬置', async () => {
        const stdin = new FakeStdin();
        const stdout = new FakeStdout();
        const driver = new AnsiTerminalDriver(stdin, stdout);

        const pending = driver.question('请输入内容: ');
        stdin.eof();

        await expect(pending).rejects.toBeInstanceOf(CancelError);
    });

    it('管道 EOF 时菜单选择抛 CancelError，而不是永久挂起', async () => {
        const stdin = new FakeStdin();
        const stdout = new FakeStdout();
        const driver = new AnsiTerminalDriver(stdin, stdout);

        const choices: Choice<'a'>[] = [{ key: '1', title: '选项', description: '说明', value: 'a' }];

        const pending = driver.select('请选择: ', choices);
        stdin.eof();

        await expect(pending).rejects.toBeInstanceOf(CancelError);
    });

    it('同一批预写的多行答案可依次回答多个提问', async () => {
        const stdin = new FakeStdin();
        const stdout = new FakeStdout();
        const driver = new AnsiTerminalDriver(stdin, stdout);

        stdin.feed('alpha\nbeta\n');

        const first = await driver.question('第一问: ');
        const second = await driver.question('第二问: ');

        expect(first).toBe('alpha');
        expect(second).toBe('beta');
        stdin.eof();
    });
});

describe('ScriptedPromptDriver 与向导工作流 (纯内存测试)', () => {
    it('缩放宽度超过 MAX_DIM 被拒绝并重问，合法值才进入配置', async () => {
        const driver = new ScriptedPromptDriver([
            { prompt: '请选择批量缩放的基准模式', reply: '1' },
            { prompt: '【目标宽度】', reply: '99999' },
            { prompt: '【目标宽度】', reply: '800' },
            { prompt: '请选择缩放后文件的最终导出格式', reply: '1' }
        ]);

        const config = await askResizeConfig(driver);

        expect(config).toMatchObject({ mode: 'by_width', width: 800, outputFormat: 'original' });
        expect(driver.consumed).toBe(4);
    });

    it('缩放百分比超过 MAX_PERCENT 被拒绝并重问，合法值才进入配置', async () => {
        const driver = new ScriptedPromptDriver([
            { prompt: '请选择批量缩放的基准模式', reply: '3' },
            { prompt: '【缩放百分比】', reply: '5000' },
            { prompt: '【缩放百分比】', reply: '50' },
            { prompt: '请选择缩放后文件的最终导出格式', reply: '1' }
        ]);

        const config = await askResizeConfig(driver);

        expect(config).toMatchObject({ mode: 'by_percent', percent: 50 });
        expect(driver.consumed).toBe(4);
    });

    it('缩放自定义模式的适配策略菜单含 0 号返回项', async () => {
        const driver = new ScriptedPromptDriver([
            { prompt: '请选择批量缩放的基准模式', reply: '4' },
            { prompt: '【目标宽度】', reply: '800' },
            { prompt: '【目标高度】', reply: '600' },
            { prompt: '适配策略', reply: '0' }
        ]);

        await expect(askResizeConfig(driver)).resolves.toBe('back');
        expect(driver.consumed).toBe(4);
    });

    it('切片边缘去噪菜单含 0 号返回项', async () => {
        const driver = new ScriptedPromptDriver([
            { prompt: '【列数】', reply: '2' },
            { prompt: '【行数】', reply: '2' },
            { prompt: '切片文件的最终导出格式', reply: '1' },
            { prompt: '是否对切片进行智能居中', reply: '3' },
            { prompt: '边缘去噪保护', reply: '0' }
        ]);

        await expect(askSplitConfig(driver)).resolves.toBe('back');
        expect(driver.consumed).toBe(5);
    });

    it('切片辅助对齐网格菜单含 0 号返回项', async () => {
        const driver = new ScriptedPromptDriver([
            { prompt: '【列数】', reply: '2' },
            { prompt: '【行数】', reply: '2' },
            { prompt: '切片文件的最终导出格式', reply: '1' },
            { prompt: '是否对切片进行智能居中', reply: '1' },
            { prompt: '附带生成辅助对齐网格', reply: '0' }
        ]);

        await expect(askSplitConfig(driver)).resolves.toBe('back');
        expect(driver.consumed).toBe(5);
    });

    it('切片正常流程完整搜集配置参数', async () => {
        const driver = new ScriptedPromptDriver([
            { prompt: '【列数】', reply: '3' },
            { prompt: '【行数】', reply: '4' },
            { prompt: '切片文件的最终导出格式', reply: '2' }, // png
            { prompt: '是否对切片进行智能居中', reply: '2' }, // keep_ratio
            { prompt: '边缘去噪保护', reply: '2' }, // 2 px
            { prompt: '附带生成辅助对齐网格', reply: '2' } // true
        ]);

        const result = await askSplitConfig(driver);
        expect(result).toEqual({
            cols: 3,
            rows: 4,
            exportFormat: 'png',
            centerMode: 'keep_ratio',
            edgeShave: 2,
            debugGrid: true
        });
        expect(driver.isExhausted).toBe(true);
    });

    it('自动修剪 (Trim) 正常采集容差与方向', async () => {
        const driver = new ScriptedPromptDriver([
            { prompt: '修剪模式', reply: '1' }, // auto
            { prompt: '修剪方向', reply: '1' }, // all 4 sides
            { prompt: '色差容忍度', reply: '15' },
            { prompt: '导出格式', reply: '2' } // webp
        ]);

        const result = await askTrimCrop(driver);
        expect(result).toEqual({
            kind: 'trim',
            trimConfig: {
                sides: ['top', 'bottom', 'left', 'right'],
                threshold: 15,
                outputFormat: 'webp'
            }
        });
    });

    it('手动裁剪 (Crop) 拦截全 0 边界并在合法值后放行', async () => {
        const driver = new ScriptedPromptDriver([
            { prompt: '修剪模式', reply: '2' }, // manual
            { prompt: '顶部', reply: '0' },
            { prompt: '底部', reply: '0' },
            { prompt: '左部', reply: '0' },
            { prompt: '右部', reply: '0' }, // 全 0 被拒绝重试
            { prompt: '顶部', reply: '10' },
            { prompt: '底部', reply: '0' },
            { prompt: '左部', reply: '5' },
            { prompt: '右部', reply: '0' },
            { prompt: '导出格式', reply: '3' } // png
        ]);

        const result = await askTrimCrop(driver);
        expect(result).toEqual({
            kind: 'crop',
            cropConfig: {
                top: 10,
                bottom: 0,
                left: 5,
                right: 0,
                outputFormat: 'png'
            }
        });
    });

    it('智能居中 (Center) 拦截非法容差并在合法值后放行', async () => {
        const driver = new ScriptedPromptDriver([
            { prompt: '色差容忍度', reply: '999' }, // 非法值拦截
            { prompt: '色差容忍度', reply: '20' },
            { prompt: '补白颜色', reply: '2' }, // #FFFFFF
            { prompt: '导出格式', reply: '3' } // png
        ]);

        const result = await askCenterConfig(driver);
        expect(result).toEqual({
            threshold: 20,
            fillColor: '#FFFFFF',
            outputFormat: 'png'
        });
        expect(driver.consumed).toBe(4);
    });

    it('画布扩边 (Pad Aspect) 拦截非法自定义比例与色值并在重试后放行', async () => {
        const driver = new ScriptedPromptDriver([
            { prompt: '目标比例', reply: '4' }, // custom
            { prompt: '自定义比例', reply: 'not-a-ratio' }, // 非法输入拦截
            { prompt: '自定义比例', reply: '4:5' },
            { prompt: '主体模式', reply: '1' }, // full_image
            { prompt: '主体占画布高度比例', reply: '0.75' },
            { prompt: '画布长边像素', reply: '1080' },
            { prompt: '填充方式', reply: '4' }, // custom hex
            { prompt: '十六进制色值码', reply: 'bad-hex' }, // 非法颜色拦截
            { prompt: '十六进制色值码', reply: '#112233' },
            { prompt: '导出格式', reply: '2' } // webp
        ]);

        const result = await askPadAspectConfig(driver);
        expect(result).toEqual({
            aspect: '4:5',
            subjectRatio: 0.75,
            subjectMode: 'full_image',
            fill: 'color',
            fillColor: '#112233',
            longEdge: 1080,
            outputFormat: 'webp'
        });
    });

    it('向导取消中断时传递 CancelError', async () => {
        const driver = new ScriptedPromptDriver([{ prompt: '选择 AI 抠图精细度', reply: '1', cancel: true }]);

        await expect(askAiModel(driver)).rejects.toBeInstanceOf(CancelError);
    });
});
