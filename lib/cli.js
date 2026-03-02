"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.askFormat = askFormat;
const readline_1 = __importDefault(require("readline"));
const chalk_1 = __importDefault(require("chalk"));
function askFormat() {
    const rl = readline_1.default.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => {
        console.log(`\n${chalk_1.default.cyan.bold('🎨 请选择要转换的目标格式')} ${chalk_1.default.gray('(输入对应数字并回车)')}:`);
        console.log(chalk_1.default.gray('━'.repeat(50)));
        console.log(`  ${chalk_1.default.green.bold('1.')} ${chalk_1.default.white.bold('WebP')}      ${chalk_1.default.gray('=> 极佳的体积和画质平衡，推荐用于网页')}`);
        console.log(`  ${chalk_1.default.green.bold('2.')} ${chalk_1.default.white.bold('PNG')}       ${chalk_1.default.gray('=> 极度压缩版本，最高系统兼容性并保留透明度')}`);
        console.log(`  ${chalk_1.default.green.bold('3.')} ${chalk_1.default.white.bold('AVIF')}      ${chalk_1.default.gray('=> 最硬核顶级压缩率，体积最小，适合现代设备')}`);
        console.log(`  ${chalk_1.default.green.bold('4.')} ${chalk_1.default.white.bold('MozJPEG')}   ${chalk_1.default.gray('=> 最好的 JPG 有损压缩，AI 和旧设备 100% 兼容')}`);
        console.log(`  ${chalk_1.default.magenta.bold('5.')} ${chalk_1.default.white.bold('AI 抠图')}   ${chalk_1.default.magenta('=> 智能分离主体，输出去除背景的高清透明图片')}`);
        console.log(`  ${chalk_1.default.red.bold('0.')} ${chalk_1.default.red('取消退出')}  ${chalk_1.default.gray('=> 放弃转换并退出程序')}`);
        console.log(chalk_1.default.gray('━'.repeat(50)));
        const question = () => {
            rl.question(chalk_1.default.yellow('💬 请输入对应数字: '), (answer) => {
                switch (answer.trim()) {
                    case '0':
                        console.log(chalk_1.default.red('👋 操作已取消。'));
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
                        console.log(`\n${chalk_1.default.magenta.bold('🧠 请选择 AI 抠图的精细度模型')} ${chalk_1.default.gray('(输入对应数字并回车)')}:`);
                        console.log(chalk_1.default.gray('━'.repeat(50)));
                        console.log(`  ${chalk_1.default.green.bold('1.')} ${chalk_1.default.white.bold('均衡模式 (Medium)')}    ${chalk_1.default.gray('=> 默认推荐，速度与画质绝佳平衡，最适合【复杂边缘、动物毛发、日常人像】')}`);
                        console.log(`  ${chalk_1.default.cyan.bold('2.')} ${chalk_1.default.white.bold('闪电极速 (Small)')}     ${chalk_1.default.gray('=> 速度极快，节省内存资源，适合【边界明显的简单图片与大批量处理】')}`);
                        console.log(chalk_1.default.gray('━'.repeat(50)));
                        const aiQuestion = () => {
                            rl.question(chalk_1.default.yellow('💬 请选择模型级别: '), (aiAnswer) => {
                                let model = 'medium';
                                switch (aiAnswer.trim()) {
                                    case '1':
                                        model = 'medium';
                                        break;
                                    case '2':
                                        model = 'small';
                                        break;
                                    default:
                                        console.log(chalk_1.default.red('❌ 无效输入，请重新输入 1 或 2。'));
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
                        console.log(chalk_1.default.red('❌ 无效输入，请重新输入 0-5 之间的数字。'));
                        question();
                        break;
                }
            });
        };
        question();
    });
}
