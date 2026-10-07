import type { PromptDriver, InputOptions } from './driver';
import { MAX_DIM, MAX_PERCENT } from '../shared/constants';
import { parseFillColor as parseFillColorInput } from '../pad-aspect';

/**
 * 通用带自闭环校验重试的行输入采集器（委托至驱动原子 input 方法）
 */
export async function askInput<T = string>(driver: PromptDriver, options: InputOptions<T>): Promise<T | 'back'> {
    return driver.input(options);
}

/**
 * 切片行/列数采集：非法值重问而非静默回退，支持 '0' 返回
 */
export async function askCount(driver: PromptDriver, query: string, fallback: number): Promise<number | 'back'> {
    return askInput<number>(driver, {
        prompt: query,
        default: String(fallback),
        allowBack: true,
        validate: (raw) => {
            const v = Number(raw);
            if (Number.isInteger(v) && v >= 1 && v <= 512) {
                return true;
            }
            return '❌ 无效的输入。请输入 1-512 之间的整数。';
        },
        transform: Number
    });
}

/**
 * 校验并采集像素维度（1 - MAX_DIM）
 */
export async function askDimension(driver: PromptDriver, prompt: string, maxDim: number = MAX_DIM): Promise<number> {
    const result = await askInput<number>(driver, {
        prompt,
        validate: (raw) => {
            const v = Number(raw);
            if (Number.isInteger(v) && v > 0 && v <= maxDim) {
                return true;
            }
            return `❌ 无效的输入。请输入 1-${maxDim} 之间的整数。`;
        },
        transform: Number
    });
    // askDimension 不允许返回 'back'
    return result as number;
}

/**
 * 校验并采集百分比（1 - MAX_PERCENT）
 */
export async function askPercent(
    driver: PromptDriver,
    prompt: string,
    maxPercent: number = MAX_PERCENT
): Promise<number> {
    const result = await askInput<number>(driver, {
        prompt,
        validate: (raw) => {
            const v = Number(raw);
            if (Number.isInteger(v) && v > 0 && v <= maxPercent) {
                return true;
            }
            return `❌ 无效的输入。请输入 1-${maxPercent} 之间的整数。`;
        },
        transform: Number
    });
    return result as number;
}

/**
 * 校验填充色输入合法性（十六进制颜色码或 transparent）
 */
export function isValidFillColor(input: string): boolean {
    return input.toLowerCase() === 'transparent' || parseFillColorInput(input) !== null;
}
