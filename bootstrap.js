const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const libServerPath = path.join(__dirname, 'lib', 'server.js');
const srcServerPath = path.join(__dirname, 'src', 'server.ts');

// 命令行参数以数组原样透传：子进程不经过 shell 解析，含空格路径也无需手工加引号
const args = process.argv.slice(2);

function printHelp() {
    console.log('');
    console.log('用法: node bootstrap.js [图片路径] [选项]');
    console.log('');
    console.log('  不带参数启动本地切图服务（优先使用 lib/ 下的编译产物）；');
    console.log('  --help, -h  显示本帮助并退出。');
    console.log('');
}

async function pathExists(p) {
    try {
        await fs.promises.access(p);
        return true;
    } catch {
        return false;
    }
}

async function main() {
    if (args.includes('--help') || args.includes('-h')) {
        printHelp();
        return;
    }

    let cmd;
    let scriptArgs;
    if (await pathExists(libServerPath)) {
        console.log('⚡ [启动器] 使用已编译产物极速启动...');
        // 用当前进程的 node 起子进程：若写死 'node'，子进程会重新按 PATH 解析，
        // 可能落到另一个（例如第三方工具自带的过老）运行时上，与父进程不一致。
        cmd = process.execPath;
        scriptArgs = [libServerPath, ...args];
    } else if (await pathExists(srcServerPath)) {
        // 开发模式需要 node_modules 中的 ts-node；缺失时会由子进程报错，此处先给明确提示
        console.log('🛠️ [启动器] 未检测到编译产物，使用 ts-node 开发模式启动（需已安装开发依赖）...');
        // 与上面的 lib 分支同理：直接用当前运行时执行本地 ts-node 入口。
        // 写成 'npx' 配 shell:false 在 Windows 上必然 ENOENT（npx 只有 .cmd 垫片，CreateProcess 不认 PATHEXT）
        cmd = process.execPath;
        try {
            scriptArgs = [require.resolve('ts-node/dist/bin.js'), '--transpile-only', srcServerPath, ...args];
        } catch {
            console.error('❌ [启动器] 找不到 ts-node：请先执行 npm install（含 devDependencies）或 npm run build。');
            process['exitCode'] = 1;
            return;
        }
    } else {
        console.error(
            '❌ [启动器] 找不到可启动的服务端：lib/server.js 与 src/server.ts 均不存在，请先确认仓库完整或执行构建。'
        );
        process['exitCode'] = 1;
        return;
    }

    const child = spawn(cmd, scriptArgs, {
        stdio: 'inherit',
        shell: false
    });

    child.on('exit', (code) => {
        process['exitCode'] = code === null ? 1 : code;
    });
    child.on('error', (err) => {
        console.error(`❌ [启动器] 无法启动 ${cmd}：${err.message}`);
        process['exitCode'] = 1;
    });
}

main().catch((err) => {
    console.error(`❌ [启动器] 启动失败：${err && err.message ? err.message : err}`);
    process['exitCode'] = 1;
});
