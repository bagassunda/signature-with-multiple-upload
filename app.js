pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const {PDFDocument, rgb} = PDFLib;

let filesQueue = [];
let activePageId = null;
let signatureData = null;
let sigState = {x: 50, y: 50, width: 140, height: 70, pageId: null};
let sigHistory = [];

const canvas = document.getElementById('signaturePad');
const ctx = canvas.getContext('2d');
let isDrawing = false;

function initCanvas() {
    const rect = canvas.getBoundingClientRect();
    // Gunakan ukuran CSS murni tanpa scaling berlebihan untuk stabilitas rollback
    canvas.width = rect.width;
    canvas.height = rect.height;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000';
    // Simpan state awal (kosong)
    saveHistory();
}

function saveHistory() {
    if (sigHistory.length > 20) sigHistory.shift();
    sigHistory.push(canvas.toDataURL());
}

function undoSig() {
    if (sigHistory.length > 1) {
        sigHistory.pop();
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
        };
        img.src = sigHistory[sigHistory.length - 1];
    }
}

function clearSig() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sigHistory = [];
    saveHistory();
    signatureData = null;
    removeOverlay();
}

function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX || (e.touches && e.touches[0].clientX);
    const cy = e.clientY || (e.touches && e.touches[0].clientY);
    return {x: cx - rect.left, y: cy - rect.top};
}

// Event Listeners for Drawing
canvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
});

canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
});

window.addEventListener('mouseup', () => {
    if (isDrawing) saveHistory();
    isDrawing = false;
});

// Touch Support
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isDrawing = true;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
}, {passive: false});

canvas.addEventListener('touchmove', (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
}, {passive: false});

canvas.addEventListener('touchend', () => {
    if (isDrawing) saveHistory();
    isDrawing = false;
});

document.getElementById('fileInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setLoading(true, "Membaca Berkas...");

    for (const file of files) {
        try {
            if (file.type === 'application/pdf') {
                const buffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({data: buffer.slice(0)}).promise;
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const viewport = page.getViewport({scale: 2.5});
                    const tCanvas = document.createElement('canvas');
                    const tCtx = tCanvas.getContext('2d');
                    tCanvas.width = viewport.width;
                    tCanvas.height = viewport.height;
                    await page.render({canvasContext: tCtx, viewport}).promise;

                    filesQueue.push({
                        id: 'f-' + Math.random().toString(36).substr(2, 9),
                        type: 'pdf',
                        data: tCanvas.toDataURL('image/jpeg', 0.9),
                        raw: buffer.slice(0),
                        pageIdx: i - 1
                    });
                }
            } else if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                const dataUrl = await new Promise(res => {
                    reader.onload = r => res(r.target.result);
                    reader.readAsDataURL(file);
                });
                filesQueue.push({
                    id: 'f-' + Math.random().toString(36).substr(2, 9),
                    type: 'image',
                    data: dataUrl,
                    raw: dataUrl
                });
            }
        } catch (err) {
            console.error("File error:", err);
        }
    }
    renderAll();
    setLoading(false);
    e.target.value = '';
});

