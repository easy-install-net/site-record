if (!window.Vue) {
    window.__showBootError?.('Vue 引擎載入失敗，請檢查網絡連線');
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
            if (!firebase.apps.length) {
                firebase.initializeApp({
                    apiKey: "AIzaSyCSRfZdAVh8ADPNtayW5lyDtmE0xDsJXNg",
                    authDomain: "gen-lang-client-0208380044.firebaseapp.com",
                    databaseURL: "https://gen-lang-client-0208380044-default-rtdb.firebaseio.com",
                    projectId: "gen-lang-client-0208380044",
                    storageBucket: "gen-lang-client-0208380044.firebasestorage.app",
                    messagingSenderId: "17077391191",
                    appId: "1:17077391191:web:f167a311052c56bd3d7812"
                });
            }
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

    const TEMPLATE_META = {
        door: { label: '門洞', fields: [{ key: 'w_in', label: '門闊' }, { key: 'h_in', label: '門高' }, { key: 't', label: '牆厚' }, { key: 't_frame', label: '門框厚' }, { key: 'h_top', label: '頂到天花' }, { key: 'w_side', label: '邊到牆' }] },
        window: { label: '窗', fields: [{ key: 'w_in', label: '內闊' }, { key: 'h_in', label: '內高' }, { key: 'd_in', label: '內深' }, { key: 'h_bottom', label: '面到地' }, { key: 't_stone', label: '窗石厚' }, { key: 'd_stone', label: '窗石凸' }] },
        beam: { label: '樑', fields: [{ key: 'w', label: '樑闊' }, { key: 'd', label: '樑深' }, { key: 'h_bottom', label: '底到地' }, { key: 'w_side', label: '樑邊到牆' }] },
        column: { label: '柱', fields: [{ key: 'w', label: '柱闊' }, { key: 'd', label: '柱深' }, { key: 'h_top', label: '柱高' }, { key: 'd_out', label: '柱凸出' }] },
        protrusion: { label: '凸', fields: [{ key: 'w', label: '闊' }, { key: 'h', label: '高' }, { key: 'd', label: '深' }] },
        pipe: { label: '包喉', fields: [{ key: 'w', label: '闊' }, { key: 'h', label: '高' }, { key: 'd', label: '深' }] },
        elec_box: { label: '電箱', fields: [{ key: 'w', label: '闊' }, { key: 'h', label: '高' }, { key: 'd', label: '深' }, { key: 'h_bottom', label: '底到地' }] },
        ac: { label: '冷氣', fields: [{ key: 'w', label: '闊' }, { key: 'h', label: '高' }, { key: 'd', label: '深' }, { key: 'h_bottom', label: '底到地' }] },
        skirting: { label: '地腳線', fields: [{ key: 'h', label: '高' }, { key: 't', label: '厚' }] },
        reserve: { label: '留位', fields: [{ key: 'w', label: '闊' }, { key: 'h', label: '高' }, { key: 'd', label: '深' }] },
        avoid: { label: '避', fields: [{ key: 'w', label: '闊' }, { key: 'h', label: '高' }, { key: 'd', label: '深' }] }
    };

    const templateRows = [
        [
            { id: 'general', l: '尺寸', f: 'val' }, { id: 'door', l: '門洞', f: 'w_in' }, { id: 'window', l: '窗', f: 'w_in' },
            { id: 'beam', l: '樑', f: 'w' }, { id: 'column', l: '柱', f: 'w' }, { id: 'protrusion', l: '凸', f: 'w' }
        ],
        [
            { id: 'pipe', l: '包喉', f: 'w' }, { id: 'elec_box', l: '電箱', f: 'w' }, { id: 'ac', l: '冷氣', f: 'w' },
            { id: 'skirting', l: '地腳線', f: 'h' }, { id: 'reserve', l: '留位', f: 'w' }, { id: 'avoid', l: '避', f: 'w' }
        ]
    ];

    const makeMarkerData = () => ({ val: '', name: '', w_in: '', h_in: '', d_in: '', w: '', d: '', h: '', t: '', h_bottom: '', t_stone: '', d_stone: '', t_frame: '', h_top: '', w_side: '', d_out: '' });

    const renderSketchDataUrl = (w, h, hasGrid) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
        if (hasGrid) {
            ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
            for (let x = 0; x <= w; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
            for (let y = 0; y <= h; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
        }
        return c.toDataURL('image/jpeg', 0.85);
    };

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

            const currentView = ref('dir'), showWatermark = ref(true), globalFontScale = ref(1.0);
            const dockCollapsed = ref(false), dockOffset = reactive({ x: 0, y: 0 });

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
                showToast(`🔠 字體：${globalFontScale.value === 1.0 ? '大' : (globalFontScale.value === 0.8 ? '中' : '細')}`);
            };

            const startDockDrag = (e) => {
                const sx = e.clientX, sy = e.clientY, ox = dockOffset.x, oy = dockOffset.y;
                const maxX = Math.max(80, window.innerWidth / 2 - 40), maxY = Math.max(120, window.innerHeight - 100);
                const onMove = (ev) => {
                    dockOffset.x = Math.max(-maxX, Math.min(maxX, ox + (ev.clientX - sx)));
                    dockOffset.y = Math.max(-maxY, Math.min(0, oy + (ev.clientY - sy)));
                };
                const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); };
                window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
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
            const onStageWheel = (e) => { if (svgCanvas.value && activeCanvas.value?.photo) applyZoomAtClientPoint(zoomScale.value * (e.deltaY < 0 ? 1.2 : 0.82), e.clientX, e.clientY, getCoords(e)); };

            const fullScreenIndex = ref(-1);
            const fullScreenList = computed(() => {
                const list = [];
                pages.value.forEach((pg, pIdx) => {
                    const d = pg.date || project.date || getTodayStr(), a = pg.author || project.lastModifiedBy || '';
                    if (pg.photo) list.push({ item: pg, pageIdx: pIdx, pinIdx: null, label: `P${pIdx + 1}${pg.space ? ' [' + pg.space + ']' : ''}`, date: d, author: a });
                    (pg.pins || []).forEach((pin, pinIdx) => { if (pin.photo) list.push({ item: pin, pageIdx: pIdx, pinIdx, label: `P${pIdx + 1} 📍釘#${pinIdx + 1}${pin.space ? ' [' + pin.space + ']' : ''}`, date: pin.date || d, author: pin.author || a }); });
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
            const editFromFullScreen = () => {
                const cur = currentFullScreen.value; if (!cur) return;
                fullScreenIndex.value = -1; resetZoom(); activePageIndex.value = cur.pageIdx;
                if (cur.pinIdx !== null && pages.value[cur.pageIdx]?.pins?.[cur.pinIdx]) openPinSubPage(pages.value[cur.pageIdx].pins[cur.pinIdx], cur.pinIdx);
                else activePin.value = null;
                currentView.value = 'proj'; drawMode.value = 'line';
            };

            const draggingPageIdx = ref(null), dragOverPageIdx = ref(null);
            const startPageDrag = (idx) => {
                if (pages.value.length <= 1) return;
                draggingPageIdx.value = idx; dragOverPageIdx.value = idx;
                const onMove = (ev) => { const card = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-page-idx]'); if (card) { const t = Number(card.getAttribute('data-page-idx')); if (!Number.isNaN(t)) dragOverPageIdx.value = t; } };
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
            const cloudStatusText = computed(() => ({ syncing: '☁️上傳', offline: '📴離線', queued: '⏳待傳', ready: '☁️v9.5' }[cloudSyncState.value] || '☁️v9.5'));
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
                else showToast('v9.5 懸浮工具窗・12格結構模板');
            };

            const photoFingerprint = (b64) => b64 ? b64.slice(0, 100) + '_' + b64.length : '';
