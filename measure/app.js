if (!window.Vue) {
    if (window.__showBootError) window.__showBootError('Vue 引擎載入失敗，請檢查網絡連線');
    else alert('Vue 引擎載入失敗，請檢查網絡連線');
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
            const globalFontScale = ref(1.0); // 1.0=大, 0.8=中, 0.6=細

            const projectList = ref([]);
            const project = reactive({ code: '', name: '', date: '', deletedPageIds: [], deletedPinIds: [], pageOrderUpdatedAt: 0, lastSyncAt: 0, lastModifiedBy: '' });
            const pages = ref([]), photoPool = ref([]), activePageIndex = ref(0), activePin = ref(null), activePinIndex = ref(0);
            const activePage = computed(() => pages.value[activePageIndex.value] || null);
            const activeCanvas = computed(() => activePin.value || activePage.value);
            const canvasW = computed(() => activeCanvas.value?.w || 1200);
            const canvasH = computed(() => activeCanvas.value?.h || 900);

            const zoomScale = ref(1), vbX = ref(0), vbY = ref(0);
            const invZoom = computed(() => 1 / Math.pow(zoomScale.value, 0.65));
            const svgViewBox = computed(() => {
                const pw = canvasW.value, ph = canvasH.value;
                const vw = Math.round((pw / zoomScale.value) * 10) / 10, vh = Math.round((ph / zoomScale.value) * 10) / 10;
                const vx = Math.max(0, Math.min(pw - vw, vbX.value)), vy = Math.max(0, Math.min(ph - vh, vbY.value));
                return `${vx} ${vy} ${vw} ${vh}`;
            });

            const resetZoom = () => { zoomScale.value = 1; vbX.value = 0; vbY.value = 0; };
            const toggleFontScale = () => {
                globalFontScale.value = globalFontScale.value === 1.0 ? 0.8 : (globalFontScale.value === 0.8 ? 0.6 : 1.0);
                (activeCanvas.value?.markers || []).forEach(m => updateMarkerSize(m));
                saveAll();
                showToast(`🔠 字體已設為：${globalFontScale.value === 1.0 ? '大' : (globalFontScale.value === 0.8 ? '中' : '細')}`);
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
                    const curVw = pw / zoomScale.value, curVh = ph / zoomScale.value;
                    const cx = vbX.value + curVw / 2, cy = vbY.value + curVh / 2;
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

            const fullScreenIndex = ref(-1);
            const fullScreenList = computed(() => {
                const list = [];
                pages.value.forEach((pg, pIdx) => {
                    const d = pg.date || project.date || getTodayStr(), a = pg.author || project.lastModifiedBy || '';
                    if (pg.photo) list.push({ item: pg, label: `P${pIdx + 1}${pg.space ? ' [' + pg.space + ']' : ''}`, date: d, author: a });
                    (pg.pins || []).forEach((pin, pinIdx) => { if (pin.photo) list.push({ item: pin, label: `P${pIdx + 1} 📍釘#${pinIdx + 1}${pin.space ? ' [' + pin.space + ']' : ''}`, date: pin.date || d, author: pin.author || a }); });
                }); return list;
            });
            const currentFullScreen = computed(() => (fullScreenIndex.value >= 0 && fullScreenIndex.value < fullScreenList.value.length) ? fullScreenList.value[fullScreenIndex.value] : null);
            const fullScreenItem = computed(() => currentFullScreen.value?.item || null);
            const fullScreenTitle = computed(() => currentFullScreen.value ? `${currentFullScreen.value.label} (${fullScreenIndex.value + 1}/${fullScreenList.value.length})` : '');
            const fullScreenDate = computed(() => currentFullScreen.value?.date || getTodayStr());
            const fullScreenAuthor = computed(() => currentFullScreen.value?.author || '');

            const openFullScreenPreview = (targetItem) => { const idx = fullScreenList.value.findIndex(x => String(x.item.id) === String(targetItem.id)); if (idx !== -1) fullScreenIndex.value = idx; };
            const prevFullScreen = () => { if (fullScreenIndex.value > 0) fullScreenIndex.value--; };
            const nextFullScreen = () => { if (fullScreenIndex.value < fullScreenList.value.length - 1) fullScreenIndex.value++; };

            const draggingPageIdx = ref(null), dragOverPageIdx = ref(null);
            const startPageDrag = (idx, e) => {
                if (pages.value.length <= 1) return;
                draggingPageIdx.value = idx; dragOverPageIdx.value = idx;
                const onMove = (ev) => { const el = document.elementFromPoint(ev.clientX, ev.clientY); const card = el?.closest('[data-page-idx]'); if (card) { const targetIdx = Number(card.getAttribute('data-page-idx')); if (!Number.isNaN(targetIdx)) dragOverPageIdx.value = targetIdx; } };
                const onUp = async () => {
                    window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
                    const from = draggingPageIdx.value, to = dragOverPageIdx.value; draggingPageIdx.value = null; dragOverPageIdx.value = null;
                    if (from !== null && to !== null && from !== to) {
                        const [moved] = pages.value.splice(from, 1); pages.value.splice(to, 0, moved); activePageIndex.value = to;
                        project.pageOrderUpdatedAt = Date.now(); hasUnsavedCloudChanges.value = true;
                        if (!navigator.onLine) cloudSyncState.value = 'offline';
                        await saveAll(); showToast(`✅ 已調整為 P${to + 1}`);
                    }
                };
                window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
            };

            const buildWatermarkLines = (item, itemDate, itemAuthor) => {
                const lines = [], dStr = itemDate || item?.date || project.date, aStr = itemAuthor || item?.author || project.lastModifiedBy;
                if (dStr || aStr) lines.push({ text: `${dStr ? '📅 ' + dStr : ''}${aStr ? (dStr ? '  ' : '') + '✍️' + aStr : ''}`, color: '#ffffff' });
                if (project.name?.trim()) lines.push({ text: `📍 ${project.name.trim()}`, color: '#facc15' });
                if (item?.space?.trim()) lines.push({ text: `🏠 ${item.space.trim()}`, color: '#ffffff' });
                return lines;
            };
            const fullScreenWatermarkLines = computed(() => buildWatermarkLines(fullScreenItem.value, fullScreenDate.value, fullScreenAuthor.value));

            const showJoinModal = ref(false), inputJoinCode = ref(''), showAddPageModal = ref(false), showSpaceModal = ref(false), showMergeModal = ref(false), showPdfModal = ref(false);
            const spaceList = ref(['主人房', '睡房一', '睡房二', '客廳', '飯廳', '廚房', '客廁', '套廁', '儲物室', '玄關', '露台']);
            const showManageModal = ref(false), manageProj = ref({}), showCloudBrowser = ref(false), cloudProjectList = ref([]), showBackupListModal = ref(false), backupList = ref([]);
            const showPhotoPoolModal = ref(false), photoPoolList = ref([]), photoPoolTarget = ref('newPage');

            const arrowColor = ref('red'), freehandColor = ref('#3b82f6'), wallStyle = ref('hollow'), wallColor = ref('#111827'), toastMsg = ref('');
            const showToast = (msg) => { toastMsg.value = msg; setTimeout(() => { if (toastMsg.value === msg) toastMsg.value = ''; }, 3000); };

            const cloudSyncState = ref(navigator.onLine ? 'ready' : 'offline');
            const cloudStatusText = computed(() => ({ syncing: '☁️上傳', offline: '📴離線', queued: '⏳待傳', ready: '☁️v9.4' }[cloudSyncState.value] || '☁️v9.4'));
            const cloudStatusClass = computed(() =>
                cloudSyncState.value === 'syncing' ? 'bg-amber-100 text-amber-900 border-amber-300' :
                cloudSyncState.value === 'offline' ? 'bg-zinc-100 text-zinc-500 border-zinc-300' :
                cloudSyncState.value === 'queued' ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-emerald-50 text-emerald-700 border-emerald-300'
            );

            const customStamps = ref([]);
            const loadCustomStamps = async () => { customStamps.value = (await localforage.getItem('custom_stamps')) || []; };
            const promptCustomStamp = async () => {
                const txt = prompt('輸入自訂印章字眼：')?.trim();
                if (txt) {
                    if (!customStamps.value.includes(txt)) { customStamps.value.push(txt); await localforage.setItem('custom_stamps', customStamps.value); }
                    applyStamp(txt);
                }
            };

            const showCloudDetail = () => {
                if (!navigator.onLine) showToast('📴 無網絡模式：照常度尺，有訊號自動上傳');
                else if (cloudSyncState.value === 'queued') processPendingUploadQueue(false);
                else showToast('v9.4 智能一體化面板・防誤觸鎖定');
            };

            const photoFingerprint = (b64) => b64 ? b64.slice(0, 100) + '_' + b64.length : '';
            const getBaseImageKey = (pg) => pg?.photoId ? String(pg.photoId) : (pg?.photo && !pg.isSketch ? photoFingerprint(pg.photo) : '');

            const updateQueue = async (code, add) => {
                code = String(code || '').trim(); if (!code) return;
                const q = (await localforage.getItem('pending_upload_queue')) || [];
                const next = add ? (q.includes(code) ? q : [...q, code]) : q.filter(c => c !== code);
                await localforage.setItem('pending_upload_queue', next);
            };

            const markProjectChanged = () => { hasUnsavedCloudChanges.value = true; if (!navigator.onLine) cloudSyncState.value = 'offline'; };

            const touchDirty = (targetPage = activePage.value) => {
                const now = Date.now(), today = getTodayStr();
                if (activePin.value) activePin.value.updatedAt = now;
                if (targetPage) {
                    targetPage.updatedAt = now; targetPage.date = today;
                    if (authorName.value) targetPage.author = authorName.value;
                    dirtyPageIds.add(targetPage.id);
                }
                project.date = today; hasUnsavedCloudChanges.value = true;
                if (!navigator.onLine) cloudSyncState.value = 'offline';
            };

            const showBranchPrompt = ref(false), branchOwner = ref(''), branchInputValue = ref(''), pendingBranchAction = ref(null), branchTargetPage = ref(null);
            const triggerBranchPrompt = (pg, owner, actionCb) => {
                if (isDrawing.value) { isDrawing.value = false; currentLine.value = null; currentWall.value = null; currentPath.value = ''; }
                if (draggedMarker.value) { draggedMarker.value.x = markerOrigin.value.x; draggedMarker.value.y = markerOrigin.value.y; draggedMarker.value = null; isDraggingMarker.value = false; }
                branchOwner.value = owner; branchInputValue.value = ''; branchTargetPage.value = pg; pendingBranchAction.value = actionCb; showBranchPrompt.value = true;
                nextTick(() => { if (document.querySelector('input[placeholder="Y"]')) document.querySelector('input[placeholder="Y"]').focus(); });
            };

            const doBranchCopy = (pg, me) => {
                const c = JSON.parse(JSON.stringify(pg)), sharedPhotoId = pg.photoId || ('page_' + pg.id); pg.photoId = sharedPhotoId;
                const oldPinId = activePin.value ? String(activePin.value.id) : null;
                const newPg = makeEmptyPage({
                    space: c.space || '', date: getTodayStr(), author: me, photo: pg.photo, photoId: sharedPhotoId, w: c.w || 1200, h: c.h || 900,
                    isSketch: !!c.isSketch, hasGrid: !!c.hasGrid, markers: c.markers || [], lines: c.lines || [], walls: c.walls || [], paths: c.paths || [], pins: c.pins || [], deletedPinIds: c.deletedPinIds || []
                });
                pages.value.push(newPg); activePageIndex.value = pages.value.length - 1;
                if (oldPinId) activePin.value = (newPg.pins || []).find(p => String(p.id) === oldPinId) || null;
                dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true;
                showToast(`📋 已為你複製為 P${pages.value.length} (保留 [${branchOwner.value}] 原圖)`);
            };

            const confirmBranch = () => {
                if (branchInputValue.value.trim().toUpperCase() === 'Y') doBranchCopy(branchTargetPage.value, String(authorName.value || '').trim());
                const cb = pendingBranchAction.value; showBranchPrompt.value = false; pendingBranchAction.value = null; branchTargetPage.value = null; if (cb) cb();
            };

            const cancelBranch = () => { const cb = pendingBranchAction.value; showBranchPrompt.value = false; pendingBranchAction.value = null; branchTargetPage.value = null; if (cb) cb(); };

            const checkBranchNeed = (actionCb) => {
                const pg = activePage.value, me = String(authorName.value || '').trim();
                if (!pg || !pg.photo || !me) return actionCb();
                const owner = String(pg.author || '').trim();
                if (!owner || owner === me) return actionCb();
                triggerBranchPrompt(pg, owner, actionCb);
            };

            const drawMode = ref('browse'), showTopSheet = ref(false), showTopTextBar = ref(false), activeMarker = ref(null);
            const isProcessing = ref(false), processingText = ref(''), focusedInput = ref('val'), topTextInputRef = ref(null), svgCanvas = ref(null);

            const getLineStroke = (l, alpha = 0.55) => !l.type || l.type === 'measure' ? `rgba(255, 0, 68, ${alpha})` : ({ gray: '#9ca3af', white: '#ffffff' }[l.color] || '#ef4444');
            const getWallSegments = (w) => buildWallSegments(w);

            const enterEditMode = (idx = 0) => { resetZoom(); activePageIndex.value = idx; activePin.value = null; drawMode.value = 'browse'; currentView.value = 'proj'; };
            const switchToPreview = async () => { await saveAll(); resetZoom(); activePin.value = null; currentView.value = 'preview'; };

            const mergeableGroups = computed(() => {
                const map = new Map();
                pages.value.forEach((pg, idx) => { const key = getBaseImageKey(pg); if (key) { if (!map.has(key)) map.set(key, []); map.get(key).push({ pg, idx }); } });
                return Array.from(map.entries()).filter(([, items]) => items.length >= 2).map(([key, items]) => ({ key, photo: items[0].pg.photo, items }));
            });

            const mergePageGroup = async (grp) => {
                const maps = { lines: new Map(), walls: new Map(), paths: new Map(), markers: new Map(), pins: new Map() };
                const delPins = new Set(project.deletedPinIds || []);
                let space = '', w = 1200, h = 900, isSketch = false, hasGrid = false;
                grp.items.forEach(({ pg }) => {
                    if (!space && pg.space) space = pg.space; w = pg.w || w; h = pg.h || h; isSketch ||= !!pg.isSketch; hasGrid ||= !!pg.hasGrid;
                    (pg.deletedPinIds || []).forEach(id => delPins.add(String(id)));
                    Object.keys(maps).forEach(k => (pg[k] || []).forEach(x => {
                        if (k === 'pins' && delPins.has(String(x.id))) return;
                        maps[k].set(String(x.id), JSON.parse(JSON.stringify(x)));
                    }));
                });
                const mergedPg = makeEmptyPage({
                    space, date: getTodayStr(), author: (authorName.value || '團隊') + ' (合併)', photo: grp.photo, photoId: grp.key, w, h, isSketch, hasGrid,
                    lines: [...maps.lines.values()], walls: [...maps.walls.values()], paths: [...maps.paths.values()], markers: [...maps.markers.values()], pins: [...maps.pins.values()], deletedPinIds: [...delPins]
                });
                pages.value.push(mergedPg); dirtyPageIds.add(mergedPg.id); hasUnsavedCloudChanges.value = true; showMergeModal.value = false; await saveAll(); showToast(`✅ 已智能合併為 P${pages.value.length}`);
            };

            const isDrawing = ref(false), startPos = ref({ x: 0, y: 0 }), currentLine = ref(null), currentWall = ref(null), currentPath = ref('');
            let tempPoints = [];
            const draggedMarker = ref(null), dragOrigin = ref({ x: 0, y: 0 }), markerOrigin = ref({ x: 0, y: 0 }), isDraggingMarker = ref(false);
            const hasUndoItems = computed(() => activeCanvas.value?.historyStack?.length > 0);
            const hasRedoItems = computed(() => activeCanvas.value?.redoStack?.length > 0);

            let isPinching = false, pinchStartDist = 0, pinchStartScale = 1, pinchAnchorSvg = null;
            let isPanningBrowse = false, panStartClient = { x: 0, y: 0 }, panStartVb = { x: 0, y: 0 };
            
            // Smart 手勢判定
            let touchStartTime = 0, touchMoved = false;

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
                const vw = pw / zoomScale.value, vh = ph / zoomScale.value, vx = Math.max(0, Math.min(pw - vw, vbX.value)), vy = Math.max(0, Math.min(ph - vh, vbY.value));
                const r = svg.getBoundingClientRect(), s = Math.min(r.width / vw, r.height / vh);
                return { x: Math.round(Math.max(0, Math.min(pw, vx + (clientX - r.left - (r.width - vw * s) / 2) / s))), y: Math.round(Math.max(0, Math.min(ph, vy + (clientY - r.top - (r.height - vh * s) / 2) / s))) };
            };

            const getCoords = (e) => { const pt = getClientPoint(e); return clientToSvgPoint(pt.clientX, pt.clientY); };

            const snapWallEnd = (x1, y1, x2, y2) => {
                if (Math.hypot(x2 - x1, y2 - y1) < 10) return { x: x2, y: y2 };
                const deg = Math.abs(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI);
                if (deg <= 4 || deg >= 176) return { x: x2, y: y1 }; if (Math.abs(deg - 90) <= 4) return { x: x1, y: y2 };
                return { x: x2, y: y2 };
            };

            const getAdaptiveCanvasSize = () => {
                const stage = document.getElementById('draw-stage'); let w = 1200, h = 1500;
                if (stage) {
                    const rect = stage.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) { const ratio = rect.width / rect.height; if (ratio > 1) { h = 1500; w = Math.round(h * ratio); } else { w = 1500; h = Math.round(w / ratio); } }
                } return { w, h };
            };

            const makeEmptyPage = (ov = {}) => {
                const pg = {
                    id: 'pg_' + Date.now() + '_' + Math.floor(Math.random() * 99999), space: '', date: ov.date || getTodayStr(), author: authorName.value || '',
                    photo: null, photoId: '', w: 1200, h: 900, isSketch: false, hasGrid: false, markers: [], lines: [], walls: [], paths: [], pins: [], deletedPinIds: [], historyStack: [], redoStack: [], updatedAt: Date.now(), ...ov
                };
                if (pg.isSketch && !pg.photo) { const size = getAdaptiveCanvasSize(); pg.w = ov.w || size.w; pg.h = ov.h || size.h; pg.photo = renderSketchDataUrl(pg.w, pg.h, !!pg.hasGrid); }
                return pg;
            };

            const initSketchOnCurrent = () => { if (!activeCanvas.value) return; resetZoom(); const size = getAdaptiveCanvasSize(); Object.assign(activeCanvas.value, { photo: renderSketchDataUrl(size.w, size.h, true), w: size.w, h: size.h, isSketch: true, hasGrid: true }); touchDirty(); drawMode.value = 'browse'; saveAll(); };
            const addNewSketchPage = (hasGrid) => { showAddPageModal.value = false; resetZoom(); const size = getAdaptiveCanvasSize(); const newPg = makeEmptyPage({ photo: renderSketchDataUrl(size.w, size.h, hasGrid), w: size.w, h: size.h, isSketch: true, hasGrid }); pages.value.push(newPg); activePageIndex.value = pages.value.length - 1; dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true; drawMode.value = 'browse'; saveAll(); };
            
            const duplicateCurrentPage = (keepAnnotations = false) => {
                showAddPageModal.value = false; const src = activePage.value; if (!src?.photo) return;
                resetZoom(); const sharedPhotoId = src.photoId || ('page_' + src.id); src.photoId = sharedPhotoId; const c = JSON.parse(JSON.stringify(src));
                const newPg = makeEmptyPage({
                    space: src.space || '', photo: src.photo, photoId: sharedPhotoId, w: src.w || 1200, h: src.h || 900, isSketch: !!src.isSketch, hasGrid: !!src.hasGrid,
                    markers: keepAnnotations ? (c.markers || []) : [], lines: keepAnnotations ? (c.lines || []) : [], walls: keepAnnotations ? (c.walls || []) : [], paths: keepAnnotations ? (c.paths || []) : [], pins: []
                });
                pages.value.push(newPg); activePageIndex.value = pages.value.length - 1; dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true; drawMode.value = 'browse'; saveAll();
                showToast(keepAnnotations ? `📑 已複製整頁為 P${pages.value.length}` : `📄 已複製純淨底圖為 P${pages.value.length}`);
            };

            const toggleSketchGrid = () => { if (!activeCanvas.value) return; checkBranchNeed(() => { activeCanvas.value.hasGrid = !activeCanvas.value.hasGrid; activeCanvas.value.photo = renderSketchDataUrl(activeCanvas.value.w || 1200, activeCanvas.value.h || 1500, activeCanvas.value.hasGrid); touchDirty(); saveAll(); }); };

            const switchPage = (idx) => { resetZoom(); activePageIndex.value = idx; activePin.value = null; drawMode.value = 'browse'; };
            const prevPage = () => { if (activePageIndex.value > 0) switchPage(activePageIndex.value - 1); };
            const nextPage = () => { if (activePageIndex.value < pages.value.length - 1) switchPage(activePageIndex.value + 1); };

            const deleteCurrentPage = () => {
                if (pages.value.length <= 1) return;
                if (prompt(`⚠️ 確認刪除 P${activePageIndex.value + 1}？\n請輸入 "d" 確認：`)?.trim().toLowerCase() !== 'd') return;
                resetZoom(); const delId = activePage.value.id; project.deletedPageIds ||= [];
                if (!project.deletedPageIds.includes(delId)) project.deletedPageIds.push(delId);
                dirtyPageIds.delete(delId); pages.value.splice(activePageIndex.value, 1); activePageIndex.value = Math.max(0, activePageIndex.value - 1);
                project.pageOrderUpdatedAt = Date.now(); hasUnsavedCloudChanges.value = true; saveAll();
                if (db && project.code) { const ref = db.collection('site_projects').doc(String(project.code)); ref.collection('pages').doc(delId).delete().catch(() => {}); ref.set({ deletedPageIds: firebase.firestore.FieldValue.arrayUnion(delId), updatedAt: Date.now() }, { merge: true }).catch(() => {}); }
                showToast('🗑️ 已刪除頁面');
            };

            const openPinSubPage = (pin, idx) => {
                resetZoom(); Object.assign(pin, { markers: pin.markers || [], lines: pin.lines || [], walls: pin.walls || [], paths: pin.paths || [], historyStack: [], redoStack: [], w: pin.w || 1200, h: pin.h || 900, space: pin.space || activePage.value?.space || '' });
                if (pin.isSketch && !pin.photo) { const size = getAdaptiveCanvasSize(); pin.photo = renderSketchDataUrl(size.w, size.h, !!pin.hasGrid); pin.w = size.w; pin.h = size.h; }
                activePin.value = pin; activePinIndex.value = idx; drawMode.value = 'browse';
            };

            const exitPinSubPage = () => { resetZoom(); activePin.value = null; drawMode.value = 'browse'; };

            const onPinTap = (pin, index) => { if (drawMode.value === 'eraser') { showToast('📍 落釘受保護，請點入內按「🗑️刪釘」移除'); return; } openPinSubPage(pin, index); };

            const deleteActivePin = async () => {
                if (!activePin.value || !activePage.value) return;
                checkBranchNeed(async () => {
                    const pinId = String(activePin.value.id), pg = activePage.value, idx = (pg.pins || []).findIndex(p => String(p.id) === pinId);
                    if (idx !== -1) {
                        const removedPin = JSON.parse(JSON.stringify(pg.pins[idx])); pg.pins.splice(idx, 1); pg.deletedPinIds ||= [];
                        if (!pg.deletedPinIds.includes(pinId)) pg.deletedPinIds.push(pinId); project.deletedPinIds ||= []; if (!project.deletedPinIds.includes(pinId)) project.deletedPinIds.push(pinId);
                        pg.historyStack ||= []; pg.redoStack = []; pg.historyStack.push({ type: 'delete_pin', pin: removedPin, index: idx });
                    }
                    touchDirty(pg); exitPinSubPage(); await saveAll(); showToast('🗑️ 已刪釘（按 ↶ 可復原）');
                });
            };

            const resolveMediaDoc = async (doc) => {
                const d = doc.data(); if (!d) return null; if (d.photo) return d.photo;
                if (d.chunked && d.totalChunks > 0) {
                    const snap = await withRetry(() => withTimeout(doc.ref.collection('chunks').get(), 15000));
                    const list = snap.docs.map(c => c.data()).sort((a, b) => (a.index || 0) - (b.index || 0));
                    if (list.length === d.totalChunks) return list.map(c => c.data || '').join('');
                } return null;
            };

            const loadMediaMapFromRef = async (projRef) => {
                const snap = await withRetry(() => withTimeout(projRef.collection('media').get(), 20000)); const map = new Map();
                await Promise.all(snap.docs.map(async (m) => { const fullPhoto = await resolveMediaDoc(m); if (fullPhoto) map.set(String(m.id), { photo: fullPhoto, data: m.data() }); }));
                return map;
            };

            const openPhotoPool = async (target = 'newPage') => {
                showAddPageModal.value = false; photoPoolTarget.value = target; isProcessing.value = true; processingText.value = '正在讀取工程底圖庫...';
                try {
                    const seen = new Set(), list = [];
                    const addUnique = (item) => { if (!item?.photo || item.isSketch) return; const fp = photoFingerprint(item.photo); if (seen.has(fp)) return; seen.add(fp); list.push({ id: item.id || ('pool_' + list.length), photo: item.photo, w: item.w || 1200, h: item.h || 900, author: item.author || '', updatedAt: item.updatedAt || 0 }); };
                    if (db && navigator.onLine && project.code) {
                        try { const mediaMap = await loadMediaMapFromRef(db.collection('site_projects').doc(String(project.code))); mediaMap.forEach((v, id) => addUnique({ id, photo: v.photo, w: v.data.w, h: v.data.h, author: v.data.author, updatedAt: v.data.updatedAt })); } catch (_) {}
                    }
                    (photoPool.value || []).forEach(addUnique);
                    pages.value.forEach(pg => { addUnique({ id: pg.photoId || ('page_' + pg.id), photo: pg.photo, w: pg.w, h: pg.h, author: pg.author, isSketch: pg.isSketch }); (pg.pins || []).forEach(pin => addUnique({ id: pin.photoId || String(pin.id), photo: pin.photo, w: pin.w, h: pin.h, isSketch: pin.isSketch })); });
                    photoPoolList.value = list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); showPhotoPoolModal.value = true;
                } finally { isProcessing.value = false; }
            };

            const selectFromPhotoPool = (item) => {
                showPhotoPoolModal.value = false; resetZoom();
                if (photoPoolTarget.value === 'newPage') {
                    const newPg = makeEmptyPage({ photo: item.photo, photoId: item.id, w: item.w || 1200, h: item.h || 900 });
                    pages.value.push(newPg); activePageIndex.value = pages.value.length - 1; dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true; showToast(`✅ 已建立 P${pages.value.length}`); drawMode.value = 'browse'; saveAll();
                } else if (activeCanvas.value) {
                    checkBranchNeed(() => { Object.assign(activeCanvas.value, { photo: item.photo, photoId: item.id, w: item.w || 1200, h: item.h || 900, isSketch: false }); touchDirty(); drawMode.value = 'browse'; saveAll(); });
                }
            };

            const deleteFromPhotoPool = async (item) => {
                if (!confirm('確定要從底圖庫移除這張照片嗎？')) return;
                const fp = photoFingerprint(item.photo); photoPoolList.value = photoPoolList.value.filter(x => photoFingerprint(x.photo) !== fp); photoPool.value = photoPool.value.filter(x => photoFingerprint(x.photo) !== fp); await saveAll();
                if (db && project.code && item.id) { const mRef = db.collection('site_projects').doc(String(project.code)).collection('media').doc(String(item.id)); mRef.collection('chunks').get().then(s => s.forEach(c => c.ref.delete())).catch(() => {}); mRef.delete().catch(() => {}); }
            };

            const setPageSpace = (sp) => { checkBranchNeed(() => { if (activeCanvas.value) activeCanvas.value.space = sp; touchDirty(); showSpaceModal.value = false; saveAll(); }); };
            const addCustomSpace = () => { const s = prompt('輸入空間名稱（例如：閣樓）')?.trim(); if (s) { if (!spaceList.value.includes(s)) spaceList.value.push(s); setPageSpace(s); } };

            const onEraseTap = (targetType, item, e) => {
                if (drawMode.value !== 'eraser') return;
                if (e.touches?.length > 1 || isPinching || showBranchPrompt.value) return;
                e.preventDefault(); e.stopPropagation(); const targetId = item.id;
                checkBranchNeed(() => {
                    const c = activeCanvas.value; if (!c) return; c.historyStack ||= []; c.redoStack = [];
                    if (targetType === 'wall') { const idx = (c.walls || []).findIndex(x => x.id === targetId); if (idx === -1) return; const removed = c.walls.splice(idx, 1)[0]; c.historyStack.push({ type: 'erase', targetType: 'wall', item: removed }); }
                    else if (targetType === 'path') { const idx = (c.paths || []).findIndex(x => x.id === targetId); if (idx === -1) return; const removed = c.paths.splice(idx, 1)[0]; c.historyStack.push({ type: 'erase', targetType: 'path', item: removed }); }
                    else if (targetType === 'line') {
                        const idx = (c.lines || []).findIndex(x => x.id === targetId); if (idx === -1) return; const removedLine = c.lines.splice(idx, 1)[0]; let linkedMarker = null;
                        const mIdx = (c.markers || []).findIndex(m => m.lineId === targetId); if (mIdx !== -1) linkedMarker = c.markers.splice(mIdx, 1)[0];
                        c.historyStack.push({ type: 'erase', targetType: 'line', item: removedLine, linkedMarker });
                    } else if (targetType === 'marker') {
                        const idx = (c.markers || []).findIndex(x => x.id === targetId); if (idx === -1) return; const removedMarker = c.markers.splice(idx, 1)[0]; let linkedLine = null;
                        if (removedMarker.lineId) { const lIdx = (c.lines || []).findIndex(l => l.id === removedMarker.lineId); if (lIdx !== -1) linkedLine = c.lines.splice(lIdx, 1)[0]; }
                        c.historyStack.push({ type: 'erase', targetType: 'marker', item: removedMarker, linkedLine });
                    }
                    touchDirty(); saveAll();
                });
            };

            const createPointMarker = (x, y, forceType) => {
                checkBranchNeed(() => {
                    const c = activeCanvas.value; if (!c) return;
                    c.markers ||= []; c.historyStack ||= []; c.redoStack = [];
                    const markerId = Date.now();
                    const newMarker = { id: markerId, lineId: null, x, y, w: 140, h: 56, type: forceType, data: { val: '', name: '', w_in: '', h_in: '', d_in: '', w: '', d: '', h: '', t: '', h_bottom: '', t_stone: '', d_stone: '', t_frame: '', h_top: '', w_side: '', d_out: '' } };
                    updateMarkerSize(newMarker); c.markers.push(newMarker); c.historyStack.push({ type: 'marker', markerId });
                    touchDirty(); activeMarker.value = newMarker;
                    if (forceType === 'stamp') { focusedInput.value = 'stamp'; showTopSheet.value = true; } // 打開一體化面板的印章頁
                    else { showTopTextBar.value = true; nextTick(() => topTextInputRef.value?.focus()); }
                    saveAll();
                });
            };

            const startDrag = (marker, e) => {
                if (e.touches?.length > 1 || isPinching || showBranchPrompt.value) return;
                
                // 防誤觸：如果係 Browse 模式，強制鎖定標註不可拖拉，當作背景一部分，只允許平移畫面
                if (drawMode.value === 'browse') return; 

                e.preventDefault(); e.stopPropagation();
                draggedMarker.value = marker;
                const p = getCoords(e); dragOrigin.value = { x: p.x, y: p.y }; markerOrigin.value = { x: marker.x, y: marker.y }; isDraggingMarker.value = false;
            };

            const beginPinch = (t1, t2) => {
                isPinching = true; isDrawing.value = false; isPanningBrowse = false; currentLine.value = null; currentWall.value = null; currentPath.value = '';
                if (draggedMarker.value) { draggedMarker.value.x = markerOrigin.value.x; draggedMarker.value.y = markerOrigin.value.y; draggedMarker.value = null; isDraggingMarker.value = false; }
                pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1; pinchStartScale = zoomScale.value;
                pinchAnchorSvg = clientToSvgPoint((t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2);
            };

            const onStageTouchStart = (e) => {
                if (showTopSheet.value || showTopTextBar.value || showBranchPrompt.value) return;
                if (e.touches.length >= 2) { e.preventDefault(); beginPinch(e.touches[0], e.touches[1]); return; }
                if (isPinching) return;
                
                touchStartTime = Date.now();
                touchMoved = false;

                if (e.touches.length === 1) {
                    // Smart手勢：允許在 line 模式(度尺)下，單指長按平移畫面（如果放開得夠快則當作點擊印章）
                    // 但如果係 Browse 模式，就100%係平移
                    if (drawMode.value === 'browse' || (drawMode.value === 'line' && !draggedMarker.value && zoomScale.value > 1)) {
                        isPanningBrowse = true; panStartClient = { x: e.touches[0].clientX, y: e.touches[0].clientY }; panStartVb = { x: vbX.value, y: vbY.value };
                    } 
                    
                    if (drawMode.value !== 'browse' && drawMode.value !== 'eraser' && !draggedMarker.value) { 
                        beginStroke(e); 
                    }
                }
            };

            const onStageTouchMove = (e) => {
                if (showBranchPrompt.value) return;
                if (e.touches.length >= 2) {
                    e.preventDefault(); if (!isPinching) { beginPinch(e.touches[0], e.touches[1]); return; }
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
                if (isPinching || showBranchPrompt.value) return;
                
                // Smart 手勢判定：短時間(<250ms)、低位移的輕點 ＝ 印章
                if (drawMode.value === 'line' && !touchMoved && (Date.now() - touchStartTime < 250) && e.touches.length === 0) {
                    isDrawing.value = false;
                    currentLine.value = null;
                    const endPos = getCoords(e);
                    createPointMarker(endPos.x, endPos.y, 'stamp');
                    return;
                }

                if (e.touches.length === 0) endStroke(e);
            };

            const panByClientDelta = (dxClient, dyClient) => {
                const svg = svgCanvas.value; if (!svg) return;
                const pw = canvasW.value, ph = canvasH.value, vw = pw / zoomScale.value, vh = ph / zoomScale.value;
                const r = svg.getBoundingClientRect(), fitScale = Math.min(r.width / vw, r.height / vh) || 1;
                vbX.value = Math.max(0, Math.min(pw - vw, panStartVb.x - dxClient / fitScale));
                vbY.value = Math.max(0, Math.min(ph - vh, panStartVb.y - dyClient / fitScale));
            };

            const onStageMouseDown = (e) => {
                if (showTopSheet.value || showTopTextBar.value || showBranchPrompt.value) return;
                if (e.button === 1 || (drawMode.value === 'browse' && zoomScale.value > 1 && !draggedMarker.value)) { e.preventDefault(); isPanningBrowse = true; panStartClient = { x: e.clientX, y: e.clientY }; panStartVb = { x: vbX.value, y: vbY.value }; return; }
                if (!draggedMarker.value && drawMode.value !== 'browse' && drawMode.value !== 'eraser') beginStroke(e);
            };
            const onStageMouseMove = (e) => { if (showBranchPrompt.value) return; if (isPanningBrowse) { panByClientDelta(e.clientX - panStartClient.x, e.clientY - panStartClient.y); return; } moveStroke(e); };
            const onStageMouseUp = (e) => { if (isPanningBrowse) { isPanningBrowse = false; return; } if (!showBranchPrompt.value) endStroke(e); };

            const beginStroke = (e) => {
                isDrawing.value = true; startPos.value = getCoords(e);
                if (drawMode.value === 'line' || drawMode.value === 'arrow-single') currentLine.value = { x1: startPos.value.x, y1: startPos.value.y, x2: startPos.value.x, y2: startPos.value.y };
                else if (drawMode.value === 'wall') currentWall.value = { x1: startPos.value.x, y1: startPos.value.y, x2: startPos.value.x, y2: startPos.value.y, style: wallStyle.value, color: wallColor.value };
                else if (drawMode.value === 'freehand') { tempPoints = [[startPos.value.x, startPos.value.y]]; currentPath.value = `M ${startPos.value.x} ${startPos.value.y}`; }
            };

            const moveStroke = (e) => {
                if (draggedMarker.value) {
                    e.preventDefault(); const p = getCoords(e), dx = p.x - dragOrigin.value.x, dy = p.y - dragOrigin.value.y;
                    if (Math.hypot(dx, dy) > 5 || isDraggingMarker.value) {
                        if (!isDraggingMarker.value) { isDraggingMarker.value = true; checkBranchNeed(() => { draggedMarker.value = (activeCanvas.value.markers || []).find(m => m.id === draggedMarker.value?.id) || draggedMarker.value; }); if (showBranchPrompt.value) return; }
                        draggedMarker.value.x = Math.round(Math.max(0, Math.min(canvasW.value, markerOrigin.value.x + dx))); draggedMarker.value.y = Math.round(Math.max(0, Math.min(canvasH.value, markerOrigin.value.y + dy)));
                    }
                } else if (isDrawing.value) {
                    e.preventDefault(); const p = getCoords(e);
                    if (drawMode.value === 'line' || drawMode.value === 'arrow-single') { currentLine.value.x2 = p.x; currentLine.value.y2 = p.y; }
                    else if (drawMode.value === 'wall' && currentWall.value) { const snapped = snapWallEnd(currentWall.value.x1, currentWall.value.y1, p.x, p.y); currentWall.value.x2 = snapped.x; currentWall.value.y2 = snapped.y; }
                    else if (drawMode.value === 'freehand') { tempPoints.push([p.x, p.y]); currentPath.value = `M ${tempPoints.map(pt => `${pt[0]} ${pt[1]}`).join(' L ')}`; }
                }
            };

            const endStroke = (e) => {
                if (draggedMarker.value) {
                    if (!isDraggingMarker.value) { draggedMarker.value.x = markerOrigin.value.x; draggedMarker.value.y = markerOrigin.value.y; activeMarker.value = draggedMarker.value; if (['stamp', 'text', 'image'].includes(draggedMarker.value.type)) { showTopTextBar.value = true; if (draggedMarker.value.type !== 'image') nextTick(() => topTextInputRef.value?.focus()); } else { showTopSheet.value = true; focusedInput.value = 'val'; } } 
                    else { touchDirty(); saveAll(); }
                    draggedMarker.value = null; isDraggingMarker.value = false; return;
                }
                if (!isDrawing.value) return;
                isDrawing.value = false; const endPos = getCoords(e), dist = Math.hypot(endPos.x - startPos.value.x, endPos.y - startPos.value.y);

                if (!activePin.value && drawMode.value === 'pin') {
                    currentLine.value = null; currentWall.value = null; currentPath.value = '';
                    checkBranchNeed(() => {
                        const pw = activePage.value.w || 1200, ph = activePage.value.h || 900; activePage.value.pins ||= []; activePage.value.historyStack ||= []; activePage.value.redoStack = [];
                        const newPin = { id: 'pin_' + Date.now(), name: `位置 ${activePage.value.pins.length + 1}`, x: parseFloat(((endPos.x / pw) * 100).toFixed(2)), y: parseFloat(((endPos.y / ph) * 100).toFixed(2)), photo: null, photoId: '', w: 1200, h: 900, space: activePage.value.space || '', markers: [], lines: [], walls: [], paths: [], historyStack: [], redoStack: [], updatedAt: Date.now() };
                        activePage.value.pins.push(newPin); activePage.value.historyStack.push({ type: 'pin', pinId: newPin.id });
                        touchDirty(); openPinSubPage(newPin, activePage.value.pins.length - 1); saveAll();
                    }); return;
                }

                if (drawMode.value === 'stamp' && dist < 14) { currentLine.value = null; currentWall.value = null; currentPath.value = ''; createPointMarker(endPos.x, endPos.y, 'stamp'); return; }

                if (drawMode.value === 'wall' && currentWall.value) {
                    if (Math.hypot(currentWall.value.x2 - currentWall.value.x1, currentWall.value.y2 - currentWall.value.y1) >= 12) {
                        const wSnap = { ...currentWall.value };
                        checkBranchNeed(() => { const c = activeCanvas.value; c.walls ||= []; c.historyStack ||= []; c.redoStack = []; const wallId = Date.now(); c.walls.push({ ...wSnap, id: wallId }); c.historyStack.push({ type: 'wall', wallId }); touchDirty(); saveAll(); });
                    }
                    currentWall.value = null;
                } else if ((drawMode.value === 'line' || drawMode.value === 'arrow-single') && currentLine.value) {
                    const lSnap = { ...currentLine.value };
                    currentLine.value = null;
                    
                    // Smart 手勢判定：拖拉距離太短，視作單點落印章
                    if (drawMode.value === 'line' && Math.hypot(lSnap.x2 - lSnap.x1, lSnap.y2 - lSnap.y1) < 14) {
                        createPointMarker(lSnap.x2, lSnap.y2, 'stamp');
                        return;
                    }

                    checkBranchNeed(() => {
                        const c = activeCanvas.value; c.lines ||= []; c.markers ||= []; c.historyStack ||= []; c.redoStack = [];
                        const lineId = Date.now(), markerId = lineId + 1;
                        c.lines.push({ ...lSnap, id: lineId, type: drawMode.value === 'line' ? 'measure' : 'arrow-single', color: drawMode.value === 'arrow-single' ? arrowColor.value : null });
                        const newMarker = { id: markerId, lineId, x: Math.round((lSnap.x1 + lSnap.x2) / 2), y: Math.round((lSnap.y1 + lSnap.y2) / 2), w: 140, h: 56, type: 'general', data: { val: '', name: '', w_in: '', h_in: '', d_in: '', w: '', d: '', h: '', t: '', h_bottom: '', t_stone: '', d_stone: '', t_frame: '', h_top: '', w_side: '', d_out: '' } };
                        updateMarkerSize(newMarker); c.markers.push(newMarker); c.historyStack.push({ type: 'line_marker', lineId, markerId });
                        touchDirty(); activeMarker.value = newMarker; focusedInput.value = 'val'; showTopSheet.value = true; saveAll();
                    });
                } else if (drawMode.value === 'freehand' && currentPath.value) {
                    const pSnap = currentPath.value; currentPath.value = '';
                    checkBranchNeed(() => { const c = activeCanvas.value; c.paths ||= []; c.historyStack ||= []; c.redoStack = []; const pathId = Date.now(); c.paths.push({ id: pathId, d: pSnap, color: freehandColor.value }); c.historyStack.push({ type: 'freehand', pathId }); touchDirty(); saveAll(); });
                }
            };

            const ensureMarkerBranched = (cb) => { if (activeMarker.value) { checkBranchNeed(() => { activeMarker.value = (activeCanvas.value.markers || []).find(m => m.id === activeMarker.value.id) || activeMarker.value; if (cb) cb(); }); } else if (cb) cb(); };
            const onMarkerTextInput = () => { ensureMarkerBranched(() => { updateMarkerSize(activeMarker.value); touchDirty(); }); };
            const resizeImageMarker = (factor) => { if (!activeMarker.value || activeMarker.value.type !== 'image') return; ensureMarkerBranched(() => { const m = activeMarker.value, minSide = 40, maxSide = Math.max(canvasW.value, canvasH.value) * 1.5; const nextW = Math.round(m.w * factor), nextH = Math.round(m.h * factor); if (nextW < minSide || nextH < minSide || nextW > maxSide || nextH > maxSide) return; m.w = nextW; m.h = nextH; touchDirty(); saveAll(); }); };

            const undoLastAction = () => {
                checkBranchNeed(() => {
                    const c = activeCanvas.value; if (!c?.historyStack?.length) return; c.redoStack ||= [];
                    const act = c.historyStack.pop(), u = { type: act.type };
                    if (act.type === 'line_marker') { const li = c.lines.findIndex(l => l.id === act.lineId), mi = c.markers.findIndex(m => m.id === act.markerId); if (li !== -1) u.line = c.lines.splice(li, 1)[0]; if (mi !== -1) u.marker = c.markers.splice(mi, 1)[0]; }
                    else if (act.type === 'marker') { const mi = c.markers.findIndex(m => m.id === act.markerId); if (mi !== -1) u.marker = c.markers.splice(mi, 1)[0]; }
                    else if (act.type === 'wall') { const wi = (c.walls || []).findIndex(w => w.id === act.wallId); if (wi !== -1) u.wall = c.walls.splice(wi, 1)[0]; }
                    else if (act.type === 'freehand') { const pi = c.paths.findIndex(p => p.id === act.pathId); if (pi !== -1) u.path = c.paths.splice(pi, 1)[0]; }
                    else if (act.type === 'erase') {
                        u.targetType = act.targetType; u.item = act.item; u.linkedMarker = act.linkedMarker || null; u.linkedLine = act.linkedLine || null;
                        if (act.targetType === 'wall') { c.walls ||= []; c.walls.push(act.item); } else if (act.targetType === 'path') { c.paths ||= []; c.paths.push(act.item); }
                        else if (act.targetType === 'line') { c.lines ||= []; c.lines.push(act.item); if (act.linkedMarker) { c.markers ||= []; c.markers.push(act.linkedMarker); } }
                        else if (act.targetType === 'marker') { c.markers ||= []; c.markers.push(act.item); if (act.linkedLine) { c.lines ||= []; c.lines.push(act.linkedLine); } }
                    } else if (act.type === 'pin') { const pni = (c.pins || []).findIndex(p => String(p.id) === String(act.pinId)); if (pni !== -1) { u.pin = c.pins.splice(pni, 1)[0]; const pid = String(u.pin.id); c.deletedPinIds ||= []; if (!c.deletedPinIds.includes(pid)) c.deletedPinIds.push(pid); project.deletedPinIds ||= []; if (!project.deletedPinIds.includes(pid)) project.deletedPinIds.push(pid); } }
                    else if (act.type === 'delete_pin' && act.pin) { c.pins ||= []; const insertIdx = Math.min(act.index ?? c.pins.length, c.pins.length); c.pins.splice(insertIdx, 0, act.pin); const pid = String(act.pin.id); if (c.deletedPinIds) c.deletedPinIds = c.deletedPinIds.filter(x => x !== pid); if (project.deletedPinIds) project.deletedPinIds = project.deletedPinIds.filter(x => x !== pid); u.pin = act.pin; u.index = insertIdx; showToast('↩️ 已復原釘選'); }
                    c.redoStack.push(u); touchDirty(); saveAll();
                });
            };

            const redoAction = () => {
                checkBranchNeed(() => {
                    const c = activeCanvas.value; if (!c?.redoStack?.length) return; const u = c.redoStack.pop(), act = { type: u.type };
                    if (u.type === 'erase') {
                        act.targetType = u.targetType; act.item = u.item; act.linkedMarker = u.linkedMarker || null; act.linkedLine = u.linkedLine || null;
                        if (u.targetType === 'wall') c.walls = (c.walls || []).filter(x => x.id !== u.item.id); else if (u.targetType === 'path') c.paths = (c.paths || []).filter(x => x.id !== u.item.id);
                        else if (u.targetType === 'line') { c.lines = (c.lines || []).filter(x => x.id !== u.item.id); if (u.linkedMarker) c.markers = (c.markers || []).filter(x => x.id !== u.linkedMarker.id); }
                        else if (u.targetType === 'marker') { c.markers = (c.markers || []).filter(x => x.id !== u.item.id); if (u.linkedLine) c.lines = (c.lines || []).filter(x => x.id !== u.linkedLine.id); }
                    } else {
                        if (u.line) { c.lines.push(u.line); act.lineId = u.line.id; } if (u.marker) { c.markers.push(u.marker); act.markerId = u.marker.id; }
                        if (u.wall) { c.walls ||= []; c.walls.push(u.wall); act.wallId = u.wall.id; } if (u.path) { c.paths.push(u.path); act.pathId = u.path.id; }
                        if (u.type === 'pin' && u.pin) { c.pins ||= []; c.pins.push(u.pin); act.pinId = u.pin.id; const pid = String(u.pin.id); if (c.deletedPinIds) c.deletedPinIds = c.deletedPinIds.filter(x => x !== pid); if (project.deletedPinIds) project.deletedPinIds = project.deletedPinIds.filter(x => x !== pid); }
                        else if (u.type === 'delete_pin' && u.pin) { const pid = String(u.pin.id); c.pins = (c.pins || []).filter(p => String(p.id) !== pid); c.deletedPinIds ||= []; if (!c.deletedPinIds.includes(pid)) c.deletedPinIds.push(pid); project.deletedPinIds ||= []; if (!project.deletedPinIds.includes(pid)) project.deletedPinIds.push(pid); act.pin = u.pin; act.index = u.index; }
                    }
                    c.historyStack.push(act); touchDirty(); saveAll();
                });
            };

            const deleteMarkerTop = () => { ensureMarkerBranched(() => { const c = activeCanvas.value, m = activeMarker.value; if (!m || !c) return; if (m.lineId) c.lines = (c.lines || []).filter(l => l.id !== m.lineId); c.markers = (c.markers || []).filter(x => x.id !== m.id); if (c.historyStack) c.historyStack = c.historyStack.filter(h => h.markerId !== m.id); c.redoStack = []; touchDirty(); showTopSheet.value = false; showTopTextBar.value = false; activeMarker.value = null; saveAll(); }); };
            
            // 一體化面板核心切換：切換印章或度尺模式
            const switchMarkerType = (t, fKey) => { 
                ensureMarkerBranched(() => { 
                    activeMarker.value.type = t; 
                    focusedInput.value = fKey; 
                    updateMarkerSize(activeMarker.value); 
                    touchDirty(); 
                }); 
            };
            
            const closeTopTextBar = () => { if (['stamp','text'].includes(activeMarker.value?.type) && !String(activeMarker.value.data.val || '').trim()) { deleteMarkerTop(); return; } showTopTextBar.value = false; saveAll(); };
            const closeTopSheet = () => { if (activeMarker.value?.type === 'stamp' && !String(activeMarker.value.data.val || '').trim()) { deleteMarkerTop(); return; } showTopSheet.value = false; saveAll(); };

            const handleKeypad = (key) => {
                if (!activeMarker.value || !focusedInput.value) return;
                ensureMarkerBranched(() => {
                    if (focusedInput.value === 'name' || focusedInput.value === 'stamp') focusedInput.value = 'val';
                    const cur = String(activeMarker.value.data[focusedInput.value] || '');
                    if (key === 'DEL') { activeMarker.value.data[focusedInput.value] = cur.slice(0, -1); touchDirty(); }
                    else if (key === 'ENTER') {
                        const tp = activeMarker.value.type;
                        if (['window','door','beam','column'].includes(tp)) { const f = getTagFields(tp), idx = f.findIndex(x => x.key === focusedInput.value); idx >= 0 && idx < f.length - 1 ? (focusedInput.value = f[idx + 1].key) : closeTopSheet(); } else closeTopSheet();
                    } else if (cur.length < 6) { activeMarker.value.data[focusedInput.value] = cur + key; touchDirty(); }
                    updateMarkerSize(activeMarker.value);
                });
            };

            const applyTag = (name) => { if (activeMarker.value) { ensureMarkerBranched(() => { activeMarker.value.data.name = name; focusedInput.value = 'val'; updateMarkerSize(activeMarker.value); touchDirty(); }); } };
            
            // 點擊印章時：自動將當前標註轉為印章，並即時關閉面板
            const applyStamp = (txt) => { 
                if (activeMarker.value) { 
                    ensureMarkerBranched(() => {
                        activeMarker.value.type = 'stamp';
                        activeMarker.value.data.val = txt; 
                        updateMarkerSize(activeMarker.value); 
                        touchDirty(); 
                        closeTopSheet(); 
                    }); 
                } 
            };

            const updateMarkerSize = (m) => {
                if (m.type === 'image') return;
                const lines = getMarkerLines(m), maxLen = Math.max(0, ...lines.map(l => l.length));
                // 字體縮放影響標註框大小
                m.w = Math.max(110, (maxLen * 30 + 34) * globalFontScale.value); 
                m.h = Math.max(50, (lines.length * 36 + 16) * globalFontScale.value);
            };

            const getStampColor = (m) => {
                if (m.type !== 'stamp') return '#ffffff'; const v = m.data.val;
                if (['需清拆','牆身斜','牆體不平','空鼓','滲水','局部凸出'].includes(v)) return '#ef4444';
                if (['開關','單蘇','孖蘇','燈曲','數據','燈線'].includes(v)) return '#eab308';
                if (['留通道','開門方向','可保留','實地台'].includes(v)) return '#3b82f6';
                if (['要收口','見光','開背板','生口位','避窗簾盒','留散熱','要分件'].includes(v)) return '#d97706';
                if (customStamps.value.includes(v)) return '#a1a1aa'; return spaceList.value.includes(v) ? '#a855f7' : '#ffffff';
            };

            const getTagFields = (t) => ({ door: [{ key: 'w_in', label: '門闊' }, { key: 'h_in', label: '門高' }, { key: 't', label: '牆厚' }, { key: 't_frame', label: '門框厚' }, { key: 'h_top', label: '頂到天花' }, { key: 'w_side', label: '邊到牆' }], window: [{ key: 'w_in', label: '內闊' }, { key: 'h_in', label: '內高' }, { key: 'd_in', label: '內深' }, { key: 'h_bottom', label: '面到地' }, { key: 't_stone', label: '窗石厚' }, { key: 'd_stone', label: '窗石凸' }], beam: [{ key: 'w', label: '樑闊' }, { key: 'd', label: '樑深' }, { key: 'h_bottom', label: '底到地' }, { key: 'w_side', label: '樑邊到牆' }], column: [{ key: 'w', label: '柱闊' }, { key: 'd', label: '柱深' }, { key: 'h_top', label: '柱高' }, { key: 'd_out', label: '柱凸出' }] }[t] || []);
            const getMarkerLines = (m) => { if (['window','door','beam','column'].includes(m.type)) { return [{ window: '窗', door: '門洞', beam: '樑', column: '柱' }[m.type], ...getTagFields(m.type).filter(f => m.data[f.key]).map(f => `${f.label}:${m.data[f.key]}`)]; } if (m.type === 'stamp' || m.type === 'text') return [m.data.val || '']; return [`${m.data.name ? m.data.name + ': ' : ''}${m.data.val || ''}`]; };

            const compressImage = (file) => new Promise((res) => {
                const reader = new FileReader(); reader.readAsDataURL(file);
                reader.onload = (e) => { const img = new Image(); img.src = e.target.result; img.onload = () => { const c = document.createElement('canvas'), MAX = 1280; let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height; if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } } c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); res({ b64: c.toDataURL('image/jpeg', 0.72), w, h }); }; };
            });

            const handleImageUpload = async (e, asNewPage = false) => {
                const rawFiles = Array.from(e.target.files || []); if (!rawFiles.length) return;
                showAddPageModal.value = false; resetZoom();
                const files = activePin.value ? [rawFiles[0]] : rawFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
                const isBatch = files.length > 1; if (isBatch) { isProcessing.value = true; processingText.value = `準備匯入 ${files.length} 張圖紙...`; }
                let firstAddedIdx = -1;
                try {
                    for (let i = 0; i < files.length; i++) {
                        if (isBatch) processingText.value = `正在匯入第 ${i + 1} / ${files.length} 張圖紙...`;
                        const res = await compressImage(files[i]); const photoId = `img_${Date.now()}_${i}_${Math.floor(Math.random() * 999)}`;
                        photoPool.value.push({ id: photoId, photo: res.b64, w: res.w, h: res.h, author: authorName.value || '', updatedAt: Date.now() });
                        if (i === 0 && !asNewPage && activeCanvas.value && !activeCanvas.value.photo) {
                            checkBranchNeed(() => { Object.assign(activeCanvas.value, { photo: res.b64, photoId, w: res.w, h: res.h, isSketch: false }); touchDirty(); firstAddedIdx = activePageIndex.value; });
                            if (showBranchPrompt.value) await new Promise(r => { const timer = setInterval(() => { if (!showBranchPrompt.value) { clearInterval(timer); r(); } }, 200); });
                        } else {
                            const newPg = makeEmptyPage({ photo: res.b64, photoId, w: res.w, h: res.h });
                            pages.value.push(newPg); dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true;
                            if (firstAddedIdx === -1) firstAddedIdx = pages.value.length - 1;
                        }
                    }
                    if (firstAddedIdx !== -1 && !activePin.value) activePageIndex.value = firstAddedIdx; drawMode.value = 'browse'; await saveAll(); if (isBatch) showToast(`✅ 已匯入 ${files.length} 張圖紙`);
                } finally { isProcessing.value = false; e.target.value = ''; }
            };

            const processPastedBlob = async (blob, forceNewPage) => {
                showAddPageModal.value = false; isProcessing.value = true; processingText.value = '正在處理貼上圖片...';
                try {
                    const res = await compressImage(blob), photoId = 'img_' + Date.now() + '_' + Math.floor(Math.random() * 999);
                    photoPool.value.push({ id: photoId, photo: res.b64, w: res.w, h: res.h, author: authorName.value || '', updatedAt: Date.now() });
                    if (forceNewPage || !activeCanvas.value?.photo) {
                        resetZoom();
                        if (!forceNewPage && !activeCanvas.value?.photo) { checkBranchNeed(() => { Object.assign(activeCanvas.value, { photo: res.b64, photoId, w: res.w, h: res.h, isSketch: false }); touchDirty(); }); } 
                        else { const newPg = makeEmptyPage({ photo: res.b64, photoId, w: res.w, h: res.h }); pages.value.push(newPg); activePageIndex.value = pages.value.length - 1; dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true; }
                        showToast('✅ 貼上為底圖');
                    } else {
                        checkBranchNeed(() => {
                            const c = activeCanvas.value; c.markers ||= []; c.historyStack ||= []; c.redoStack = [];
                            let tw = res.w, th = res.h; const maxS = Math.min(canvasW.value, canvasH.value) * 0.7;
                            if (tw > maxS || th > maxS) { if (tw > th) { th = Math.round(th * maxS / tw); tw = maxS; } else { tw = Math.round(tw * maxS / th); th = maxS; } }
                            const vw = canvasW.value / zoomScale.value, vh = canvasH.value / zoomScale.value; const cx = Math.round(vbX.value + vw / 2), cy = Math.round(vbY.value + vh / 2);
                            const markerId = Date.now(), newMarker = { id: markerId, x: cx, y: cy, w: tw, h: th, type: 'image', data: { b64: res.b64 } };
                            c.markers.push(newMarker); c.historyStack.push({ type: 'marker', markerId }); activeMarker.value = newMarker; showTopTextBar.value = true; touchDirty(); showToast('✅ 貼圖成功');
                        });
                    }
                    drawMode.value = 'browse'; await saveAll();
                } catch (_) { showToast('貼上失敗，請確定複製的是圖片'); } finally { isProcessing.value = false; }
            };

            const pasteFromClipboard = async (forceNewPage = false) => { try { const items = await navigator.clipboard.read(); for (const item of items) { if (item.types.some(t => t.startsWith('image/'))) { const blob = await item.getType(item.types.find(t => t.startsWith('image/'))); await processPastedBlob(blob, forceNewPage); return; } } showToast('剪貼簿內無圖片'); } catch (_) { showToast('請使用 Ctrl+V (或 Cmd+V) 貼上'); } };
            const handleGlobalPaste = async (e) => { if (currentView.value !== 'proj') return; if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; const items = e.clipboardData?.items; if (!items) return; for (let i = 0; i < items.length; i++) { if (items[i].type.indexOf('image') !== -1) { e.preventDefault(); await processPastedBlob(items[i].getAsFile(), false); return; } } };
            const handleGlobalKeydown = (e) => { if (fullScreenIndex.value === -1) return; if (e.key === 'ArrowLeft') { e.preventDefault(); prevFullScreen(); } else if (e.key === 'ArrowRight') { e.preventDefault(); nextFullScreen(); } else if (e.key === 'Escape') { e.preventDefault(); fullScreenIndex.value = -1; } };

            const saveAll = async () => {
                const code = String(project.code || '').trim(); if (!code) return;
                const cleanPages = JSON.parse(JSON.stringify(pages.value || [])).map(pg => { delete pg.historyStack; delete pg.redoStack; (pg.pins || []).forEach(p => { delete p.historyStack; delete p.redoStack; }); return pg; });
                const hasPending = hasUnsavedCloudChanges.value || dirtyPageIds.size > 0;
                await localforage.setItem('proj_' + code, { code, name: String(project.name || ''), date: String(project.date || ''), pages: cleanPages, photoPool: JSON.parse(JSON.stringify(photoPool.value || [])), deletedPageIds: JSON.parse(JSON.stringify(project.deletedPageIds || [])), deletedPinIds: JSON.parse(JSON.stringify(project.deletedPinIds || [])), pageOrderUpdatedAt: Number(project.pageOrderUpdatedAt || 0), updatedAt: Date.now(), lastSyncAt: Number(project.lastSyncAt || 0), lastModifiedBy: String(project.lastModifiedBy || authorName.value || ''), pendingUpload: hasPending });
                await updateQueue(code, hasPending);
            };

            const mergePagesSmart = (localList, cloudList, deletedSet, orderList) => {
                const lMap = new Map(localList.map(p => [p.id, p])), cMap = new Map(cloudList.map(p => [p.id, p])), result = [];
                const globalDeletedPins = new Set((project.deletedPinIds || []).map(String));
                new Set([...lMap.keys(), ...cMap.keys()]).forEach(id => {
                    if (deletedSet.has(id)) return;
                    const lp = lMap.get(id), cp = cMap.get(id), pageDeletedPins = new Set([...globalDeletedPins, ...((lp?.deletedPinIds || []).map(String)), ...((cp?.deletedPinIds || []).map(String))]);
                    if (!lp || !cp) { const single = makeEmptyPage(lp || cp); single.pins = (single.pins || []).filter(x => !pageDeletedPins.has(String(x.id))); single.deletedPinIds = [...pageDeletedPins]; result.push(single); return; }
                    const base = (cp.updatedAt || 0) > (lp.updatedAt || 0) ? { ...cp } : { ...lp }; if (!base.photo) base.photo = lp.photo || cp.photo || null; if (!base.date) base.date = lp.date || cp.date || getTodayStr();
                    const lPins = new Map((lp.pins || []).map(x => [String(x.id), x])), cPins = new Map((cp.pins || []).map(x => [String(x.id), x])), mergedPins = [];
                    new Set([...lPins.keys(), ...cPins.keys()]).forEach(pid => { if (pageDeletedPins.has(pid)) return; const lP = lPins.get(pid), cP = cPins.get(pid); if (!lP || !cP) mergedPins.push(lP || cP); else { const w = (cP.updatedAt || 0) > (lP.updatedAt || 0) ? { ...cP } : { ...lP }; if (!w.photo) w.photo = lP.photo || cP.photo || null; mergedPins.push(w); } });
                    base.pins = mergedPins; base.deletedPinIds = [...pageDeletedPins]; result.push(makeEmptyPage(base));
                });
                return result.sort((a, b) => (orderList.indexOf(a.id) === -1 ? 9999 : orderList.indexOf(a.id)) - (orderList.indexOf(b.id) === -1 ? 9999 : orderList.indexOf(b.id)));
            };

            const pullAndMergeFromCloud = async (code, throwErr = false) => {
                code = String(code || '').trim(); if (!navigator.onLine) { cloudSyncState.value = 'offline'; if (throwErr) throw new Error('目前無網絡連線'); return; }
                if (!db) throw new Error('雲端資料庫未初始化');
                cloudSyncState.value = 'syncing';
                try {
                    const projRef = db.collection('site_projects').doc(code);
                    const [projDoc, pagesSnap, mediaMap] = await Promise.all([withRetry(() => withTimeout(projRef.get())), withRetry(() => withTimeout(projRef.collection('pages').get())), loadMediaMapFromRef(projRef)]);
                    if (!projDoc.exists) { cloudSyncState.value = hasUnsavedCloudChanges.value ? 'queued' : 'ready'; return; }
                    const pd = projDoc.data(); if (pd.name) project.name = pd.name; if (pd.date) project.date = pd.date; if (pd.lastModifiedBy) project.lastModifiedBy = pd.lastModifiedBy;
                    const deletedSet = new Set([...(project.deletedPageIds || []), ...(pd.deletedPageIds || [])]); project.deletedPageIds = [...deletedSet];
                    const deletedPins = new Set([...(project.deletedPinIds || []).map(String), ...((pd.deletedPinIds || []).map(String))]); project.deletedPinIds = [...deletedPins];

                    const cloudPages = pagesSnap.docs.map(doc => { const r = doc.data(); return makeEmptyPage({ id: doc.id, ...r, date: r.date || pd.date || getTodayStr(), photo: (r.photoId && mediaMap.get(r.photoId)?.photo) || mediaMap.get('page_' + (r.id || doc.id))?.photo || r.photo || null, pins: (r.pins || []).map(pin => ({ ...pin, photo: (pin.photoId && mediaMap.get(pin.photoId)?.photo) || mediaMap.get(String(pin.id))?.photo || pin.photo || null })) }); });
                    const localOrderNewer = (project.pageOrderUpdatedAt || 0) > (pd.pageOrderUpdatedAt || 0); if (!localOrderNewer && pd.pageOrderUpdatedAt) project.pageOrderUpdatedAt = pd.pageOrderUpdatedAt;
                    const orderList = localOrderNewer ? [...pages.value.map(p => p.id), ...(pd.pageIds || [])] : [...(pd.pageIds || []), ...pages.value.map(p => p.id)];
                    const merged = mergePagesSmart(pages.value, cloudPages, deletedSet, orderList);
                    if (merged.length) { pages.value = merged; if (activePageIndex.value >= pages.value.length) activePageIndex.value = pages.value.length - 1; if (activePin.value && activePage.value) activePin.value = (activePage.value.pins || []).find(p => String(p.id) === String(activePin.value.id)) || null; }
                    project.lastSyncAt = Date.now(); if (dirtyPageIds.size === 0 && !hasUnsavedCloudChanges.value) hasUnsavedCloudChanges.value = false;
                    await saveAll(); cloudSyncState.value = hasUnsavedCloudChanges.value ? 'queued' : 'ready';
                } catch (e) { cloudSyncState.value = navigator.onLine ? 'queued' : 'offline'; if (throwErr) throw e; }
            };

            const startRealtimeListener = (code) => {
                if (unsubPages) { unsubPages(); unsubPages = null; }
                if (!db || !code) return; let first = true;
                unsubPages = db.collection('site_projects').doc(String(code)).collection('pages').onSnapshot(async (snap) => {
                    if (first) { first = false; return; }
                    if (isPushing || currentView.value === 'dir' || snap.metadata.hasPendingWrites || isDrawing.value || isPinching || showTopSheet.value || showTopTextBar.value) return;
                    await pullAndMergeFromCloud(code, false); showToast('🔄 已同步同事最新圖紙');
                }, () => {});
            };

            const uploadMediaWithChunks = async (projRef, code, docKey, photoB64, meta, onStatus) => {
                if (!photoB64) return; const cacheKey = `synced_media_${code}_${docKey}_${photoB64.length}`; if (await localforage.getItem(cacheKey)) return;
                const mediaRef = projRef.collection('media').doc(docKey), totalChunks = Math.ceil(photoB64.length / CHUNK_SIZE);
                try { const ex = await withTimeout(mediaRef.get(), 10000); if (ex.exists && ex.data().chunked && ex.data().totalChunks === totalChunks && ex.data().byteLen === photoB64.length) { await localforage.setItem(cacheKey, true); return; } } catch (_) {}
                for (let i = 0; i < totalChunks; i++) { if (onStatus) onStatus(`切片 ${i + 1}/${totalChunks}`); await withRetry(() => withTimeout(mediaRef.collection('chunks').doc(String(i)).set({ index: i, data: photoB64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) }), 20000)); }
                await withRetry(() => withTimeout(mediaRef.set({ chunked: true, totalChunks, byteLen: photoB64.length, w: meta.w || 1200, h: meta.h || 900, author: meta.author || '', updatedAt: meta.updatedAt || Date.now() }, { merge: true }), 15000));
                await localforage.setItem(cacheKey, true);
            };

            const pushProjectPayload = async (projObj, isCurrentOpen = true, onProgress = null) => {
                const code = String(projObj.code || '').trim(); if (!db || !code || !navigator.onLine) return false;
                const projRef = db.collection('site_projects').doc(code), now = Date.now(), lastSync = projObj.lastSyncAt || 0, rawPages = projObj.pages || [];
                const targetList = isCurrentOpen ? rawPages.filter(pg => dirtyPageIds.has(pg.id) || (pg.updatedAt || 0) > lastSync) : rawPages;
                const dirtyPages = JSON.parse(JSON.stringify(targetList)).map(pg => { delete pg.historyStack; delete pg.redoStack; (pg.pins || []).forEach(p => { delete p.historyStack; delete p.redoStack; }); return pg; });
                const projPatch = { code, name: projObj.name || '', date: projObj.date || getTodayStr(), pageIds: rawPages.map(p => p.id), pageOrderUpdatedAt: projObj.pageOrderUpdatedAt || now, deletedPageIds: projObj.deletedPageIds?.length ? firebase.firestore.FieldValue.arrayUnion(...projObj.deletedPageIds) : [], deletedPinIds: projObj.deletedPinIds?.length ? firebase.firestore.FieldValue.arrayUnion(...projObj.deletedPinIds) : [], updatedAt: now };
                if (dirtyPages.length > 0 && authorName.value) projPatch.lastModifiedBy = authorName.value;
                await withRetry(() => withTimeout(projRef.set(projPatch, { merge: true }), 15000));

                for (let idx = 0; idx < dirtyPages.length; idx++) {
                    const pg = dirtyPages[idx], { photo: pagePhoto, pins, ...restPage } = pg;
                    if (pagePhoto && !pg.isSketch) await uploadMediaWithChunks(projRef, code, pg.photoId || ('page_' + pg.id), pagePhoto, { w: pg.w, h: pg.h, author: pg.author || authorName.value || '', updatedAt: now }, (st) => onProgress?.(`上傳第 ${idx + 1}/${dirtyPages.length} 頁 (${st})...`));
                    const pinsMeta = [];
                    for (let pIdx = 0; pIdx < (pins || []).length; pIdx++) {
                        const { photo: pinPhoto, ...restPin } = pins[pIdx]; pinsMeta.push({ ...restPin, hasPhoto: !!pinPhoto });
                        if (pinPhoto && !pins[pIdx].isSketch) await uploadMediaWithChunks(projRef, code, pins[pIdx].photoId || String(pins[pIdx].id), pinPhoto, { w: pins[pIdx].w, h: pins[pIdx].h, author: authorName.value || '', updatedAt: now }, (st) => onProgress?.(`上傳 P${idx + 1} 釘#${pIdx + 1} (${st})...`));
                    }
                    onProgress?.(`儲存第 ${idx + 1}/${dirtyPages.length} 頁標註...`);
                    await withRetry(() => withTimeout(projRef.collection('pages').doc(pg.id).set({ ...restPage, updatedAt: now, hasPhoto: !!pagePhoto, pins: pinsMeta }, { merge: true }), 15000));
                }
                await updateQueue(code, false); return now;
            };

            const pushToCloud = async (throwErr = false, onProgress = null) => {
                const code = String(project.code || '').trim(); if (!db || !code) return;
                if (!navigator.onLine) { await saveAll(); cloudSyncState.value = 'offline'; if (throwErr) throw new Error('目前無網絡'); return; }
                isPushing = true; cloudSyncState.value = 'syncing';
                try {
                    const now = await pushProjectPayload({ code, name: project.name, date: project.date, pages: pages.value, deletedPageIds: project.deletedPageIds, deletedPinIds: project.deletedPinIds, pageOrderUpdatedAt: project.pageOrderUpdatedAt, lastSyncAt: project.lastSyncAt }, true, onProgress);
                    dirtyPageIds.clear(); project.lastSyncAt = now; cloudSyncState.value = 'ready'; hasUnsavedCloudChanges.value = false; await saveAll();
                } catch (e) { await saveAll(); cloudSyncState.value = navigator.onLine ? 'queued' : 'offline'; if (throwErr) throw e; } finally { setTimeout(() => { isPushing = false; }, 1000); }
            };

            const createCloudBackup = async (code) => {
                if (!db || !navigator.onLine) return; const localData = await localforage.getItem('proj_' + code); if (!localData) return;
                const bData = JSON.parse(JSON.stringify(localData)); delete bData.photoPool; bData.pages.forEach(p => { delete p.photo; (p.pins || []).forEach(pin => delete pin.photo); });
                const ref = db.collection('site_projects').doc(code).collection('backups'), ts = Date.now();
                await withRetry(() => withTimeout(ref.doc(String(ts)).set({ timestamp: ts, author: authorName.value || '未知', data: JSON.stringify(bData) })));
                const snaps = await ref.orderBy('timestamp', 'desc').get(); let i = 0; snaps.forEach(d => { if (++i > 5) d.ref.delete(); });
            };

            const processPendingUploadQueue = async (silent = true) => {
                if (isAutoQueueing || !navigator.onLine || !db || isDrawing.value || isPinching || showTopSheet.value || showTopTextBar.value || showBranchPrompt.value) return;
                const queue = (await localforage.getItem('pending_upload_queue')) || []; if (!queue.length) return; isAutoQueueing = true;
                try {
                    for (const qCode of [...queue]) {
                        if (!navigator.onLine) break;
                        if (currentView.value !== 'dir' && String(project.code) === String(qCode)) { await pullAndMergeFromCloud(qCode, false); await pushToCloud(true); await createCloudBackup(qCode); if (!silent) showToast(`✅ #${qCode} 已自動上傳`); }
                        else { const saved = await localforage.getItem('proj_' + qCode); if (!saved) { await updateQueue(qCode, false); continue; } saved.lastSyncAt = await pushProjectPayload(saved, false, null); saved.pendingUpload = false; await localforage.setItem('proj_' + qCode, saved); await createCloudBackup(qCode); showToast(`✅ 網絡已恢復，#${qCode} 已自動上傳`); }
                    }
                    if (currentView.value === 'dir') await loadProjectList();
                } catch (_) {} finally { isAutoQueueing = false; }
            };

            const uploadNow = async () => {
                if (!project.code) return; await saveAll(); if (!navigator.onLine) { cloudSyncState.value = 'offline'; showToast('📴 無網絡：已鎖入本機，有訊號自動上傳'); return; }
                isProcessing.value = true; processingText.value = '正在智能合併並分片上傳...';
                try { await pullAndMergeFromCloud(project.code, false); await pushToCloud(true, (st) => { processingText.value = st; }); await createCloudBackup(project.code); showToast('✅ 100% 上傳成功'); } catch (_) { showToast('⚠️ 網絡波動，已加入自動補傳隊列'); } finally { isProcessing.value = false; }
            };

            const downloadNow = async () => {
                if (!project.code) return; if (!navigator.onLine) { showToast('📴 目前無網絡，顯示本機最新資料'); return; }
                isProcessing.value = true; processingText.value = '正在載入最新進度...';
                try { await pullAndMergeFromCloud(project.code, true); showToast('✅ 已合併雲端最新資料'); } catch (e) { alert('載入失敗：' + e.message); } finally { isProcessing.value = false; }
            };

            const createNewProject = async () => {
                await checkAuthorName(); resetZoom(); const today = getTodayStr(), firstPg = makeEmptyPage({ date: today });
                Object.assign(project, { code: Math.floor(100000 + Math.random() * 900000).toString(), name: '', date: today, deletedPageIds: [], deletedPinIds: [], pageOrderUpdatedAt: Date.now(), lastSyncAt: 0, lastModifiedBy: authorName.value });
                pages.value = [firstPg]; photoPool.value = []; activePageIndex.value = 0; activePin.value = null; dirtyPageIds.clear(); dirtyPageIds.add(firstPg.id); hasUnsavedCloudChanges.value = true;
                cloudSyncState.value = navigator.onLine ? 'queued' : 'offline'; currentView.value = 'proj'; await saveAll(); startRealtimeListener(project.code);
            };

            const copyCode = (code) => { navigator.clipboard?.writeText(code); showToast('已複製工程碼：#' + code); showManageModal.value = false; };
            const joinProjectByCode = async () => {
                await checkAuthorName(); const code = String(inputJoinCode.value || '').trim(); if (code.length !== 6) return alert('請輸入 6 位數字工程碼'); if (!navigator.onLine) return alert('連通新工程碼需要網絡連線');
                isProcessing.value = true; processingText.value = '正在連通 #' + code + '...';
                try { const doc = await withRetry(() => withTimeout(db.collection('site_projects').doc(code).get(), 15000)); if (!doc.exists) return alert('雲端找不到工程碼 #' + code); showJoinModal.value = false; inputJoinCode.value = ''; await loadProject(code, true); showToast('✅ 已連通 #' + code); } catch (e) { alert('連線失敗：' + e.message); } finally { isProcessing.value = false; }
            };

            const loadProject = async (code, openAsPreview = true) => {
                resetZoom(); code = String(code); project.code = code; project.deletedPageIds = []; project.deletedPinIds = []; project.pageOrderUpdatedAt = 0; pages.value = []; photoPool.value = []; dirtyPageIds.clear();
                const d = await localforage.getItem('proj_' + code);
                if (d) { Object.assign(project, { name: d.name || '', date: d.date || '', deletedPageIds: d.deletedPageIds || [], deletedPinIds: d.deletedPinIds || [], pageOrderUpdatedAt: d.pageOrderUpdatedAt || 0, lastSyncAt: d.lastSyncAt || 0, lastModifiedBy: d.lastModifiedBy || '' }); if (d.pages?.length) pages.value = d.pages.map(pg => makeEmptyPage(pg)); if (d.photoPool) photoPool.value = d.photoPool; hasUnsavedCloudChanges.value = !!d.pendingUpload; } else hasUnsavedCloudChanges.value = false;
                activePageIndex.value = 0; activePin.value = null; currentView.value = openAsPreview ? 'preview' : 'proj';
                await pullAndMergeFromCloud(code, false); if (!pages.value.length) pages.value = [makeEmptyPage()]; drawMode.value = 'browse'; startRealtimeListener(code);
            };

            const openManageMenu = (proj) => { manageProj.value = proj; showManageModal.value = true; };
            const renameProject = async () => {
                const newName = prompt('請輸入新的地址 / 名稱：', manageProj.value.name);
                if (newName !== null) { const trimmed = newName.trim(), code = String(manageProj.value.code), d = await localforage.getItem('proj_' + code); if (d) { d.name = trimmed; d.pendingUpload = true; await localforage.setItem('proj_' + code, d); await updateQueue(code, true); } manageProj.value.name = trimmed; if (db && navigator.onLine) db.collection('site_projects').doc(code).set({ name: trimmed, updatedAt: Date.now() }, { merge: true }).catch(() => {}); await loadProjectList(); showToast('✅ 已更新地址'); }
            };
            const duplicateProject = async () => { const d = await localforage.getItem('proj_' + manageProj.value.code); if (!d) return; const newCode = Math.floor(100000 + Math.random() * 900000).toString(); d.code = newCode; d.name = (d.name || '工程') + ' (副本)'; d.lastSyncAt = 0; d.pendingUpload = true; await localforage.setItem('proj_' + newCode, d); await updateQueue(newCode, true); showManageModal.value = false; await loadProjectList(); showToast('✅ 已複製為 #' + newCode); };
            const batchDeleteDocs = async (docs) => { for (let i = 0; i < docs.length; i += 400) { const b = db.batch(); docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit(); } };
            const deleteProject = async (code) => {
                if (prompt('⚠️ 輸入 "dd" 確認刪除此工程：')?.trim().toLowerCase() !== 'dd') return; isProcessing.value = true; processingText.value = '正在徹底刪除工程...';
                try { await localforage.removeItem('proj_' + code); await updateQueue(code, false); if (db && navigator.onLine) { const ref = db.collection('site_projects').doc(String(code)); const delCol = async (sub) => { const snap = await ref.collection(sub).get(); if (sub === 'media') { for (const doc of snap.docs) await batchDeleteDocs((await doc.ref.collection('chunks').get()).docs); } await batchDeleteDocs(snap.docs); }; await Promise.all([delCol('pages'), delCol('media'), delCol('backups')]); await ref.delete(); } showManageModal.value = false; await loadProjectList(); showToast('🗑️ 已徹底刪除'); } catch (e) { alert('清理異常：' + e.message); } finally { isProcessing.value = false; }
            };
            const cleanCloudGarbage = async () => {
                if (!db || !navigator.onLine) return alert('請檢查網路連線'); if (!confirm('🧹 掃描並徹底清除已刪除工程的殘留碎片？')) return; isProcessing.value = true; processingText.value = '正在清理雲端殘留垃圾...';
                try { const activeIds = new Set((await withTimeout(db.collection('site_projects').get(), 15000)).docs.map(d => d.id)); let removed = 0; for (const sub of ['chunks', 'media', 'pages', 'backups']) { const snap = await withTimeout(db.collectionGroup(sub).get(), 20000); const orphans = snap.docs.filter(d => { const p = d.ref.path.split('/'); return p[0] === 'site_projects' && p[1] && !activeIds.has(p[1]); }); await batchDeleteDocs(orphans); removed += orphans.length; } showToast(removed > 0 ? `🧹 已清理 ${removed} 筆殘留垃圾` : '✨ 雲端非常乾淨'); } catch (e) { alert('清理失敗：' + e.message); } finally { isProcessing.value = false; }
            };
            const openBackupList = async () => { showManageModal.value = false; isProcessing.value = true; processingText.value = '正在搜尋備份...'; try { const snaps = await withTimeout(db.collection('site_projects').doc(manageProj.value.code).collection('backups').get(), 15000); backupList.value = snaps.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); showBackupListModal.value = true; } catch (e) { alert('讀取失敗：' + e.message); } finally { isProcessing.value = false; } };
            const restoreBackup = async (bkId) => {
                isProcessing.value = true; processingText.value = '正在還原紀錄...';
                try {
                    const doc = await withTimeout(db.collection('site_projects').doc(manageProj.value.code).collection('backups').doc(bkId).get(), 15000);
                    const bData = JSON.parse(doc.data().data), newCode = Math.floor(100000 + Math.random() * 900000).toString();
                    bData.code = newCode; bData.name = (bData.name || '工程') + ' (還原檔)'; bData.lastSyncAt = 0; bData.pendingUpload = true;
                    const curLocal = await localforage.getItem('proj_' + manageProj.value.code);
                    if (curLocal) { const pMap = new Map(); curLocal.pages.forEach(p => { if (p.photo) pMap.set(p.id, p.photo); (p.pins || []).forEach(pin => { if (pin.photo) pMap.set(pin.id, pin.photo); }); }); bData.pages.forEach(p => { p.photo = pMap.get(p.id) || null; (p.pins || []).forEach(pin => { pin.photo = pMap.get(pin.id) || null; }); }); }
                    await localforage.setItem('proj_' + newCode, bData); await updateQueue(newCode, true); showBackupListModal.value = false; await loadProjectList(); showToast('✅ 已還原為 #' + newCode);
                } catch (e) { alert('還原失敗：' + e.message); } finally { isProcessing.value = false; }
            };

            const openCloudBrowser = async () => { if (!db || !navigator.onLine) return alert('請檢查網路連線'); isProcessing.value = true; processingText.value = '正在讀取雲端目錄...'; try { const snaps = await withTimeout(db.collection('site_projects').orderBy('updatedAt', 'desc').limit(30).get(), 10000); cloudProjectList.value = snaps.docs.map(d => ({ code: d.id, ...d.data() })).filter(d => d.name || d.updatedAt); showCloudBrowser.value = true; } catch (e) { alert('讀取目錄失敗：' + e.message); } finally { isProcessing.value = false; } };
            const downloadFromCloudBrowser = async (code) => { showCloudBrowser.value = false; await loadProject(code, true); showToast('✅ 已載入 #' + code); };
            const loadProjectList = async () => { const keys = await localforage.keys(), q = (await localforage.getItem('pending_upload_queue')) || [], list = []; for (const k of keys) { if (k.startsWith('proj_')) { const d = await localforage.getItem(k); if (d?.code) { const pgs = d.pages || []; list.push({ code: d.code, name: d.name, date: d.date, pageCount: pgs.length || 1, pinCount: pgs.reduce((s, p) => s + (p.pins?.length || 0), 0), updatedAt: d.updatedAt || 0, lastModifiedBy: d.lastModifiedBy || '', pendingUpload: !!d.pendingUpload || q.includes(String(d.code)) }); } } } projectList.value = list.sort((a, b) => b.updatedAt - a.updatedAt); };
            const backToProjects = async () => { resetZoom(); if (unsubPages) { unsubPages(); unsubPages = null; } await saveAll(); if ((hasUnsavedCloudChanges.value || dirtyPageIds.size > 0) && project.code && db) { if (!navigator.onLine) showToast('📴 無網絡模式：已鎖入本機，有訊號自動上傳'); else { isProcessing.value = true; processingText.value = '正在自動上傳並返回目錄...'; try { await pullAndMergeFromCloud(project.code, false); await pushToCloud(true, (st) => { processingText.value = st; }); await createCloudBackup(project.code); showToast('✅ 已自動同步雲端'); } catch (_) { showToast('⚠️ 已排入自動補傳隊列'); } finally { isProcessing.value = false; } } } dirtyPageIds.clear(); hasUnsavedCloudChanges.value = false; await loadProjectList(); currentView.value = 'dir'; };
            const checkAuthorName = async () => { let name = await localforage.getItem('measure_author_name'); if (!name) { name = prompt('👤 請輸入您的稱呼或設備名稱 (例: 明哥、強哥iPad)：')?.trim(); if (name) await localforage.setItem('measure_author_name', name); } authorName.value = name || ''; };
            const changeAuthorName = async () => { const name = prompt('👤 更新設備稱呼：', authorName.value)?.trim(); if (name) { authorName.value = name; await localforage.setItem('measure_author_name', name); } };

            const fallbackCopyTextToClipboard = (text) => { const textArea = document.createElement("textarea"); textArea.value = text; textArea.style.top = "0"; textArea.style.left = "0"; textArea.style.position = "fixed"; document.body.appendChild(textArea); textArea.focus(); textArea.select(); try { document.execCommand('copy'); showToast('🔗 已複製 WhatsApp 專屬連結，可直接發送'); } catch (err) { window.prompt("請手動複製以下連結：", text); } document.body.removeChild(textArea); };
            const copyShareLink = () => {
                const code = String(project.code || '').trim(); if (!code) return; let baseUrl = window.location.href.split('index.html')[0]; if (!baseUrl.endsWith('/')) baseUrl += '/'; const link = baseUrl + 'view.html?code=' + code; const msg = `📋 工程度尺圖 (#${code})\n📍 地址：${project.name || '未標題'}\n👉 點擊檢視：\n${link}`;
                if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(msg).then(() => { showToast('🔗 已複製 WhatsApp 專屬連結，可直接發送'); }).catch(() => fallbackCopyTextToClipboard(msg)); } else { fallbackCopyTextToClipboard(msg); }
            };

            onMounted(async () => {
                const bs = document.getElementById('boot-screen'); if (bs) bs.remove(); document.getElementById('app').style.display = 'flex';
                await loadCustomStamps(); await checkAuthorName(); await loadProjectList();
                window.addEventListener('online', () => { cloudSyncState.value = 'ready'; showToast('🌐 網絡已恢復'); processPendingUploadQueue(false); }); window.addEventListener('offline', () => { cloudSyncState.value = 'offline'; }); window.addEventListener('paste', handleGlobalPaste); window.addEventListener('keydown', handleGlobalKeydown);
                if (navigator.onLine) setTimeout(() => processPendingUploadQueue(false), 1500); setInterval(() => { if (navigator.onLine) processPendingUploadQueue(true); }, 15000);
            });

            const renderAnnotatedCanvas = (canvasObj, includeStamp = true, itemDate = '', itemAuthor = '') => new Promise(async (resolve) => {
                const img = new Image(); img.src = canvasObj.photo; await new Promise(r => { img.onload = r; img.onerror = r; });
                const c = document.createElement('canvas'), w = canvasObj.w || 1200, h = canvasObj.h || 900; c.width = w; c.height = h; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
                const markerImages = {}; for (const m of (canvasObj.markers || [])) { if (m.type === 'image' && m.data.b64) { const im = new Image(); im.src = m.data.b64; await new Promise(r => { im.onload = r; im.onerror = r; }); markerImages[m.id] = im; } }
                if (includeStamp) { const wmLines = buildWatermarkLines(canvasObj, itemDate, itemAuthor); if (wmLines.length) { ctx.font = '900 23px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; wmLines.forEach((item, idx) => { const y = 26 + idx * 32; ctx.lineWidth = 6; ctx.strokeStyle = '#ffffff'; ctx.strokeText(item.text, 22, y); ctx.fillStyle = item.color === '#ffffff' ? '#111827' : (item.color === '#facc15' ? '#d97706' : item.color); ctx.fillText(item.text, 22, y); }); } }
                ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                (canvasObj.walls || []).forEach(wObj => { ctx.strokeStyle = wObj.color || '#111827'; buildWallSegments(wObj).forEach(seg => { ctx.lineWidth = seg.isHatch ? 2.5 : 3.5; ctx.beginPath(); ctx.moveTo(seg.x1, seg.y1); ctx.lineTo(seg.x2, seg.y2); ctx.stroke(); }); });
                (canvasObj.lines || []).forEach(l => {
                    if (l.type === 'arrow-single') { const hex = getLineStroke(l); ctx.strokeStyle = hex; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke(); ctx.save(); ctx.fillStyle = hex; ctx.translate(l.x2, l.y2); ctx.rotate(Math.atan2(l.y2 - l.y1, l.x2 - l.x1)); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-9, 4.5); ctx.lineTo(-9, -4.5); ctx.closePath(); ctx.fill(); ctx.restore(); }
                    else { ctx.strokeStyle = getLineStroke(l, 0.55); ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke(); }
                });
                (canvasObj.paths || []).forEach(p => { ctx.strokeStyle = p.color || '#3b82f6'; ctx.lineWidth = 6; ctx.stroke(new Path2D(p.d)); });
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                (canvasObj.markers || []).forEach(m => { if (m.type === 'image') { if (markerImages[m.id]) ctx.drawImage(markerImages[m.id], m.x - m.w / 2, m.y - m.h / 2, m.w, m.h); } else { const lines = getMarkerLines(m), color = getStampColor(m); ctx.font = `900 ${28 * globalFontScale.value}px sans-serif`; const startY = m.y - ((lines.length - 1) * 34 * globalFontScale.value) / 2; lines.forEach((line, i) => { const y = startY + i * 34 * globalFontScale.value; ctx.lineWidth = 7 * globalFontScale.value; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round'; ctx.strokeText(line, m.x, y); ctx.fillStyle = color; ctx.fillText(line, m.x, y); }); } });
                (canvasObj.pins || []).forEach((pin, idx) => { const px = (pin.x / 100) * w, py = (pin.y / 100) * h; ctx.beginPath(); ctx.arc(px, py - 22, 20, 0, 2 * Math.PI); ctx.fillStyle = '#dc2626'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = 'bold 22px sans-serif'; ctx.fillText(idx + 1, px, py - 22); }); resolve(c);
            });

            const copyFullScreenImage = async () => { if (!fullScreenItem.value?.photo) return; const c = await renderAnnotatedCanvas(fullScreenItem.value, showWatermark.value, fullScreenDate.value, fullScreenAuthor.value); try { if (navigator.clipboard && window.ClipboardItem) { const blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(), 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); showToast('✅ 已複製圖片'); return; } } catch (_) {} try { const blob = await new Promise(res => c.toBlob(res, 'image/png')); const file = new File([blob], 'measure.png', { type: 'image/png' }); if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (_) {} alert('此瀏覽器不支援直接複製圖片，請按旁邊「⬇️下載」'); };
            const downloadFullScreenImage = async () => { if (!fullScreenItem.value?.photo) return; try { const dStr = sanitizeFilename(fullScreenDate.value || getTodayStr()); const c = await renderAnnotatedCanvas(fullScreenItem.value, showWatermark.value, fullScreenDate.value, fullScreenAuthor.value); const url = URL.createObjectURL(await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92))); const a = document.createElement('a'); a.href = url; a.download = `${sanitizeFilename(project.name || '工程')}_#${project.code}_${sanitizeFilename(currentFullScreen.value?.label || '圖紙')}_${dStr}.jpg`; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 2000); showToast('✅ 已下載圖片'); } catch (_) { alert('下載圖片失敗'); } };
            
            const exportPdfReport = async (perPage = 1) => {
                showPdfModal.value = false; isProcessing.value = true; processingText.value = `正在產生 PDF (每頁 ${perPage} 張)...`;
                setTimeout(async () => {
                    try {
                        const { jsPDF } = window.jspdf, doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                        const PAGE_W = 1240, PAGE_H = 1754, validPages = [];
                        pages.value.forEach((pg, pIdx) => { const pgDate = pg.date || project.date || getTodayStr(), pgAuthor = pg.author || project.lastModifiedBy || '未知'; if (pg.photo) validPages.push({ ...pg, date: pgDate, author: pgAuthor, pdfLabel: `P${pIdx + 1}${pg.space ? ' [' + pg.space + ']' : ''}` }); (pg.pins || []).forEach((pin, pinIdx) => { if (pin.photo) validPages.push({ ...pin, date: pgDate, author: pgAuthor, pdfLabel: `P${pIdx + 1} 📍釘選#${pinIdx + 1}${pin.space ? ' [' + pin.space + ']' : ''}` }); }); });
                        if (!validPages.length) return alert('沒有可輸出的圖紙！');
                        const uniqueDates = [...new Set(validPages.map(p => p.date).filter(Boolean))]; const headerDate = uniqueDates.length > 1 ? `${uniqueDates[0]} ~ ${uniqueDates[uniqueDates.length - 1]}` : (uniqueDates[0] || getTodayStr()); const fileDateTag = sanitizeFilename(uniqueDates[uniqueDates.length - 1] || getTodayStr());
                        if (perPage > 1) {
                            const cols = perPage === 4 ? 2 : 1, rows = 2; const totalPdf = Math.ceil(validPages.length / perPage), mx = 45, topY = 115, gap = 24; const cellW = Math.floor((PAGE_W - mx * 2 - (cols - 1) * gap) / cols); const cellH = Math.floor((PAGE_H - topY - 45 - (rows - 1) * gap) / rows);
                            for (let pIdx = 0; pIdx < totalPdf; pIdx++) {
                                if (pIdx > 0) doc.addPage(); const c = document.createElement('canvas'); c.width = PAGE_W; c.height = PAGE_H; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H); ctx.fillStyle = '#000'; ctx.font = 'bold 34px sans-serif'; ctx.fillText(`${project.name || '工程度尺'} (#${project.code})`, mx, 60); ctx.font = 'bold 21px sans-serif'; ctx.fillStyle = '#4b5563'; ctx.fillText(`日期: ${headerDate}   |   共 ${validPages.length} 張   |   第 ${pIdx + 1} / ${totalPdf} 頁`, mx, 94);
                                for (let j = 0; j < perPage; j++) {
                                    const pg = validPages[pIdx * perPage + j]; if (!pg) break; const cx = mx + (j % cols) * (cellW + gap), cy = topY + Math.floor(j / cols) * (cellH + gap); ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 2; ctx.strokeRect(cx, cy, cellW, cellH); ctx.fillStyle = '#f3f4f6'; ctx.fillRect(cx + 1, cy + 1, cellW - 2, 44); ctx.fillStyle = '#111827'; ctx.font = 'bold 20px sans-serif'; ctx.fillText(`${pg.pdfLabel} (${pg.date})`.slice(0, cols === 1 ? 56 : 32), cx + 14, cy + 30);
                                    const im = await renderAnnotatedCanvas(pg, true, pg.date, pg.author); const maxW = cellW - 20, maxH = cellH - 60; let dw = maxW, dh = (im.height / im.width) * dw; if (dh > maxH) { dh = maxH; dw = (im.width / im.height) * dh; } ctx.drawImage(im, cx + 10 + (maxW - dw) / 2, cy + 52 + (maxH - dh) / 2, dw, dh);
                                } doc.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, 210, 297);
                            }
                        } else {
                            for (let i = 0; i < validPages.length; i++) {
                                if (i > 0) doc.addPage(); const pg = validPages[i], c = document.createElement('canvas'); c.width = PAGE_W; c.height = PAGE_H; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H); ctx.fillStyle = '#000'; ctx.font = 'bold 38px sans-serif'; ctx.fillText(`${project.name || '工程度尺'} (#${project.code}) — ${pg.pdfLabel}`, 50, 65); ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = '#4b5563'; ctx.fillText(`日期: ${pg.date}   |   最後修改: ${pg.author}`, 50, 102);
                                const im = await renderAnnotatedCanvas(pg, true, pg.date, pg.author); const maxW = PAGE_W - 100, maxH = PAGE_H - 180; let dw = maxW, dh = (im.height / im.width) * dw; if (dh > maxH) { dh = maxH; dw = (im.width / im.height) * dh; } ctx.drawImage(im, 50 + (maxW - dw) / 2, 130, dw, dh); doc.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, 210, 297);
                            }
                        }
                        const modeTag = perPage === 4 ? '4合1' : perPage === 2 ? '2合1' : '單頁'; doc.save(`${sanitizeFilename(project.name || '工程')}_#${project.code}_${fileDateTag}_${modeTag}.pdf`);
                    } catch (_) { alert('生成 PDF 失敗'); } finally { isProcessing.value = false; }
                }, 50);
            };

            return {
                offlineReady, currentView, fullScreenIndex, fullScreenList, fullScreenItem, fullScreenTitle, fullScreenWatermarkLines, showWatermark, getLineStroke, getWallSegments,
                zoomScale, invZoom, svgViewBox, stepZoom, resetZoom, onStageWheel, draggingPageIdx, dragOverPageIdx, startPageDrag,
                openFullScreenPreview, prevFullScreen, nextFullScreen, copyFullScreenImage, downloadFullScreenImage, enterEditMode, switchToPreview, duplicateCurrentPage,
                showMergeModal, mergeableGroups, mergePageGroup, showPdfModal, showPhotoPoolModal, photoPoolList, openPhotoPool, selectFromPhotoPool, deleteFromPhotoPool,
                projectList, project, pages, activePageIndex, activePage, activePin, activePinIndex, activeCanvas, canvasW, canvasH,
                showJoinModal, inputJoinCode, showAddPageModal, showSpaceModal, spaceList, authorName, changeAuthorName, hasUnsavedCloudChanges, markProjectChanged,
                showManageModal, manageProj, openManageMenu, renameProject, duplicateProject, showCloudBrowser, cloudProjectList, openCloudBrowser, downloadFromCloudBrowser, cleanCloudGarbage,
                showBackupListModal, backupList, openBackupList, restoreBackup, arrowColor, freehandColor, wallStyle, wallColor, cloudStatusText, cloudStatusClass, showCloudDetail, toastMsg, copyShareLink,
                customStamps, promptCustomStamp, drawMode, showTopSheet, showTopTextBar, activeMarker, isProcessing, processingText, focusedInput, topTextInputRef,
                showBranchPrompt, branchOwner, branchInputValue, confirmBranch, cancelBranch, svgCanvas, currentLine, currentWall, currentPath, hasUndoItems, hasRedoItems,
                createNewProject, loadProject, deleteProject, backToProjects, copyCode, joinProjectByCode, saveAll, downloadNow, uploadNow, prevPage, nextPage, deleteCurrentPage, openPinSubPage, exitPinSubPage, onPinTap, deleteActivePin,
                setPageSpace, addCustomSpace, initSketchOnCurrent, addNewSketchPage, toggleSketchGrid, handleImageUpload, pasteFromClipboard,
                onEraseTap, resizeImageMarker, startDrag, onStageTouchStart, onStageTouchMove, onStageTouchEnd, onStageMouseDown, onStageMouseMove, onStageMouseUp, undoLastAction, redoAction,
                deleteMarkerTop, switchMarkerType, closeTopSheet, closeTopTextBar, onMarkerTextInput, handleKeypad, applyTag, applyStamp, getStampColor, getMarkerLines, getTagFields, exportPdfReport,
                globalFontScale, toggleFontScale
            };
        }
    }).mount('#app');
}
