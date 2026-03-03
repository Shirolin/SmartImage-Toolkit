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
        const width = metadata.width;
        const height = metadata.height;
        if (!width || !height) {
            throw new Error('无法读取图像尺寸');
        }
        const tileWidth = Math.floor(width / options.cols);
        const tileHeight = Math.floor(height / options.rows);
        if (tileWidth <= 0 || tileHeight <= 0) {
            throw new Error(`切片尺寸计算异常 (宽: ${tileWidth}, 高: ${tileHeight})`);
        }
        let outDir = path_1.default.join(dir, name);
        let dirCounter = 1;
        while (fs_1.default.existsSync(outDir)) {
            outDir = path_1.default.join(dir, `${name}(${dirCounter})`);
            dirCounter++;
        }
        fs_1.default.mkdirSync(outDir, { recursive: true });
        const promises = [];
        for (let row = 0; row < options.rows; row++) {
            for (let col = 0; col < options.cols; col++) {
                // 安全计算：由于使用向下取整，右侧或底部可能剩余少数像素，我们直接忽略这些像素(通常是透明/白底)
                const left = col * tileWidth;
                const top = row * tileHeight;
                // 容错: 如果由于浮点数误差出现极大越界（尽管在 floor 下极少发生）
                if (left + tileWidth > width || top + tileHeight > height) {
                    continue;
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
                        // 提取该切片的左上角像素作为动态边框底色
                        const { data, info } = await (0, sharp_1.default)(tileBuffer)
                            .extract({ left: 0, top: 0, width: 1, height: 1 })
                            .raw()
                            .toBuffer({ resolveWithObject: true });
                        const r = data[0];
                        const g = data[1];
                        const b = data[2];
                        const alpha = info.channels === 4 ? data[3] / 255 : 1;
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
