const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d');
const imgPathInput = document.getElementById('imgPathInput');
const loadBtn = document.getElementById('loadBtn');
const splitBtn = document.getElementById('splitBtn');
const exitBtn = document.getElementById('exitBtn');
const statusMsg = document.getElementById('statusMsg');

// 新增工具栏元素
const zoomPercent = document.getElementById('zoomPercent');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const resetViewBtn = document.getElementById('resetViewBtn');
const canvasWrapper = document.getElementById('canvasWrapper');
const modeVerticalBtn = document.getElementById('modeVertical');
const modeHorizontalBtn = document.getElementById('modeHorizontal');
const modePanBtn = document.getElementById('modePan');

// 等分工具
const divideRowsInput = document.getElementById('divideRows');
const divideColsInput = document.getElementById('divideCols');
const applyDivideBtn = document.getElementById('applyDivideBtn');

// 放大镜
const magnifier = document.getElementById('magnifier');
const magCtx = magnifier.getContext('2d');
const MAG_SIZE = 150;
const MAG_ZOOM = 4;

let currentImage = null;
let imgWidth = 0;
let imgHeight = 0;

// 交互状态
let scale = 1;
let translateX = 0;
let translateY = 0;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;
let currentMode = 'v'; // 'v' | 'h' | 'p' (vertical, horizontal, pan)
let isSpacePressed = false;

// 吸附状态
const SNAP_THRESHOLD = 8; // 像素阈值（图片坐标空间内）
let snapIndicator = null; // { axis: 'x'|'y', value: number } 当前吸附的参考线

const lines = {
    x: [], // vertical lines (X coords)
    y: []  // horizontal lines (Y coords)
};

let draggingLine = null; // { axis: 'x'|'y', index: number }

// 分段选择器逻辑
function setMode(mode) {
    currentMode = mode;
    modeVerticalBtn.classList.toggle('active', mode === 'v');
    modeHorizontalBtn.classList.toggle('active', mode === 'h');
    modePanBtn.classList.toggle('active', mode === 'p');

    // 视觉反馈：平移模式下画布光标变为 grab
    if (mode === 'p') {
        canvas.style.cursor = 'grab';
    } else {
        canvas.style.cursor = 'crosshair';
    }
}

modeVerticalBtn.addEventListener('click', () => setMode('v'));
modeHorizontalBtn.addEventListener('click', () => setMode('h'));
modePanBtn.addEventListener('click', () => setMode('p'));

// 等分功能
applyDivideBtn.addEventListener('click', () => {
    if (!currentImage) return;
    const rows = parseInt(divideRowsInput.value) || 1;
    const cols = parseInt(divideColsInput.value) || 1;
    applyEqualDivide(rows, cols);
});

function applyEqualDivide(rows, cols) {
    // 保留边界线 (0 和 max)，重新生成中间线
    lines.x = [0, imgWidth];
    lines.y = [0, imgHeight];

    // 生成竖向等分线
    for (let i = 1; i < cols; i++) {
        lines.x.push(Math.round(imgWidth * i / cols));
    }
    // 生成横向等分线
    for (let i = 1; i < rows; i++) {
        lines.y.push(Math.round(imgHeight * i / rows));
    }

    lines.x.sort((a, b) => a - b);
    lines.y.sort((a, b) => a - b);
    draw();
    showStatus(`已等分为 ${rows} 行 × ${cols} 列 (${rows * cols} 块)`, 'success');
}

// 智能吸附
function snapToNearest(value, axis) {
    const max = axis === 'x' ? imgWidth : imgHeight;
    const otherLines = lines[axis];
    let bestTarget = null;
    let bestDist = SNAP_THRESHOLD;

    // 收集吸附目标：所有同轴线 + 边界
    const targets = [0, max];
    for (let i = 0; i < otherLines.length; i++) {
        if (otherLines[i] !== value) targets.push(otherLines[i]);
    }

    for (const t of targets) {
        const d = Math.abs(value - t);
        if (d < bestDist) {
            bestDist = d;
            bestTarget = t;
        }
    }

    if (bestTarget !== null) {
        snapIndicator = { axis, value: bestTarget };
        return bestTarget;
    }
    snapIndicator = null;
    return value;
}

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
            statusMsg.textContent = '';
        }
    }, 5000);
}

