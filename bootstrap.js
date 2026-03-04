const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const libServerPath = path.join(__dirname, 'lib', 'server.js');
const srcServerPath = path.join(__dirname, 'src', 'server.ts');

// 如果路径中含有空格，需要用双引号包裹以防由于 shell: true 被截断
const args = process.argv.slice(2).map(arg => arg.includes(' ') ? `"${arg}"` : arg);

let cmd, scriptArgs;

// 判断是否曾经 build 过，或者是否处于 dist 发行版目录中
if (fs.existsSync(libServerPath)) {
    console.log('⚡ [启动器] 使用已编译产物极速启动...');
    cmd = 'node';
    scriptArgs = [libServerPath, ...args];
} else {
    console.log('🛠️ [启动器] 未检测到 build，使用 ts-node 开发模式启动...');
    cmd = 'npx';
    // 修复：不要把 ts-node 和 --transpile-only 放进同一个参数字符串中
    scriptArgs = ['ts-node', '--transpile-only', srcServerPath, ...args];
}

const child = spawn(cmd, scriptArgs, {
    stdio: 'inherit',
    shell: true
});

child.on('exit', code => process.exit(code));
