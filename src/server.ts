import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { splitImage } from './split';
import { exec } from 'child_process';

const startTime = Date.now();
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../ui')));

// 读取默认通过 CLI 传入的路径参数
const defaultImagePath = process.argv[2] ? path.resolve(process.argv[2]) : '';

app.get('/api/default-image', (req, res) => {
    res.json({ path: defaultImagePath });
});

app.get('/api/load-image', (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) {
        return res.status(400).send('No path provided');
    }
    const absolutePath = path.resolve(filePath);
    if (fs.existsSync(absolutePath)) {
        res.sendFile(absolutePath);
    } else {
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
        const result = await splitImage(filePath, {
            rows: 0,
            cols: 0,
            cutX,
            cutY
        });
        if (result.status === 'success') {
            res.json({ success: true, message: '切图完成！', files: result.generatedFiles });
        } else {
            res.status(500).json({ success: false, error: result.reason });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: String(e) });
    }
});

// --- 超时自动关机机制 ---
// 如果启动后超过 15 秒没有任何前端请求，或者距离最后一次访问超过 5 分钟，自动退出进程
let lastActiveTime = Date.now();
const IDLE_TIMEOUT = 5 * 60 * 1000; 

app.use((req, res, next) => {
    // 每次收到任意前端请求，刷新活跃时间
    lastActiveTime = Date.now();
    next();
});

setInterval(() => {
    if (Date.now() - lastActiveTime > IDLE_TIMEOUT) {
        console.log('💤 长时间无页面交互，服务端自动进入休眠并退出...');
        process.exit(0);
    }
}, 30000);

// 前端心跳或主动关闭服务的接口
app.post('/api/exit', (req, res) => {
    res.json({ success: true });
    console.log('收到前端关闭指令，正在退出服务并关闭控制台窗口...');
    setTimeout(() => {
        process.exit(0);
    }, 500);
});

// 寻找可用端口
const startServer = (port: number) => {
    const server = app.listen(port);

    server.on('listening', async () => {
        const startupTime = Date.now() - startTime;
        console.log(`🔌 智能切图服务已启动 (端口: ${port})`);
        console.log(`⏱️ 服务器启动耗时: ${startupTime}ms`);
        
        const url = `http://localhost:${port}`;
        try {
            const startCmd =
                process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
            exec(`${startCmd} ${url}`);
        } catch {
            // fail silently
        }
    });

    server.on('error', (e: any) => {
        if (e.code === 'EADDRINUSE') {
            console.log(`端口 ${port} 被占用，尝试端口 ${port + 1}...`);
            // 彻底关闭当前尝试失败的 server 实例
            server.close();
            startServer(port + 1);
        } else {
            console.error(e);
        }
    });
};

startServer(PORT);
