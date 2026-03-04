"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitImage = splitImage;
const sharp_1 = __importDefault(require("sharp"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * 核心切割引擎
 */
async function splitImage(filePath, options, formatExt = '.webp') {
    const dir = path_1.default.dirname(filePath);
    const ext = path_1.default.extname(filePath);
    const name = path_1.default.basename(filePath, ext);
    const generatedFiles = [];
    try {
        const metadata = await (0, sharp_1.default)(filePath).metadata();
        const width = metadata.width || 0;
        const height = metadata.height || 0;
        if (!width || !height) {
            throw new Error('无法读取图像尺寸');
        }
        // --- 物理网格绝对定位 (Physical Grid Alignment) ---
        // 废弃原先不稳定的“全景寻边”算法。对于带边线的 AI 图，自动寻边会捕捉错误的边界
        // 导致整体网格收缩漂移。现在强制回归物理真实的 100% 原始尺寸进行切分。
        const contentWidth = width;
        const contentHeight = height;
        const offsetLeft = 0;
        const offsetTop = 0;
        let outDir = path_1.default.join(dir, name);
        let dirCounter = 1;
        while (fs_1.default.existsSync(outDir)) {
            outDir = path_1.default.join(dir, `${name}(${dirCounter})`);
            dirCounter++;
        }
        fs_1.default.mkdirSync(outDir, { recursive: true });
        const promises = [];
        let svgLines = '';
        if (options.debugGrid) {
            svgLines = `<svg width="${width}" height="${height}">
                <rect x="${offsetLeft}" y="${offsetTop}" width="${contentWidth}" height="${contentHeight}" fill="none" stroke="red" stroke-width="4"/>`;
        }
        const useCustomCuts = Array.isArray(options.cutX) &&
            Array.isArray(options.cutY) &&
            options.cutX.length >= 2 &&
            options.cutY.length >= 2;
        const totalRows = useCustomCuts ? options.cutY.length - 1 : options.rows;
        const totalCols = useCustomCuts ? options.cutX.length - 1 : options.cols;
        for (let row = 0; row < totalRows; row++) {
            for (let col = 0; col < totalCols; col++) {
                // 结合两大核武级别防偏算法:
                // 1. 限定在 offsetLeft/Top 计算的 "内容封包区" 内部运作
                // 2. 采用针对 contentWidth/Height 的百分比端点映射计算，根绝浮点像素吃边漂移
                let innerLeft, innerRight, innerTop, innerBottom;
                if (useCustomCuts) {
                    innerLeft = options.cutX[col];
                    innerRight = options.cutX[col + 1];
                    innerTop = options.cutY[row];
                    innerBottom = options.cutY[row + 1];
                }
                else {
                    innerLeft = Math.round((col * contentWidth) / options.cols);
                    innerRight = Math.round(((col + 1) * contentWidth) / options.cols);
                    innerTop = Math.round((row * contentHeight) / options.rows);
                    innerBottom = Math.round(((row + 1) * contentHeight) / options.rows);
                }
                const left = offsetLeft + innerLeft;
                const top = offsetTop + innerTop;
                const tileWidth = innerRight - innerLeft;
                const tileHeight = innerBottom - innerTop;
                // 容错: 确保不越出原图物理边界
                if (left + tileWidth > width || top + tileHeight > height || tileWidth <= 0 || tileHeight <= 0) {
                    continue;
                }
                if (options.debugGrid) {
                    svgLines += `<rect x="${left}" y="${top}" width="${tileWidth}" height="${tileHeight}" fill="none" stroke="blue" stroke-width="2"/>`;
                }
                // 命名格式：原图名_行_列
                const rName = String(row + 1).padStart(2, '0');
                const cName = String(col + 1).padStart(2, '0');
                const suffix = `_r${rName}_c${cName}`;
                const outputPath = path_1.default.join(outDir, `${name}${suffix}${formatExt}`);
                // 首先提取出原本的切片块 (作为原始碎片 Buffer)
                const tileBuffer = await (0, sharp_1.default)(filePath)
                    .extract({ left, top, width: tileWidth, height: tileHeight })
                    .toBuffer();
                let pipeline = (0, sharp_1.default)(tileBuffer);
                // 智能居中逻辑
                if (options.centerMode && options.centerMode !== 'none') {
                    try {
                        // 0. 边缘杂边消除 (Edge Shaving)
                        // 若原图含有不易察觉的切分线网格 (如极淡的灰色1px线条)，会阻碍 trim 的寻路
                        // 依据用户选择，安全向内剃去指定的边缘像素厚度
                        const shave = options.edgeShave || 0;
                        const shavedBuffer = shave > 0 && tileWidth > shave * 2 && tileHeight > shave * 2
                            ? await (0, sharp_1.default)(tileBuffer)
                                .extract({
                                left: shave,
                                top: shave,
                                width: tileWidth - shave * 2,
                                height: tileHeight - shave * 2
                            })
                                .toBuffer()
                            : tileBuffer;
                        // --- 修正采样逻辑：从“剃肉”后的干净 Buffer 中提取背景色 ---
                        const { data, info } = await (0, sharp_1.default)(shavedBuffer)
                            .extract({ left: 0, top: 0, width: 1, height: 1 })
                            .raw()
                            .toBuffer({ resolveWithObject: true });
                        const r = data[0];
                        const g = data[1];
                        const b = data[2];
                        const alpha = info.channels === 4 ? data[3] : 255;
                        // 1. 修剪空白边缘 (此步骤丢弃所有纯白或透明的边缘填充)
                        // threshold=40 容差可以吃掉很多肉眼看不见但阻碍算作空白的 WebP/JPEG 压缩噪波点 (如 #Fdfdfd)
                        const trimmedBuffer = await (0, sharp_1.default)(shavedBuffer)
                            .trim({
                            background: { r, g, b, alpha },
                            threshold: 40
                        })
                            .toBuffer();
                        const trimMeta = await (0, sharp_1.default)(trimmedBuffer).metadata();
                        const coreWidth = trimMeta.width || tileWidth;
                        const coreHeight = trimMeta.height || tileHeight;
                        // 2. 根据用户要求的最终长宽重新扩展画布
                        let finalCanvasWidth = tileWidth;
                        let finalCanvasHeight = tileHeight;
                        if (options.centerMode === 'square') {
                            const maxSize = Math.max(tileWidth, tileHeight);
                            finalCanvasWidth = maxSize;
                            finalCanvasHeight = maxSize;
                        }
                        // 3. 计算在目标大画布中的安全留白并拓展
                        const extendLeft = Math.floor((finalCanvasWidth - coreWidth) / 2);
                        const extendRight = finalCanvasWidth - coreWidth - extendLeft;
                        const extendTop = Math.floor((finalCanvasHeight - coreHeight) / 2);
                        const extendBottom = finalCanvasHeight - coreHeight - extendTop;
                        pipeline = (0, sharp_1.default)(trimmedBuffer).extend({
                            top: extendTop,
                            bottom: extendBottom,
                            left: extendLeft,
                            right: extendRight,
                            background: { r, g, b, alpha }
                        });
                    }
                    catch {
                        // 如果 trim 失败，抛弃 trim 继续使用原始 buffer
                        pipeline = (0, sharp_1.default)(tileBuffer);
                    }
                }
                if (formatExt === '.webp') {
                    pipeline = pipeline.webp({ quality: 90, effort: 6 });
                }
                else if (formatExt === '.png') {
                    pipeline = pipeline.png({ quality: 80, effort: 8 });
                }
                else if (formatExt === '.jpg') {
                    pipeline = pipeline.jpeg({ quality: 90 });
                }
                generatedFiles.push(outputPath);
                const savePromise = pipeline
                    .toFile(outputPath)
                    .then(() => { })
                    .catch((err) => {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    throw new Error(`保存切片 ${suffix} 失败: ${errMsg}`);
                });
                promises.push(savePromise);
            }
        }
        await Promise.all(promises);
        // 如果开启了辅佐标尺模式，生成带有标尺线的全图副本
        if (options.debugGrid) {
            svgLines += `</svg>`;
            const debugFilePath = path_1.default.join(outDir, `${name}_debug_grid${formatExt}`);
            await (0, sharp_1.default)(filePath)
                .composite([{ input: Buffer.from(svgLines), top: 0, left: 0 }])
                .toFile(debugFilePath);
            generatedFiles.push(debugFilePath);
        }
        // 保存用户切割配置
        const configPath = path_1.default.join(outDir, 'split_config.json');
        fs_1.default.writeFileSync(configPath, JSON.stringify({
            source: filePath,
            options: options
        }, null, 2), 'utf-8');
        generatedFiles.push(configPath);
        return {
            status: 'success',
            file: filePath,
            generatedFiles
        };
    }
    catch (error) {
        let errorDetails = '';
        if (error instanceof Error) {
            errorDetails = error.message;
        }
        return {
            status: 'error',
            file: filePath,
            reason: `图片切割异常: ${errorDetails}`,
            generatedFiles: []
        };
    }
}
