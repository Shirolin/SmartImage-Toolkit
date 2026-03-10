"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processCenter = processCenter;
const sharp_1 = __importDefault(require("sharp"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
async function processCenter(filePath, config, formatExt) {
    const dir = path_1.default.dirname(filePath);
    const ext = path_1.default.extname(filePath);
    const name = path_1.default.basename(filePath, ext);
    const actualExt = formatExt || ext.toLowerCase();
    const outDir = path_1.default.join(dir, 'centered');
    if (!fs_1.default.existsSync(outDir)) {
        fs_1.default.mkdirSync(outDir, { recursive: true });
    }
    let outputPath = path_1.default.join(outDir, `${name}${actualExt}`);
    let counter = 1;
    while (fs_1.default.existsSync(outputPath)) {
        outputPath = path_1.default.join(outDir, `${name}(${counter})${actualExt}`);
        counter++;
    }
    try {
        const originalImage = (0, sharp_1.default)(filePath);
        const metadata = await originalImage.metadata();
        const originalW = metadata.width || 0;
        const originalH = metadata.height || 0;
        // 1. 探测主体内容 (Bounding Box)
        // 我们利用 trim() 的探测能力来寻找主体，但要在内存中拿到结果
        const probe = (0, sharp_1.default)(filePath).trim({ threshold: config.threshold });
        const { info: probeInfo } = await probe.toBuffer({ resolveWithObject: true });
        // probeInfo.trimOffsetLeft 和 trimOffsetTop 是负值，代表左侧和顶部被切掉的像素
        const contentLeft = Math.abs(probeInfo.trimOffsetLeft || 0);
        const contentTop = Math.abs(probeInfo.trimOffsetTop || 0);
        const contentW = probeInfo.width;
        const contentH = probeInfo.height;
        // 如果探测出的内容就是全图，没必要处理
        if (contentW === originalW && contentH === originalH) {
            // 实际上也可以继续，但为了性能可以跳过，或者直接复制
        }
        // 2. 计算轴向总可用边距 (Total Margins)
        const totalHorizontalMargin = originalW - contentW;
        const totalVerticalMargin = originalH - contentH;
        const allowedSides = config.sides || ['top', 'bottom', 'left', 'right'];
        const hasTop = allowedSides.includes('top');
        const hasBottom = allowedSides.includes('bottom');
        const hasLeft = allowedSides.includes('left');
        const hasRight = allowedSides.includes('right');
        // 3. 应用轴向分配逻辑 (Alignment Distribution)
        // 核心逻辑：不选哪边，哪边不留白。选了哪边，哪边承接边距。
        // 若对向均选，则平分（居中）；若均不选，则画布收缩至内容尺寸。
        const padding = {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0
        };
        // 垂直轴处理
        if (hasTop && hasBottom) {
            padding.top = Math.floor(totalVerticalMargin / 2);
            padding.bottom = totalVerticalMargin - padding.top;
        }
        else if (hasTop) {
            padding.top = totalVerticalMargin;
        }
        else if (hasBottom) {
            padding.bottom = totalVerticalMargin;
        }
        // 水平轴处理
        if (hasLeft && hasRight) {
            padding.left = Math.floor(totalHorizontalMargin / 2);
            padding.right = totalHorizontalMargin - padding.left;
        }
        else if (hasLeft) {
            padding.left = totalHorizontalMargin;
        }
        else if (hasRight) {
            padding.right = totalHorizontalMargin;
        }
        // 4. 构建处理流水线
        let pipeline = (0, sharp_1.default)(filePath)
            .extract({
            left: contentLeft,
            top: contentTop,
            width: contentW,
            height: contentH
        })
            .extend({
            ...padding,
            background: config.fillColor === 'transparent' ? { r: 0, g: 0, b: 0, alpha: 0 } : config.fillColor
        });
        // 4. 编码保存
        switch (actualExt) {
            case '.webp':
                pipeline = pipeline.webp({ quality: 90, effort: 6 });
                break;
            case '.png':
                pipeline = pipeline.png({ quality: 90, effort: 8 });
                break;
            case '.jpg':
            case '.jpeg':
                pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
                break;
        }
        await pipeline.toFile(outputPath);
        return { status: 'success', file: filePath };
    }
    catch (err) {
        let errMsg = '未知错误';
        if (err instanceof Error) {
            errMsg = err.message;
        }
        return { status: 'error', file: filePath, reason: errMsg };
    }
}