function renderAll() {
    const thumbBox = document.getElementById('thumbContainer');
    const mainBox = document.getElementById('mainContainer');
    const thumbEmpty = document.getElementById('thumbEmpty');
    const mainEmpty = document.getElementById('mainEmpty');

    if (filesQueue.length === 0) {
        if (thumbEmpty) thumbEmpty.style.display = 'flex';
        if (mainEmpty) mainEmpty.style.display = 'flex';
        thumbBox.innerHTML = '';
        mainBox.innerHTML = '';
        return;
    }

    if (thumbEmpty) thumbEmpty.style.display = 'none';
    if (mainEmpty) mainEmpty.style.display = 'none';

    thumbBox.innerHTML = '';
    filesQueue.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = `thumb-item ${activePageId === item.id ? 'active' : ''}`;
        div.dataset.id = item.id;
        div.onclick = () => scrollToPage(item.id);
        div.innerHTML = `<img src="${item.data}" class="w-full h-auto rounded"><span class="thumb-number">${idx + 1}</span>`;
        thumbBox.appendChild(div);
    });

    mainBox.innerHTML = '';
    filesQueue.forEach((item, idx) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'page-large-container';
        wrapper.id = `main-page-${item.id}`;
        wrapper.innerHTML = `
                    <div class="absolute -left-12 top-0 text-[10px] font-black text-slate-500 transform -rotate-90 origin-top-right">PAGE ${idx + 1}</div>
                    <img src="${item.data}" class="w-full h-auto block rounded select-none pointer-events-none" style="max-width: 800px;">
                    <div class="absolute top-4 right-4 flex gap-2 z-10">
                        <button onclick="moveToPage('${item.id}')" class="bg-indigo-600 text-white text-[9px] px-3 py-1.5 rounded-full font-bold shadow-lg transition-all hover:scale-105">TARUH TTD DI SINI</button>
                        <button onclick="removeFile('${item.id}')" class="bg-white text-red-500 text-[9px] px-2 py-1.5 rounded-full font-bold shadow-lg">HAPUS</button>
                    </div>
                `;
        mainBox.appendChild(wrapper);
    });

    initSortable();
    if (signatureData) attachOverlay();
}

function initSortable() {
    const container = document.getElementById('thumbContainer');
    if (container.sortable) container.sortable.destroy();
    container.sortable = new Sortable(container, {
        animation: 150,
        onEnd: () => {
            const newIds = Array.from(document.querySelectorAll('.thumb-item')).map(el => el.dataset.id);
            filesQueue.sort((a, b) => newIds.indexOf(a.id) - newIds.indexOf(b.id));
            renderAll();
        }
    });
}

function scrollToPage(id) {
    activePageId = id;
    document.querySelectorAll('.thumb-item').forEach(el => el.classList.toggle('active', el.dataset.id === id));
    const el = document.getElementById(`main-page-${id}`);
    if (el) el.scrollIntoView({behavior: 'smooth', block: 'center'});
}

function removeFile(id) {
    filesQueue = filesQueue.filter(f => f.id !== id);
    if (sigState.pageId === id) removeOverlay();
    renderAll();
}

function applySig() {
    // Cek apakah kanvas kosong
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let empty = true;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) {
        empty = false;
        break;
    }

    if (empty) return;

    signatureData = canvas.toDataURL();
    if (!sigState.pageId && filesQueue.length > 0) sigState.pageId = filesQueue[0].id;
    attachOverlay();
}

function moveToPage(id) {
    sigState.pageId = id;
    attachOverlay();
}

function removeOverlay() {
    const ov = document.getElementById('sigOverlay');
    if (ov) ov.remove();
}

