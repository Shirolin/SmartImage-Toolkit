import express from 'express';
import cors from 'cors';
import path from 'path';
import { promises as fsp } from 'fs';
import { execFile } from 'child_process';
import { splitImage } from './split';
import { processCenter } from './center';
import { SUPPORTED_EXTS } from './utils';
import { resolveImageExt } from './shared/formats';
import { IDLE_TIMEOUT_MS, IDLE_CHECK_MS, MAX_TILES } from './shared/constants';
import type { SplitResult } from './shared/results';

// 第一性原理：本地服务默认只信任本机回环，且文件读与命令执行都走“白名单 + 数组传参”，
// 不给字符串拼接留任何注入面。

const startTime = Date.now();
const app = express();
const PORT = 3000;

// CORS 收紧：只允许本机回环页访问，杜绝局域网/外网页面跨站调用本地服务
app.use(cors({ origin: /^http:\/\/localhost(:\d+)?$/ }));
app.use(express.json());

// --- 超时自动关机机制 ---
// 语义说明：lastActiveTime 只由真实任务刷新（如 /api/split-custom）。
// 心跳（/api/heartbeat）仅证明页面还开着，不刷新计时——否则开着页面就会永活，
// “闲置休眠”的设计就被架空。想要服务常驻，保持页面有真实任务即可。
let lastActiveTime = Date.now();

function touchActivity(): void {
    lastActiveTime = Date.now();
}

// 服务自身的退出点（闲置休眠 / 前端关闭指令）：集中收敛于此一处
function requestExit(code: number): never {
    process['exit'](code);
    throw new Error('退出中');
}

app.use(express.static(path.join(__dirname, '../ui')));

// 读取默认通过 CLI 传入的路径参数
const defaultImagePath = process.argv[2] ? path.resolve(process.argv[2]) : '';

/** 可读根目录：当前工作目录 + 默认图所在目录；白名单之外一律拒绝 */
function getAllowedRoots(): string[] {
    const roots = [process.cwd()];
    if (defaultImagePath) roots.push(path.dirname(defaultImagePath));
    return roots;
}

/** 路径是否落在白名单根内（含根自身），供单测与路由共用 */
export function isPathAllowed(p: string, roots: string[]): boolean {
    const resolved = path.resolve(p);
    return roots.some((root) => {
        const base = path.resolve(root);
        return resolved === base || resolved.startsWith(base + path.sep);
    });
}

app.get('/api/default-image', (req, res) => {
    res.json({ path: defaultImagePath });
});

app.get('/api/load-image', (req, res) => {
    const filePath = req.query.path;
    if (typeof filePath !== 'string' || !filePath) {
        return res.status(400).send('No path provided');
    }
    const absolutePath = path.resolve(filePath);
    if (!isPathAllowed(absolutePath, getAllowedRoots())) {
        return res.status(403).send('Forbidden');
    }
    if (!SUPPORTED_EXTS.includes(path.extname(absolutePath).toLowerCase())) {
        return res.status(400).send('Unsupported file type');
    }
    // 异步存在性探测：不阻塞事件循环，高并发下不卡主线程
    fsp.access(absolutePath)
        .then(() => {
            res.sendFile(absolutePath);
        })
        .catch(() => {
            res.status(404).send('File not found');
        });
});

/** 切分线守卫：数组、长度 2..100、全为非负整数（须为整数）、严格递增 */
export function isValidCutArray(value: unknown): value is number[] {
    if (!Array.isArray(value)) return false;
    if (value.length < 2 || value.length > 100) return false;
    for (const item of value) {
        if (typeof item !== 'number' || !Number.isFinite(item) || !Number.isInteger(item) || item < 0) return false;
    }
    for (let i = 1; i < value.length; i++) {
        if (value[i] <= value[i - 1]) return false;
    }
    return true;
}

/** 切片总数：(cutX.length-1)*(cutY.length-1)，供路由上限守卫与单测共用 */
export function countSplitTiles(cutX: number[], cutY: number[]): number {
    return (cutX.length - 1) * (cutY.length - 1);
}

/** split-custom 成功回包拼装：failedTiles 与 SplitResult 同形，无失败时为空数组 */
export function buildSplitCustomSuccess(result: SplitResult): {
    success: true;
    message: string;
    files: string[];
    artifacts: string[];
    failedTiles: Array<{ row: number; col: number; reason: string }>;
} {
    return {
        success: true,
        message: '切图完成！',
        files: result.generatedFiles,
        artifacts: result.artifacts ?? [],
        failedTiles: result.failedTiles ?? []
    };
}

