import type { AiModel, SplitConfig, ResizeConfig, CenterConfig, PadAspectConfig } from './config-types';
import type { Choice, PromptDriver } from './prompt/driver';
import { getDefaultPromptDriver } from './prompt/driver';
import type { TrimCropAnswer } from './prompt/wizards';

// 导出核心类型与驱动接口
export type { Choice, InputOptions, PromptDriver } from './prompt/driver';
export { getDefaultPromptDriver, setDefaultPromptDriver, registerDefaultPromptDriverFactory } from './prompt/driver';
export { AnsiTerminalDriver } from './prompt/ansi-driver';
export { ScriptedPromptDriver, type ScriptStep } from './prompt/scripted-driver';
export type { TrimCropAnswer } from './prompt/wizards';

// 基础终端渲染与选择适配函数（保持向后兼容）
export function renderHeader(breadcrumb: string, driver: PromptDriver = getDefaultPromptDriver()): void {
    driver.renderHeader(breadcrumb);
}

export async function customSelect<T>(
    message: string,
    choices: readonly Choice<T>[],
    driver: PromptDriver = getDefaultPromptDriver()
): Promise<T> {
    return driver.select(message, choices);
}

export async function askQuestion(query: string, driver: PromptDriver = getDefaultPromptDriver()): Promise<string> {
    return driver.question(query);
}

// 领域向导工作流门面导出（支持可选注入 driver，默认绑定终端驱动）
export async function askAiModel(driver: PromptDriver = getDefaultPromptDriver()): Promise<AiModel | 'back'> {
    const { askAiModel: runWizard } = await import('./prompt/wizards/ai-model');
    return runWizard(driver);
}

export async function askSplitConfig(driver: PromptDriver = getDefaultPromptDriver()): Promise<SplitConfig | 'back'> {
    const { askSplitConfig: runWizard } = await import('./prompt/wizards/split');
    return runWizard(driver);
}

export async function askResizeConfig(driver: PromptDriver = getDefaultPromptDriver()): Promise<ResizeConfig | 'back'> {
    const { askResizeConfig: runWizard } = await import('./prompt/wizards/resize');
    return runWizard(driver);
}

export async function askTrimCrop(driver: PromptDriver = getDefaultPromptDriver()): Promise<TrimCropAnswer> {
    const { askTrimCrop: runWizard } = await import('./prompt/wizards/trim-crop');
    return runWizard(driver);
}

export async function askCenterConfig(driver: PromptDriver = getDefaultPromptDriver()): Promise<CenterConfig | 'back'> {
    const { askCenterConfig: runWizard } = await import('./prompt/wizards/center');
    return runWizard(driver);
}

export async function askPadAspectConfig(
    driver: PromptDriver = getDefaultPromptDriver()
): Promise<PadAspectConfig | 'back'> {
    const { askPadAspectConfig: runWizard } = await import('./prompt/wizards/pad-aspect');
    return runWizard(driver);
}
