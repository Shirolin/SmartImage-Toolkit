import express from 'express';
import cors from 'cors';
import path from 'path';
import { promises as fsp } from 'fs';
import { execFile } from 'child_process';
import { splitImage } from './split';
import { processCenter } from './center';
import { SUPPORTED_EXTS } from './utils';
import { resolveImageExt } from './shared/formats';
import { IDLE_TIMEOUT_MS, IDLE_CHECK_MS, MAX_TILES, EXIT_GRACE_MS } from './shared/constants';
import type { SplitResult } from './shared/results';

// 第一性原理：本地服务默认只信任本机回环，且文件读与命令执行都走“白名单 + 数组传参”，
// 不给字符串拼接留任何注入面。

const startTime = Date.now();
const app = express();
const PORT = 3000;

// CORS 头只决定浏览器能否**读取**响应，拦不住跨站的 simple request（POST /api/exit 无预检）。
// 带非本机 Origin 的请求在这里直接拒绝，避免任意网页关掉本机服务或弹文件对话框。
const LOOPBACK_ORIGIN = /^http:\/\/localhost(:\d+)?$/;
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin !== '' && !LOOPBACK_ORIGIN.test(origin)) {
        res.status(403).json({ success: false, error: 'forbidden origin' });
        return;
    }
    next();
});
app.use(cors({ origin: LOOPBACK_ORIGIN }));
app.use(express.json());

// --- 超时自动关机机制 ---
// 语义修正：调切割线、放大查看这类纯前端操作不产生任何请求；只认任务时间的话，
// 一次超过 IDLE_TIMEOUT_MS 的调线就会被判闲置并退出，整轮调整成果丢失。
// 因此心跳也算「页面仍在使用」——真正的闲置判据是「页面关掉或长时间无交互」。
let lastActiveTime = Date.now();
let lastHeartbeatAt = Date.now();

function touchActivity(): void {
    lastActiveTime = Date.now();
}

// 正在进行写盘的切图任务数：退出前必须等它归零（强杀会留下截断的切片），同时充当并发闸门
let inFlight = 0;

// 服务自身的退出点（闲置休眠 / 前端关闭指令）：集中收敛于此一处。
// 有任务在写盘时先等其收尾，最多等 EXIT_GRACE_MS 后仍强退。
function requestExit(code: number): void {
    if (inFlight > 0) {
        console.log(`⏳ 仍有 ${inFlight} 个切图任务在写盘，等待其收尾后再退出...`);
        const startedAt = Date.now();
        const waiter = setInterval(() => {
            if (inFlight === 0 || Date.now() - startedAt > EXIT_GRACE_MS) {
                clearInterval(waiter);
                process['exit'](code);
            }
        }, 200);
        return;
    }
    process['exit'](code);
}

app.use(express.static(path.join(__dirname, '../ui')));

// 读取默认通过 CLI 传入的路径参数
const defaultImagePath = process.argv[2] ? path.resolve(process.argv[2]) : '';

/** 用户通过文件对话框显式选中的目录：加入可读白名单，否则「选了桌面图片却 403」 */
const extraRoots = new Set<string>();

/** 可读根目录：当前工作目录 + 用户显式授权目录 + 默认图所在目录；白名单之外一律拒绝 */
function getAllowedRoots(): string[] {
    const roots = [process.cwd(), ...extraRoots];
    if (defaultImagePath) roots.push(path.dirname(defaultImagePath));
    return roots;
}