const CENTER_SIDES = new Set(['top', 'bottom', 'left', 'right']);
const CENTER_FORMATS = new Set(['original', 'webp', 'png', 'mozjpeg']);

/** centerConfig 白名单校验：缺省放行，只校验出现的字段 */
export function isValidCenterConfig(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value !== 'object') return false;
    const cfg = value as Record<string, unknown>;
    if ('threshold' in cfg) {
        const t = cfg['threshold'];
        if (typeof t !== 'number' || !Number.isFinite(t) || t < 1 || t > 100) return false;
    }
    if ('fillColor' in cfg) {
        const f = cfg['fillColor'];
        if (typeof f !== 'string') return false;
        if (f !== 'transparent' && !/^#[0-9a-fA-F]{6}$/.test(f)) return false;
    }
    if ('outputFormat' in cfg) {
        const o = cfg['outputFormat'];
        if (typeof o !== 'string' || !CENTER_FORMATS.has(o)) return false;
    }
    if ('sides' in cfg && cfg['sides'] !== undefined) {
        const s = cfg['sides'];
        if (!Array.isArray(s)) return false;
        for (const side of s) {
            if (typeof side !== 'string' || !CENTER_SIDES.has(side)) return false;
        }
    }
    return true;
}

app.post('/api/split-custom', (req, res) => {
    const rawBody: unknown = req.body;
    const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as Record<string, unknown>;
    const { filePath: rawPath, cutX, cutY, smartCenter, centerConfig } = body;

    if (typeof rawPath !== 'string' || !rawPath) {
        return res.status(400).json({ success: false, error: '缺少必要参数' });
    }
    if (!isValidCutArray(cutX) || !isValidCutArray(cutY)) {
        return res.status(400).json({ success: false, error: '切分线参数非法：须为 2..100 个严格递增的非负整数' });
    }
    if (countSplitTiles(cutX, cutY) > MAX_TILES) {
        return res.status(400).json({ success: false, error: `切片总数超限：最多 ${MAX_TILES} 张` });
    }
    if (!isValidCenterConfig(centerConfig)) {
        return res.status(400).json({ success: false, error: '居中配置参数非法' });
    }

    const filePath = path.resolve(rawPath);
    if (!isPathAllowed(filePath, getAllowedRoots())) {
        return res.status(403).json({ success: false, error: '路径不在允许范围内' });
    }
    if (!SUPPORTED_EXTS.includes(path.extname(filePath).toLowerCase())) {
        return res.status(400).json({ success: false, error: '仅支持图片文件' });
    }

    // 真实任务：守卫全部通过后才刷新闲置计时（心跳不刷新，见顶部语义说明）
    touchActivity();

    splitImage(filePath, { rows: 0, cols: 0, cutX, cutY })
        .then((result) => {
            if (result.status !== 'success') {
                res.status(500).json({ success: false, error: result.reason });
                return;
            }
            // 2. 如果开启了智能居中，对所有切片进行后处理
            const runCenter = async (): Promise<void> => {
                if (smartCenter) {
                    console.log(`✨ 正在对 ${result.generatedFiles?.length} 张切片执行智能居中...`);
                    // 使用前端传来的配置，如果不存在则回退至安全默认值
                    const rawCfg = (typeof centerConfig === 'object' && centerConfig !== null ? centerConfig : {}) as {
                        threshold?: unknown;
                        fillColor?: unknown;
                        outputFormat?: unknown;
                    };
                    const threshold =
                        typeof rawCfg.threshold === 'number' && Number.isFinite(rawCfg.threshold)
                            ? Math.min(100, Math.max(1, Math.round(rawCfg.threshold)))
                            : 10;
                    const fillColor = typeof rawCfg.fillColor === 'string' ? rawCfg.fillColor : 'transparent';
                    type CenterOutput = 'original' | 'webp' | 'png' | 'mozjpeg';
                    const isCenterOutput = (v: unknown): v is CenterOutput =>
                        v === 'original' || v === 'webp' || v === 'png' || v === 'mozjpeg';
                    const outFormat: CenterOutput = isCenterOutput(rawCfg.outputFormat)
                        ? rawCfg.outputFormat
                        : 'original';
                    const finalConfig = { threshold, fillColor, outputFormat: outFormat };
                    // 复用共享解析：mozjpeg 落盘统一为 .jpg，不再手写点拼接
                    const formatExt =
                        finalConfig.outputFormat === 'original'
                            ? null
                            : resolveImageExt(finalConfig.outputFormat, '.jpg');

                    for (const file of result.generatedFiles || []) {
                        await processCenter(file, finalConfig, formatExt);
                    }
                }
                // files 语义=切片图（前端依赖）；排查产物经 artifacts 透出，不混入 files
                // failedTiles 与 SplitResult 同形，无失败时为空数组
                res.json(buildSplitCustomSuccess(result));
            };
            runCenter().catch((e: unknown) => {
                res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
            });
        })
        .catch((e: unknown) => {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        });
});

