const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d');
const imgPathInput = document.getElementById('imgPathInput');
const loadBtn = document.getElementById('loadBtn');
const splitBtn = document.getElementById('splitBtn');
const exitBtn = document.getElementById('exitBtn');
const statusMsg = document.getElementById('statusMsg');

let currentImage = null;
let imgWidth = 0;
let imgHeight = 0;

const lines = {
    x: [], // vertical lines (X coords)
    y: []  // horizontal lines (Y coords)
};

let draggingLine = null; // { axis: 'x'|'y', index: number }

async function init() {
    try {
        const res = await fetch('/api/default-image');
        const data = await res.json();
        if (data.path) {
            imgPathInput.value = data.path;
            loadImage(data.path);
        }
    } catch (e) {
        console.error(e);
    }
}

function showStatus(msg, type = 'success') {
    statusMsg.textContent = msg;
    statusMsg.className = `status-msg ${type}`;
    setTimeout(() => {
        if (statusMsg.textContent === msg) {
            // keep it if it's an error, maybe? No, clear it after 5s
            statusMsg.textContent = '';
        }
    }, 5000);
}

loadBtn.addEventListener('click', () => {
    const p = imgPathInput.value.trim();
    if (p) loadImage(p);
});

function loadImage(path) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        currentImage = img;
        imgWidth = img.width;
        imgHeight = img.height;

        canvas.width = imgWidth;
        canvas.height = imgHeight;

        // CSS zoom 逻辑：以保持比例显示在容器内
        const maxW = canvas.parentElement.clientWidth - 40;
        const maxH = canvas.parentElement.clientHeight - 40;
        const ratio = Math.min(maxW / imgWidth, maxH / imgHeight, 1);

        canvas.style.width = (imgWidth * ratio) + 'px';
        canvas.style.height = (imgHeight * ratio) + 'px';
        canvas.dataset.ratio = ratio; // 存储缩放比

        // 默认初始化边界线
        lines.x = [0, imgWidth];
        lines.y = [0, imgHeight];

        splitBtn.disabled = false;
        draw();
        showStatus('加载成功!');
    };
    img.onerror = () => {
        showStatus('加载失败，找不到图片或跨域错误', 'error');
    };
    // 为了防止浏览器缓存影响开发测试，加上时间戳
    img.src = '/api/load-image?path=' + encodeURIComponent(path) + '&_t=' + Date.now();
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const ratio = parseFloat(canvas.dataset.ratio || 1);

    return {
        x: Math.round((e.clientX - rect.left) / ratio),
        y: Math.round((e.clientY - rect.top) / ratio)
    };
}

const HIT_TOLERANCE = 10;

canvas.addEventListener('mousedown', (e) => {
    if (!currentImage) return;
    const pos = getMousePos(e);
    const ratio = parseFloat(canvas.dataset.ratio || 1);
    const snapT = HIT_TOLERANCE / ratio;

    // Check hit on existing lines (ignore 0 and last index which are boundaries)
    for (let i = 1; i < lines.x.length - 1; i++) {
        if (Math.abs(pos.x - lines.x[i]) <= snapT) {
            draggingLine = { axis: 'x', index: i };
            return;
        }
    }
    for (let i = 1; i < lines.y.length - 1; i++) {
        if (Math.abs(pos.y - lines.y[i]) <= snapT) {
            draggingLine = { axis: 'y', index: i };
            return;
        }
    }

    // Add new line
    if (e.altKey) {
        lines.y.push(pos.y);
        lines.y.sort((a, b) => a - b);
    } else {
        lines.x.push(pos.x);
        lines.x.sort((a, b) => a - b);
    }
    draw();
});

canvas.addEventListener('mousemove', (e) => {
    if (!currentImage) return;
    const pos = getMousePos(e);

    if (draggingLine) {
        lines[draggingLine.axis][draggingLine.index] = draggingLine.axis === 'x' ? pos.x : pos.y;
        if (lines[draggingLine.axis][draggingLine.index] < 0) lines[draggingLine.axis][draggingLine.index] = 0;
        const max = draggingLine.axis === 'x' ? imgWidth : imgHeight;
        if (lines[draggingLine.axis][draggingLine.index] > max) lines[draggingLine.axis][draggingLine.index] = max;
        lines[draggingLine.axis].sort((a, b) => a - b);
        draw();
    } else {
        const ratio = parseFloat(canvas.dataset.ratio || 1);
        const snapT = HIT_TOLERANCE / ratio;
        let hovered = false;
        for (let i = 1; i < lines.x.length - 1; i++) {
            if (Math.abs(pos.x - lines.x[i]) <= snapT) { hovered = true; canvas.style.cursor = 'col-resize'; break; }
        }
        for (let i = 1; i < lines.y.length - 1 && !hovered; i++) {
            if (Math.abs(pos.y - lines.y[i]) <= snapT) { hovered = true; canvas.style.cursor = 'row-resize'; break; }
        }
        if (!hovered) canvas.style.cursor = 'crosshair';
    }
});