/** 路径是否落在白名单根内（含根自身），供单测与路由共用 */
export function isPathAllowed(p: string, roots: string[]): boolean {
    // Windows 路径大小写不敏感：从别处粘贴来的路径不应因大小写差异被拒
    const norm = (s: string): string => {
        const resolved = path.resolve(s);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const resolved = norm(p);
    return roots.some((root) => {
        const base = norm(root);
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
        // 旧文案只是一个 Forbidden，用户看不到"该先用选择图片授权我选的目录"
        return res.status(403).send('Forbidden: 该目录未授权，请先用「选择图片」打开该文件，再预览或切图');
    }
    if (!SUPPORTED_EXTS.includes(path.extname(absolutePath).toLowerCase())) {
        return res.status(400).send('Unsupported file type');
    }
    // stat 兼作存在性与类型判断：目录不能直接交给 sendFile（会落到 Express 默认错误页）
    fsp.stat(absolutePath)
        .then((st) => {
            if (!st.isFile()) {
                res.status(400).send('Not a file');
                return;
            }
            res.sendFile(absolutePath, (err) => {
                // sendFile 的失败不经过上面的 catch：必须在回调里收敛，否则用户看到 500 堆栈页
                if (!err || res.headersSent) return;
                const code = isErrnoException(err) ? err.code : undefined;
                res.status(code === 'ENOENT' ? 404 : 400).send('File not readable');
            });
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

/** split-custom 成功回包拼装：failedTiles 与 SplitResult 同形；居中失败单独回报，不发散成假成功 */
export function buildSplitCustomSuccess(
    result: SplitResult,
    centerFailures: Array<{ file: string; reason: string }> = []
): {
    success: true;
    message: string;
    files: string[];
    artifacts: string[];
    failedTiles: Array<{ row: number; col: number; reason: string }>;
    centerFailures: Array<{ file: string; reason: string }>;
} {
    return {
        success: true,
        message: centerFailures.length > 0 ? `切图完成，但有 ${centerFailures.length} 张切片居中失败` : '切图完成！',
        files: result.generatedFiles,
        artifacts: result.artifacts ?? [],
        failedTiles: result.failedTiles ?? [],
        centerFailures
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
    // 并发闸门：单个请求会把最多 MAX_TILES 张切片全量并发写盘，多开页面/多进程同时发会拖垮整机；
    // 前端的 disabled 只挡得住自己那一页
    if (inFlight > 0) {
        return res.status(429).json({ success: false, error: '已有切图任务在进行，请等待其完成' });
    }
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

    // 真实任务：守卫全部通过后才刷新闲置计时
    touchActivity();
    // 计数在真正开工时递增，在 then/catch 之后统一递减（见链尾 finally）
    inFlight += 1;

    splitImage(filePath, { rows: 0, cols: 0, cutX, cutY })
        .then((result) => {
            if (result.status !== 'success') {
                res.status(500).json({ success: false, error: result.reason });
                return;
            }
            // 2. 如果开启了智能居中，对所有切片进行后处理
            const runCenter = async (): Promise<void> => {
                // 后处理失败必须回传：丢掉返回值会让「居中全失败」也报「切图完成」
                const centerFailures: Array<{ file: string; reason: string }> = [];
                if (smartCenter) {
                    console.log(`✨ 正在对 ${result.generatedFiles?.length} 张切片执行智能居中...`);
                    // 使用前端传来的配置，如果不存在则回退至安全默认值
                    const rawCfg = (typeof centerConfig === 'object' && centerConfig !== null ? centerConfig : {}) as {
                        threshold?: unknown;
                        fillColor?: unknown;
                        outputFormat?: unknown;
                        sides?: unknown;
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
                    // sides 只在明确是数组时透传：空数组表示「一个方向都不补齐」，
                    // 不能用 || 回退，否则用户取消全部勾选会被静默还原成四边补齐
                    const sides = Array.isArray(rawCfg.sides)
                        ? rawCfg.sides.filter(
                              (s): s is 'top' | 'bottom' | 'left' | 'right' =>
                                  s === 'top' || s === 'bottom' || s === 'left' || s === 'right'
                          )
                        : undefined;
                    const finalConfig = { threshold, fillColor, outputFormat: outFormat, ...(sides ? { sides } : {}) };
                    // 复用共享解析：mozjpeg 落盘统一为 .jpg，不再手写点拼接
                    const formatExt =
                        finalConfig.outputFormat === 'original'
                            ? null
                            : resolveImageExt(finalConfig.outputFormat, '.jpg');

                    for (const file of result.generatedFiles || []) {
                        const centered = await processCenter(file, finalConfig, formatExt);
                        if (centered.status !== 'success') {
                            centerFailures.push({ file, reason: centered.reason ?? '未知错误' });
                        }
                    }
                }
                // files 语义=切片图（前端依赖）；排查产物经 artifacts 透出，不混入 files
                // failedTiles 与 SplitResult 同形；居中失败经 centerFailures 单独回报
                res.json(buildSplitCustomSuccess(result, centerFailures));
            };
            runCenter().catch((e: unknown) => {
                res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
            });
        })
        .catch((e: unknown) => {
            res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
        })
        .finally(() => {
            // 无论成功/失败/异常都要放行闸门，否则一次失败会把服务锁死
            inFlight -= 1;
        });
});

setInterval(() => {
    // 任务写盘途中不算闲置：退出会截断正在落盘的切片
    if (inFlight > 0) return;
    const idleTime = Date.now() - Math.max(lastActiveTime, lastHeartbeatAt);
    if (idleTime > IDLE_TIMEOUT_MS) {
        console.log(`💤 长时间运行但无页面交互（已闲置 ${Math.round(idleTime / 1000)}s），服务端自动进入休眠并退出...`);
        requestExit(0);
    }
}, IDLE_CHECK_MS);

// 前端心跳：证明页面仍在使用（调线、预览都不产生任务请求），据此推迟休眠
app.get('/api/heartbeat', (req, res) => {
    lastHeartbeatAt = Date.now();
    res.json({ success: true, timestamp: lastHeartbeatAt });
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
            // 用户显式选择就是授权：把该文件所在目录加入可读白名单，
            // 否则在对话框里选项目目录外的图片会被自家白名单 403 挡掉
            if (filePath) extraRoots.add(path.dirname(path.resolve(filePath)));
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
    // 绑定回环：注释承诺「只信任本机回环」，实现也要落到实处，别让局域网主机直接访问
    const server = app.listen(port, '127.0.0.1');

    server.on('listening', () => {
        const startupTime = Date.now() - startTime;
        console.log(`🔌 智能切图服务已启动 (端口: ${port})`);
        console.log(`⏱️ 服务器启动耗时: ${startupTime}ms`);

        const url = `http://localhost:${port}`;
        openBrowser(url);
    });

    server.on('error', (e: unknown) => {
        if (isErrnoException(e) && e.code === 'EADDRINUSE') {
            if (port >= PORT + 20) {
                console.error(`端口 ${PORT}-${PORT + 20} 均被占用，无法启动服务。`);
                process['exit'](1);
                return;
            }
            console.log(`端口 ${port} 被占用，尝试端口 ${port + 1}...`);
            // 彻底关闭当前尝试失败的 server 实例
            server.close();
            startServer(port + 1);
        } else {
            // EACCES 之类的致命错误不能只打印后空转：进程会既无监听也无提示地挂着
            console.error(e);
            process['exit'](1);
        }
    });
};

// 直接运行时才监听端口；被单测 import 时只导出守卫与 app，不产生副作用
if (require.main === module) {
    startServer(PORT);
}

export default app;
