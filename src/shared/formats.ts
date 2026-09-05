// 扩展名归一化：全链路统一大小写与 jpeg/jpg 别名
// 支持的输入格式名
export type ImageFormat = 'webp' | 'png' | 'mozjpeg' | 'original';
// 切片导出后缀集合
export type SPLIT_FORMATS = '.webp' | '.png' | '.jpg';

// 归一化扩展名：转小写，.jpeg 统一为 .jpg，无点输入统一补 '.' 前缀
// （空串原样透传：无扩展名源文件的占位命名依赖空串，见 output-naming）
export function normalizeExt(ext: string): string {
    const lower = ext.toLowerCase();
    if (lower === '.jpeg' || lower === 'jpeg') {
        return '.jpg';
    }
    if (lower === '' || lower.startsWith('.')) {
        return lower;
    }
    return `.${lower}`;
}

// 由目标格式解析输出扩展名：mozjpeg 落盘一律 .jpg，original 沿用来源
// 重载保留字面量精度，调用方无需再手写 `.${x}` 拼接与类型强转
export function resolveImageExt(format: 'webp', fallbackExt: string): '.webp';
export function resolveImageExt(format: 'png', fallbackExt: string): '.png';
export function resolveImageExt(format: 'mozjpeg', fallbackExt: string): '.jpg';
export function resolveImageExt(format: 'webp' | 'png' | 'mozjpeg', fallbackExt: string): '.webp' | '.png' | '.jpg';
export function resolveImageExt(format: 'original', fallbackExt: string): string;
export function resolveImageExt(format: ImageFormat, fallbackExt: string): string {
    if (format === 'mozjpeg') {
        return '.jpg';
    }
    if (format === 'original') {
        return normalizeExt(fallbackExt);
    }
    return `.${format}`;
}

// 归一化后比较两个扩展名是否等价（.jpeg 与 .jpg 视为相同，忽略大小写）
export function equalExt(a: string, b: string): boolean {
    return normalizeExt(a) === normalizeExt(b);
}