loadBtn.addEventListener('click', async () => {
    if (loadBtn.classList.contains('loading')) return;

    // 立即进入加载状态，避免 PowerShell 启动造成的“未点击”错觉
    loadBtn.classList.add('loading');
    showStatus('正在为您开启系统文件选择器...', 'success');

    try {
        const res = await fetch('/api/open-file-dialog');
        const data = await res.json();

        if (data.success && data.path) {
            imgPathInput.value = data.path;
            const absolutePath = data.path.trim();
            if (absolutePath) loadImage(absolutePath);
        }
    } catch (e) {
        const p = imgPathInput.value.trim();
        if (p) loadImage(p);
    } finally {
        // 完成或取消后立即恢复
        loadBtn.classList.remove('loading');
    }
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

        // 默认初始化边界线
        lines.x = [0, imgWidth];
        lines.y = [0, imgHeight];

        splitBtn.disabled = false;
        resetView(); // 加载后自适应
        draw();
        showStatus('加载成功!');
    };
    img.onerror = () => {
        showStatus('加载失败，找不到图片或跨域错误', 'error');
    };
    img.src = '/api/load-image?path=' + encodeURIComponent(path) + '&_t=' + Date.now();
}

// 视图控制
function updateTransform() {
    canvasWrapper.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    zoomPercent.textContent = Math.round(scale * 100) + '%';
}

function resetView() {
    if (!currentImage) return;
    const padding = 60;
    const parent = canvasWrapper.parentElement;
    const maxW = parent.clientWidth - padding;
    const maxH = parent.clientHeight - padding;

    scale = Math.min(maxW / imgWidth, maxH / imgHeight, 1);
    translateX = 0;
    translateY = 0;
    updateTransform();
}

function zoom(delta, centerX, centerY) {
    const oldScale = scale;
    const zoomStep = 1.1;
    if (delta > 0) scale *= zoomStep;
    else scale /= zoomStep;

    // 限制缩放范围
    scale = Math.max(0.1, Math.min(scale, 10));

    // 如果提供了中心点（如滚轮），则向中心缩放（可选增强，目前先实现简单缩放）
    updateTransform();
}

// 事件监听
zoomInBtn.addEventListener('click', () => zoom(1));
zoomOutBtn.addEventListener('click', () => zoom(-1));
resetViewBtn.addEventListener('click', resetView);

// 放大镜渲染
function renderMagnifier(mouseEvent, snapValue, axis) {
    if (!currentImage) return;

    // 显示放大镜
    magnifier.style.display = 'block';

    // 吸附状态反馈
    if (snapIndicator) {
        magnifier.classList.add('snapped');
    } else {
        magnifier.classList.remove('snapped');
    }

    // 计算放大镜在页面上的位置（鼠标右下偏移 20px）
    const mainContent = canvas.closest('.main-content');
    const mainRect = mainContent.getBoundingClientRect();
    const offset = 20;
    let magX = mouseEvent.clientX - mainRect.left + offset;
    let magY = mouseEvent.clientY - mainRect.top + offset;

    // 边缘自动翻转
    if (magX + MAG_SIZE + 10 > mainRect.width) magX = mouseEvent.clientX - mainRect.left - MAG_SIZE - offset;
    if (magY + MAG_SIZE + 10 > mainRect.height) magY = mouseEvent.clientY - mainRect.top - MAG_SIZE - offset;
    if (magX < 0) magX = offset;
    if (magY < 0) magY = offset;

    magnifier.style.left = magX + 'px';
    magnifier.style.top = magY + 'px';

    // 计算原图上的中心坐标
    const pos = getMousePos(mouseEvent);
    const cx = axis === 'x' ? snapValue : pos.x;
    const cy = axis === 'y' ? snapValue : pos.y;

    // 从原图裁剪区域（MAG_SIZE / MAG_ZOOM 像素的方块）
    const srcSize = MAG_SIZE / MAG_ZOOM;
    const sx = cx - srcSize / 2;
    const sy = cy - srcSize / 2;

    // 清除并绘制放大图像
    magCtx.clearRect(0, 0, MAG_SIZE, MAG_SIZE);
    magCtx.imageSmoothingEnabled = false; // 像素级清晰
    magCtx.drawImage(
        currentImage,
        sx, sy, srcSize, srcSize,
        0, 0, MAG_SIZE, MAG_SIZE
    );

    // 绘制十字准线
    const center = MAG_SIZE / 2;
    magCtx.strokeStyle = 'rgba(255,255,255,0.5)';
    magCtx.lineWidth = 1;
    magCtx.setLineDash([]);

    // 横线
    magCtx.beginPath();
    magCtx.moveTo(0, center);
    magCtx.lineTo(MAG_SIZE, center);
    magCtx.stroke();

    // 竖线
    magCtx.beginPath();
    magCtx.moveTo(center, 0);
    magCtx.lineTo(center, MAG_SIZE);
    magCtx.stroke();

    // 绘制当前拖拽线的位置标记（加粗高亮线）
    const lineColor = axis === 'x' ? '#00e5ff' : '#ff2a6d';
    magCtx.strokeStyle = lineColor;
    magCtx.lineWidth = 2;
    magCtx.globalAlpha = 0.8;
    magCtx.beginPath();
    if (axis === 'x') {
        const lineXInMag = (snapValue - sx) * MAG_ZOOM;
        magCtx.moveTo(lineXInMag, 0);
        magCtx.lineTo(lineXInMag, MAG_SIZE);
    } else {
        const lineYInMag = (snapValue - sy) * MAG_ZOOM;
        magCtx.moveTo(0, lineYInMag);
        magCtx.lineTo(MAG_SIZE, lineYInMag);
    }
    magCtx.stroke();
    magCtx.globalAlpha = 1.0;

    // 倍率标签
    magCtx.fillStyle = 'rgba(0,0,0,0.6)';
    magCtx.fillRect(MAG_SIZE - 32, MAG_SIZE - 18, 30, 16);
    magCtx.fillStyle = '#facc15';
    magCtx.font = 'bold 11px Inter, sans-serif';
    magCtx.textAlign = 'center';
    magCtx.fillText(MAG_ZOOM + '×', MAG_SIZE - 17, MAG_SIZE - 6);
}

