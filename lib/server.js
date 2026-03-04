"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const split_1 = require("./split");
const child_process_1 = require("child_process");
const startTime = Date.now();
const app = (0, express_1.default)();
const PORT = 3000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// --- 超时自动关机机制 ---
let lastActiveTime = Date.now();
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 分钟闲置超时
app.use((req, res, next) => {
    // 每次收到任意前端请求（包括静态资源、API、心跳），刷新活跃时间
    lastActiveTime = Date.now();
    next();
});
app.use(express_1.default.static(path_1.default.join(__dirname, '../ui')));
// 读取默认通过 CLI 传入的路径参数
const defaultImagePath = process.argv[2] ? path_1.default.resolve(process.argv[2]) : '';
app.get('/api/default-image', (req, res) => {
    res.json({ path: defaultImagePath });
});
app.get('/api/load-image', (req, res) => {
    const filePath = req.query.path;
    if (!filePath) {
        return res.status(400).send('No path provided');
    }
    const absolutePath = path_1.default.resolve(filePath);
    if (fs_1.default.existsSync(absolutePath)) {
        res.sendFile(absolutePath);
    }
    else {
        res.status(404).send('File not found');
    }
});
app.post('/api/split-custom', async (req, res) => {
    const { filePath, cutX, cutY } = req.body;
    if (!filePath || !cutX || !cutY) {
        return res.status(400).json({ success: false, error: '缺少必要参数' });
    }
    try {
        // 调用核心切图库，提供自定义坐标范围
        const result = await (0, split_1.splitImage)(filePath, {
            rows: 0,
            cols: 0,
            cutX,
            cutY
        });
        if (result.status === 'success') {
            res.json({ success: true, message: '切图完成！', files: result.generatedFiles });
        }
        else {
            res.status(500).json({ success: false, error: result.reason });
        }
    }
    catch (e) {
        res.status(500).json({ success: false, error: String(e) });
    }
});
setInterval(() => {
    const idleTime = Date.now() - lastActiveTime;
    if (idleTime > IDLE_TIMEOUT) {
        console.log(`💤 长时间运行但无页面交互（已闲置 ${Math.round(idleTime / 1000)}s），服务端自动进入休眠并退出...`);
        process.exit(0);
    }
}, 30000);
// 前端心跳或主动关闭服务的接口
app.get('/api/heartbeat', (req, res) => {
    res.json({ success: true, timestamp: Date.now() });
});
app.get('/api/open-file-dialog', (req, res) => {
    // 性能优化：使用 -NoProfile 减少初始加载，并精简 PS 指令
    const cmd = `powershell -NoProfile -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'Images|*.png;*.jpg;*.jpeg;*.webp;*.gif'; if($f.ShowDialog() -eq 'OK') { $f.FileName }"`;
    (0, child_process_1.exec)(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error('PowerShell 错误:', stderr);
            return res.status(500).json({ success: false, error: '无法启动文件搜索器' });
        }
        const filePath = stdout.trim();
        res.json({ success: true, path: filePath });
    });
});
app.post('/api/exit', (req, res) => {
    res.json({ success: true });
    console.log('收到前端关闭指令，正在退出服务并关闭控制台窗口...');
    setTimeout(() => {
        process.exit(0);
    }, 500);
});
// 寻找可用端口
const startServer = (port) => {
    const server = app.listen(port);
    server.on('listening', async () => {
        const startupTime = Date.now() - startTime;
        console.log(`🔌 智能切图服务已启动 (端口: ${port})`);
        console.log(`⏱️ 服务器启动耗时: ${startupTime}ms`);
        const url = `http://localhost:${port}`;
        try {
            const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
            (0, child_process_1.exec)(`${startCmd} ${url}`);
        }
        catch {
            // fail silently
        }
    });
    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log(`端口 ${port} 被占用，尝试端口 ${port + 1}...`);
            // 彻底关闭当前尝试失败的 server 实例
            server.close();
            startServer(port + 1);
        }
        else {
            console.error(e);
        }
    });
};
startServer(PORT);
