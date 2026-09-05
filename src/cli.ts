import chalk from 'chalk';
import { CancelError } from './config-types';
import type { TargetFormat, InteractiveResolution } from './config-types';
import {
    renderHeader,
    customSelect,
    askAiModel,
    askSplitConfig,
    askResizeConfig,
    askTrimCrop,
    askCenterConfig
} from './prompts';
import type { Choice } from './prompts';

// 本文件自 917 行上帝文件拆分后的调度薄层：只保留主菜单编排，类型与交互实现分别见
// config-types.ts / prompts.ts。取消统一抛 CancelError，由入口决定退出码。

// 类型兼容：历史调用方从 './cli' 引入类型，此处全部 re-export，保持引入路径不变。
export { CancelError } from './config-types';
export type {
    TargetFormat,
    AiModel,
    SplitConfig,
    ResizeConfig,
    TrimConfig,
    CropConfig,
    CenterConfig,
    InteractiveResolution
} from './config-types';

export async function askFormat(): Promise<InteractiveResolution> {
    const message = `\n${chalk.cyan.bold('🎨 上下键浏览，数字键直达，回车确认')}:\n${chalk.gray('  ? 特效方案:')}`;

    const formatChoices: Choice<TargetFormat | 'cancel'>[] = [
        {
            key: '1',
            title: 'WebP',
            description: '体积与画质平衡，推荐',
            value: 'webp',
            titleColor: chalk.green.bold
        },
        {
            key: '2',
            title: 'PNG',
            description: '无损压缩，保留透明度',
            value: 'png',
            titleColor: chalk.green.bold
        },
        {
            key: '3',
            title: 'AVIF',
            description: '顶级压缩率，适合现代设备',
            value: 'avif',
            titleColor: chalk.green.bold
        },
        {
            key: '4',
            title: 'MozJPEG',
            description: 'JPG 有损压缩，兼容性最高',
            value: 'mozjpeg',
            titleColor: chalk.green.bold
        },
        {
            key: '5',
            title: 'AI 抠图',
            description: '智能去除背景，输出透明图',
            value: 'rmbg_solid',
            titleColor: chalk.magenta.bold
        },
        {
            key: '6',
            title: '图像切片',
            description: '表情包/雪碧图按网格切分',
            value: 'split',
            titleColor: chalk.cyan.bold
        },
        {
            key: '7',
            title: '批量缩放',
            description: '按比例或像素批量调整大小',
            value: 'resize',
            titleColor: chalk.blue.bold
        },
        {
            key: '8',
            title: '边缘修剪 (Trim/Crop)',
            description: '自动去白边或手动像素级切除',
            value: 'trim',
            titleColor: chalk.yellow
        },
        {
            key: '9',
            title: '自动居中 (Smart Center)',
            description: '探测主体位置并平衡边距，使内容完美居中',
            value: 'center',
            titleColor: chalk.magenta.bold
        },
        {
            key: '0',
            title: '退出程序',
            description: '结束当前会话',
            value: 'cancel',
            titleColor: chalk.gray
        }
    ];

    while (true) {
        renderHeader('主界面');
        const selectedFormat = await customSelect(message, formatChoices);

        // 取消不再直接退出进程：抛信号异常，退出码由入口 main 统一决定
        if (selectedFormat === 'cancel') {
            console.clear();
            console.log(chalk.red('👋 操作已取消。'));
            throw new CancelError('用户在主菜单选择退出');
        }

        if (selectedFormat === 'rmbg_solid') {
            const aiModel = await askAiModel();
            if (aiModel === 'back') continue;
            console.clear();
            return { format: 'rmbg_solid', aiModel };
        }

        if (selectedFormat === 'split') {
            const splitConfig = await askSplitConfig();
            if (splitConfig === 'back') continue;
            return { format: 'split', splitConfig };
        }

        if (selectedFormat === 'resize') {
            const resizeConfig = await askResizeConfig();
            if (resizeConfig === 'back') continue;
            return { format: 'resize', resizeConfig };
        }

        if (selectedFormat === 'trim') {
            const answer = await askTrimCrop();
            if (answer === 'back') continue;
            if (answer.kind === 'trim') return { format: 'trim', trimConfig: answer.trimConfig };
            return { format: 'crop', cropConfig: answer.cropConfig };
        }

        if (selectedFormat === 'center') {
            const centerConfig = await askCenterConfig();
            if (centerConfig === 'back') continue;
            return { format: 'center', centerConfig };
        }

        console.clear();
        return { format: selectedFormat };
    }
}