setInterval(() => {
    const idleTime = Date.now() - lastActiveTime;
    if (idleTime > IDLE_TIMEOUT_MS) {
        console.log(`💤 长时间运行但无页面交互（已闲置 ${Math.round(idleTime / 1000)}s），服务端自动进入休眠并退出...`);
        requestExit(0);
    }
}, IDLE_CHECK_MS);

// 前端心跳：只证明页面存活，刻意不刷新 lastActiveTime（语义见顶部注释）
app.get('/api/heartbeat', (req, res) => {
    res.json({ success: true, timestamp: Date.now() });
});

app.get('/api/open-file-dialog', (req, res) => {
    // 强制 PowerShell 使用 UTF-8 编码输出，并设置 [Console]::OutputEncoding 解决中文字符集乱码
    const psCommand = `
        $OutputEncoding = [System.Text.Encoding]::UTF8;
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
        [void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');
        $objForm = New-Object System.Windows.Forms.OpenFileDialog;
        $objForm.Filter = 'Images|*.png;*.jpg;*.jpeg;*.webp;*.gif|All Files|*.*';
        $objForm.Title = '选择图片';
        if ($objForm.ShowDialog() -eq 'OK') {
            Write-Host $objForm.FileName
        }
    `
        .replace(/\n/g, ' ')
        .trim();

    console.log('正在执行文件对话框指令 (UTF-8)...');
    // 数组传参直达进程：不经过 shell 解析，用户路径中的元字符不再有注入面
    execFile(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
        { encoding: 'utf8' },
        (error, stdout) => {
            if (error) {
                console.error('PowerShell 运行错误:', error.message);
                return res.status(500).json({ success: false, error: '无法调起文件搜索器' });
            }
            const filePath = stdout.trim();
            console.log('获取到的文件路径:', filePath);
            res.json({ success: true, path: filePath });
        }
    );
});

app.post('/api/exit', (req, res) => {
    res.json({ success: true });
    console.log('收到前端关闭指令，正在退出服务并关闭控制台窗口...');
    setTimeout(() => {
        requestExit(0);
    }, 500);
});

/** 按平台以数组参数打开浏览器：不拼字符串，不经过 shell */
function openBrowser(url: string): void {
    const opener: [string, string[]] =
        process.platform === 'win32'
            ? ['cmd', ['/c', 'start', '', url]]
            : process.platform === 'darwin'
              ? ['open', [url]]
              : ['xdg-open', [url]];
    execFile(opener[0], opener[1], (error) => {
        if (error) {
            console.error('自动打开浏览器失败:', error.message);
        }
    });
}

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
    return e instanceof Error && 'code' in e;
}

// 寻找可用端口
const startServer = (port: number): void => {
    const server = app.listen(port);

    server.on('listening', () => {
        const startupTime = Date.now() - startTime;
        console.log(`🔌 智能切图服务已启动 (端口: ${port})`);
        console.log(`⏱️ 服务器启动耗时: ${startupTime}ms`);

        const url = `http://localhost:${port}`;
        openBrowser(url);
    });

    server.on('error', (e: unknown) => {
        if (isErrnoException(e) && e.code === 'EADDRINUSE') {
            console.log(`端口 ${port} 被占用，尝试端口 ${port + 1}...`);
            // 彻底关闭当前尝试失败的 server 实例
            server.close();
            startServer(port + 1);
        } else {
            console.error(e);
        }
    });
};

// 直接运行时才监听端口；被单测 import 时只导出守卫与 app，不产生副作用
if (require.main === module) {
    startServer(PORT);
}

export default app;