canvas.addEventListener('mouseup', () => {
    draggingLine = null;
});

canvas.addEventListener('dblclick', (e) => {
    if (!currentImage) return;
    const pos = getMousePos(e);
    const ratio = parseFloat(canvas.dataset.ratio || 1);
    const snapT = HIT_TOLERANCE / ratio;

    for (let i = 1; i < lines.x.length - 1; i++) {
        if (Math.abs(pos.x - lines.x[i]) <= snapT) {
            lines.x.splice(i, 1);
            draw();
            return;
        }
    }
    for (let i = 1; i < lines.y.length - 1; i++) {
        if (Math.abs(pos.y - lines.y[i]) <= snapT) {
            lines.y.splice(i, 1);
            draw();
            return;
        }
    }
});

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (currentImage) {
        // 暗化背景图
        ctx.globalAlpha = 0.6;
        ctx.drawImage(currentImage, 0, 0);
        ctx.globalAlpha = 1.0;

        const ratio = parseFloat(canvas.dataset.ratio || 1);
        const visualWidth = 2 / ratio;

        // 画垂线
        lines.x.forEach((xPos, idx) => {
            if (idx === 0 || idx === lines.x.length - 1) return;
            ctx.beginPath();
            ctx.moveTo(xPos, 0);
            ctx.lineTo(xPos, imgHeight);
            ctx.strokeStyle = '#00e5ff'; // 霓虹青色
            ctx.lineWidth = visualWidth;
            ctx.setLineDash([10 / ratio, 10 / ratio]);
            ctx.stroke();

            // 可以加个小光晕
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#00e5ff';
            ctx.stroke();
            ctx.shadowBlur = 0;
        });

        // 画水平线
        lines.y.forEach((yPos, idx) => {
            if (idx === 0 || idx === lines.y.length - 1) return;
            ctx.beginPath();
            ctx.moveTo(0, yPos);
            ctx.lineTo(imgWidth, yPos);
            ctx.strokeStyle = '#ff2a6d'; // 霓虹粉红
            ctx.lineWidth = visualWidth;
            ctx.setLineDash([10 / ratio, 10 / ratio]);
            ctx.stroke();

            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ff2a6d';
            ctx.stroke();
            ctx.shadowBlur = 0;
        });
        ctx.setLineDash([]);
    }
}

splitBtn.addEventListener('click', async () => {
    if (!currentImage) return;
    splitBtn.disabled = true;
    showStatus('正在执行图像处理，请稍候...', 'success');

    try {
        const res = await fetch('/api/split-custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filePath: imgPathInput.value.trim(),
                cutX: lines.x,
                cutY: lines.y
            })
        });
        const data = await res.json();

        if (data.success) {
            showStatus('✨ 切割成功！产物已输出到与原图同级的目录下。', 'success');
        } else {
            showStatus('❌ 错误: ' + data.error, 'error');
        }
    } catch (e) {
        showStatus('请求失败: ' + e.message, 'error');
    } finally {
        splitBtn.disabled = false;
    }
});

exitBtn.addEventListener('click', async () => {
    try {
        await fetch('/api/exit', { method: 'POST' });
        showStatus('服务已关闭，您可以安全关闭此窗口。', 'success');
        // 尝试关闭浏览器标签页 (有时会因为安全策略被浏览器拦截，所以需要上面的文案提示)
        window.close();
    } catch (e) {
        showStatus('无法联系服务，可能已经关闭。', 'error');
    }
});

// 监听浏览器窗口关闭，利用 sendBeacon 确保后台进程同步自毁
window.addEventListener('beforeunload', () => {
    navigator.sendBeacon('/api/exit');
});

// Window resize时重绘画布适应
window.addEventListener('resize', () => {
    if (currentImage) {
        const maxW = canvas.parentElement.clientWidth - 40;
        const maxH = canvas.parentElement.clientHeight - 40;
        const ratio = Math.min(maxW / imgWidth, maxH / imgHeight, 1);
        canvas.style.width = (imgWidth * ratio) + 'px';
        canvas.style.height = (imgHeight * ratio) + 'px';
        canvas.dataset.ratio = ratio;
        draw();
    }
});

init();
