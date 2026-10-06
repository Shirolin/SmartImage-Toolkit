/**
 * 菜单选项定义
 */
export interface Choice<T> {
    /** 快捷键或序号标识（如 '1', '2', '0'） */
    readonly key: string;
    /** 选项主标题 */
    readonly title: string;
    /** 辅助说明文案 */
    readonly description: string;
    /** 选项绑定的真实值 */
    readonly value: T;
    /** 标题色彩渲染函数（可选） */
    readonly titleColor?: (text: string) => string;
}

/**
 * 行输入校验与转换配置
 */
export interface InputOptions<T = string> {
    /** 提示文案 */
    readonly prompt: string;
    /** 用户直接按回车时的默认值 */
    readonly default?: string;
    /** 是否允许输入 '0' 快速返回上一级（若输入 '0'，直接返回 'back'） */
    readonly allowBack?: boolean;
    /** 输入校验函数：返回 true 表示合法，返回 string 则为错误提示文案并在驱动内就地重问 */
    readonly validate?: (raw: string) => true | string;
    /** 输入解析函数：在校验通过后将字符串转换为强类型 T */
    readonly transform?: (raw: string) => T;
}

/**
 * 交互提示驱动器模块接口（PromptDriver Interface）
 * 坐落在领域向导工作流与具体输入输出基础设施之间的接缝上。
 */
export interface PromptDriver {
    /**
     * 呈现单选菜单并等待用户确认一个选项
     * @throws {CancelError} 用户主动按下 Ctrl+C 或底层输入流 EOF
     */
    select<T>(message: string, choices: readonly Choice<T>[]): Promise<T>;

    /**
     * 呈现文本提问并采集单行原始输入
     * @throws {CancelError} 用户主动按下 Ctrl+C 或底层输入流 EOF
     */
    question(query: string): Promise<string>;

    /**
     * 渲染当前流程顶部导航面包屑与系统标头
     */
    renderHeader(breadcrumb: string): void;

    /**
     * 输出即时状态通知或校验反馈
     */
    notify(message: string, type?: 'info' | 'warn' | 'error'): void;

    /**
     * 清理终端屏幕或重绘缓冲区
     */
    clear(): void;
}

let defaultDriverInstance: PromptDriver | null = null;
let defaultDriverFactory: (() => PromptDriver) | null = null;

/**
 * 注册默认驱动工厂（用于解耦生产适配器初始化）
 */
export function registerDefaultPromptDriverFactory(factory: () => PromptDriver): void {
    defaultDriverFactory = factory;
}

/**
 * 获取当前全局默认 PromptDriver 实例（惰性单例）
 */
export function getDefaultPromptDriver(): PromptDriver {
    if (!defaultDriverInstance) {
        if (!defaultDriverFactory) {
            throw new Error('PromptDriver: 默认驱动工厂未注册');
        }
        defaultDriverInstance = defaultDriverFactory();
    }
    return defaultDriverInstance;
}

/**
 * 设置全局默认 PromptDriver 实例（主要用于全局测试注入）
 */
export function setDefaultPromptDriver(driver: PromptDriver | null): void {
    defaultDriverInstance = driver;
}
