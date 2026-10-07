import { splitImage } from '../split';
import { PathSandbox, validateSplitCustomBody, buildSplitCustomSuccess, type SplitCustomSuccessPayload } from './guard';

export interface SplitExecutionOutcome {
    status: 200 | 400 | 403 | 500;
    body: SplitCustomSuccessPayload | { success: false; error: string };
}

/**
 * 切图后处理领域级编排：
 * 统摄请求体验证、网格切片、内存级智能居中单阶段流式变换与结果封包
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

    // 2. 单阶段物理网格切割与智能居中（纯内存流变换，消除二次磁盘往返）
    const result = await splitImage(filePath, {
        cutX,
        cutY,
        centerConfig: smartCenter ? centerConfig : undefined
    });

    if (result.status !== 'success') {
        return {
            status: 500,
            body: { success: false, error: result.reason || '切图执行失败' }
        };
    }

    // 3. 组装契约响应（直接复用 splitImage 在内存阶段聚合的 centerFailures）
    const payload = buildSplitCustomSuccess(result, result.centerFailures ?? []);
    return {
        status: 200,
        body: payload
    };
}
