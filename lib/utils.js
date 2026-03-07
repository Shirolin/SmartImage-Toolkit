"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_EXTS = void 0;
exports.getFiles = getFiles;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
// 支持的图片扩展名
exports.SUPPORTED_EXTS = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.gif', '.webp', '.avif'];
/**
 * 安全地获取给定路径下的所有受支持格式的图片文件
 * @param inputPath 输入的文件或文件夹路径
 * @param maxDepth 最大允许的递归搜索深度
 * @param currentDepth 内部使用的当前递归深度状态
 */
async function getFiles(inputPath, maxDepth = 10, currentDepth = 0) {
    if (currentDepth > maxDepth) {
        console.warn(chalk_1.default.yellow(`⚠️ [深度限制] 路径层级超过最大的 ${maxDepth} 层限制，已跳过更深层级的检索: ${inputPath}`));
        return [];
    }
    try {
        const stats = await fs_1.default.promises.lstat(inputPath); // 使用 lstat 提取软链接信息（比 stat 更全面）
        if (stats.isSymbolicLink()) {
            console.warn(chalk_1.default.yellow(`⚠️ [链接跳过] 检测到软链接，为防止死循环已跳过: ${inputPath}`));
            return [];
        }
        if (stats.isFile()) {
            return exports.SUPPORTED_EXTS.includes(path_1.default.extname(inputPath).toLowerCase()) ? [inputPath] : [];
        }
        else if (stats.isDirectory()) {
            let results = [];
            const list = await fs_1.default.promises.readdir(inputPath);
            for (const file of list) {
                const fullPath = path_1.default.join(inputPath, file);
                results = results.concat(await getFiles(fullPath, maxDepth, currentDepth + 1));
            }
            return results;
        }
        return [];
    }
    catch (err) {
        let msg = '未知错误';
        if (err instanceof Error) {
            msg = err.message;
        }
        console.error(chalk_1.default.red(`⚠️ [读取跳过] 无法访问路径: ${inputPath} | 错误信息: ${msg}`));
        return [];
    }
}
