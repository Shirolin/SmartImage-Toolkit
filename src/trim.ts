import sharp from 'sharp';
import path from 'path';
import { promises as fsp } from 'fs';

import { TrimConfig, CropConfig } from './cli';
import type { OpResult } from './shared/results';
import { ensureDir, allocateFilePath } from './shared/output-naming';
import { orientedSize } from './shared/orientation';
import { applyEncoding } from './shared/encode';
import { normalizeExt } from './shared/formats';

// 兼容旧名：统一复用共享操作结果类型
export type TrimResult = OpResult;

export function processTrimOrCrop(
    filePath: string,
    action: 'trim',
    config: TrimConfig,
    formatExt: string | null
): Promise<TrimResult>;
export function processTrimOrCrop(
    filePath: string,
    action: 'crop',
    config: CropConfig,
    formatExt: string | null
): Promise<TrimResult>;
export async function processTrimOrCrop(
    filePath: string,
    action: 'trim' | 'crop',
    config: TrimConfig | CropConfig,
    formatExt: string | null
): Promise<TrimResult> {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);

    // 输出扩展名归一化（小写；.jpeg→.jpg），未知格式原样透传
    const actualExt = normalizeExt(formatExt || ext);
    const isTrim = action === 'trim';
    const subDirName = isTrim ? 'trimmed' : 'cropped';
    const outDir = path.join(dir, subDirName);

    // 占位路径声明：allocate 移到全部参数校验之后，校验早退时尚无占位可泄漏
    let outputPath = '';

    try {
        // 元数据只读一次，trim/crop 分支复用
        // metadata() 返回未旋转的原始宽高，orientation 5~8 需互换；
        // 后续 trim 偏移量与 crop 裁剪框都在摆正后的坐标系里，故用摆正尺寸
        const oriented = await orientedSize(filePath);
        const originalW = oriented.width;
        const originalH = oriented.height;

        // rotate() 无参时按 EXIF Orientation 自动摆正，必须在 extract 之前应用，
        // 否则裁剪坐标与摆正后的探测结果不一致
        let sharpInstance = sharp(filePath).rotate();

        // 关键逻辑分支：trim vs crop（重载签名保证配对，in 守卫再收窄）
        if (action === 'trim') {
            if (!('threshold' in config)) {
                return { status: 'error', file: filePath, reason: 'trim 配置缺少 threshold。' };
            }
            const trimCfg = config;

            // --- 智能边向选择探底方案 ---
            // 隐式测试：仅在内存中执行全方位 Trim 看能切出什么边界
            // 探测必须与最终流水线同样先 rotate()，否则 trimOffset 基于未摆正坐标系，extract 会整体错位
            // 探测只要边界信息：raw() 输出的 info 同样带 trimOffsetLeft/Top 与裁后宽高，
            // 省掉一次全图编码往返，避免大图批量处理时的 CPU 与内存峰值翻倍（见缺陷 4）
            const { info: probeInfo } = await sharp(filePath)
                .rotate()
                .trim({ threshold: trimCfg.threshold })
                .raw()
                .toBuffer({ resolveWithObject: true });

            // 仅当确实发生切除行为（尺寸变化）才进入后续运算，否则按原图保存
            if (probeInfo.width !== originalW || probeInfo.height !== originalH) {
                // 解析出系统探测认为应当剔除的四个方位像素量
                // trimOffsetLeft / trimOffsetTop 是被裁切后剩余图像相对于原图左上角的偏移，本质上就是左边和上边被切掉的像素数
                const cutLeft = -(probeInfo.trimOffsetLeft || 0);
                const cutTop = -(probeInfo.trimOffsetTop || 0);

                // 右边的切去量 = 原宽度 - cutLeft - 裁切后的结果新宽度
                const cutRight = originalW - cutLeft - probeInfo.width;
                // 底部的切去量 = 原高度 - cutTop - 裁切后的结果新高度
                const cutBottom = originalH - cutTop - probeInfo.height;

                // 3. 构建我们自己的 extract 方框，决定接纳哪些边的切除建议
                const activeSides = trimCfg.sides || ['top', 'bottom', 'left', 'right'];

                const finalTop = activeSides.includes('top') ? cutTop : 0;
                const finalLeft = activeSides.includes('left') ? cutLeft : 0;
                const finalBottom = activeSides.includes('bottom') ? cutBottom : 0;
                const finalRight = activeSides.includes('right') ? cutRight : 0;

                const newWidth = originalW - finalLeft - finalRight;
                const newHeight = originalH - finalTop - finalBottom;

                if (newWidth <= 0 || newHeight <= 0) {
                    return { status: 'error', file: filePath, reason: '容差计算结果为空或越界。' };
                }

                // 过滤筛选后等价于一刀没切时直接跳过 extract
                if (newWidth !== originalW || newHeight !== originalH) {
                    sharpInstance = sharpInstance.extract({
                        left: finalLeft,
                        top: finalTop,
                        width: newWidth,
                        height: newHeight
                    });
                }
            }
        } else {
            if (!('top' in config)) {
                return { status: 'error', file: filePath, reason: 'crop 配置缺少边距。' };
            }
            const cropCfg = config;
            // 复用已读元数据，防止切除过度报错
            const newWidth = originalW - cropCfg.left - cropCfg.right;
            const newHeight = originalH - cropCfg.top - cropCfg.bottom;

            if (newWidth <= 0 || newHeight <= 0) {
                return { status: 'error', file: filePath, reason: '裁剪范围大于原图尺寸，将导致图像消失！' };
            }

            sharpInstance = sharpInstance.extract({
                left: cropCfg.left,
                top: cropCfg.top,
                width: newWidth,
                height: newHeight
            });
        }

        // O_EXCL 独占占位命名：全部参数校验通过后才建占位，早退路径无残留
        // 建目录同样在 try 内：目录不可写/路径过长/磁盘满时按 OpResult 报错，不让 reject 逃出契约（见缺陷 3）
        await ensureDir(outDir);
        outputPath = await allocateFilePath(outDir, name, actualExt);
        // 统一编码后落盘（未知扩展原样透传）
        sharpInstance = applyEncoding(sharpInstance, actualExt);

        await sharpInstance.toFile(outputPath);
        return { status: 'success', file: filePath };
    } catch (err: unknown) {
        // 占位由本进程独占创建：失败时删同路径幽灵空文件，不碰目录；早退前无占位则跳过
        if (outputPath) await fsp.unlink(outputPath).catch(() => {});
        let errMsg = '未知错误';
        if (err instanceof Error) {
            errMsg = err.message;
        }
        return { status: 'error', file: filePath, reason: errMsg };
    }
}
