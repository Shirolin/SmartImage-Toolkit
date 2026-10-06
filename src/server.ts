import express from 'express';
import cors from 'cors';
import path from 'path';
import { promises as fsp } from 'fs';
import { execFile } from 'child_process';
import { SUPPORTED_EXTS } from './utils';
import { IDLE_TIMEOUT_MS, IDLE_CHECK_MS, EXIT_GRACE_MS } from './shared/constants';
import { PathSandbox } from './server/guard';
import { executeSplitCustom } from './server/split-custom';

// 第一性原理：本地服务默认只信任本机回环，且文件读与命令执行都走“白名单 + 数组传参”，
// 不给字符串拼接留任何注入面。

const startTime = Date.now();
const app = express();
const PORT = 3000;

// CORS 头只决定浏览器能否**读取**响应，拦不住跨站的 simple request（POST /api/exit 无预检）。
// 带非本机 Origin 的请求在这里直接拒绝，避免任意网页关掉本机服务或弹文件对话框。
// 回环有 localhost / 127.0.0.1 / [::1] 三种写法，缺一个就会让用另一写法打开的页面 403
// （前端 <img crossOrigin="anonymous"> 会带 Origin，踩中即「加载失败」）。
const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
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
const sandbox = new PathSandbox(defaultImagePath);

app.get('/api/default-image', (req, res) => {
    res.json({ path: defaultImagePath });
});

app.get('/api/load-image', (req, res) => {
    const filePath = req.query.path;
    if (typeof filePath !== 'string' || !filePath) {
        return res.status(400).send('No path provided');
    }
    const absolutePath = path.resolve(filePath);
    if (!sandbox.isAllowed(absolutePath)) {
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

app.post('/api/split-custom', async (req, res) => {
    // 并发闸门：单个请求会把最多 MAX_TILES 张切片全量并发写盘，多开页面/多进程同时发会拖垮整机；
    // 前端的 disabled 只挡得住自己那一页
    if (inFlight > 0) {
        return res.status(429).json({ success: false, error: '已有切图任务在进行，请等待其完成' });
    }

    touchActivity();
    inFlight += 1;

    try {
        const outcome = await executeSplitCustom(req.body, sandbox);
        res.status(outcome.status).json(outcome.body);
    } catch (e: unknown) {
        res.status(500).json({ success: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
        inFlight -= 1;
    }
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
            if (filePath) sandbox.authorize(filePath);
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

// 统一向后兼容导出，单测或旧调用方直接使用
export {
    isPathAllowed,
    isValidCutArray,
    isValidCenterConfig,
    countSplitTiles,
    buildSplitCustomSuccess,
    PathSandbox
} from './server/guard';

export default app;
