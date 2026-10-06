import chalk from 'chalk';
import type { AiModel } from '../../config-types';
import type { Choice, PromptDriver } from '../driver';
import { getDefaultPromptDriver } from '../driver';

/**
 * AI 抠图精细度采集向导
 */
export async function askAiModel(driver: PromptDriver = getDefaultPromptDriver()): Promise<AiModel | 'back'> {
    driver.renderHeader('主界面 > AI 抠图');
    const aiMessage = `${chalk.magenta.bold('🧠 选择 AI 抠图精细度')}:\n${chalk.gray('  ? 运行级别:')}`;
    const aiChoices: Choice<AiModel | 'back'>[] = [
        {
            key: '1',
            title: '均衡模式 (Medium)',
            description: '适合复杂边缘和人像',
            value: 'medium',
            titleColor: chalk.white.bold
        },
        {
            key: '2',
            title: '极速模式 (Small)',
            description: '速度快，适合大批量',
            value: 'small',
            titleColor: chalk.white.bold
        },
        {
            key: '0',
            title: '返回上一级',
            description: '重新选择特效方案',
            value: 'back',
            titleColor: chalk.gray
        }
    ];

    const aiModel = await driver.select(aiMessage, aiChoices);
    if (aiModel === 'back') return 'back';
    driver.clear();
    return aiModel;
}
