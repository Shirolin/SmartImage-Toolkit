import { splitImage } from '../split';
import { processCenter } from '../center';
import { executeBatch } from '../shared/pipeline';
import type { CenterConfig } from '../cli';
import { resolveImageExt } from '../shared/formats';
import { PathSandbox, validateSplitCustomBody, buildSplitCustomSuccess, type SplitCustomSuccessPayload } from './guard';

export interface SplitExecutionOutcome {
    status: 200 | 400 | 403 | 500;
    body: SplitCustomSuccessPayload | { success: false; error: string };
}

/**
 * 切图后处理领域级编排：
 * 统摄请求体验证、网格切片、受控并发居中批处理、双阶段失败归集与结果封包
 */
export async function executeSplitCustom(rawBody: unknown, sandbox: PathSandbox): Promise<SplitExecutionOutcome> {
    // 1. 跨接缝防御性验证
    const validation = validateSplitCustomBody(rawBody, sandbox);
    if (!validation.ok) {
        return {
            status: validation.status,
            body: { success: false, error: validation.error }
        };
    }

    const { filePath, cutX, cutY, smartCenter, centerConfig } = validation.params;

    // 2. 底层物理网格切割
    const result = await splitImage(filePath, { rows: 0, cols: 0, cutX, cutY });
    if (result.status !== 'success') {
        return {
            status: 500,
            body: { success: false, error: result.reason || '切图执行失败' }
        };
    }

    // 3. 若开启智能居中，对成功生成的切片进行受控并发后处理 (BATCH_SIZE = 4)
    const centerFailures: Array<{ file: string; reason: string }> = [];
    const generatedFiles = result.generatedFiles ?? [];

    if (smartCenter && generatedFiles.length > 0) {
        console.log(`✨ 正在对 ${generatedFiles.length} 张切片执行智能居中...`);
        const centerConfigObj: CenterConfig = {
            threshold: centerConfig?.threshold ?? 10,
            fillColor: centerConfig?.fillColor ?? 'transparent',
            outputFormat: centerConfig?.outputFormat ?? 'original',
            sides: centerConfig?.sides ?? ['top', 'bottom', 'left', 'right']
        };

        const outFormat = centerConfigObj.outputFormat;
        const formatExt = !outFormat || outFormat === 'original' ? null : resolveImageExt(outFormat, '.jpg');

        const centerBatchResults = await executeBatch(generatedFiles, processCenter, centerConfigObj, formatExt, {
            batchSize: 4
        });

        for (const item of centerBatchResults) {
            if (item.status === 'error') {
                centerFailures.push({
                    file: item.file,
                    reason: item.reason || '未知错误'
                });
            }
        }

        if (centerFailures.length > 0) {
            console.warn(`⚠️ 智能居中部分失败 (${centerFailures.length} 张):`, centerFailures);
        } else {
            console.log(`✨ 全部 ${generatedFiles.length} 张切片智能居中完成`);
        }
    }

    // 4. 组装契约响应
    const payload = buildSplitCustomSuccess(result, centerFailures);
    return {
        status: 200,
        body: payload
    };
}
