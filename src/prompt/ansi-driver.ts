import readline from 'readline';
import chalk from 'chalk';
import { CancelError } from '../config-types';
import type { Choice, PromptDriver } from './driver';
import { registerDefaultPromptDriverFactory } from './driver';

interface LineWaiter {
    deliver: (line: string) => void;
    fail: (err: Error) => void;
}

/**
 * 生产终端驱动器适配器（AnsiTerminalDriver）
 * 封装底层的 ANSI 光标控制、TTY RawMode、按键事件与会话级 Readline 缓冲队列。
 */
export class AnsiTerminalDriver implements PromptDriver {
    private readonly input: NodeJS.ReadableStream;
    private readonly output: NodeJS.WritableStream;
    private questionReader: readline.Interface | null = null;
    private readonly bufferedLines: string[] = [];
    private readonly lineWaiters: LineWaiter[] = [];

    constructor(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout) {
        this.input = input;
        this.output = output;
    }

    renderHeader(breadcrumb: string): void {
        console.clear();
        console.log(
            chalk.gray('=====================================================================================')
        );
        console.log(chalk.bold.white('   🎨 SmartImage-Toolkit (交互模式版)'));
        console.log(
            chalk.gray('=====================================================================================\n')
        );
        console.log(`${chalk.gray('📍 当前位置:')} ${chalk.cyan(breadcrumb)}\n`);
    }

    notify(message: string, type?: 'info' | 'warn' | 'error'): void {
        if (type === 'error') {
            console.log(chalk.red(message));
        } else if (type === 'warn') {
            console.log(chalk.yellow(message));
        } else if (type === 'info') {
            console.log(chalk.cyan(message));
        } else {
            console.log(message);
        }
    }

    clear(): void {
        console.clear();
    }

    async select<T>(message: string, choices: readonly Choice<T>[]): Promise<T> {
        // 菜单独占 stdin：先释放共享的 questionReader，否则它会同时消费按键
        this.releaseQuestionReader();

        return new Promise<T>((resolve, reject) => {
            let selectedIndex = 0;
            let renderedLines = 0;
            let settled = false;

            const inStream = this.input as NodeJS.ReadStream;
            const outStream = this.output as NodeJS.WriteStream;

            const rl = readline.createInterface({
                input: this.input,
                output: this.output,
                terminal: true
            });

            readline.emitKeypressEvents(this.input);
            if (inStream.isTTY && typeof inStream.setRawMode === 'function') {
                inStream.setRawMode(true);
            }

            const render = (): void => {
                if (renderedLines > 0) {
                    outStream.write('\x1B[' + renderedLines + 'A');
                    outStream.write('\x1B[J');
                }

                let output = `${message}\n`;
                let lines = message.split('\n').length;

                choices.forEach((choice, index) => {
                    if (choice.key === '0') {
                        output += chalk.gray('  ' + '━'.repeat(50)) + '\n';
                        lines++;
                    }

                    const prefix = index === selectedIndex ? '❯ ' : '  ';
                    const keyStr = `${choice.key}. `;

                    let lineStr = '';
                    if (index === selectedIndex) {
                        // 选中时，整行反色高亮
                        const content = ` ${prefix}${keyStr}${choice.title}  ${choice.description} `;
                        lineStr = chalk.bgCyan.black.bold(content);
                    } else {
                        // 未选中时
                        const colorFn = choice.titleColor || chalk.white;
                        lineStr = `  ${prefix}${keyStr}${colorFn(choice.title)}  ${chalk.gray(choice.description)}`;
                    }

                    output += lineStr + '\n';
                    lines++;
                });

                outStream.write(output);
                renderedLines = lines;
            };

            const onKeypress = (str: string, key: readline.Key): void => {
                if (key && key.name === 'up') {
                    selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
                    render();
                } else if (key && key.name === 'down') {
                    selectedIndex = (selectedIndex + 1) % choices.length;
                    render();
                } else if (key && (key.name === 'return' || key.name === 'enter')) {
                    settled = true;
                    cleanup();
                    resolve(choices[selectedIndex].value);
                } else if (key && key.ctrl && key.name === 'c') {
                    settled = true;
                    cleanup();
                    reject(new CancelError('用户中断选择'));
                } else if (str) {
                    const choice = choices.find((c) => c.key === str.trim());
                    if (choice) {
                        settled = true;
                        cleanup();
                        resolve(choice.value);
                    }
                }
            };

            const cleanup = (): void => {
                try {
                    if (inStream.isTTY && typeof inStream.setRawMode === 'function') {
                        inStream.setRawMode(false);
                    }
                } catch {
                    // 忽略终端恢复错误
                }
                try {
                    inStream.removeListener('keypress', onKeypress);
                } catch {
                    // 忽略移除监听器错误
                }
                try {
                    rl.close();
                } catch {
                    // 忽略关闭错误
                }
                try {
                    outStream.write('\n');
                } catch {
                    // 忽略输出错误
                }
            };

            inStream.on('keypress', onKeypress);

            rl.on('close', () => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new CancelError('标准输入已结束'));
            });

            try {
                if (inStream.isTTY && typeof inStream.setRawMode === 'function') {
                    inStream.setRawMode(true);
                }
                render();
            } catch (err) {
                settled = true;
                cleanup();
                reject(err);
            }
        });
    }

    async question(query: string): Promise<string> {
        const rl = this.getQuestionReader();
        rl.setPrompt(query);
        rl.prompt();

        const buffered = this.bufferedLines.shift();
        if (buffered !== undefined) {
            return Promise.resolve(buffered.trim());
        }

        return new Promise<string>((resolve, reject) => {
            let settled = false;

            const detach = (): void => {
                const index = this.lineWaiters.indexOf(waiter);
                if (index >= 0) this.lineWaiters.splice(index, 1);
                rl.removeListener('SIGINT', onSigint);
            };

            const waiter: LineWaiter = {
                deliver: (line: string) => {
                    if (settled) return;
                    settled = true;
                    detach();
                    resolve(line.trim());
                },
                fail: (err: Error) => {
                    if (settled) return;
                    settled = true;
                    detach();
                    reject(err);
                }
            };

            const onSigint = (): void => {
                if (settled) return;
                settled = true;
                detach();
                reject(new CancelError('用户中断输入'));
            };

            rl.on('SIGINT', onSigint);
            this.lineWaiters.push(waiter);
        });
    }

    private releaseQuestionReader(): void {
        const rl = this.questionReader;
        this.questionReader = null;
        if (rl) {
            try {
                rl.close();
            } catch {
                // 忽略关闭错误
            }
        }
        this.bufferedLines.length = 0;
        for (const waiter of this.lineWaiters.splice(0)) {
            waiter.fail(new CancelError('用户中断输入'));
        }
    }

    private getQuestionReader(): readline.Interface {
        if (this.questionReader) return this.questionReader;

        const rl = readline.createInterface({
            input: this.input,
            output: this.output
        });

        rl.on('line', (line: string) => {
            const waiter = this.lineWaiters.shift();
            if (waiter) {
                waiter.deliver(line);
            } else {
                this.bufferedLines.push(line);
            }
        });

        rl.on('close', () => {
            if (this.questionReader === rl) this.questionReader = null;
            for (const waiter of this.lineWaiters.splice(0)) {
                const buffered = this.bufferedLines.shift();
                if (buffered === undefined) {
                    waiter.fail(new CancelError('用户中断输入'));
                } else {
                    waiter.deliver(buffered);
                }
            }
        });

        this.questionReader = rl;
        return rl;
    }
}

// 自动注册默认驱动工厂
registerDefaultPromptDriverFactory(() => new AnsiTerminalDriver());