// 鼠标位置映射 (处理 CSS transform)
function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: Math.round((e.clientX - rect.left) / scale),
        y: Math.round((e.clientY - rect.top) / scale)
    };
}

const HIT_TOLERANCE = 12;

canvas.addEventListener('mousedown', (e) => {
    if (!currentImage) return;

    // 平移逻辑：
    // 1. 中键或 Shift+左键（全局快捷键）
    // 2. 或是处于 'p' (Pan) 模式下的左键
    // 3. 或是按下空格键时的左键
    const isExplicitPan = e.button === 1 || (e.button === 0 && (e.shiftKey || isSpacePressed));
    const isModePan = e.button === 0 && currentMode === 'p';

    if (isExplicitPan || isModePan) {
        isPanning = true;
        startPanX = e.clientX - translateX;
        startPanY = e.clientY - translateY;
        canvas.style.cursor = 'grabbing';
        return;
    }

    const pos = getMousePos(e);
    const snapT = HIT_TOLERANCE / scale;

    // 检查是否点击了现有线（拖拽逻辑优先级最高）
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

    // 平移模式下左键如果不点击线，则不添加新线，直接返回（前面已处理平移启动）
    if (currentMode === 'p') return;

    // 添加新线逻辑
    // 根据当前模式和 Alt 键判断方向
    let useHorizontal = currentMode === 'h';
    if (e.altKey) useHorizontal = !useHorizontal;

    if (useHorizontal) {
        lines.y.push(pos.y);
        lines.y.sort((a, b) => a - b);
    } else {
        lines.x.push(pos.x);
        lines.x.sort((a, b) => a - b);
    }
    draw();
});

window.addEventListener('mousemove', (e) => {
    if (isPanning) {
        translateX = e.clientX - startPanX;
        translateY = e.clientY - startPanY;
        updateTransform();
        return;
    }

    if (!currentImage) return;
    const pos = getMousePos(e);

    if (draggingLine) {
        let rawValue = draggingLine.axis === 'x' ? pos.x : pos.y;
        // 边界限制
        rawValue = Math.max(0, Math.min(rawValue, draggingLine.axis === 'x' ? imgWidth : imgHeight));
        // 智能吸附
        const snapped = snapToNearest(rawValue, draggingLine.axis);
        lines[draggingLine.axis][draggingLine.index] = snapped;
        lines[draggingLine.axis].sort((a, b) => a - b);
        draw();
        renderMagnifier(e, snapped, draggingLine.axis);
    } else {
        const snapT = HIT_TOLERANCE / scale;
        let hovered = false;
        for (let i = 1; i < lines.x.length - 1; i++) {
            if (Math.abs(pos.x - lines.x[i]) <= snapT) { hovered = true; canvas.style.cursor = 'col-resize'; break; }
        }
        for (let i = 1; i < lines.y.length - 1 && !hovered; i++) {
            if (Math.abs(pos.y - lines.y[i]) <= snapT) { hovered = true; canvas.style.cursor = 'row-resize'; break; }
        }

        if (!hovered) {
            canvas.style.cursor = (currentMode === 'p' || isSpacePressed) ? 'grab' : 'crosshair';
        }
    }
});

