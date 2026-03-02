"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertImage = convertImage;
const sharp_1 = __importDefault(require("sharp"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const url_1 = __importDefault(require("url"));
const chalk_1 = __importDefault(require("chalk"));
const background_removal_node_1 = require("@imgly/background-removal-node");
/**
 * 图像处理核心网关引擎
 */
async function convertImage(filePath, format, spinnerInstance, aiModel = 'medium') {
    const dir = path_1.default.dirname(filePath);
    const ext = path_1.default.extname(filePath);
    const name = path_1.default.basename(filePath, ext);
    let outputExt = '';
    let suffix = '';
    let sharpInstance = (0, sharp_1.default)(filePath);
    switch (format) {
        case 'webp':
            outputExt = '.webp';
            if (ext.toLowerCase() === '.webp')
                return { status: 'skipped', file: filePath, reason: '已经是该格式' };
            sharpInstance = sharpInstance.webp({ quality: 80, effort: 6 });
            break;
        case 'png':
            outputExt = '.png';
            suffix = '_optimized';
            sharpInstance = sharpInstance.png({ quality: 75, colors: 256, dither: 1.0, effort: 8 });
            break;
        case 'avif':
            outputExt = '.avif';
            if (ext.toLowerCase() === '.avif')
                return { status: 'skipped', file: filePath, reason: '已经是该格式' };
            sharpInstance = sharpInstance.avif({ quality: 75, effort: 7 });
            break;
        case 'mozjpeg':
            outputExt = '.jpg';
            suffix = '_optimized';
            sharpInstance = sharpInstance.jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:4:4' });
            break;
        case 'rmbg_solid': {
            outputExt = ext.toLowerCase() === '.webp' ? '.webp' : '.png';
            suffix = '_nobg';
            // 内存防漏保护变量
            let normalizedBuffer = null;
            let finalBuffer = null;
            try {
                if (spinnerInstance) {
                    spinnerInstance.text = chalk_1.default.blue(`[AI 引擎就绪] 正在读取并准备提取: ${name}`);
                    spinnerInstance.render();
                }
                // 细化前置错误捕获（针对格式异常/图片损坏）
                try {
                    normalizedBuffer = await (0, sharp_1.default)(filePath).png().toBuffer();
                }
                catch (sharpErr) {
                    let errMsg = '未知 Sharp 处理错误';
                    if (sharpErr instanceof Error) {
                        errMsg = sharpErr.message;
                    }
                    throw new Error(`图片文件解析失败 (文件可能已损坏或不支持此处理): ${errMsg}`);
                }
                // 手动构造无类型歧义的强类型 Blob，绕过底层解析 Bug
                const { Blob } = await Promise.resolve().then(() => __importStar(require('buffer')));
                // 使用 Uint8Array 包装 Buffer 以契合 Web 标准 BlobPart 的需要
                const inputBlob = new Blob([new Uint8Array(normalizedBuffer)], {
                    type: 'image/png'
                });
                const blob = await (0, background_removal_node_1.removeBackground)(inputBlob, {
                    publicPath: url_1.default.pathToFileURL(path_1.default.join(__dirname, '..', 'node_modules', '@imgly', 'background-removal-node', 'dist')).href + '/',
                    model: aiModel,
                    output: {
                        format: 'image/x-rgba8',
                        quality: 1.0
                    },
                    progress: (key, current, total) => {
                        const percent = ((current / total) * 100).toFixed(1);
                        if (spinnerInstance) {
                            spinnerInstance.text = chalk_1.default.yellow(`🧠 [AI 处理中] 图像: ${name} | 模型(${aiModel}): ${percent}%`);
                            spinnerInstance.render();
                        }
                    }
                });
                if (spinnerInstance) {
                    spinnerInstance.text = chalk_1.default.green(`✨ [AI 抠图完成] 图像: ${name} 处理成功，正在保存...`);
                    spinnerInstance.render();
                }
                // 通过对未知 blob 再次进行安全转换，以此保障 ArrayBuffer 可以正常调起
                const resultBlob = blob;
                const arrayBuffer = await resultBlob.arrayBuffer();
                const aiResultBuffer = Buffer.from(arrayBuffer);
                const metadata = await (0, sharp_1.default)(normalizedBuffer).metadata();
                // 根据底层文档 image/x-rgba8 数据格式提取并直接交给 Sharp 原生组装
                let resultSharp = (0, sharp_1.default)(aiResultBuffer, {
                    raw: {
                        width: metadata.width ?? 0,
                        height: metadata.height ?? 0,
                        channels: 4 // RGBA 4通道
                    }
                });
                if (outputExt === '.webp') {
                    resultSharp = resultSharp.webp({ lossless: true, effort: 6 });
                }
                else {
                    resultSharp = resultSharp.png({ effort: 8 });
                }
                finalBuffer = await resultSharp.toBuffer();
                sharpInstance = (0, sharp_1.default)(finalBuffer);
            }
            catch (err) {
                let errorDetails = '';
                if (err instanceof Error) {
                    errorDetails = err.message;
                }
                return {
                    status: 'error',
                    file: filePath,
                    reason: errorDetails.includes('图片文件解析失败') ? errorDetails : `AI 处理异常: ${errorDetails}`
                };
            }
            finally {
                normalizedBuffer = null;
            }
            break;
        }
        default:
            return { status: 'error', file: filePath, reason: '不支持的目标格式' };
    }
    // 自动重命名逻辑：检测文件是否存在，如果存在则添加 (1), (2) 后缀
    let outputPath = path_1.default.join(dir, `${name}${suffix}${outputExt}`);
    let counter = 1;
    while (fs_1.default.existsSync(outputPath)) {
        outputPath = path_1.default.join(dir, `${name}${suffix}(${counter})${outputExt}`);
        counter++;
    }
    try {
        await sharpInstance.toFile(outputPath);
        return { status: 'success', file: filePath };
    }
    catch (err) {
        let saveErr = '未能保存文件';
        if (err instanceof Error) {
            saveErr = err.message;
        }
        return { status: 'error', file: filePath, reason: saveErr };
    }
}
