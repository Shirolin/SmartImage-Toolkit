import { CancelError } from '../config-types';
import type { Choice, PromptDriver } from './driver';

export interface ScriptStep {
    /** 预期的提示文案关键词（可选校验） */
    readonly prompt?: string;
    /** 模拟回复：若是单选菜单则为 key 或 value，若是行提问则为答案文本 */
    readonly reply: string;
    /** 是否模拟用户触发取消中断 */
    readonly cancel?: boolean;
}

/**
 * 纯内存脚本交互驱动器（ScriptedPromptDriver）
 * 专为单元测试设计，零 Node 流依赖，零事件循环等待，提供完全确定性的交互驱动与断言。
 */
export class ScriptedPromptDriver implements PromptDriver {
    private readonly steps: ScriptStep[];
    private cursor = 0;
    public readonly recordedNotes: { message: string; type?: 'info' | 'warn' | 'error' }[] = [];
    public readonly headers: string[] = [];

    constructor(steps: (string | ScriptStep)[]) {
        this.steps = steps.map((s) => (typeof s === 'string' ? { reply: s } : s));
    }

    /** 当前已消费的步骤数量 */
    get consumed(): number {
        return this.cursor;
    }

    /** 脚本指令是否已全部执行完毕 */
    get isExhausted(): boolean {
        return this.cursor >= this.steps.length;
    }

    renderHeader(breadcrumb: string): void {
        this.headers.push(breadcrumb);
    }

    notify(message: string, type?: 'info' | 'warn' | 'error'): void {
        this.recordedNotes.push({ message, type });
    }

    clear(): void {}

    async select<T>(message: string, choices: readonly Choice<T>[]): Promise<T> {
        const step = this.nextStep('select', message);
        if (step.cancel) {
            throw new CancelError('脚本模拟用户中断选择');
        }

        const replyTrimmed = step.reply.trim();
        // 优先按快捷按键 key（如 '1', '0'）精确匹配，未命中时再兜底匹配 value
        let choice = choices.find((c) => c.key === replyTrimmed);
        if (!choice) {
            choice = choices.find((c) => c.value === (replyTrimmed as unknown) || String(c.value) === replyTrimmed);
        }

        if (!choice) {
            const availableKeys = choices.map((c) => `${c.key}:${String(c.value)}`).join(', ');
            throw new Error(
                `ScriptedPromptDriver: 脚本输入 "${step.reply}" 未匹配任何选项。可选项: [${availableKeys}]`
            );
        }

        return choice.value;
    }

    async question(query: string): Promise<string> {
        const step = this.nextStep('question', query);
        if (step.cancel) {
            throw new CancelError('脚本模拟用户中断输入');
        }
        return step.reply.trim();
    }

    private nextStep(kind: 'select' | 'question', actualPrompt: string): ScriptStep {
        if (this.cursor >= this.steps.length) {
            throw new Error(`ScriptedPromptDriver: 脚本动作已耗尽，无法响应 ${kind} 提问: "${actualPrompt}"`);
        }

        const step = this.steps[this.cursor++];
        if (step.prompt && !actualPrompt.includes(step.prompt)) {
            // 若显式指定了 prompt 断言但未匹配
            throw new Error(`ScriptedPromptDriver: 提示不匹配。期望包含 "${step.prompt}"，实际为 "${actualPrompt}"`);
        }

        return step;
    }
}