window.addEventListener('mouseup', () => {
    isPanning = false;
    draggingLine = null;
    snapIndicator = null;
    magnifier.style.display = 'none';
    magnifier.classList.remove('snapped');
    if (canvas) canvas.style.cursor = (currentMode === 'p' || isSpacePressed) ? 'grab' : 'crosshair';
    draw();
});

// 滚轮缩放
window.addEventListener('wheel', (e) => {
    if (e.target.closest('.main-content')) {
        e.preventDefault();
        zoom(e.deltaY < 0 ? 1 : -1);
    }
}, { passive: false });

canvas.addEventListener('dblclick', (e) => {
    if (!currentImage) return;
    const pos = getMousePos(e);
    const snapT = HIT_TOLERANCE / scale;

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
        // 亮度恢复：移除之前的 0.6 透明度
        ctx.globalAlpha = 1.0;
        ctx.drawImage(currentImage, 0, 0);

        const visualWidth = 2 / scale;

        // 画垂线
        lines.x.forEach((xPos, idx) => {
            if (idx === 0 || idx === lines.x.length - 1) return;
            ctx.beginPath();
            ctx.moveTo(xPos, 0);
            ctx.lineTo(xPos, imgHeight);
            ctx.strokeStyle = '#00e5ff'; // 霓虹青色
            ctx.lineWidth = visualWidth;
            ctx.setLineDash([8 / scale, 8 / scale]);
            ctx.stroke();

            // 增强视觉发光感
            ctx.globalAlpha = 0.3;
            ctx.lineWidth = 6 / scale;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        });

        // 画水平线
        lines.y.forEach((yPos, idx) => {
            if (idx === 0 || idx === lines.y.length - 1) return;
            ctx.beginPath();
            ctx.moveTo(0, yPos);
            ctx.lineTo(imgWidth, yPos);
            ctx.strokeStyle = '#ff2a6d'; // 霓虹粉红
            ctx.lineWidth = visualWidth;
            ctx.setLineDash([8 / scale, 8 / scale]);
            ctx.stroke();

            ctx.globalAlpha = 0.3;
            ctx.lineWidth = 6 / scale;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        });
        ctx.setLineDash([]);

        // 吸附参考线视觉反馈
        if (snapIndicator && draggingLine) {
            ctx.beginPath();
            ctx.setLineDash([]);
            ctx.strokeStyle = '#facc15'; // 金色参考线
            ctx.lineWidth = 2 / scale;
            ctx.globalAlpha = 0.8;

            if (snapIndicator.axis === 'x') {
                ctx.moveTo(snapIndicator.value, 0);
                ctx.lineTo(snapIndicator.value, imgHeight);
            } else {
                ctx.moveTo(0, snapIndicator.value);
                ctx.lineTo(imgWidth, snapIndicator.value);
            }
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }
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
        window.close();
    } catch (e) {
        showStatus('无法联系服务，可能已经关闭。', 'error');
    }
});

window.addEventListener('resize', resetView);

// 快捷键监听
window.addEventListener('keydown', (e) => {
    // 按下空格临时变身抓手模式，且当前没在输入框
    if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        if (!isSpacePressed) {
            isSpacePressed = true;
            canvas.style.cursor = 'grab';
        }
        e.preventDefault(); // 阻止页面滚动
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        isSpacePressed = false;
        canvas.style.cursor = currentMode === 'p' ? 'grab' : 'crosshair';
    }
});

// 外部文件拖拽加载 (Drag & Drop)
window.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.body.classList.add('drag-active');
});

window.addEventListener('dragleave', () => {
    document.body.classList.remove('drag-active');
});

window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-active');

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
        // 同步路径输入框显示文件名（通过拖拽载入的）
        imgPathInput.value = file.name;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                currentImage = img;
                imgWidth = img.width;
                imgHeight = img.height;
                canvas.width = imgWidth;
                canvas.height = imgHeight;
                lines.x = [0, imgWidth];
                lines.y = [0, imgHeight];
                splitBtn.disabled = false;
                resetView();
                draw();
                showStatus('通过拖拽成功载入预览图！', 'success');
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

init();

// 每 1 分钟发送一次心跳，证明页面仍在开启状态，防止服务端因闲置超时而自动关闭
setInterval(() => {
    fetch('/api/heartbeat').catch(() => { });
}, 60000);

