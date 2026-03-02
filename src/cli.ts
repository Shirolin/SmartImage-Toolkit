import readline from 'readline';
import chalk from 'chalk';

export type TargetFormat = 'webp' | 'png' | 'avif' | 'mozjpeg' | 'rmbg_solid';
export type AiModel = 'medium' | 'small';

export interface InteractiveResolution {
    format: TargetFormat;
    aiModel?: AiModel;
}

export function askFormat(): Promise<InteractiveResolution> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        console.log(`\n${chalk.cyan.bold('🎨 请选择要转换的目标格式')} ${chalk.gray('(输入对应数字并回车)')}:`);
        console.log(chalk.gray('━'.repeat(50)));
        console.log(
            `  ${chalk.green.bold('1.')} ${chalk.white.bold('WebP')}      ${chalk.gray('=> 极佳的体积和画质平衡，推荐用于网页')}`
        );
        console.log(
            `  ${chalk.green.bold('2.')} ${chalk.white.bold('PNG')}       ${chalk.gray('=> 极度压缩版本，最高系统兼容性并保留透明度')}`
        );
        console.log(
            `  ${chalk.green.bold('3.')} ${chalk.white.bold('AVIF')}      ${chalk.gray('=> 最硬核顶级压缩率，体积最小，适合现代设备')}`
        );
        console.log(
            `  ${chalk.green.bold('4.')} ${chalk.white.bold('MozJPEG')}   ${chalk.gray('=> 最好的 JPG 有损压缩，AI 和旧设备 100% 兼容')}`
        );
        console.log(
            `  ${chalk.magenta.bold('5.')} ${chalk.white.bold('AI 抠图')}   ${chalk.magenta('=> 智能分离主体，输出去除背景的高清透明图片')}`
        );
        console.log(`  ${chalk.red.bold('0.')} ${chalk.red('取消退出')}  ${chalk.gray('=> 放弃转换并退出程序')}`);
        console.log(chalk.gray('━'.repeat(50)));

        const question = () => {
            rl.question(chalk.yellow('💬 请输入对应数字: '), (answer: string) => {
                switch (answer.trim()) {
                    case '0':
                        console.log(chalk.red('👋 操作已取消。'));
                        rl.close();
                        process.exit(0);
                        break;
                    case '1':
                        rl.close();
                        resolve({ format: 'webp' });
                        break;
                    case '2':
                        rl.close();
                        resolve({ format: 'png' });
                        break;
                    case '3':
                        rl.close();
                        resolve({ format: 'avif' });
                        break;
                    case '4':
                        rl.close();
                        resolve({ format: 'mozjpeg' });
                        break;
                    case '5': {
                        console.log(
                            `\n${chalk.magenta.bold('🧠 请选择 AI 抠图的精细度模型')} ${chalk.gray('(输入对应数字并回车)')}:`
                        );
                        console.log(chalk.gray('━'.repeat(50)));
                        console.log(
                            `  ${chalk.green.bold('1.')} ${chalk.white.bold('均衡模式 (Medium)')}    ${chalk.gray('=> 默认推荐，速度与画质绝佳平衡，最适合【复杂边缘、动物毛发、日常人像】')}`
                        );
                        console.log(
                            `  ${chalk.cyan.bold('2.')} ${chalk.white.bold('闪电极速 (Small)')}     ${chalk.gray('=> 速度极快，节省内存资源，适合【边界明显的简单图片与大批量处理】')}`
                        );
                        console.log(chalk.gray('━'.repeat(50)));
                        const aiQuestion = () => {
                            rl.question(chalk.yellow('💬 请选择模型级别: '), (aiAnswer: string) => {
                                let model: AiModel = 'medium';
                                switch (aiAnswer.trim()) {
                                    case '1':
                                        model = 'medium';
                                        break;
                                    case '2':
                                        model = 'small';
                                        break;
                                    default:
                                        console.log(chalk.red('❌ 无效输入，请重新输入 1 或 2。'));
                                        return aiQuestion();
                                }
                                rl.close();
                                resolve({ format: 'rmbg_solid', aiModel: model });
                            });
                        };
                        aiQuestion();
                        break;
                    }
                    default:
                        console.log(chalk.red('❌ 无效输入，请重新输入 0-5 之间的数字。'));
                        question();
                        break;
                }
            });
        };
        question();
    });
}
