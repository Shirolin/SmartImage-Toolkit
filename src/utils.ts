import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

// 支持的图片扩展名
export const SUPPORTED_EXTS: string[] = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.gif', '.webp', '.avif'];

/**
 * 安全地获取给定路径下的所有受支持格式的图片文件
 * @param inputPath 输入的文件或文件夹路径
 * @param maxDepth 最大允许的递归搜索深度
 * @param currentDepth 内部使用的当前递归深度状态
 */
export async function getFiles(inputPath: string, maxDepth: number = 10, currentDepth: number = 0): Promise<string[]> {
    if (currentDepth > maxDepth) {
        console.warn(
            chalk.yellow(`⚠️ [深度限制] 路径层级超过最大的 ${maxDepth} 层限制，已跳过更深层级的检索: ${inputPath}`)
        );
        return [];
    }

    try {
        const stats = await fs.promises.lstat(inputPath); // 使用 lstat 提取软链接信息（比 stat 更全面）

        if (stats.isSymbolicLink()) {
            console.warn(chalk.yellow(`⚠️ [链接跳过] 检测到软链接，为防止死循环已跳过: ${inputPath}`));
            return [];
        }

        if (stats.isFile()) {
            return SUPPORTED_EXTS.includes(path.extname(inputPath).toLowerCase()) ? [inputPath] : [];
        } else if (stats.isDirectory()) {
            let results: string[] = [];
            const list = await fs.promises.readdir(inputPath);
            for (const file of list) {
                const fullPath = path.join(inputPath, file);
                results = results.concat(await getFiles(fullPath, maxDepth, currentDepth + 1));
            }
            return results;
        }
        return [];
    } catch (err: unknown) {
        let msg = '未知错误';
        if (err instanceof Error) {
            msg = err.message;
        }
        console.error(chalk.red(`⚠️ [读取跳过] 无法访问路径: ${inputPath} | 错误信息: ${msg}`));
        return [];
    }
}
