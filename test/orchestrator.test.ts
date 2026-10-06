import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resolveTask, describeTask, runBatch } from '../src/orchestrator';
import type { TaskInput, ImageTask } from '../src/orchestrator';
import { makeTempDir, createPng } from './helpers';

const tempDirs: string[] = [];
function trackedTempDir(): string {
    const dir = makeTempDir();
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
});

describe('Orchestrator resolveTask', () => {
    it('正确解析标准转码任务', () => {
        const input: TaskInput = { format: 'webp' };
        const task = resolveTask(input);
        expect(task).toEqual({ type: 'convert', format: 'webp' });
    });

    it('正确解析 AI 抠图任务及默认/指定模型', () => {
        const defaultTask = resolveTask({ format: 'rmbg_solid' });
        expect(defaultTask).toEqual({ type: 'rmbg_solid', aiModel: 'medium' });

        const smallTask = resolveTask({ format: 'rmbg_solid', aiModel: 'small' });
        expect(smallTask).toEqual({ type: 'rmbg_solid', aiModel: 'small' });
    });

    it('为 trim 和 center 自动补齐 CLI 默认配置', () => {
        const trimTask = resolveTask({ format: 'trim' });
        expect(trimTask).toEqual({
            type: 'trim',
            config: {
                threshold: 10,
                sides: ['top', 'bottom', 'left', 'right'],
                outputFormat: 'original'
            }
        });

        const centerTask = resolveTask({ format: 'center' });
        expect(centerTask).toEqual({
            type: 'center',
            config: {
                threshold: 10,
                fillColor: 'transparent',
                outputFormat: 'original'
            }
        });
    });

    it('对缺失配置的复杂任务提前报错（Fail Early）', () => {
        expect(() => resolveTask({ format: 'split' })).toThrow('需要切割参数');
        expect(() => resolveTask({ format: 'resize' })).toThrow('需要缩放参数');
        expect(() => resolveTask({ format: 'crop' })).toThrow('需要裁剪参数');
        expect(() => resolveTask({ format: 'pad_aspect' })).toThrow('需要目标比例等参数');
    });

    it('对未知格式报错', () => {
        expect(() => resolveTask({ format: 'invalid_format' })).toThrow('未知的目标格式');
    });
});

describe('Orchestrator describeTask', () => {
    it('正确生成任务横幅说明', () => {
        const convertTask: ImageTask = { type: 'convert', format: 'png' };
        expect(describeTask(convertTask)).toContain('[格式转换] -> PNG');

        const trimTask: ImageTask = {
            type: 'trim',
            config: { threshold: 10, sides: ['top'], outputFormat: 'original' }
        };
        expect(describeTask(trimTask)).toContain('[智能去边(Trim)]');

        const padTask: ImageTask = {
            type: 'pad_aspect',
            config: { aspect: '16:9', fill: 'transparent' }
        };
        expect(describeTask(padTask)).toContain('[画布扩边(Pad Aspect) -> 16:9]');
    });
});

describe('Orchestrator runBatch', () => {
    it('批处理执行与静默模式汇总', async () => {
        const dir = trackedTempDir();
        const file1 = path.join(dir, 'img1.png');
        const file2 = path.join(dir, 'img2.png');
        await createPng(file1, 20, 20);
        await createPng(file2, 30, 30);

        const summary = await runBatch(
            [file1, file2],
            { type: 'convert', format: 'webp' },
            { silent: true, batchSize: 2 }
        );

        expect(summary.success).toBe(2);
        expect(summary.skip).toBe(0);
        expect(summary.failed).toBe(0);

        expect(fs.existsSync(path.join(dir, 'img1.webp'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'img2.webp'))).toBe(true);
    });

    it('单文件故障隔离且不中断批处理', async () => {
        const dir = trackedTempDir();
        const goodFile = path.join(dir, 'good.png');
        const badFile = path.join(dir, 'bad.png');
        await createPng(goodFile, 20, 20);
        fs.writeFileSync(badFile, 'not-an-image');

        const summary = await runBatch(
            [goodFile, badFile],
            { type: 'convert', format: 'webp' },
            { silent: true, logDir: dir }
        );

        expect(summary.success).toBe(1);
        expect(summary.failed).toBe(1);
        expect(summary.skip).toBe(0);

        // 验证错误日志写出
        const logFiles = fs.readdirSync(dir).filter((f) => f.startsWith('error_'));
        expect(logFiles.length).toBe(1);
    });
});
