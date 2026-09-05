// SmartImage-Toolkit 交互配置类型（由 SliceC 自 cli.ts 拆出，cli.ts 保留 re-export 做兼容）
// 第一性原理：类型是各层共享的契约，交互渲染与流程编排都只引用此处，不再各自重复声明。

/** 用户取消交互时抛出的信号异常，由入口 main 捕获并决定退出码（替代散落各处的直接退出调用）。 */
export class CancelError extends Error {
    constructor(message = '操作已取消') {
        super(message);
        this.name = 'CancelError';
    }
}

/** 顶层特效方案 */
export type TargetFormat =
    | 'webp'
    | 'png'
    | 'avif'
    | 'mozjpeg'
    | 'rmbg_solid'
    | 'split'
    | 'resize'
    | 'trim'
    | 'crop'
    | 'center';

/** AI 抠图模型档位 */
export type AiModel = 'medium' | 'small';

export interface SplitConfig {
    rows: number;
    cols: number;
    exportFormat: 'webp' | 'png' | 'mozjpeg'; // 切片导出格式
    centerMode?: 'none' | 'keep_ratio' | 'square'; // 居中裁剪策略
    edgeShave?: number; // 边缘向内削减像素数
    debugGrid?: boolean; // 是否额外输出带红蓝指示线的可视化排查切分基准图
}

export interface ResizeConfig {
    mode: 'by_width' | 'by_height' | 'by_percent' | 'custom';
    width?: number;
    height?: number;
    percent?: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside';
    outputFormat?: 'original' | 'webp' | 'png' | 'mozjpeg';
}

export interface TrimConfig {
    threshold: number; // 颜色容忍度 1-100
    sides: ('top' | 'bottom' | 'left' | 'right')[]; // 用户允许智能去掉的边
    outputFormat?: 'original' | 'webp' | 'png' | 'mozjpeg';
}

export interface CropConfig {
    top: number;
    bottom: number;
    left: number;
    right: number;
    outputFormat?: 'original' | 'webp' | 'png' | 'mozjpeg';
}

export interface CenterConfig {
    threshold: number;
    fillColor: string | 'transparent';
    outputFormat?: 'webp' | 'png' | 'mozjpeg' | 'original';
    sides?: ('top' | 'bottom' | 'left' | 'right')[];
}

export interface InteractiveResolution {
    format: TargetFormat;
    aiModel?: AiModel;
    splitConfig?: SplitConfig; // 针对切片操作附加参数
    resizeConfig?: ResizeConfig; // 针对缩放操作附加参数
    trimConfig?: TrimConfig; // 针对智能去边操作附加参数
    cropConfig?: CropConfig; // 针对手动裁切操作附加参数
    centerConfig?: CenterConfig; // 针对智能居中操作附加参数
}
