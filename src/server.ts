import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { splitImage } from './split';
import { processCenter } from './center';
import { exec } from 'child_process';

const startTime = Date.now();
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// --- 超时自动关机机制 ---
let lastActiveTime = Date.now();
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 分钟闲置超时

app.use((req, res, next) => {
    // 每次收到任意前端请求（包括静态资源、API、心跳），刷新活跃时间
    lastActiveTime = Date.now();
    next();
});

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
    const { filePath: rawPath, cutX, cutY, smartCenter, centerConfig } = req.body;

    if (!rawPath || !cutX || !cutY) {
        return res.status(400).json({ success: false, error: '缺少必要参数' });
    }

    const filePath = path.resolve(rawPath);

    try {
        // 1. 执行切割
        const result = await splitImage(filePath, {
            rows: 0,
            cols: 0,
            cutX,
            cutY
        });

        if (result.status === 'success') {
            // 2. 如果开启了智能居中，对所有切片进行后处理
            if (smartCenter) {
                console.log(`✨ 正在对 ${result.generatedFiles?.length} 张切片执行智能居中...`);
                // 使用前端传来的配置，如果不存在则回退至安全默认值
                const finalConfig = centerConfig || {
                    threshold: 10,
                    fillColor: 'transparent',
                    outputFormat: 'original'
                };

                for (const file of result.generatedFiles || []) {
                    const formatExt = finalConfig.outputFormat === 'original' ? null : `.${finalConfig.outputFormat}`;
                    await processCenter(file, finalConfig, formatExt);
                }
            }
            res.json({ success: true, message: '切图完成！', files: result.generatedFiles });
        } else {
            res.status(500).json({ success: false, error: result.reason });
        }
    } catch (e) {
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

    // 在 Windows 上通过 chcp 65001 强制切换子进程代码页为 UTF-8
    const cmd = `chcp 65001 >nul && powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`;

    console.log('正在执行文件对话框指令 (UTF-8)...');
    exec(cmd, { encoding: 'utf8' }, (error, stdout) => {
        if (error) {
            console.error('PowerShell 运行错误:', error.message);
            return res.status(500).json({ success: false, error: '无法调起文件搜索器' });
        }
        const filePath = stdout.trim();
        console.log('获取到的文件路径:', filePath);
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