function attachOverlay() {
    const old = document.getElementById('sigOverlay');
    if (old) old.remove();

    if (!sigState.pageId || !signatureData) return;
    const container = document.getElementById(`main-page-${sigState.pageId}`);
    if (!container) return;

    const overlay = document.createElement('div');
    overlay.id = 'sigOverlay';
    overlay.className = 'signature-overlay pointer-events-auto';
    overlay.style.cssText = `width:${sigState.width}px; height:${sigState.height}px; left:${sigState.x}px; top:${sigState.y}px;`;
    overlay.innerHTML = `
                <img src="${signatureData}" class="w-full h-full select-none pointer-events-none">
                <div class="resize-handle" id="resH"></div>
            `;

    container.appendChild(overlay);

    // Drag and Resize logic
    let dragging = false, resizing = false, startX, startY, startW, startH, offX, offY;

    const onStart = (e) => {
        const cx = e.clientX || e.touches[0].clientX;
        const cy = e.clientY || e.touches[0].clientY;
        if (e.target.id === 'resH') {
            resizing = true;
            startX = cx;
            startY = cy;
            startW = sigState.width;
            startH = sigState.height;
        } else {
            dragging = true;
            const r = overlay.getBoundingClientRect();
            offX = cx - r.left;
            offY = cy - r.top;
        }
        e.stopPropagation();
    };

    const onMove = (e) => {
        if (!dragging && !resizing) return;
        const cx = e.clientX || (e.touches && e.touches[0].clientX);
        const cy = e.clientY || (e.touches && e.touches[0].clientY);

        if (dragging) {
            const pr = container.getBoundingClientRect();
            let nx = cx - pr.left - offX;
            let ny = cy - pr.top - offY;
            nx = Math.max(0, Math.min(nx, pr.width - sigState.width));
            ny = Math.max(0, Math.min(ny, pr.height - sigState.height));
            overlay.style.left = nx + 'px';
            overlay.style.top = ny + 'px';
            sigState.x = nx;
            sigState.y = ny;
        }

        if (resizing) {
            const nw = Math.max(40, startW + (cx - startX));
            const nh = Math.max(20, startH + (cy - startY));
            overlay.style.width = nw + 'px';
            overlay.style.height = nh + 'px';
            sigState.width = nw;
            sigState.height = nh;
        }
    };

    const onEnd = () => {
        dragging = resizing = false;
    };

    overlay.addEventListener('mousedown', onStart);
    overlay.addEventListener('touchstart', onStart, {passive: false});
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, {passive: false});
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);
}

async function downloadResult() {
    if (filesQueue.length === 0) return;
    if (!signatureData) {
        alert("Silakan buat dan pasang tanda tangan terlebih dahulu.");
        return;
    }

    setLoading(true, "Menggabungkan Dokumen...");
    try {
        const outPdf = await PDFDocument.create();
        const sigImg = await outPdf.embedPng(signatureData);

        for (const item of filesQueue) {
            let page;
            if (item.type === 'pdf') {
                const src = await PDFDocument.load(item.raw.slice(0));
                const [copied] = await outPdf.copyPages(src, [item.pageIdx]);
                page = outPdf.addPage(copied);
            } else {
                const img = item.raw.startsWith('data:image/jpeg') ? await outPdf.embedJpg(item.raw) : await outPdf.embedPng(item.raw);
                page = outPdf.addPage([img.width, img.height]);
                page.drawImage(img, {x: 0, y: 0, width: img.width, height: img.height});
            }

            if (sigState.pageId === item.id) {
                const {width, height} = page.getSize();
                const view = document.getElementById(`main-page-${item.id}`).querySelector('img');
                const scX = width / view.clientWidth;
                const scY = height / view.clientHeight;

                page.drawImage(sigImg, {
                    x: sigState.x * scX,
                    y: height - (sigState.y * scY) - (sigState.height * scY),
                    width: sigState.width * scX,
                    height: sigState.height * scY
                });
            }
        }

        const bytes = await outPdf.save();
        const blob = new Blob([bytes], {type: 'application/pdf'});
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Signed_Document_${Date.now()}.pdf`;
        link.click();
    } catch (err) {
        console.error(err);
    }
    setLoading(false);
}

function setLoading(s, t) {
    const el = document.getElementById('loadingScreen');
    const txt = document.getElementById('loadingText');
    if (txt) txt.innerText = t;
    if (el) el.style.display = s ? 'flex' : 'none';
}

function exportSig() {
    const link = document.createElement('a');
    link.download = 'signature.png';
    link.href = canvas.toDataURL();
    link.click();
}

function importSig(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (f) => {
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const ratio = Math.min(canvas.width / img.width, canvas.height / img.height);
            ctx.drawImage(img, 0, 0, img.width * ratio, img.height * ratio);
            saveHistory();
        };
        img.src = f.target.result;
    };
    reader.readAsDataURL(file);
}

window.onload = () => {
    initCanvas();
    // Delay inisialisasi untuk memastikan layout stabil
    setTimeout(initCanvas, 500);
};