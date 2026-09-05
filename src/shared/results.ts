// 通用操作结果：各引擎统一使用，旧名在各自模块 re-export 兼容
export interface OpResult {
    status: 'success' | 'error' | 'skipped';
    file: string;
    reason?: string;
}

// 切片结果：附带生成文件与失败瓦片明细
// artifacts: 排查标尺图、split_config.json 等非切片产物，不计入 success 计数
export interface SplitResult extends OpResult {
    generatedFiles: string[];
    artifacts: string[];
    failedTiles?: Array<{ row: number; col: number; reason: string }>;
}
