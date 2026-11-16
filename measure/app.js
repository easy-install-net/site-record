if (!window.Vue) {
    window.__showBootError('Vue 引擎載入失敗，請檢查網絡連線');
} else {
    const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;
    localforage.config({ name: 'SiteMeasurePro', storeName: 'projects_store' });

    const offlineReady = ref(false);
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').then(() => { offlineReady.value = true; }).catch(() => {}));
        navigator.serviceWorker.ready.then(() => { offlineReady.value = true; }).catch(() => {});
    }

    let db = null;
    try {
        if (window.firebase) {
            firebase.initializeApp({
                apiKey: "AIzaSyCSRfZdAVh8ADPNtayW5lyDtmE0xDsJXNg",
                authDomain: "gen-lang-client-0208380044.firebaseapp.com",
                databaseURL: "https://gen-lang-client-0208380044-default-rtdb.firebaseio.com",
                projectId: "gen-lang-client-0208380044",
                storageBucket: "gen-lang-client-0208380044.firebasestorage.app",
                messagingSenderId: "17077391191",
                appId: "1:17077391191:web:f167a311052c56bd3d7812"
            });
            db = firebase.firestore();
            db.settings({ experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true });
        }
    } catch (_) {}

    const withTimeout = (p, ms = 15000, msg = '雲端連線逾時，請檢查網路') => {
        let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
    };

    const withRetry = async (fn, retries = 3, delay = 800) => {
        for (let i = 0; i <= retries; i++) {
            try { return await fn(); } catch (e) { if (i === retries) throw e; await new Promise(r => setTimeout(r, delay * (i + 1))); }
        }
    };

    const CHUNK_SIZE = 350000;
    const getTodayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const sanitizeFilename = (s) => String(s || '').trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');

    const buildWallSegments = (w) => {
        if (!w) return [];
        const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = Math.hypot(dx, dy); if (L < 4) return [];
        const ux = dx / L, uy = dy / L, nx = -uy, ny = ux, hw = 9;
        const p1A = { x: w.x1 + nx * hw, y: w.y1 + ny * hw }, p2A = { x: w.x2 + nx * hw, y: w.y2 + ny * hw };
        const p1B = { x: w.x1 - nx * hw, y: w.y1 - ny * hw }, p2B = { x: w.x2 - nx * hw, y: w.y2 - ny * hw };
        const segs = [
            { x1: p1A.x, y1: p1A.y, x2: p2A.x, y2: p2A.y, isHatch: false }, { x1: p1B.x, y1: p1B.y, x2: p2B.x, y2: p2B.y, isHatch: false },
            { x1: p1A.x, y1: p1A.y, x2: p1B.x, y2: p1B.y, isHatch: false }, { x1: p2A.x, y1: p2A.y, x2: p2B.x, y2: p2B.y, isHatch: false }
        ];
        if (w.style === 'hatched') {
            for (let c = -hw + 14; c < L + hw; c += 14) {
                const t0 = Math.max(-hw, -c), t1 = Math.min(hw, L - c);
                if (t1 - t0 > 0.5) segs.push({ x1: w.x1 + (c + t0) * ux + t0 * nx, y1: w.y1 + (c + t0) * uy + t0 * ny, x2: w.x1 + (c + t1) * ux + t1 * nx, y2: w.y1 + (c + t1) * uy + t1 * ny, isHatch: true });
            }
        }
        return segs;
    };

    createApp({
        setup() {
            const authorName = ref(''), hasUnsavedCloudChanges = ref(false), dirtyPageIds = new Set();
            let unsubPages = null, isPushing = false, isAutoQueueing = false;

            const currentView = ref('dir');
            const showWatermark = ref(true);
            const globalFontScale = ref(1.0); // 1.0 = 大(預設), 0.8 = 中, 0.6 = 細

            const projectList = ref([]);
            const project = reactive({ code: '', name: '', date: '', deletedPageIds: [], deletedPinIds: [], pageOrderUpdatedAt: 0, lastSyncAt: 0, lastModifiedBy: '' });
            const pages = ref([]), photoPool = ref([]), activePageIndex = ref(0), activePin = ref(null), activePinIndex = ref(0);
            const activePage = computed(() => pages.value[activePageIndex.value] || null);
            const activeCanvas = computed(() => activePin.value || activePage.value);
            const canvasW = computed(() => activeCanvas.value?.w || 1200);
            const canvasH = computed(() => activeCanvas.value?.h || 900);

            const zoomScale = ref(1);
            const vbX = ref(0);
            const vbY = ref(0);
            const invZoom = computed(() => 1 / Math.pow(zoomScale.value, 0.65));
            const svgViewBox = computed(() => {
                const pw = canvasW.value, ph = canvasH.value;
                const vw = Math.round((pw / zoomScale.value) * 10) / 10, vh = Math.round((ph / zoomScale.value) * 10) / 10;
                const vx = Math.max(0, Math.min(pw - vw, vbX.value)), vy = Math.max(0, Math.min(ph - vh, vbY.value));
                return `${vx} ${vy} ${vw} ${vh}`;
            });

            const resetZoom = () => { zoomScale.value = 1; vbX.value = 0; vbY.value = 0; };
            const toggleFontScale = () => {
                if (globalFontScale.value === 1.0) globalFontScale.value = 0.8;
                else if (globalFontScale.value === 0.8) globalFontScale.value = 0.6;
                else globalFontScale.value = 1.0;
            };

            const applyZoomAtClientPoint = (nextScale, clientX, clientY, anchorSvg) => {
                const svg = svgCanvas.value, pw = canvasW.value, ph = canvasH.value;
                const clampedScale = Math.max(1, Math.min(5, Math.round(nextScale * 100) / 100));
                if (clampedScale <= 1) { resetZoom(); return; }
                const vw = pw / clampedScale, vh = ph / clampedScale;
                if (svg && anchorSvg) {
                    const r = svg.getBoundingClientRect(), baseFit = Math.min(r.width / pw, r.height / ph);
                    const effScale = baseFit * clampedScale, offX = r.left + (r.width - pw * baseFit) / 2, offY = r.top + (r.height - ph * baseFit) / 2;
                    zoomScale.value = clampedScale;
                    vbX.value = Math.max(0, Math.min(pw - vw, anchorSvg.x - (clientX - offX) / effScale));
                    vbY.value = Math.max(0, Math.min(ph - vh, anchorSvg.y - (clientY - offY) / effScale));
                } else {
                    const cx = vbX.value + (pw / zoomScale.value) / 2, cy = vbY.value + (ph / zoomScale.value) / 2;
                    zoomScale.value = clampedScale;
                    vbX.value = Math.max(0, Math.min(pw - vw, cx - vw / 2));
                    vbY.value = Math.max(0, Math.min(ph - vh, cy - vh / 2));
                }
            };
            const stepZoom = (delta) => { applyZoomAtClientPoint(zoomScale.value + delta, null, null, null); };

            const onStageWheel = (e) => {
                if (!svgCanvas.value || !activeCanvas.value?.photo) return;
                applyZoomAtClientPoint(zoomScale.value * (e.deltaY < 0 ? 1.2 : 0.82), e.clientX, e.clientY, getCoords(e));
            };

            // ...(省略了 fullScreen 同 project drag/drop 邏輯以保持字數，與原本相同)
            const fullScreenIndex = ref(-1);
            // [...其他原本存在的輔助函數照舊保留...]

            const drawMode = ref('browse'); // browse(睇圖), smart(智能拉線/點印), freehand, wall, pin, eraser
            const showTopSheet = ref(false);
            const activeMarker = ref(null);
            const isProcessing = ref(false), processingText = ref(''), focusedInput = ref('val'), topTextInputRef = ref(null), svgCanvas = ref(null);

            const getLineStroke = (l, alpha = 0.55) => !l.type || l.type === 'measure' ? `rgba(255, 0, 68, ${alpha})` : ({ gray: '#9ca3af', white: '#ffffff' }[l.color] || '#ef4444');
            const enterEditMode = (idx = 0) => { resetZoom(); activePageIndex.value = idx; activePin.value = null; drawMode.value = 'browse'; currentView.value = 'proj'; };
            const switchToPreview = async () => { await saveAll(); resetZoom(); activePin.value = null; currentView.value = 'preview'; };

            const isDrawing = ref(false), startPos = ref({ x: 0, y: 0 }), currentLine = ref(null), currentWall = ref(null), currentPath = ref('');
            let tempPoints = [];
            const draggedMarker = ref(null), dragOrigin = ref({ x: 0, y: 0 }), markerOrigin = ref({ x: 0, y: 0 }), isDraggingMarker = ref(false);
            const hasUndoItems = computed(() => activeCanvas.value?.historyStack?.length > 0);
            const hasRedoItems = computed(() => activeCanvas.value?.redoStack?.length > 0);

            let isPinching = false, pinchStartDist = 0, pinchStartScale = 1, pinchAnchorSvg = null;
            let isPanningBrowse = false, panStartClient = { x: 0, y: 0 }, panStartVb = { x: 0, y: 0 };
            
            // 手勢判定變量
            let touchStartTime = 0;
            let touchMoved = false;

            const getClientPoint = (e) => e.touches?.[0] || e.changedTouches?.[0] || e;

            const clientToSvgPoint = (clientX, clientY) => {
                const svg = svgCanvas.value; if (!svg || !activeCanvas.value) return { x: 0, y: 0 };
                const pw = canvasW.value, ph = canvasH.value;
                try {
                    const ctm = svg.getScreenCTM();
                    if (ctm) {
                        const p = svg.createSVGPoint(); p.x = clientX; p.y = clientY;
                        const loc = p.matrixTransform(ctm.inverse());
                        return { x: Math.round(Math.max(0, Math.min(pw, loc.x))), y: Math.round(Math.max(0, Math.min(ph, loc.y))) };
                    }
                } catch (_) {}
                const vw = pw / zoomScale.value, vh = ph / zoomScale.value;
                const r = svg.getBoundingClientRect(), s = Math.min(r.width / vw, r.height / vh);
                return {
                    x: Math.round(Math.max(0, Math.min(pw, vbX.value + (clientX - r.left - (r.width - vw * s) / 2) / s))),
                    y: Math.round(Math.max(0, Math.min(ph, vbY.value + (clientY - r.top - (r.height - vh * s) / 2) / s)))
                };
            };

            const getCoords = (e) => { const pt = getClientPoint(e); return clientToSvgPoint(pt.clientX, pt.clientY); };

            // ... (省略中間 helper functions, page creation, tools)

            const onStageTouchStart = (e) => {
                if (showTopSheet.value) return;
                if (e.touches.length >= 2) { e.preventDefault(); beginPinch(e.touches[0], e.touches[1]); return; }
                if (isPinching) return;
                
                touchStartTime = Date.now();
                touchMoved = false;
                
                if (e.touches.length === 1) {
                    if (drawMode.value === 'browse' || (drawMode.value === 'smart' && !draggedMarker.value && zoomScale.value > 1)) {
                        // 在 Browse 模式或 Smart 模式且需要拖曳畫面時，允許畫面 pan
                        isPanningBrowse = true; panStartClient = { x: e.touches[0].clientX, y: e.touches[0].clientY }; panStartVb = { x: vbX.value, y: vbY.value };
                    } else if (drawMode.value !== 'browse' && drawMode.value !== 'eraser' && !draggedMarker.value) { 
                        beginStroke(e); 
                    }
                }
            };

            const onStageTouchMove = (e) => {
                if (e.touches.length >= 2) {
                    e.preventDefault();
                    if (!isPinching) { beginPinch(e.touches[0], e.touches[1]); return; }
                    const t1 = e.touches[0], t2 = e.touches[1], curDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1;
                    applyZoomAtClientPoint(pinchStartScale * (curDist / pinchStartDist), (t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2, pinchAnchorSvg);
                    return;
                }
                if (isPinching) return;
                if (e.touches.length === 1) {
                    touchMoved = true;
                    if (isPanningBrowse) { e.preventDefault(); panByClientDelta(e.touches[0].clientX - panStartClient.x, e.touches[0].clientY - panStartClient.y); }
                    else { moveStroke(e); }
                }
            };

            const onStageTouchEnd = (e) => {
                if (e.touches.length === 0) {
                    if (isPinching) { isPinching = false; pinchAnchorSvg = null; return; }
                    if (isPanningBrowse) { isPanningBrowse = false; return; }
                }
                if (isPinching) return;
                
                // 判斷 Smart 模式下的 Tap (無明顯移動，且時間短)
                if (drawMode.value === 'smart' && !touchMoved && (Date.now() - touchStartTime < 300) && e.touches.length === 0) {
                    isDrawing.value = false;
                    currentLine.value = null;
                    const endPos = getCoords(e);
                    createPointMarker(endPos.x, endPos.y, 'stamp'); // 點擊 = 彈出印章面板
                    return;
                }

                if (e.touches.length === 0) endStroke(e);
            };

            const beginStroke = (e) => {
                isDrawing.value = true; startPos.value = getCoords(e);
                if (drawMode.value === 'smart' || drawMode.value === 'line' || drawMode.value === 'arrow-single') {
                    currentLine.value = { x1: startPos.value.x, y1: startPos.value.y, x2: startPos.value.x, y2: startPos.value.y };
                }
            };

            const moveStroke = (e) => {
                if (draggedMarker.value) {
                    e.preventDefault(); const p = getCoords(e), dx = p.x - dragOrigin.value.x, dy = p.y - dragOrigin.value.y;
                    if (Math.hypot(dx, dy) > 5 || isDraggingMarker.value) {
                        isDraggingMarker.value = true;
                        draggedMarker.value.x = Math.round(Math.max(0, Math.min(canvasW.value, markerOrigin.value.x + dx)));
                        draggedMarker.value.y = Math.round(Math.max(0, Math.min(canvasH.value, markerOrigin.value.y + dy)));
                    }
                } else if (isDrawing.value) {
                    e.preventDefault(); const p = getCoords(e);
                    if (drawMode.value === 'smart' || drawMode.value === 'line' || drawMode.value === 'arrow-single') { 
                        currentLine.value.x2 = p.x; currentLine.value.y2 = p.y; 
                    }
                }
            };

            const endStroke = (e) => {
                if (draggedMarker.value) {
                    if (!isDraggingMarker.value) {
                        draggedMarker.value.x = markerOrigin.value.x; draggedMarker.value.y = markerOrigin.value.y;
                        activeMarker.value = draggedMarker.value;
                        showTopSheet.value = true; focusedInput.value = 'val';
                    } else { touchDirty(); saveAll(); }
                    draggedMarker.value = null; isDraggingMarker.value = false; return;
                }
                
                if (!isDrawing.value) return;
                isDrawing.value = false; 
                
                if ((drawMode.value === 'smart' || drawMode.value === 'line' || drawMode.value === 'arrow-single') && currentLine.value) {
                    const lSnap = { ...currentLine.value };
                    currentLine.value = null;
                    
                    // 若拖拉距離太短，且是 Smart 模式，視為點擊
                    if (drawMode.value === 'smart' && Math.hypot(lSnap.x2 - lSnap.x1, lSnap.y2 - lSnap.y1) < 14) {
                        createPointMarker(lSnap.x2, lSnap.y2, 'stamp');
                        return;
                    }

                    const c = activeCanvas.value; c.lines ||= []; c.markers ||= []; c.historyStack ||= []; c.redoStack = [];
                    const lineId = Date.now(), markerId = lineId + 1;
                    c.lines.push({ ...lSnap, id: lineId, type: drawMode.value === 'arrow-single' ? 'arrow-single' : 'measure' });
                    const newMarker = { id: markerId, lineId, x: Math.round((lSnap.x1 + lSnap.x2) / 2), y: Math.round((lSnap.y1 + lSnap.y2) / 2), w: 140, h: 56, type: 'general', data: { val: '' } };
                    updateMarkerSize(newMarker); c.markers.push(newMarker); c.historyStack.push({ type: 'line_marker', lineId, markerId });
                    touchDirty(); activeMarker.value = newMarker; focusedInput.value = 'val'; showTopSheet.value = true; saveAll();
                }
            };

            const updateMarkerSize = (m) => {
                if (m.type === 'image') return;
                const lines = getMarkerLines(m), maxLen = Math.max(0, ...lines.map(l => l.length));
                // 字體縮放影響 Marker 框大小
                m.w = Math.max(110, (maxLen * 30 + 34) * globalFontScale.value); 
                m.h = Math.max(50, (lines.length * 36 + 16) * globalFontScale.value);
            };

            // ... (其餘邏輯，包括 Undo/Redo/Cloud Sync/Firebase 處理等保持原樣)
            
            return {
                offlineReady, currentView, 
                // ... 匯出所需變數
                drawMode, showTopSheet, activeMarker, globalFontScale, toggleFontScale,
                svgCanvas, currentLine,
                // ... 工具函數
                onStageTouchStart, onStageTouchMove, onStageTouchEnd
            };
        }
    }).mount('#app');
}
