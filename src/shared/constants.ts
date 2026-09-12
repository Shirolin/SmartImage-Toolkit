// 全局常量：批处理与服务端计时统一取值
export const BATCH_SIZE = 5;
export const TRIM_THRESHOLD_DEFAULT = 10;
export const SPLIT_TRIM_THRESHOLD = 40;
export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
export const IDLE_CHECK_MS = 30000;
export const HEARTBEAT_MS = 60000;
// 切图总数上限：(cutX.length-1)*(cutY.length-1) 超限时路由直接 400，防止超大任务拖垮服务
export const MAX_TILES = 500;
// 退出前的收尾宽限：进程退出必须等正在写盘的切图任务跑完，否则输出目录会留下截断的切片
export const EXIT_GRACE_MS = 5000;
