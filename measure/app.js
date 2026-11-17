if (!window.Vue || !window.MEASURE_DATA || !window.MEASURE_CAD || !window.MEASURE_EXPORT) {
    const missing = !window.Vue ? 'Vue 引擎' : (!window.MEASURE_DATA ? 'data.js' : (!window.MEASURE_CAD ? 'cad.js' : 'export.js'));
    const msg = `檔案 ${missing} 載入失敗，請檢查網絡或檔案是否齊全`;
    if (window.__showBootError) window.__showBootError(msg);
    else alert(msg);
} else {
    const { createApp, ref, reactive, computed, onMounted, onUnmounted, nextTick } = Vue;
    const { TAG_DEFS, TEMPLATE_ROWS, DIM_QUICK_ROWS, KEYPAD_KEYS, DEFAULT_SPACES, STAMP_PALETTE, DEFAULT_STAMP_SEED } = window.MEASURE_DATA;
    const { CAD_CATEGORIES, CAD_DEFS, CAD_LIST } = window.MEASURE_CAD;
    const { buildWallSegments, getLineStroke, buildWatermarkBox, copyAnnotatedImage, downloadAnnotatedImage, generatePdfReport } = window.MEASURE_EXPORT;

    localforage.config({ name: 'SiteMeasurePro', storeName: 'projects_store' });

    const offlineReady = ref(false);
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').then(() => { offlineReady.value = true; }).catch(() => {}));
        navigator.serviceWorker.ready.then(() => { offlineReady.value = true; }).catch(() => {});
    }

    let db = null, auth = null;
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
            if (typeof firebase.auth === 'function') auth = firebase.auth();
        }
    } catch (_) {}

    const withTimeout = (p, ms = 15000, msg = '雲端連線逾時，請檢查網路') => {
        let t;
        return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
    };
    const withRetry = async (fn, retries = 3, delay = 800) => {
        for (let i = 0; i <= retries; i++) {
            try { return await fn(); } catch (e) { if (i === retries) throw e; await new Promise(r => setTimeout(r, delay * (i + 1))); }
        }
    };

    const CHUNK_SIZE = 350000;
    const getTodayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const sanitizeFilename = (s) => String(s || '').trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');

    const renderSketchDataUrl = (w = 1200, h = 1500, hasGrid = true) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
        if (hasGrid) {
            ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1.5;
            for (let x = 50; x < w; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
            for (let y = 50; y < h; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
        }
        return c.toDataURL('image/jpeg', 0.85);
    };

    createApp({
        setup() {
            const authReady = ref(false);
            const currentUser = ref(null);
            const isGuestMode = ref(false);
            const isLoggingIn = ref(false);
            const authorName = ref(''), hasUnsavedCloudChanges = ref(false), dirtyPageIds = new Set();
            let unsubPages = null, unsubFeedback = null, isPushing = false, isAutoQueueing = false;

            const loginWithGoogle = async () => {
                if (!auth) return alert('登入模組載入中，請稍候或重新整理網頁');
                if (!navigator.onLine) return alert('目前無網絡連線，請先點「免登入離線進入」，有訊號後再綁定 Google 帳號');
                isLoggingIn.value = true;
                try {
                    const provider = new firebase.auth.GoogleAuthProvider();
                    provider.setCustomParameters({ prompt: 'select_account' });
                    await auth.signInWithPopup(provider);
                } catch (e) {
                    if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/cancelled-popup-request') {
                        try {
                            const provider = new firebase.auth.GoogleAuthProvider();
                            await auth.signInWithRedirect(provider);
                            return;
                        } catch (re) { alert('登入失敗：' + re.message); }
                    } else if (e?.code !== 'auth/popup-closed-by-user') {
                        alert('Google 登入失敗：' + (e?.message || '請確認 Firebase 後台已授權此網域'));
                    }
                } finally {
                    isLoggingIn.value = false;
                }
            };

            const enterAsGuest = async () => {
                isGuestMode.value = true;
                currentUser.value = null;
                authReady.value = true;
                await localforage.setItem('auth_session_v1', { guest: true });
                await checkAuthorName();
            };

            const logoutUser = async () => {
                if (!navigator.onLine && !confirm('⚠️ 目前無網絡連線，登出後需等有訊號才能重新登入 Google，確定要登出嗎？')) return;
                if (auth && navigator.onLine) await auth.signOut().catch(() => {});
                currentUser.value = null;
                isGuestMode.value = false;
                await localforage.removeItem('auth_session_v1');
                showToast('👋 已登出帳號');
            };

            const currentView = ref('dir'), showWatermark = ref(true), globalFontScale = ref(0.6);
            const defaultTextColor = ref('#ffffff');

            const stampCategories = ref([]);
            const stampItems = ref([]);
            const stampUpdatedAt = ref(0);
            const stampFilter = ref('hot');
            const showStampManagerModal = ref(false);
            const showNewCatForm = ref(false);
            const managerCatFilter = ref('all');
            const managerSearch = ref('');

            const newCatName = ref(''), newCatIcon = ref('📐'), newCatColor = ref('#38bdf8');
            const newStampText = ref(''), newStampCatId = ref(''), newStampColor = ref('#ffffff');
            const showQuickAddStamp = ref(false);
            let stampAutoSyncTimer = null;

            const saveStampStore = async () => {
                stampUpdatedAt.value = Date.now();
                await localforage.setItem('dynamic_stamp_store_v1', { categories: JSON.parse(JSON.stringify(stampCategories.value || [])), items: JSON.parse(JSON.stringify(stampItems.value || [])), updatedAt: stampUpdatedAt.value });
                if (currentUser.value?.uid && db && navigator.onLine) { clearTimeout(stampAutoSyncTimer); stampAutoSyncTimer = setTimeout(() => { syncStampLibraryCloud(true); }, 1500); }
            };

            const buildSeedStampData = () => {
                const cats = [], items = [];
                (DEFAULT_STAMP_SEED || []).forEach((g, gIdx) => {
                    cats.push({ id: g.id, icon: g.icon || '🏷️', name: g.name, defaultColor: g.defaultColor || '#ffffff' });
                    (g.items || []).forEach((txt, iIdx) => { items.push({ id: `st_${g.id}_${iIdx}_${gIdx}`, catId: g.id, text: txt, color: g.defaultColor || '#ffffff', count: 0, pinned: false }); });
                });
                return { cats, items };
            };

            const loadStampStore = async () => {
                const saved = await localforage.getItem('dynamic_stamp_store_v1');
                if (saved && Array.isArray(saved.categories) && Array.isArray(saved.items) && saved.categories.length) {
                    stampCategories.value = saved.categories; stampItems.value = saved.items; stampUpdatedAt.value = saved.updatedAt || Date.now();
                } else {
                    const { cats, items } = buildSeedStampData();
                    const legacyCustom = (await localforage.getItem('custom_stamps')) || [];
                    if (legacyCustom.length) { cats.unshift({ id: 'cat_custom', icon: '⭐', name: '自訂', defaultColor: '#ffffff' }); legacyCustom.forEach((txt, idx) => { if (!items.some(x => x.text === txt)) { items.unshift({ id: `st_legacy_${idx}`, catId: 'cat_custom', text: txt, color: '#ffffff', count: 1, pinned: true }); } }); }
                    stampCategories.value = cats; stampItems.value = items; await saveStampStore();
                }
                if (!newStampCatId.value && stampCategories.value.length) newStampCatId.value = stampCategories.value[0].id;
            };

            const hotStamps = computed(() => {
                const active = stampItems.value.filter(x => x.pinned || (x.count || 0) > 0);
                if (active.length > 0) return [...active].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.count || 0) - (a.count || 0)).slice(0, 18);
                return stampItems.value.slice(0, 12);
            });

            const filteredCanvasStampGroups = computed(() => stampCategories.value.filter(c => stampFilter.value === 'all' || stampFilter.value === c.id).map(c => ({ ...c, items: stampItems.value.filter(it => it.catId === c.id) })).filter(g => g.items.length > 0));
            const managerFilteredItems = computed(() => { const kw = String(managerSearch.value || '').trim().toLowerCase(); return stampItems.value.filter(it => { if (managerCatFilter.value === 'pinned' && !it.pinned) return false; if (managerCatFilter.value !== 'all' && managerCatFilter.value !== 'pinned' && it.catId !== managerCatFilter.value) return false; if (kw && !String(it.text || '').toLowerCase().includes(kw)) return false; return true; }); });
            const getCategoryById = (catId) => stampCategories.value.find(c => c.id === catId) || { id: catId, icon: '🏷️', name: '未分類', defaultColor: '#ffffff' };

            const openStampManager = () => { managerCatFilter.value = 'all'; managerSearch.value = ''; showNewCatForm.value = false; if (!newStampCatId.value && stampCategories.value.length) { newStampCatId.value = stampCategories.value[0].id; newStampColor.value = stampCategories.value[0].defaultColor || '#ffffff'; } showStampManagerModal.value = true; };
            const onSelectNewStampCat = () => { const cat = getCategoryById(newStampCatId.value); if (cat?.defaultColor) newStampColor.value = cat.defaultColor; };
            const addStampCategory = async () => { const name = String(newCatName.value || '').trim(); if (!name) return showToast('請輸入分類名稱（例如：收口、燈槽）'); if (stampCategories.value.some(c => c.name === name)) return showToast('此分類名稱已存在'); const id = 'cat_' + Date.now(); stampCategories.value.unshift({ id, icon: newCatIcon.value || '🏷️', name, defaultColor: newCatColor.value || '#ffffff' }); newCatName.value = ''; newStampCatId.value = id; newStampColor.value = newCatColor.value || '#ffffff'; showNewCatForm.value = false; await saveStampStore(); showToast(`✅ 已新增分類「${name}」`); };
            const deleteStampCategory = async (catId) => { const cat = getCategoryById(catId); const count = stampItems.value.filter(x => x.catId === catId).length; if (!confirm(`確定要刪除分類「${cat.name}」${count ? `及其內 ${count} 個印章` : ''}嗎？`)) return; stampCategories.value = stampCategories.value.filter(c => c.id !== catId); stampItems.value = stampItems.value.filter(it => it.catId !== catId); if (managerCatFilter.value === catId) managerCatFilter.value = 'all'; if (stampFilter.value === catId) stampFilter.value = 'hot'; if (newStampCatId.value === catId) newStampCatId.value = stampCategories.value[0]?.id || ''; await saveStampStore(); showToast(`🗑️ 已刪除分類「${cat.name}」`); };
            const addStampItem = async (applyImmediately = false) => { const txt = String(newStampText.value || '').trim(); if (!txt) return showToast('請輸入印章字眼'); const catId = newStampCatId.value || stampCategories.value[0]?.id || 'cat_finishing'; const color = newStampColor.value || '#ffffff'; let existing = stampItems.value.find(it => it.text === txt && it.catId === catId); if (!existing) { existing = { id: 'st_' + Date.now() + '_' + Math.floor(Math.random() * 999), catId, text: txt, color, count: 0, pinned: false }; stampItems.value.unshift(existing); } else { existing.color = color; } newStampText.value = ''; showQuickAddStamp.value = false; await saveStampStore(); if (applyImmediately && activeMarker.value) applyStamp(existing); else showToast(`✅ 已加入印章「${txt}」`); };
            const toggleStampPin = async (item) => { item.pinned = !item.pinned; await saveStampStore(); showToast(item.pinned ? `⭐ 已將「${item.text}」置頂到熱門` : `已取消「${item.text}」置頂`); };
            const setStampItemColor = async (item, hex) => { item.color = hex; await saveStampStore(); };
            const cycleStampItemColor = async (item) => { const idx = STAMP_PALETTE.findIndex(p => p.hex === (item.color || '#ffffff')); const next = STAMP_PALETTE[(idx + 1) % STAMP_PALETTE.length]; item.color = next.hex; await saveStampStore(); showToast(`🎨 顏色：${next.name}`); };
            const editStampItemText = async (item) => { const next = prompt('修改印章字眼：', item.text)?.trim(); if (next && next !== item.text) { item.text = next; await saveStampStore(); showToast('✅ 已更新印章字眼'); } };
            const deleteStampItem = async (itemId) => { stampItems.value = stampItems.value.filter(x => x.id !== itemId); await saveStampStore(); };
            const resetStampCounts = async () => { if (!confirm('確定要將所有印章的使用次數歸零嗎？（手動加星 ⭐ 置頂會保留）')) return; stampItems.value.forEach(it => { it.count = 0; }); await saveStampStore(); showToast('🔄 已重置熱門使用計數'); };
            const restoreDefaultStamps = async () => { if (!confirm('補回所有出廠預設分類與印章？（你自建的印章與計數會完整保留）')) return; const { cats, items } = buildSeedStampData(); cats.forEach(c => { if (!stampCategories.value.some(x => x.id === c.id)) stampCategories.value.push(c); }); items.forEach(it => { if (!stampItems.value.some(x => x.text === it.text && x.catId === it.catId)) stampItems.value.push(it); }); await saveStampStore(); showToast('✅ 已補回全部出廠預設印章'); };

            const syncStampLibraryCloud = async (silent = false) => {
                if (!db || !navigator.onLine) { if (!silent) alert('請檢查網絡連線後再同步印章庫'); return; }
                const libKey = currentUser.value?.uid ? ('uid_' + currentUser.value.uid) : (sanitizeFilename(authorName.value || 'shared_team') || 'shared_team');
                if (!silent) { isProcessing.value = true; processingText.value = '正在同步雲端印章庫...'; }
                try {
                    const docRef = db.collection('stamp_libraries').doc(libKey); const snap = await withTimeout(docRef.get(), 15000);
                    if (snap.exists) {
                        const cloud = snap.data() || {}, cCats = Array.isArray(cloud.categories) ? cloud.categories : [], cItems = Array.isArray(cloud.items) ? cloud.items : [];
                        const catMap = new Map(); [...cCats, ...stampCategories.value].forEach(c => { if (c?.id) catMap.set(c.id, c); }); stampCategories.value = Array.from(catMap.values());
                        const itemMap = new Map(); cItems.forEach(it => { if (it?.text) itemMap.set(`${it.catId}__${it.text}`, { ...it }); });
                        stampItems.value.forEach(it => { const k = `${it.catId}__${it.text}`; const ex = itemMap.get(k); if (ex) { itemMap.set(k, { ...it, count: Math.max(it.count || 0, ex.count || 0), pinned: !!(it.pinned || ex.pinned) }); } else { itemMap.set(k, { ...it }); } });
                        stampItems.value = Array.from(itemMap.values());
                    }
                    await localforage.setItem('dynamic_stamp_store_v1', { categories: JSON.parse(JSON.stringify(stampCategories.value || [])), items: JSON.parse(JSON.stringify(stampItems.value || [])), updatedAt: Date.now() });
                    await withTimeout(docRef.set({ owner: currentUser.value?.name || authorName.value || '團隊', uid: currentUser.value?.uid || '', categories: JSON.parse(JSON.stringify(stampCategories.value)), items: JSON.parse(JSON.stringify(stampItems.value)), updatedAt: Date.now() }, { merge: true }), 15000);
                    if (!silent) showToast(`☁️ 已雙向同步 ${stampItems.value.length} 個印章`);
                } catch (e) { if (!silent) alert('印章庫同步失敗：' + e.message); } finally { if (!silent) isProcessing.value = false; }
            };

            const cadCategory = ref('arch'), selectedCadType = ref('door_single');
            const filteredCadList = computed(() => CAD_LIST.filter(x => x.cat === cadCategory.value));
            const getCadDef = (type) => CAD_DEFS[type] || null;
            const getCadTransform = (m) => `translate(${m.x}, ${m.y}) rotate(${m.rot || 0}) scale(${(m.scale || 1) * (m.flipX || 1)}, ${(m.scale || 1) * (m.flipY || 1)})`;

            const projectList = ref([]), allProjectOptions = ref([]);
            const project = reactive({ code: '', name: '', nameUpdatedAt: 0, date: '', deletedPageIds: [], deletedPinIds: [], pageOrderUpdatedAt: 0, lastSyncAt: 0, lastModifiedBy: '' });
            const pages = ref([]), photoPool = ref([]);
            const splitMode = ref(false), activePane = ref('A'), activePageIndex = ref(0), activePin = ref(null), activePinIndex = ref(0), pageIndexB = ref(0), pinB = ref(null), pinIndexB = ref(0);
            const activePage = computed(() => pages.value[activePageIndex.value] || null);
            const activeCanvas = computed(() => activePin.value || activePage.value);
            const canvasW = computed(() => activeCanvas.value?.w || 1200), canvasH = computed(() => activeCanvas.value?.h || 900);
            const pageB = computed(() => pages.value[pageIndexB.value] || null);
            const canvasB = computed(() => pinB.value || pageB.value);
            const canvasWB = computed(() => canvasB.value?.w || 1200), canvasHB = computed(() => canvasB.value?.h || 900);
            const targetPage = computed(() => (splitMode.value && activePane.value === 'B') ? pageB.value : activePage.value);
            const targetPin = computed(() => (splitMode.value && activePane.value === 'B') ? pinB.value : activePin.value);
            const targetCanvas = computed(() => (splitMode.value && activePane.value === 'B') ? canvasB.value : activeCanvas.value);
            const targetCanvasW = computed(() => targetCanvas.value?.w || 1200), targetCanvasH = computed(() => targetCanvas.value?.h || 900);

            const focusPane = (pane) => { if (activePane.value !== pane) activePane.value = pane; };
            const toggleSplitMode = () => { splitMode.value = !splitMode.value; if (splitMode.value) { if (pages.value.length > 1 && pageIndexB.value === activePageIndex.value) pageIndexB.value = activePageIndex.value === 0 ? 1 : 0; pinB.value = null; resetZoomB(); activePane.value = 'A'; showToast('⊞ 已開啟雙頁並排編輯'); } else { activePane.value = 'A'; } };

            const feedbackList = ref([]), showFeedbackOverlay = ref(true), showFeedbackModal = ref(false);
            const currentCanvasFeedbacks = computed(() => { const pgId = String(activePage.value?.id || ''), pinId = activePin.value ? String(activePin.value.id) : ''; return pgId ? feedbackList.value.filter(f => String(f.pageId || '') === pgId && String(f.pinId || '') === pinId) : []; });
            const canvasBFeedbacks = computed(() => { const pgId = String(pageB.value?.id || ''), pinId = pinB.value ? String(pinB.value.id) : ''; return pgId ? feedbackList.value.filter(f => String(f.pageId || '') === pgId && String(f.pinId || '') === pinId) : []; });
            const pageFeedbackCount = (pgId) => feedbackList.value.filter(f => String(f.pageId || '') === String(pgId)).length;
            const jumpToFeedback = (fb) => { showFeedbackModal.value = false; resetZoom(); showQuickPageNav.value = false; activePane.value = 'A'; const pIdx = pages.value.findIndex(p => String(p.id) === String(fb.pageId)); if (pIdx === -1) { showToast('⚠️ 該意見所屬頁面已不存在'); return; } activePageIndex.value = pIdx; if (fb.pinId) { const targetPinIdx = (pages.value[pIdx].pins || []).findIndex(x => String(x.id) === String(fb.pinId)); if (targetPinIdx !== -1) openPinSubPage(pages.value[pIdx].pins[targetPinIdx], targetPinIdx, 'A'); else activePin.value = null; } else activePin.value = null; showFeedbackOverlay.value = true; drawMode.value = 'browse'; currentView.value = 'proj'; };
            const resolveFeedback = async (fbId) => { if (!db || !project.code || !fbId || !navigator.onLine) { showToast('📴 請在有網絡連線時清除意見'); return; } try { await db.collection('site_projects').doc(String(project.code)).collection('feedback').doc(String(fbId)).delete(); feedbackList.value = feedbackList.value.filter(x => x.id !== fbId); showToast('✅ 已跟進並清除該條意見'); } catch (_) { showToast('⚠️ 清除失敗，請稍後再試'); } };

            const masterPages = computed(() => pages.value.map((pg, idx) => ({ pg, idx })).filter(x => x.pg.space === '總圖'));
            const showQuickPageNav = ref(false), showQuickPageNavB = ref(false);
            const jumpToPage = (idx) => { showQuickPageNav.value = false; switchPage(idx, 'A'); };
            const jumpToPageB = (idx) => { showQuickPageNavB.value = false; switchPage(idx, 'B'); };
            const jumpToPageById = (targetId, pane = activePane.value) => { if (!targetId) return; const idx = pages.value.findIndex(p => String(p.id) === String(targetId)); if (idx !== -1) { switchPage(idx, pane); showToast(`↪️ 已跳轉至 P${idx + 1}${pages.value[idx].space ? ' [' + pages.value[idx].space + ']' : ''}`); } else showToast('⚠️ 連結的目標頁面已不存在'); };
            const goToMasterPlan = (pane = 'A') => { if (!masterPages.value.length) return; if (masterPages.value.length === 1) { pane === 'B' ? jumpToPageB(masterPages.value[0].idx) : jumpToPage(masterPages.value[0].idx); } else { if (pane === 'B') showQuickPageNavB.value = !showQuickPageNavB.value; else showQuickPageNav.value = !showQuickPageNav.value; } };

            const capsuleOffset = reactive({ x: 0, y: 0 }), capsuleCollapsed = ref(false);
            const startCapsuleDrag = (e) => { const sx = e.clientX, sy = e.clientY, ox = capsuleOffset.x, oy = capsuleOffset.y; const onMove = (ev) => { const maxX = Math.max(60, window.innerWidth / 2 - 50); capsuleOffset.x = Math.max(-maxX, Math.min(maxX, ox + (ev.clientX - sx))); capsuleOffset.y = Math.max(-6, Math.min(window.innerHeight - 130, oy + (ev.clientY - sy))); }; const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); }; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp); };

            const zoomScale = ref(1), vbX = ref(0), vbY = ref(0), invZoom = computed(() => 1 / Math.pow(zoomScale.value, 0.65));
            const svgViewBox = computed(() => { const pw = canvasW.value, ph = canvasH.value, vw = Math.round((pw / zoomScale.value) * 10) / 10, vh = Math.round((ph / zoomScale.value) * 10) / 10; return `${Math.max(0, Math.min(pw - vw, vbX.value))} ${Math.max(0, Math.min(ph - vh, vbY.value))} ${vw} ${vh}`; });
            const zoomScaleB = ref(1), vbXB = ref(0), vbYB = ref(0), invZoomB = computed(() => 1 / Math.pow(zoomScaleB.value, 0.65));
            const svgViewBoxB = computed(() => { const pw = canvasWB.value, ph = canvasHB.value, vw = Math.round((pw / zoomScaleB.value) * 10) / 10, vh = Math.round((ph / zoomScaleB.value) * 10) / 10; return `${Math.max(0, Math.min(pw - vw, vbXB.value))} ${Math.max(0, Math.min(ph - vh, vbYB.value))} ${vw} ${vh}`; });
            const resetZoom = () => { zoomScale.value = 1; vbX.value = 0; vbY.value = 0; };
            const resetZoomB = () => { zoomScaleB.value = 1; vbXB.value = 0; vbYB.value = 0; };
            const toggleFontScale = () => { globalFontScale.value = globalFontScale.value === 0.6 ? 0.8 : (globalFontScale.value === 0.8 ? 1.0 : 0.6); (targetCanvas.value?.markers || []).forEach(m => updateMarkerSize(m)); saveAll(); showToast(`🔠 字體：${globalFontScale.value === 1.0 ? '大' : (globalFontScale.value === 0.8 ? '中' : '細')}`); };

            const applyZoomAtClientPoint = (nextScale, clientX, clientY, anchorSvg, pane = 'A') => {
                const isB = pane === 'B', svg = isB ? svgCanvasB.value : svgCanvas.value, pw = isB ? canvasWB.value : canvasW.value, ph = isB ? canvasHB.value : canvasH.value;
                const zRef = isB ? zoomScaleB : zoomScale, xRef = isB ? vbXB : vbX, yRef = isB ? vbYB : vbY;
                const clampedScale = Math.max(1, Math.min(5, Math.round(nextScale * 100) / 100));
                if (clampedScale <= 1) { isB ? resetZoomB() : resetZoom(); return; }
                const vw = pw / clampedScale, vh = ph / clampedScale;
                if (svg && anchorSvg) {
                    const r = svg.getBoundingClientRect(), baseFit = Math.min(r.width / pw, r.height / ph), effScale = baseFit * clampedScale, offX = r.left + (r.width - pw * baseFit) / 2, offY = r.top + (r.height - ph * baseFit) / 2;
                    zRef.value = clampedScale; xRef.value = Math.max(0, Math.min(pw - vw, anchorSvg.x - (clientX - offX) / effScale)); yRef.value = Math.max(0, Math.min(ph - vh, anchorSvg.y - (clientY - offY) / effScale));
                } else {
                    const cx = xRef.value + (pw / zRef.value) / 2, cy = yRef.value + (ph / zRef.value) / 2;
                    zRef.value = clampedScale; xRef.value = Math.max(0, Math.min(pw - vw, cx - vw / 2)); yRef.value = Math.max(0, Math.min(ph - vh, cy - vh / 2));
                }
            };
            const stepZoom = (delta, pane = 'A') => applyZoomAtClientPoint((pane === 'B' ? zoomScaleB.value : zoomScale.value) + delta, null, null, null, pane);
            const onStageWheel = (e, pane = 'A') => { const svg = pane === 'B' ? svgCanvasB.value : svgCanvas.value, cObj = pane === 'B' ? canvasB.value : activeCanvas.value; if (svg && cObj?.photo) applyZoomAtClientPoint((pane === 'B' ? zoomScaleB.value : zoomScale.value) * (e.deltaY < 0 ? 1.2 : 0.82), e.clientX, e.clientY, getCoords(e, pane), pane); };

            const fullScreenIndex = ref(-1);
            const fullScreenList = computed(() => { const list = []; pages.value.forEach((pg, pIdx) => { const d = pg.date || project.date || getTodayStr(), a = pg.author || project.lastModifiedBy || ''; if (pg.photo) list.push({ item: pg, label: `P${pIdx + 1}${pg.space ? ' [' + pg.space + ']' : ''}`, date: d, author: a }); (pg.pins || []).forEach((pin, pinIdx) => { if (pin.photo) list.push({ item: pin, label: `P${pIdx + 1} 📍釘#${pinIdx + 1}${pin.space ? ' [' + pin.space + ']' : ''}`, date: pin.date || d, author: pin.author || a }); }); }); return list; });
            const currentFullScreen = computed(() => (fullScreenIndex.value >= 0 && fullScreenIndex.value < fullScreenList.value.length) ? fullScreenList.value[fullScreenIndex.value] : null);
            const fullScreenItem = computed(() => currentFullScreen.value?.item || null), fullScreenTitle = computed(() => currentFullScreen.value ? `${currentFullScreen.value.label} (${fullScreenIndex.value + 1}/${fullScreenList.value.length})` : ''), fullScreenDate = computed(() => currentFullScreen.value?.date || getTodayStr()), fullScreenAuthor = computed(() => currentFullScreen.value?.author || '');

            const openFullScreenPreview = (targetItem) => { const idx = fullScreenList.value.findIndex(x => String(x.item.id) === String(targetItem.id)); if (idx !== -1) fullScreenIndex.value = idx; };
            const prevFullScreen = () => { if (fullScreenIndex.value > 0) fullScreenIndex.value--; };
            const nextFullScreen = () => { if (fullScreenIndex.value < fullScreenList.value.length - 1) fullScreenIndex.value++; };
            const editFromFullScreen = () => { const target = fullScreenItem.value; if (!target) return; const tid = String(target.id); fullScreenIndex.value = -1; resetZoom(); showQuickPageNav.value = false; activePane.value = 'A'; for (let i = 0; i < pages.value.length; i++) { const pg = pages.value[i]; if (String(pg.id) === tid) { activePageIndex.value = i; activePin.value = null; drawMode.value = 'line'; currentView.value = 'proj'; return; } const pIdx = (pg.pins || []).findIndex(p => String(p.id) === tid); if (pIdx !== -1) { activePageIndex.value = i; openPinSubPage(pg.pins[pIdx], pIdx, 'A'); drawMode.value = 'line'; currentView.value = 'proj'; return; } } };

            const draggingPageIdx = ref(null), dragOverPageIdx = ref(null);
            const startPageDrag = (idx) => { if (pages.value.length <= 1 || selectMode.value) return; draggingPageIdx.value = idx; dragOverPageIdx.value = idx; const onMove = (ev) => { const card = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-page-idx]'); if (card) { const t = Number(card.getAttribute('data-page-idx')); if (!Number.isNaN(t)) dragOverPageIdx.value = t; } }; const onUp = async () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); const from = draggingPageIdx.value, to = dragOverPageIdx.value; draggingPageIdx.value = null; dragOverPageIdx.value = null; if (from !== null && to !== null && from !== to) { const [moved] = pages.value.splice(from, 1); pages.value.splice(to, 0, moved); activePageIndex.value = to; project.pageOrderUpdatedAt = Date.now(); hasUnsavedCloudChanges.value = true; if (!navigator.onLine) cloudSyncState.value = 'offline'; await saveAll(); showToast(`✅ 已調整為 P${to + 1}`); } }; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp); };
            const fullScreenWatermarkBox = computed(() => buildWatermarkBox(fullScreenItem.value, { projectName: project.name, projectDate: project.date, projectAuthor: project.lastModifiedBy, itemDate: fullScreenDate.value, itemAuthor: fullScreenAuthor.value, canvasWidth: fullScreenItem.value?.w || 1200 }));
            const setMarkerTextColor = (colorHex) => { defaultTextColor.value = colorHex; if (activeMarker.value) ensureMarkerBranched(() => { activeMarker.value.textColor = colorHex; touchDirty(); saveAll(); }); };
            const getArrowMarkerId = (c, suffix = '') => 'arrow-end-' + suffix + String(c || '#ef4444').replace('#', 'hex_');
            const getFsArrowMarkerId = (c) => 'fs-arrow-' + String(c || '#ef4444').replace('#', 'hex_');
            const getWallSegments = (w) => buildWallSegments(w);

            // =========================================================================
            // 工程目錄與管理核心功能
            // =========================================================================
            const fetchCompleteProjectData = async (code) => {
                code = String(code || '').trim();
                const localObj = await localforage.getItem('proj_' + code);
                let result = localObj ? JSON.parse(JSON.stringify(localObj)) : null;
                if (db && navigator.onLine) {
                    try {
                        const projRef = db.collection('site_projects').doc(code);
                        const [projDoc, pagesSnap, mediaMap] = await Promise.all([withRetry(() => withTimeout(projRef.get(), 15000)), withRetry(() => withTimeout(projRef.collection('pages').get(), 15000)), loadMediaMapFromRef(projRef)]);
                        if (projDoc.exists) {
                            const pd = projDoc.data();
                            const cloudPages = pagesSnap.docs.map(doc => {
                                const r = doc.data();
                                return makeEmptyPage({ id: doc.id, ...r, date: r.date || pd.date || getTodayStr(), photo: (r.photoId && mediaMap.get(r.photoId)?.photo) || mediaMap.get('page_' + (r.id || doc.id))?.photo || r.photo || null, pins: (r.pins || []).map(pin => ({ ...pin, photo: (pin.photoId && mediaMap.get(pin.photoId)?.photo) || mediaMap.get(String(pin.id))?.photo || pin.photo || null })) });
                            });
                            if (!result) {
                                const delSet = new Set(pd.deletedPageIds || []);
                                result = { code, name: pd.name || '', nameUpdatedAt: pd.nameUpdatedAt || 0, date: pd.date || getTodayStr(), pages: cloudPages.filter(p => !delSet.has(p.id)).sort((a, b) => ((pd.pageIds || []).indexOf(a.id) === -1 ? 9999 : (pd.pageIds || []).indexOf(a.id)) - ((pd.pageIds || []).indexOf(b.id) === -1 ? 9999 : (pd.pageIds || []).indexOf(b.id))), photoPool: [], deletedPageIds: pd.deletedPageIds || [], deletedPinIds: pd.deletedPinIds || [], pageOrderUpdatedAt: pd.pageOrderUpdatedAt || 0, lastSyncAt: Date.now(), lastModifiedBy: pd.lastModifiedBy || '' };
                            } else {
                                const delSet = new Set([...(result.deletedPageIds || []), ...(pd.deletedPageIds || [])]);
                                const orderList = [...(pd.pageIds || []), ...(result.pages || []).map(p => p.id)];
                                result.pages = mergePagesSmart(result.pages || [], cloudPages, delSet, orderList);
                                if (!result.name && pd.name) result.name = pd.name;
                            }
                        }
                    } catch (_) {}
                }
                return result;
            };

            const clonePagesWithFreshIds = (rawPages) => {
                const cloned = JSON.parse(JSON.stringify(rawPages || [])), idMap = new Map(), now = Date.now();
                cloned.forEach((pg, idx) => idMap.set(String(pg.id), `pg_${now}_${idx}_${Math.floor(Math.random() * 99999)}`));
                return cloned.map((pg, idx) => {
                    const newId = idMap.get(String(pg.id)); delete pg.historyStack; delete pg.redoStack;
                    (pg.markers || []).forEach(m => { if (m.type === 'page_link' && m.data?.targetPageId && idMap.has(String(m.data.targetPageId))) m.data.targetPageId = idMap.get(String(m.data.targetPageId)); });
                    (pg.pins || []).forEach((pin, pIdx) => { pin.id = `pin_${now}_${idx}_${pIdx}_${Math.floor(Math.random() * 99999)}`; delete pin.historyStack; delete pin.redoStack; });
                    return makeEmptyPage({ ...pg, id: newId, updatedAt: now });
                });
            };

            const refreshAllProjectOptions = async () => {
                await loadProjectList();
                const map = new Map(); projectList.value.forEach(p => map.set(String(p.code), { ...p }));
                if (db && navigator.onLine) {
                    try {
                        const snaps = await withTimeout(db.collection('site_projects').orderBy('updatedAt', 'desc').limit(50).get(), 10000);
                        snaps.docs.forEach(d => {
                            const data = d.data() || {}, c = String(d.id);
                            if (data.name || data.updatedAt) {
                                const ex = map.get(c);
                                map.set(c, { code: c, name: data.name || ex?.name || '', date: data.date || ex?.date || '', pageCount: (data.pageIds?.length) || ex?.pageCount || 1, updatedAt: Math.max(data.updatedAt || 0, ex?.updatedAt || 0) });
                            }
                        });
                    } catch (_) {}
                }
                allProjectOptions.value = Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            };

            const openMergeProjectsModal = async () => {
                isProcessing.value = true; processingText.value = '正在讀取工程清單...';
                try {
                    await refreshAllProjectOptions();
                    if (allProjectOptions.value.length < 2) { alert('至少需要 2 個工程才能合拼'); return; }
                    mergeProjCodeA.value = allProjectOptions.value[0]?.code || '';
                    mergeProjCodeB.value = allProjectOptions.value[1]?.code || '';
                    updateMergeDefaultName();
                    showMergeProjectsModal.value = true;
                } finally { isProcessing.value = false; }
            };
            const updateMergeDefaultName = () => {
                const a = allProjectOptions.value.find(x => String(x.code) === String(mergeProjCodeA.value)), b = allProjectOptions.value.find(x => String(x.code) === String(mergeProjCodeB.value));
                mergeProjNewName.value = (mergeProjCodeA.value && mergeProjCodeB.value) ? `${a?.name?.trim() || '#' + mergeProjCodeA.value} + ${b?.name?.trim() || '#' + mergeProjCodeB.value}` : '';
            };
            const executeMergeProjects = async () => {
                const cA = String(mergeProjCodeA.value || '').trim(), cB = String(mergeProjCodeB.value || '').trim();
                if (!cA || !cB) return alert('請選擇兩個要合拼的工程'); if (cA === cB) return alert('請選擇兩個不同的工程總號');
                showMergeProjectsModal.value = false; isProcessing.value = true; processingText.value = `正在讀取 #${cA} 與 #${cB} 圖紙...`;
                try {
                    const [dataA, dataB] = await Promise.all([fetchCompleteProjectData(cA), fetchCompleteProjectData(cB)]);
                    if (!dataA || !dataB) throw new Error('無法讀取其中一份工程資料，請檢查網絡連線');
                    const mergedPages = [...clonePagesWithFreshIds(dataA.pages), ...clonePagesWithFreshIds(dataB.pages)];
                    if (!mergedPages.length) mergedPages.push(makeEmptyPage());
                    const seenFp = new Set(), mergedPool = [];
                    [...(dataA.photoPool || []), ...(dataB.photoPool || [])].forEach(item => { if (item?.photo) { const fp = photoFingerprint(item.photo); if (!seenFp.has(fp)) { seenFp.add(fp); mergedPool.push(item); } } });
                    const existingCodes = new Set(allProjectOptions.value.map(x => String(x.code)));
                    let newCode = ''; do { newCode = Math.floor(100000 + Math.random() * 900000).toString(); } while (existingCodes.has(newCode));
                    const finalName = mergeProjNewName.value.trim() || `${dataA.name || '#' + cA} + ${dataB.name || '#' + cB}`, now = Date.now();
                    const newProjObj = { code: newCode, name: finalName, nameUpdatedAt: now, date: getTodayStr(), pages: mergedPages, photoPool: mergedPool, deletedPageIds: [], deletedPinIds: [], pageOrderUpdatedAt: now, updatedAt: now, lastSyncAt: 0, lastModifiedBy: authorName.value || '', pendingUpload: true };
                    await localforage.setItem('proj_' + newCode, newProjObj); await updateQueue(newCode, true);
                    if (db && navigator.onLine) { try { const syncTs = await pushProjectPayload(newProjObj, false, (st) => { processingText.value = st; }); if (syncTs) { newProjObj.lastSyncAt = syncTs; newProjObj.pendingUpload = false; await localforage.setItem('proj_' + newCode, newProjObj); } } catch (_) {} }
                    await loadProjectList(); showToast(`✅ 已合拼為新總號 #${newCode}（共 ${mergedPages.length} 頁）`);
                } catch (e) { alert('合拼失敗：' + e.message); } finally { isProcessing.value = false; }
            };

            const toggleSelectMode = () => { selectMode.value = !selectMode.value; selectedPageIds.value = []; };
            const togglePageSelection = (pgId) => { const idStr = String(pgId), idx = selectedPageIds.value.indexOf(idStr); if (idx === -1) selectedPageIds.value.push(idStr); else selectedPageIds.value.splice(idx, 1); };
            const selectAllPages = () => { selectedPageIds.value = selectedPageIds.value.length === pages.value.length ? [] : pages.value.map(p => String(p.id)); };

            const openTransferModal = async (singlePageId = null) => {
                if (singlePageId) selectedPageIds.value = [String(singlePageId)];
                if (!selectedPageIds.value.length) { showToast('請先點選要轉檔的圖紙'); return; }
                isProcessing.value = true; processingText.value = '正在讀取工程選列...';
                try { await refreshAllProjectOptions(); transferTargetCode.value = otherProjectOptions.value[0]?.code || '__NEW__'; transferMode.value = 'copy'; transferNewProjName.value = ''; showTransferModal.value = true; }
                finally { isProcessing.value = false; }
            };
            const executeTransferPages = async () => {
                if (!selectedPageIds.value.length || !transferTargetCode.value) return;
                const selectedSet = new Set(selectedPageIds.value.map(String)), pickedRaw = pages.value.filter(p => selectedSet.has(String(p.id)));
                if (!pickedRaw.length) return;
                if (transferMode.value === 'move' && !confirm(`確定要將選中的 ${pickedRaw.length} 頁「移動」過去嗎？\n（移動後將從目前工程 #${project.code} 移除）`)) return;
                showTransferModal.value = false; isProcessing.value = true; processingText.value = `正在轉移 ${pickedRaw.length} 頁圖紙...`;
                try {
                    const clonedPages = clonePagesWithFreshIds(pickedRaw), now = Date.now(); let targetCode = String(transferTargetCode.value);
                    if (targetCode === '__NEW__') {
                        const existingCodes = new Set(allProjectOptions.value.map(x => String(x.code)));
                        do { targetCode = Math.floor(100000 + Math.random() * 900000).toString(); } while (existingCodes.has(targetCode));
                        const targetName = transferNewProjName.value.trim() || `${project.name || '工程'} (分拆)`;
                        const newProjObj = { code: targetCode, name: targetName, nameUpdatedAt: now, date: getTodayStr(), pages: clonedPages, photoPool: [], deletedPageIds: [], deletedPinIds: [], pageOrderUpdatedAt: now, updatedAt: now, lastSyncAt: 0, lastModifiedBy: authorName.value || '', pendingUpload: true };
                        await localforage.setItem('proj_' + targetCode, newProjObj); await updateQueue(targetCode, true);
                        if (db && navigator.onLine) { try { const syncTs = await pushProjectPayload(newProjObj, false, (st) => { processingText.value = st; }); if (syncTs) { newProjObj.lastSyncAt = syncTs; newProjObj.pendingUpload = false; await localforage.setItem('proj_' + targetCode, newProjObj); } } catch (_) {} }
                    } else {
                        const targetProj = await fetchCompleteProjectData(targetCode); if (!targetProj) throw new Error(`找不到目標工程 #${targetCode}`);
                        targetProj.pages = [...(targetProj.pages || []), ...clonedPages]; targetProj.updatedAt = now; targetProj.pendingUpload = true;
                        await localforage.setItem('proj_' + targetCode, targetProj); await updateQueue(targetCode, true);
                        if (db && navigator.onLine) { try { const syncTs = await pushProjectPayload(targetProj, false, (st) => { processingText.value = st; }); if (syncTs) { targetProj.lastSyncAt = syncTs; targetProj.pendingUpload = false; await localforage.setItem('proj_' + targetCode, targetProj); } } catch (_) {} }
                    }
                    if (transferMode.value === 'move') {
                        project.deletedPageIds ||= [];
                        pickedRaw.forEach(pg => { if (!project.deletedPageIds.includes(pg.id)) project.deletedPageIds.push(pg.id); dirtyPageIds.delete(pg.id); });
                        pages.value = pages.value.filter(p => !selectedSet.has(String(p.id))); if (!pages.value.length) pages.value = [makeEmptyPage()];
                        activePageIndex.value = Math.min(activePageIndex.value, pages.value.length - 1); pageIndexB.value = Math.min(pageIndexB.value, pages.value.length - 1);
                        project.pageOrderUpdatedAt = Date.now(); hasUnsavedCloudChanges.value = true; await saveAll();
                        if (db && navigator.onLine && project.code) {
                            const curRef = db.collection('site_projects').doc(String(project.code)); pickedRaw.forEach(pg => curRef.collection('pages').doc(pg.id).delete().catch(() => {}));
                            curRef.set({ pageIds: pages.value.map(p => p.id), deletedPageIds: firebase.firestore.FieldValue.arrayUnion(...pickedRaw.map(p => p.id)), updatedAt: Date.now() }, { merge: true }).catch(() => {});
                        }
                    }
                    selectMode.value = false; selectedPageIds.value = []; showToast(`✅ 已${transferMode.value === 'move' ? '移動' : '複製'} ${clonedPages.length} 頁至 #${targetCode}`);
                } catch (e) { alert('轉檔失敗：' + e.message); } finally { isProcessing.value = false; }
            };

            const createNewProject = async () => {
                await checkAuthorName(); resetZoom(); const today = getTodayStr(), now = Date.now(), firstPg = makeEmptyPage({ date: today });
                Object.assign(project, { code: Math.floor(100000 + Math.random() * 900000).toString(), name: '', nameUpdatedAt: now, date: today, deletedPageIds: [], deletedPinIds: [], pageOrderUpdatedAt: now, lastSyncAt: 0, lastModifiedBy: authorName.value });
                pages.value = [firstPg]; photoPool.value = []; feedbackList.value = []; activePageIndex.value = 0; activePin.value = null; pageIndexB.value = 0; pinB.value = null; splitMode.value = false; activePane.value = 'A'; dirtyPageIds.clear(); dirtyPageIds.add(firstPg.id); hasUnsavedCloudChanges.value = true;
                cloudSyncState.value = navigator.onLine ? 'queued' : 'offline'; currentView.value = 'proj'; await saveAll(); startRealtimeListener(project.code);
            };
            const copyCode = (code) => { navigator.clipboard?.writeText(code); showToast('已複製工程碼：#' + code); showManageModal.value = false; };
            const joinProjectByCode = async () => {
                await checkAuthorName(); const code = String(inputJoinCode.value || '').trim(); if (code.length !== 6) return alert('請輸入 6 位數字工程碼'); if (!navigator.onLine) return alert('連通新工程碼需要網絡連線');
                isProcessing.value = true; processingText.value = '正在連通 #' + code + '...';
                try { const doc = await withRetry(() => withTimeout(db.collection('site_projects').doc(code).get(), 15000)); if (!doc.exists) return alert('雲端找不到工程碼 #' + code); showJoinModal.value = false; inputJoinCode.value = ''; await loadProject(code, true); showToast('✅ 已連通 #' + code); } catch (e) { alert('連線失敗：' + e.message); } finally { isProcessing.value = false; }
            };
            const loadProject = async (code, openAsPreview = true) => {
                resetZoom(); showQuickPageNav.value = false; selectMode.value = false; selectedPageIds.value = []; splitMode.value = false; activePane.value = 'A'; code = String(code); project.code = code; project.name = ''; project.nameUpdatedAt = 0; project.deletedPageIds = []; project.deletedPinIds = []; project.pageOrderUpdatedAt = 0; pages.value = []; photoPool.value = []; feedbackList.value = []; dirtyPageIds.clear();
                const d = await localforage.getItem('proj_' + code);
                if (d) { Object.assign(project, { name: d.name || '', nameUpdatedAt: d.nameUpdatedAt || 0, date: d.date || '', deletedPageIds: d.deletedPageIds || [], deletedPinIds: d.deletedPinIds || [], pageOrderUpdatedAt: d.pageOrderUpdatedAt || 0, lastSyncAt: d.lastSyncAt || 0, lastModifiedBy: d.lastModifiedBy || '' }); if (d.pages?.length) pages.value = d.pages.map(pg => makeEmptyPage(pg)); if (d.photoPool) photoPool.value = d.photoPool; hasUnsavedCloudChanges.value = !!d.pendingUpload; } else hasUnsavedCloudChanges.value = false;
                activePageIndex.value = 0; activePin.value = null; pageIndexB.value = 0; pinB.value = null; currentView.value = openAsPreview ? 'preview' : 'proj';
                await pullAndMergeFromCloud(code, false); if (!pages.value.length) pages.value = [makeEmptyPage()]; drawMode.value = 'browse'; startRealtimeListener(code);
            };

            const openManageMenu = (proj) => { manageProj.value = proj; showManageModal.value = true; };
            const renameProject = async () => {
                const newName = prompt('請輸入新的地址 / 名稱：', manageProj.value.name);
                if (newName !== null) {
                    const trimmed = newName.trim(), code = String(manageProj.value.code), now = Date.now();
                    const d = await localforage.getItem('proj_' + code);
                    if (d) { d.name = trimmed; d.nameUpdatedAt = now; d.pendingUpload = true; await localforage.setItem('proj_' + code, d); await updateQueue(code, true); }
                    manageProj.value.name = trimmed;
                    if (db && navigator.onLine) { try { await withTimeout(db.collection('site_projects').doc(code).set({ name: trimmed, nameUpdatedAt: now, updatedAt: now }, { merge: true }), 10000); } catch (_) {} }
                    await loadProjectList(); showToast('✅ 已更新地址');
                }
            };
            const duplicateProject = async () => { const d = await localforage.getItem('proj_' + manageProj.value.code); if (!d) return; const newCode = Math.floor(100000 + Math.random() * 900000).toString(); d.code = newCode; d.name = (d.name || '工程') + ' (副本)'; d.nameUpdatedAt = Date.now(); d.lastSyncAt = 0; d.pendingUpload = true; await localforage.setItem('proj_' + newCode, d); await updateQueue(newCode, true); showManageModal.value = false; await loadProjectList(); showToast('✅ 已複製為 #' + newCode); };
            const batchDeleteDocs = async (docs) => { for (let i = 0; i < docs.length; i += 400) { const b = db.batch(); docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit(); } };
            const clearLocalMediaCacheForCode = async (code) => { const prefix = `synced_media_${code}_`, keys = await localforage.keys(); for (const k of keys) { if (k.startsWith(prefix)) await localforage.removeItem(k); } };
            const deleteProject = async (code) => {
                if (prompt('⚠️ 輸入 "dd" 確認刪除此工程：')?.trim().toLowerCase() !== 'dd') return; isProcessing.value = true; processingText.value = '正在徹底刪除工程...';
                try { await localforage.removeItem('proj_' + code); await clearLocalMediaCacheForCode(code); await updateQueue(code, false); if (db && navigator.onLine) { const ref = db.collection('site_projects').doc(String(code)); const delCol = async (sub) => { const snap = await ref.collection(sub).get(); if (sub === 'media') { for (const doc of snap.docs) await batchDeleteDocs((await doc.ref.collection('chunks').get()).docs); } await batchDeleteDocs(snap.docs); }; await Promise.all([delCol('pages'), delCol('media'), delCol('backups'), delCol('feedback')]); await ref.delete(); } showManageModal.value = false; await loadProjectList(); showToast('🗑️ 已徹底刪除'); } catch (e) { alert('清理異常：' + e.message); } finally { isProcessing.value = false; }
            };

            const cleanCloudGarbage = async () => {
                if (!db || !navigator.onLine) return alert('請檢查網路連線');
                if (!confirm('🧹 掃描並徹底清除已刪除工程的殘留碎片及無用孤兒相片？')) return;
                isProcessing.value = true; processingText.value = '正在掃描雲端索引...';
                try {
                    const projSnap = await withTimeout(db.collection('site_projects').get(), 15000); const activeIds = new Set(projSnap.docs.map(d => d.id)); let removedDocs = 0, removedOrphanMedia = 0;
                    for (const sub of ['pages', 'media', 'backups', 'feedback']) {
                        processingText.value = `正在清理殘留 ${sub}...`; const snap = await withTimeout(db.collectionGroup(sub).get(), 20000);
                        const orphans = snap.docs.filter(d => { const p = d.ref.path.split('/'); return p[0] === 'site_projects' && p[1] && !activeIds.has(p[1]); });
                        if (sub === 'media') { for (const mDoc of orphans) { const cSnap = await withTimeout(mDoc.ref.collection('chunks').get(), 15000); if (cSnap.docs.length) { await batchDeleteDocs(cSnap.docs); removedDocs += cSnap.docs.length; } } }
                        if (orphans.length) { await batchDeleteDocs(orphans); removedDocs += orphans.length; }
                    }
                    const safeCutoff = Date.now() - 5 * 60 * 1000;
                    for (let i = 0; i < projSnap.docs.length; i++) {
                        const pDoc = projSnap.docs[i]; processingText.value = `正在核對工程 #${pDoc.id} (${i + 1}/${projSnap.docs.length})...`;
                        const [pSnap, mSnap] = await Promise.all([withTimeout(pDoc.ref.collection('pages').get(), 15000), withTimeout(pDoc.ref.collection('media').get(), 15000)]);
                        const usedIds = new Set();
                        pSnap.docs.forEach(pgDoc => { const pg = pgDoc.data() || {}; if (pg.photoId) usedIds.add(String(pg.photoId)); usedIds.add('page_' + (pg.id || pgDoc.id)); (pg.pins || []).forEach(pin => { if (pin.photoId) usedIds.add(String(pin.photoId)); if (pin.id) usedIds.add(String(pin.id)); }); });
                        for (const mDoc of mSnap.docs) { const mData = mDoc.data() || {}; if (!usedIds.has(String(mDoc.id)) && (!mData.updatedAt || mData.updatedAt < safeCutoff)) { const cSnap = await withTimeout(mDoc.ref.collection('chunks').get(), 15000); if (cSnap.docs.length) await batchDeleteDocs(cSnap.docs); await mDoc.ref.delete(); removedOrphanMedia++; } }
                    }
                    const lKeys = await localforage.keys(); for (const k of lKeys) { if (k.startsWith('synced_media_')) { const cPart = k.split('_')[2]; if (cPart && !activeIds.has(cPart) && !(await localforage.getItem('proj_' + cPart))) await localforage.removeItem(k); } }
                    const total = removedDocs + removedOrphanMedia; showToast(total > 0 ? `🧹 已徹底清理 ${removedDocs} 筆殘留及 ${removedOrphanMedia} 張孤兒相` : '✨ 雲端與本機非常乾淨');
                } catch (e) { alert('清理失敗：' + e.message); } finally { isProcessing.value = false; }
            };

            const openBackupList = async () => { showManageModal.value = false; isProcessing.value = true; processingText.value = '正在搜尋備份...'; try { const snaps = await withTimeout(db.collection('site_projects').doc(manageProj.value.code).collection('backups').get(), 15000); backupList.value = snaps.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); showBackupListModal.value = true; } catch (e) { alert('讀取失敗：' + e.message); } finally { isProcessing.value = false; } };
            const restoreBackup = async (bkId) => {
                isProcessing.value = true; processingText.value = '正在還原紀錄...';
                try {
                    const doc = await withTimeout(db.collection('site_projects').doc(manageProj.value.code).collection('backups').doc(bkId).get(), 15000);
                    const bData = JSON.parse(doc.data().data), newCode = Math.floor(100000 + Math.random() * 900000).toString();
                    bData.code = newCode; bData.name = (bData.name || '工程') + ' (還原檔)'; bData.nameUpdatedAt = Date.now(); bData.lastSyncAt = 0; bData.pendingUpload = true;
                    const curLocal = await localforage.getItem('proj_' + manageProj.value.code);
                    if (curLocal) { const pMap = new Map(); curLocal.pages.forEach(p => { if (p.photo) pMap.set(p.id, p.photo); (p.pins || []).forEach(pin => { if (pin.photo) pMap.set(pin.id, pin.photo); }); }); bData.pages.forEach(p => { p.photo = pMap.get(p.id) || null; (p.pins || []).forEach(pin => { pin.photo = pMap.get(pin.id) || null; }); }); }
                    await localforage.setItem('proj_' + newCode, bData); await updateQueue(newCode, true); showBackupListModal.value = false; await loadProjectList(); showToast('✅ 已還原為 #' + newCode);
                } catch (e) { alert('還原失敗：' + e.message); } finally { isProcessing.value = false; }
            };

            const openCloudBrowser = async () => { if (!db || !navigator.onLine) return alert('請檢查網路連線'); isProcessing.value = true; processingText.value = '正在讀取雲端目錄...'; try { const snaps = await withTimeout(db.collection('site_projects').orderBy('updatedAt', 'desc').limit(30).get(), 10000); cloudProjectList.value = snaps.docs.map(d => ({ code: d.id, ...d.data() })).filter(d => d.name || d.updatedAt); showCloudBrowser.value = true; } catch (e) { alert('讀取目錄失敗：' + e.message); } finally { isProcessing.value = false; } };
            const downloadFromCloudBrowser = async (code) => { showCloudBrowser.value = false; await loadProject(code, true); showToast('✅ 已載入 #' + code); };
            const loadProjectList = async () => { const keys = await localforage.keys(), q = (await localforage.getItem('pending_upload_queue')) || [], list = []; for (const k of keys) { if (k.startsWith('proj_')) { const d = await localforage.getItem(k); if (d?.code) { const pgs = d.pages || []; list.push({ code: d.code, name: d.name, date: d.date, pageCount: pgs.length || 1, pinCount: pgs.reduce((s, p) => s + (p.pins?.length || 0), 0), updatedAt: d.updatedAt || 0, lastModifiedBy: d.lastModifiedBy || '', pendingUpload: !!d.pendingUpload || q.includes(String(d.code)) }); } } } projectList.value = list.sort((a, b) => b.updatedAt - a.updatedAt); };
            const backToProjects = async () => { resetZoom(); showQuickPageNav.value = false; selectMode.value = false; selectedPageIds.value = []; splitMode.value = false; activePane.value = 'A'; if (unsubPages) { unsubPages(); unsubPages = null; } if (unsubFeedback) { unsubFeedback(); unsubFeedback = null; } await saveAll(); if ((hasUnsavedCloudChanges.value || dirtyPageIds.size > 0) && project.code && db) { if (!navigator.onLine) showToast('📴 無網絡模式：已鎖入本機，有訊號自動上傳'); else { isProcessing.value = true; processingText.value = '正在自動上傳並返回目錄...'; try { await pullAndMergeFromCloud(project.code, false); await pushToCloud(true, (st) => { processingText.value = st; }); await createCloudBackup(project.code); showToast('✅ 已自動同步雲端'); } catch (_) { showToast('⚠️ 已排入自動補傳隊列'); } finally { isProcessing.value = false; } } } dirtyPageIds.clear(); hasUnsavedCloudChanges.value = false; feedbackList.value = []; await loadProjectList(); currentView.value = 'dir'; };

            const pullAndMergeFromCloud = async (code, throwErr = false) => {
                code = String(code || '').trim(); if (!navigator.onLine) { cloudSyncState.value = 'offline'; if (throwErr) throw new Error('目前無網絡連線'); return; }
                if (!db) throw new Error('雲端資料庫未初始化');
                cloudSyncState.value = 'syncing';
                try {
                    const projRef = db.collection('site_projects').doc(code);
                    const [projDoc, pagesSnap, mediaMap] = await Promise.all([withRetry(() => withTimeout(projRef.get())), withRetry(() => withTimeout(projRef.collection('pages').get())), loadMediaMapFromRef(projRef)]);
                    if (!projDoc.exists) { cloudSyncState.value = hasUnsavedCloudChanges.value ? 'queued' : 'ready'; return; }
                    const pd = projDoc.data(), cloudNameTs = Number(pd.nameUpdatedAt || 0), localNameTs = Number(project.nameUpdatedAt || 0);
                    if (pd.name !== undefined && (cloudNameTs > localNameTs || (!project.name && localNameTs === 0))) { project.name = pd.name; if (cloudNameTs) project.nameUpdatedAt = cloudNameTs; }
                    if (pd.date) project.date = pd.date; if (pd.lastModifiedBy) project.lastModifiedBy = pd.lastModifiedBy;
                    const deletedSet = new Set([...(project.deletedPageIds || []), ...(pd.deletedPageIds || [])]); project.deletedPageIds = [...deletedSet];
                    const deletedPins = new Set([...(project.deletedPinIds || []).map(String), ...((pd.deletedPinIds || []).map(String))]); project.deletedPinIds = [...deletedPins];
                    const cloudPages = pagesSnap.docs.map(doc => { const r = doc.data(); return makeEmptyPage({ id: doc.id, ...r, date: r.date || pd.date || getTodayStr(), photo: (r.photoId && mediaMap.get(r.photoId)?.photo) || mediaMap.get('page_' + (r.id || doc.id))?.photo || r.photo || null, pins: (r.pins || []).map(pin => ({ ...pin, photo: (pin.photoId && mediaMap.get(pin.photoId)?.photo) || mediaMap.get(String(pin.id))?.photo || pin.photo || null })) }); });
                    const localOrderNewer = (project.pageOrderUpdatedAt || 0) > (pd.pageOrderUpdatedAt || 0); if (!localOrderNewer && pd.pageOrderUpdatedAt) project.pageOrderUpdatedAt = pd.pageOrderUpdatedAt;
                    const orderList = localOrderNewer ? [...pages.value.map(p => p.id), ...(pd.pageIds || [])] : [...(pd.pageIds || []), ...pages.value.map(p => p.id)];
                    const merged = mergePagesSmart(pages.value, cloudPages, deletedSet, orderList);
                    if (merged.length) { pages.value = merged; if (activePageIndex.value >= pages.value.length) activePageIndex.value = pages.value.length - 1; if (pageIndexB.value >= pages.value.length) pageIndexB.value = pages.value.length - 1; if (activePin.value && activePage.value) activePin.value = (activePage.value.pins || []).find(p => String(p.id) === String(activePin.value.id)) || null; if (pinB.value && pageB.value) pinB.value = (pageB.value.pins || []).find(p => String(p.id) === String(pinB.value.id)) || null; }
                    project.lastSyncAt = Date.now(); if (dirtyPageIds.size === 0 && !hasUnsavedCloudChanges.value) hasUnsavedCloudChanges.value = false; await saveAll(); cloudSyncState.value = hasUnsavedCloudChanges.value ? 'queued' : 'ready';
                } catch (e) { cloudSyncState.value = navigator.onLine ? 'queued' : 'offline'; if (throwErr) throw e; }
            };

            const startRealtimeListener = (code) => {
                if (unsubPages) { unsubPages(); unsubPages = null; } if (unsubFeedback) { unsubFeedback(); unsubFeedback = null; } if (!db || !code) return;
                let first = true;
                unsubPages = db.collection('site_projects').doc(String(code)).collection('pages').onSnapshot(async (snap) => { if (first) { first = false; return; } if (isPushing || currentView.value === 'dir' || snap.metadata.hasPendingWrites || isDrawing.value || isPinching || showTopSheet.value || showTopTextBar.value || showIndexModal.value) return; await pullAndMergeFromCloud(code, false); showToast('🔄 已同步同事最新圖紙'); }, () => {});
                let fbFirst = true;
                unsubFeedback = db.collection('site_projects').doc(String(code)).collection('feedback').orderBy('createdAt', 'desc').onSnapshot((snap) => { feedbackList.value = snap.docs.map(d => ({ id: d.id, ...d.data() })); if (!fbFirst && snap.docChanges().some(c => c.type === 'added')) showToast('💬 收到師傅/業主新留言批註！'); fbFirst = false; }, () => {});
            };

            const uploadMediaWithChunks = async (projRef, code, docKey, photoB64, meta, onStatus) => {
                if (!photoB64) return; const cacheKey = `synced_media_${code}_${docKey}_${photoB64.length}`; if (await localforage.getItem(cacheKey)) return;
                const mediaRef = projRef.collection('media').doc(docKey), totalChunks = Math.ceil(photoB64.length / CHUNK_SIZE);
                try { const ex = await withTimeout(mediaRef.get(), 10000); if (ex.exists && ex.data().chunked && ex.data().totalChunks === totalChunks && ex.data().byteLen === photoB64.length) { await localforage.setItem(cacheKey, true); return; } } catch (_) {}
                for (let i = 0; i < totalChunks; i++) { onStatus?.(`切片 ${i + 1}/${totalChunks}`); await withRetry(() => withTimeout(mediaRef.collection('chunks').doc(String(i)).set({ index: i, data: photoB64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) }), 20000)); }
                await withRetry(() => withTimeout(mediaRef.set({ chunked: true, totalChunks, byteLen: photoB64.length, w: meta.w || 1200, h: meta.h || 900, author: meta.author || '', updatedAt: meta.updatedAt || Date.now() }, { merge: true }), 15000));
                await localforage.setItem(cacheKey, true);
            };

            const pushProjectPayload = async (projObj, isCurrentOpen = true, onProgress = null) => {
                const code = String(projObj.code || '').trim(); if (!db || !code || !navigator.onLine) return false;
                const projRef = db.collection('site_projects').doc(code), now = Date.now(), lastSync = projObj.lastSyncAt || 0, rawPages = projObj.pages || [];
                const targetList = isCurrentOpen ? rawPages.filter(pg => dirtyPageIds.has(pg.id) || (pg.updatedAt || 0) > lastSync) : rawPages;
                const dirtyPages = JSON.parse(JSON.stringify(targetList)).map(pg => { delete pg.historyStack; delete pg.redoStack; (pg.pins || []).forEach(p => { delete p.historyStack; delete p.redoStack; }); return pg; });
                const projPatch = { code, name: projObj.name || '', nameUpdatedAt: Number(projObj.nameUpdatedAt || now), date: projObj.date || getTodayStr(), pageIds: rawPages.map(p => p.id), pageOrderUpdatedAt: projObj.pageOrderUpdatedAt || now, deletedPageIds: projObj.deletedPageIds?.length ? firebase.firestore.FieldValue.arrayUnion(...projObj.deletedPageIds) : [], deletedPinIds: projObj.deletedPinIds?.length ? firebase.firestore.FieldValue.arrayUnion(...projObj.deletedPinIds) : [], updatedAt: now };
                if (dirtyPages.length > 0 && authorName.value) projPatch.lastModifiedBy = authorName.value;
                await withRetry(() => withTimeout(projRef.set(projPatch, { merge: true }), 15000));
                for (let idx = 0; idx < dirtyPages.length; idx++) {
                    const pg = dirtyPages[idx], { photo: pagePhoto, pins, ...restPage } = pg;
                    if (pagePhoto && !pg.isSketch) await uploadMediaWithChunks(projRef, code, pg.photoId || ('page_' + pg.id), pagePhoto, { w: pg.w, h: pg.h, author: pg.author || authorName.value || '', updatedAt: now }, (st) => onProgress?.(`上傳第 ${idx + 1}/${dirtyPages.length} 頁 (${st})...`));
                    const pinsMeta = [];
                    for (let pIdx = 0; pIdx < (pins || []).length; pIdx++) { const { photo: pinPhoto, ...restPin } = pins[pIdx]; pinsMeta.push({ ...restPin, hasPhoto: !!pinPhoto }); if (pinPhoto && !pins[pIdx].isSketch) await uploadMediaWithChunks(projRef, code, pins[pIdx].photoId || String(pins[pIdx].id), pinPhoto, { w: pins[pIdx].w, h: pins[pIdx].h, author: authorName.value || '', updatedAt: now }, (st) => onProgress?.(`上傳 P${idx + 1} 釘#${pIdx + 1} (${st})...`)); }
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
                    const now = await pushProjectPayload({ code, name: project.name, nameUpdatedAt: project.nameUpdatedAt, date: project.date, pages: pages.value, deletedPageIds: project.deletedPageIds, deletedPinIds: project.deletedPinIds, pageOrderUpdatedAt: project.pageOrderUpdatedAt, lastSyncAt: project.lastSyncAt }, true, onProgress);
                    dirtyPageIds.clear(); project.lastSyncAt = now; cloudSyncState.value = 'ready'; hasUnsavedCloudChanges.value = false; await saveAll();
                } catch (e) { await saveAll(); cloudSyncState.value = navigator.onLine ? 'queued' : 'offline'; if (throwErr) throw e; } finally { setTimeout(() => { isPushing = false; }, 1000); }
            };

            const processPendingUploadQueue = async (silent = true) => {
                if (isAutoQueueing || !navigator.onLine || !db || isDrawing.value || isPinching || showTopSheet.value || showTopTextBar.value || showIndexModal.value || showBranchPrompt.value) return;
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

            const showJoinModal = ref(false), inputJoinCode = ref(''), showAddPageModal = ref(false), showSpaceModal = ref(false), showMergeModal = ref(false), showPdfModal = ref(false);
            const spaceList = ref([...DEFAULT_SPACES]);
            const showManageModal = ref(false), manageProj = ref({}), showCloudBrowser = ref(false), cloudProjectList = ref([]), showBackupListModal = ref(false), backupList = ref([]);
            const showPhotoPoolModal = ref(false), photoPoolList = ref([]), photoPoolTarget = ref('newPage');
            const showMergeProjectsModal = ref(false), mergeProjCodeA = ref(''), mergeProjCodeB = ref(''), mergeProjNewName = ref('');
            const selectMode = ref(false), selectedPageIds = ref([]);
            const showTransferModal = ref(false), transferTargetCode = ref(''), transferMode = ref('copy'), transferNewProjName = ref('');
            const otherProjectOptions = computed(() => allProjectOptions.value.filter(p => String(p.code) !== String(project.code)));

            const drawColor = ref('#ef4444'), wallStyle = ref('hollow'), toastMsg = ref('');
            const showToast = (msg) => { toastMsg.value = msg; setTimeout(() => { if (toastMsg.value === msg) toastMsg.value = ''; }, 3000); };

            const cloudSyncState = ref(navigator.onLine ? 'ready' : 'offline');
            const cloudStatusText = computed(() => ({ syncing: '☁️上傳', offline: '📴離線', queued: '⏳待傳', ready: '☁️v1.0' }[cloudSyncState.value] || '☁️v1.0'));
            const cloudStatusClass = computed(() => cloudSyncState.value === 'syncing' ? 'bg-amber-100 text-amber-900 border-amber-300' : cloudSyncState.value === 'offline' ? 'bg-zinc-100 text-zinc-500 border-zinc-300' : cloudSyncState.value === 'queued' ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-emerald-50 text-emerald-700 border-emerald-300');
            const showCloudDetail = () => { if (!navigator.onLine) showToast('📴 無網絡模式：照常度尺，有訊號自動上傳'); else if (cloudSyncState.value === 'queued') processPendingUploadQueue(false); else showToast(`度尺寶 Pro v1.0 · ${currentUser.value ? 'Google 帳號已連線' : '訪客離線模式'}`); };
            const photoFingerprint = (b64) => b64 ? b64.slice(0, 100) + '_' + b64.length : '';
            const getBaseImageKey = (pg) => pg?.photoId ? String(pg.photoId) : (pg?.photo && !pg.isSketch ? photoFingerprint(pg.photo) : '');

            const updateQueue = async (code, add) => { code = String(code || '').trim(); if (!code) return; const q = (await localforage.getItem('pending_upload_queue')) || []; const next = add ? (q.includes(code) ? q : [...q, code]) : q.filter(c => c !== code); await localforage.setItem('pending_upload_queue', next); };
            const markProjectChanged = () => { project.nameUpdatedAt = Date.now(); hasUnsavedCloudChanges.value = true; if (!navigator.onLine) cloudSyncState.value = 'offline'; };
            const touchDirty = (pg = targetPage.value) => { const now = Date.now(), today = getTodayStr(); if (targetPin.value) targetPin.value.updatedAt = now; if (pg) { pg.updatedAt = now; pg.date = today; if (authorName.value) pg.author = authorName.value; dirtyPageIds.add(pg.id); } project.date = today; hasUnsavedCloudChanges.value = true; if (!navigator.onLine) cloudSyncState.value = 'offline'; };

            const showBranchPrompt = ref(false), branchOwner = ref(''), branchInputValue = ref(''), pendingBranchAction = ref(null), branchTargetPage = ref(null);
            const triggerBranchPrompt = (pg, owner, actionCb) => { isDrawing.value = false; currentLine.value = null; currentWall.value = null; currentPath.value = ''; if (draggedMarker.value) { draggedMarker.value.x = markerOrigin.value.x; draggedMarker.value.y = markerOrigin.value.y; draggedMarker.value = null; } branchOwner.value = owner; branchInputValue.value = ''; branchTargetPage.value = pg; pendingBranchAction.value = actionCb; showBranchPrompt.value = true; nextTick(() => document.querySelector('input[placeholder="Y"]')?.focus()); };
            const doBranchCopy = (pg, me) => { const c = JSON.parse(JSON.stringify(pg)), sharedPhotoId = pg.photoId || ('page_' + pg.id); pg.photoId = sharedPhotoId; const isB = splitMode.value && activePane.value === 'B'; const oldPinId = (isB ? pinB.value : activePin.value) ? String((isB ? pinB.value : activePin.value).id) : null; const newPg = makeEmptyPage({ space: c.space || '', date: getTodayStr(), author: me, photo: pg.photo, photoId: sharedPhotoId, w: c.w || 1200, h: c.h || 900, isSketch: !!c.isSketch, hasGrid: !!c.hasGrid, markers: c.markers || [], lines: c.lines || [], walls: c.walls || [], paths: c.paths || [], pins: c.pins || [], deletedPinIds: c.deletedPinIds || [] }); pages.value.push(newPg); if (isB) { pageIndexB.value = pages.value.length - 1; if (oldPinId) pinB.value = (newPg.pins || []).find(p => String(p.id) === oldPinId) || null; } else { activePageIndex.value = pages.value.length - 1; if (oldPinId) activePin.value = (newPg.pins || []).find(p => String(p.id) === oldPinId) || null; } dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true; showToast(`📋 已複製為 P${pages.value.length} (保留 [${branchOwner.value}] 原圖)`); };
            const confirmBranch = () => { if (branchInputValue.value.trim().toUpperCase() === 'Y') doBranchCopy(branchTargetPage.value, String(authorName.value || '').trim()); const cb = pendingBranchAction.value; showBranchPrompt.value = false; pendingBranchAction.value = null; branchTargetPage.value = null; if (cb) cb(); };
            const cancelBranch = () => { const cb = pendingBranchAction.value; showBranchPrompt.value = false; pendingBranchAction.value = null; branchTargetPage.value = null; if (cb) cb(); };
            const checkBranchNeed = (actionCb) => { const pg = targetPage.value, me = String(authorName.value || '').trim(); if (!pg || !pg.photo || !me) return actionCb(); const owner = String(pg.author || '').trim(); if (!owner || owner === me) return actionCb(); triggerBranchPrompt(pg, owner, actionCb); };

            const drawMode = ref('browse'), showTopSheet = ref(false), showTopTextBar = ref(false), activeMarker = ref(null);
            const isProcessing = ref(false), processingText = ref(''), focusedInput = ref('val'), topTextInputRef = ref(null), svgCanvas = ref(null), svgCanvasB = ref(null);

            const showIndexModal = ref(false), indexDraftPos = ref({ x: 0, y: 0 }), indexCustomCode = ref(''), editingIndexMarker = ref(null);
            const openIndexModalAt = (x, y, existing = null) => { indexDraftPos.value = { x, y }; editingIndexMarker.value = existing; indexCustomCode.value = existing?.data?.customCode || ''; showIndexModal.value = true; };
            const placeSpaceTag = (sp) => { checkBranchNeed(() => { const c = targetCanvas.value; if (!c) return; c.markers ||= []; c.historyStack ||= []; c.redoStack = []; if (editingIndexMarker.value) { const target = c.markers.find(m => m.id === editingIndexMarker.value.id); if (target) { target.type = 'space_tag'; target.textColor = defaultTextColor.value !== '#ffffff' ? defaultTextColor.value : null; target.data = { ...makeBlankMarkerData(), val: sp }; updateMarkerSize(target); } } else { const markerId = Date.now(); const newMarker = { id: markerId, lineId: null, x: indexDraftPos.value.x, y: indexDraftPos.value.y, w: 140, h: 56, type: 'space_tag', textColor: defaultTextColor.value !== '#ffffff' ? defaultTextColor.value : null, data: { ...makeBlankMarkerData(), val: sp } }; updateMarkerSize(newMarker); c.markers.push(newMarker); c.historyStack.push({ type: 'marker', markerId }); } touchDirty(); saveAll(); showIndexModal.value = false; editingIndexMarker.value = null; }); };
            const addCustomSpaceTag = () => { const s = prompt('輸入空間或標籤名稱：')?.trim(); if (s) { if (!spaceList.value.includes(s)) spaceList.value.push(s); placeSpaceTag(s); } };
            const placePageLink = (targetPg, targetIdx) => { checkBranchNeed(() => { const c = targetCanvas.value; if (!c) return; c.markers ||= []; c.historyStack ||= []; c.redoStack = []; const code = String(indexCustomCode.value || '').trim(), label = code ? `${code} ➔ P${targetIdx + 1}` : `P${targetIdx + 1}${targetPg.space ? ' ' + targetPg.space : ''}`; if (editingIndexMarker.value) { const target = c.markers.find(m => m.id === editingIndexMarker.value.id); if (target) { target.type = 'page_link'; target.data = { ...makeBlankMarkerData(), val: label, customCode: code, targetPageId: targetPg.id }; updateMarkerSize(target); } } else { const markerId = Date.now(); const newMarker = { id: markerId, lineId: null, x: indexDraftPos.value.x, y: indexDraftPos.value.y, w: 160, h: 56, type: 'page_link', data: { ...makeBlankMarkerData(), val: label, customCode: code, targetPageId: targetPg.id } }; updateMarkerSize(newMarker); c.markers.push(newMarker); c.historyStack.push({ type: 'marker', markerId }); } touchDirty(); saveAll(); showIndexModal.value = false; editingIndexMarker.value = null; showToast(`🔗 已連結至 P${targetIdx + 1}`); }); };
            const deleteEditingIndexMarker = () => { if (!editingIndexMarker.value) return; activeMarker.value = editingIndexMarker.value; showIndexModal.value = false; editingIndexMarker.value = null; deleteMarkerTop(); };

            const enterEditMode = (idx = 0) => { resetZoom(); showQuickPageNav.value = false; selectMode.value = false; selectedPageIds.value = []; splitMode.value = false; activePane.value = 'A'; activePageIndex.value = idx; activePin.value = null; drawMode.value = 'browse'; currentView.value = 'proj'; };
            const switchToPreview = async () => { await saveAll(); resetZoom(); showQuickPageNav.value = false; selectMode.value = false; selectedPageIds.value = []; splitMode.value = false; activePane.value = 'A'; activePin.value = null; currentView.value = 'preview'; };

            const mergeableGroups = computed(() => { const map = new Map(); pages.value.forEach((pg, idx) => { const key = getBaseImageKey(pg); if (key) { if (!map.has(key)) map.set(key, []); map.get(key).push({ pg, idx }); } }); return Array.from(map.entries()).filter(([, items]) => items.length >= 2).map(([key, items]) => ({ key, photo: items[0].pg.photo, items })); });
            const mergePageGroup = async (grp) => { const maps = { lines: new Map(), walls: new Map(), paths: new Map(), markers: new Map(), pins: new Map() }; const delPins = new Set(project.deletedPinIds || []); let space = '', w = 1200, h = 900, isSketch = false, hasGrid = false; grp.items.forEach(({ pg }) => { if (!space && pg.space) space = pg.space; w = pg.w || w; h = pg.h || h; isSketch ||= !!pg.isSketch; hasGrid ||= !!pg.hasGrid; (pg.deletedPinIds || []).forEach(id => delPins.add(String(id))); Object.keys(maps).forEach(k => (pg[k] || []).forEach(x => { if (!(k === 'pins' && delPins.has(String(x.id)))) maps[k].set(String(x.id), JSON.parse(JSON.stringify(x))); })); }); const mergedPg = makeEmptyPage({ space, date: getTodayStr(), author: (authorName.value || '團隊') + ' (合併)', photo: grp.photo, photoId: grp.key, w, h, isSketch, hasGrid, lines: [...maps.lines.values()], walls: [...maps.walls.values()], paths: [...maps.paths.values()], markers: [...maps.markers.values()], pins: [...maps.pins.values()], deletedPinIds: [...delPins] }); pages.value.push(mergedPg); dirtyPageIds.add(mergedPg.id); hasUnsavedCloudChanges.value = true; showMergeModal.value = false; await saveAll(); showToast(`✅ 已智能合併為 P${pages.value.length}`); };

            const isDrawing = ref(false), drawingPane = ref('A'), startPos = ref({ x: 0, y: 0 }), currentLine = ref(null), currentWall = ref(null), currentPath = ref('');
            let tempPoints = []; const draggedMarker = ref(null), dragOrigin = ref({ x: 0, y: 0 }), markerOrigin = ref({ x: 0, y: 0 });
            const hasUndoItems = computed(() => targetCanvas.value?.historyStack?.length > 0), hasRedoItems = computed(() => targetCanvas.value?.redoStack?.length > 0);
            let isPinching = false, pinchPane = 'A', pinchStartDist = 0, pinchStartScale = 1, pinchAnchorSvg = null;
            let isPanningBrowse = false, panPane = 'A', panStartClient = { x: 0, y: 0 }, panStartVb = { x: 0, y: 0 };
            let touchStartTime = 0, touchMoved = false, pendingTapMarker = null, isSpaceDown = false;

            const getClientPoint = (e) => e.touches?.[0] || e.changedTouches?.[0] || e;
            const clientToSvgPoint = (clientX, clientY, pane = 'A') => { const isB = pane === 'B', svg = isB ? svgCanvasB.value : svgCanvas.value, cObj = isB ? canvasB.value : activeCanvas.value; if (!svg || !cObj) return { x: 0, y: 0 }; const pw = cObj.w || 1200, ph = cObj.h || 900; try { const ctm = svg.getScreenCTM(); if (ctm) { const p = svg.createSVGPoint(); p.x = clientX; p.y = clientY; const loc = p.matrixTransform(ctm.inverse()); return { x: Math.round(Math.max(0, Math.min(pw, loc.x))), y: Math.round(Math.max(0, Math.min(ph, loc.y))) }; } } catch (_) {} const zVal = isB ? zoomScaleB.value : zoomScale.value, xVal = isB ? vbXB.value : vbX.value, yVal = isB ? vbYB.value : vbY.value; const vw = pw / zVal, vh = ph / zVal, vx = Math.max(0, Math.min(pw - vw, xVal)), vy = Math.max(0, Math.min(ph - vh, yVal)); const r = svg.getBoundingClientRect(), s = Math.min(r.width / vw, r.height / vh); return { x: Math.round(Math.max(0, Math.min(pw, vx + (clientX - r.left - (r.width - vw * s) / 2) / s))), y: Math.round(Math.max(0, Math.min(ph, vy + (clientY - r.top - (r.height - vh * s) / 2) / s))) }; };
            const getCoords = (e, pane = activePane.value) => { const pt = getClientPoint(e); return clientToSvgPoint(pt.clientX, pt.clientY, pane); };
            const snapWallEnd = (x1, y1, x2, y2) => { if (Math.hypot(x2 - x1, y2 - y1) < 10) return { x: x2, y: y2 }; const deg = Math.abs(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI); if (deg <= 4 || deg >= 176) return { x: x2, y: y1 }; if (Math.abs(deg - 90) <= 4) return { x: x1, y: y2 }; return { x: x2, y: y2 }; };
            const getAdaptiveCanvasSize = () => { const stage = document.getElementById('draw-stage'); let w = 1200, h = 1500; if (stage) { const rect = stage.getBoundingClientRect(); if (rect.width > 0 && rect.height > 0) { const ratio = rect.width / rect.height; if (ratio > 1) { h = 1500; w = Math.round(h * ratio); } else { w = 1500; h = Math.round(w / ratio); } } } return { w, h }; };
            const makeEmptyPage = (ov = {}) => { const pg = { id: 'pg_' + Date.now() + '_' + Math.floor(Math.random() * 99999), space: '', date: ov.date || getTodayStr(), author: authorName.value || '', photo: null, photoId: '', w: 1200, h: 900, isSketch: false, hasGrid: false, markers: [], lines: [], walls: [], paths: [], pins: [], deletedPinIds: [], historyStack: [], redoStack: [], updatedAt: Date.now(), ...ov }; if (pg.isSketch && !pg.photo) { const size = getAdaptiveCanvasSize(); pg.w = ov.w || size.w; pg.h = ov.h || size.h; pg.photo = renderSketchDataUrl(pg.w, pg.h, !!pg.hasGrid); } return pg; };
            const initSketchOnCurrent = () => { if (!targetCanvas.value) return; targetPaneResetZoom(); const size = getAdaptiveCanvasSize(); Object.assign(targetCanvas.value, { photo: renderSketchDataUrl(size.w, size.h, true), w: size.w, h: size.h, isSketch: true, hasGrid: true }); touchDirty(); drawMode.value = 'browse'; saveAll(); };
            const addNewSketchPage = (hasGrid) => { showAddPageModal.value = false; resetZoom(); const size = getAdaptiveCanvasSize(); const newPg = makeEmptyPage({ photo: renderSketchDataUrl(size.w, size.h, hasGrid), w: size.w, h: size.h, isSketch: true, hasGrid }); pages.value.push(newPg); activePageIndex.value = pages.value.length - 1; dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true; drawMode.value = 'browse'; saveAll(); };
            const duplicateCurrentPage = (keepAnnotations = false) => { showAddPageModal.value = false; const src = targetPage.value; if (!src?.photo) return; resetZoom(); const sharedPhotoId = src.photoId || ('page_' + src.id); src.photoId = sharedPhotoId; const c = JSON.parse(JSON.stringify(src)); const newPg = makeEmptyPage({ space: src.space || '', photo: src.photo, photoId: sharedPhotoId, w: src.w || 1200, h: src.h || 900, isSketch: !!src.isSketch, hasGrid: !!src.hasGrid, markers: keepAnnotations ? (c.markers || []) : [], lines: keepAnnotations ? (c.lines || []) : [], walls: keepAnnotations ? (c.walls || []) : [], paths: keepAnnotations ? (c.paths || []) : [], pins: [] }); pages.value.push(newPg); if (splitMode.value && activePane.value === 'B') pageIndexB.value = pages.value.length - 1; else activePageIndex.value = pages.value.length - 1; dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true; drawMode.value = 'browse'; saveAll(); showToast(keepAnnotations ? `📑 已複製整頁為 P${pages.value.length}` : `📄 已複製純淨底圖為 P${pages.value.length}`); };
            const toggleSketchGrid = () => { if (!targetCanvas.value) return; checkBranchNeed(() => { targetCanvas.value.hasGrid = !targetCanvas.value.hasGrid; targetCanvas.value.photo = renderSketchDataUrl(targetCanvas.value.w || 1200, targetCanvas.value.h || 1500, targetCanvas.value.hasGrid); touchDirty(); saveAll(); }); };
            const targetPaneResetZoom = () => { if (splitMode.value && activePane.value === 'B') resetZoomB(); else resetZoom(); };

            const switchPage = (idx, pane = 'A') => { if (pane === 'B') { resetZoomB(); showQuickPageNavB.value = false; pageIndexB.value = idx; pinB.value = null; } else { resetZoom(); showQuickPageNav.value = false; activePageIndex.value = idx; activePin.value = null; } drawMode.value = 'browse'; };
            const prevPage = (pane = 'A') => { const cur = pane === 'B' ? pageIndexB.value : activePageIndex.value; if (cur > 0) switchPage(cur - 1, pane); };
            const nextPage = (pane = 'A') => { const cur = pane === 'B' ? pageIndexB.value : activePageIndex.value; if (cur < pages.value.length - 1) switchPage(cur + 1, pane); };
            const deleteCurrentPage = () => { if (pages.value.length <= 1) return; if (prompt(`⚠️ 確認刪除 P${activePageIndex.value + 1}？\n請輸入 "d" 確認：`)?.trim().toLowerCase() !== 'd') return; resetZoom(); showQuickPageNav.value = false; const delId = activePage.value.id; project.deletedPageIds ||= []; if (!project.deletedPageIds.includes(delId)) project.deletedPageIds.push(delId); dirtyPageIds.delete(delId); pages.value.splice(activePageIndex.value, 1); activePageIndex.value = Math.max(0, activePageIndex.value - 1); pageIndexB.value = Math.min(pageIndexB.value, pages.value.length - 1); project.pageOrderUpdatedAt = Date.now(); hasUnsavedCloudChanges.value = true; saveAll(); if (db && project.code) { const ref = db.collection('site_projects').doc(String(project.code)); ref.collection('pages').doc(delId).delete().catch(() => {}); ref.set({ deletedPageIds: firebase.firestore.FieldValue.arrayUnion(delId), updatedAt: Date.now() }, { merge: true }).catch(() => {}); } showToast('🗑️ 已刪除頁面'); };

            const openPinSubPage = (pin, idx, pane = 'A') => { const isB = pane === 'B'; isB ? resetZoomB() : resetZoom(); showQuickPageNav.value = false; showQuickPageNavB.value = false; const parentPg = isB ? pageB.value : activePage.value; Object.assign(pin, { markers: pin.markers || [], lines: pin.lines || [], walls: pin.walls || [], paths: pin.paths || [], historyStack: [], redoStack: [], w: pin.w || 1200, h: pin.h || 900, space: pin.space || parentPg?.space || '' }); if (pin.isSketch && !pin.photo) { const size = getAdaptiveCanvasSize(); pin.photo = renderSketchDataUrl(size.w, size.h, !!pin.hasGrid); pin.w = size.w; pin.h = size.h; } if (isB) { pinB.value = pin; pinIndexB.value = idx; } else { activePin.value = pin; activePinIndex.value = idx; } drawMode.value = 'browse'; };
            const exitPinSubPage = (pane = 'A') => { if (pane === 'B') { resetZoomB(); pinB.value = null; } else { resetZoom(); activePin.value = null; } drawMode.value = 'browse'; };
            const onPinTap = (pin, index, pane = 'A') => { focusPane(pane); if (drawMode.value === 'eraser') { showToast('📍 落釘受保護，請點入內按「🗑️刪釘」移除'); return; } openPinSubPage(pin, index, pane); };
            const deleteActivePin = async (pane = activePane.value) => { const isB = pane === 'B', pObj = isB ? pinB.value : activePin.value, pg = isB ? pageB.value : activePage.value; if (!pObj || !pg) return; activePane.value = pane; checkBranchNeed(async () => { const pinId = String(pObj.id), idx = (pg.pins || []).findIndex(p => String(p.id) === pinId); if (idx !== -1) { const removedPin = JSON.parse(JSON.stringify(pg.pins[idx])); pg.pins.splice(idx, 1); pg.deletedPinIds ||= []; if (!pg.deletedPinIds.includes(pinId)) pg.deletedPinIds.push(pinId); project.deletedPinIds ||= []; if (!project.deletedPinIds.includes(pinId)) project.deletedPinIds.push(pinId); pg.historyStack ||= []; pg.redoStack = []; pg.historyStack.push({ type: 'delete_pin', pin: removedPin, index: idx }); } touchDirty(pg); exitPinSubPage(pane); await saveAll(); showToast('🗑️ 已刪釘（按 ↶ 可復原）'); }); };

            const resolveMediaDoc = async (doc) => { const d = doc.data(); if (!d) return null; if (d.photo) return d.photo; if (d.chunked && d.totalChunks > 0) { const snap = await withRetry(() => withTimeout(doc.ref.collection('chunks').get(), 15000)); const list = snap.docs.map(c => c.data()).sort((a, b) => (a.index || 0) - (b.index || 0)); if (list.length === d.totalChunks) return list.map(c => c.data || '').join(''); } return null; };
            const loadMediaMapFromRef = async (projRef) => { const snap = await withRetry(() => withTimeout(projRef.collection('media').get(), 20000)); const map = new Map(); await Promise.all(snap.docs.map(async (m) => { const fullPhoto = await resolveMediaDoc(m); if (fullPhoto) map.set(String(m.id), { photo: fullPhoto, data: m.data() }); })); return map; };
            const openPhotoPool = async (target = 'newPage') => { showAddPageModal.value = false; photoPoolTarget.value = target; isProcessing.value = true; processingText.value = '正在讀取工程底圖庫...'; try { const seen = new Set(), list = []; const addUnique = (item) => { if (!item?.photo || item.isSketch) return; const fp = photoFingerprint(item.photo); if (seen.has(fp)) return; seen.add(fp); list.push({ id: item.id || ('pool_' + list.length), photo: item.photo, w: item.w || 1200, h: item.h || 900, author: item.author || '', updatedAt: item.updatedAt || 0 }); }; if (db && navigator.onLine && project.code) { try { const mediaMap = await loadMediaMapFromRef(db.collection('site_projects').doc(String(project.code))); mediaMap.forEach((v, id) => addUnique({ id, photo: v.photo, w: v.data.w, h: v.data.h, author: v.data.author, updatedAt: v.data.updatedAt })); } catch (_) {} } (photoPool.value || []).forEach(addUnique); pages.value.forEach(pg => { addUnique({ id: pg.photoId || ('page_' + pg.id), photo: pg.photo, w: pg.w, h: pg.h, author: pg.author, isSketch: pg.isSketch }); (pg.pins || []).forEach(pin => addUnique({ id: pin.photoId || String(pin.id), photo: pin.photo, w: pin.w, h: pin.h, isSketch: pin.isSketch })); }); photoPoolList.value = list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); showPhotoPoolModal.value = true; } finally { isProcessing.value = false; } };
            const selectFromPhotoPool = (item) => { showPhotoPoolModal.value = false; targetPaneResetZoom(); if (photoPoolTarget.value === 'newPage') { const newPg = makeEmptyPage({ photo: item.photo, photoId: item.id, w: item.w || 1200, h: item.h || 900 }); pages.value.push(newPg); activePageIndex.value = pages.value.length - 1; dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true; showToast(`✅ 已建立 P${pages.value.length}`); drawMode.value = 'browse'; saveAll(); } else if (targetCanvas.value) { checkBranchNeed(() => { Object.assign(targetCanvas.value, { photo: item.photo, photoId: item.id, w: item.w || 1200, h: item.h || 900, isSketch: false }); touchDirty(); drawMode.value = 'browse'; saveAll(); }); } };
            const deleteFromPhotoPool = async (item) => { if (!confirm('確定要從底圖庫移除這張照片嗎？')) return; const fp = photoFingerprint(item.photo); photoPoolList.value = photoPoolList.value.filter(x => photoFingerprint(x.photo) !== fp); photoPool.value = photoPool.value.filter(x => photoFingerprint(x.photo) !== fp); await saveAll(); if (db && project.code && item.id) { const mRef = db.collection('site_projects').doc(String(project.code)).collection('media').doc(String(item.id)); mRef.collection('chunks').get().then(s => s.forEach(c => c.ref.delete())).catch(() => {}); mRef.delete().catch(() => {}); } };

            const setPageSpace = (sp) => { checkBranchNeed(() => { if (targetCanvas.value) targetCanvas.value.space = sp; touchDirty(); showSpaceModal.value = false; saveAll(); }); };
            const addCustomSpace = () => { const s = prompt('輸入空間名稱（例如：閣樓）')?.trim(); if (s) { if (!spaceList.value.includes(s)) spaceList.value.push(s); setPageSpace(s); } };

            const onEraseTap = (targetType, item, e, pane = activePane.value) => { focusPane(pane); if (drawMode.value !== 'eraser') return; if (e.touches?.length > 1 || isPinching || showBranchPrompt.value) return; e.preventDefault(); e.stopPropagation(); const targetId = item.id; checkBranchNeed(() => { const c = targetCanvas.value; if (!c) return; c.historyStack ||= []; c.redoStack = []; if (targetType === 'wall') { const idx = (c.walls || []).findIndex(x => x.id === targetId); if (idx === -1) return; const removed = c.walls.splice(idx, 1)[0]; c.historyStack.push({ type: 'erase', targetType: 'wall', item: removed }); } else if (targetType === 'path') { const idx = (c.paths || []).findIndex(x => x.id === targetId); if (idx === -1) return; const removed = c.paths.splice(idx, 1)[0]; c.historyStack.push({ type: 'erase', targetType: 'path', item: removed }); } else if (targetType === 'line') { const idx = (c.lines || []).findIndex(x => x.id === targetId); if (idx === -1) return; const removedLine = c.lines.splice(idx, 1)[0]; let linkedMarker = null; const mIdx = (c.markers || []).findIndex(m => m.lineId === targetId); if (mIdx !== -1) linkedMarker = c.markers.splice(mIdx, 1)[0]; c.historyStack.push({ type: 'erase', targetType: 'line', item: removedLine, linkedMarker }); } else if (targetType === 'marker') { const idx = (c.markers || []).findIndex(x => x.id === targetId); if (idx === -1) return; const removedMarker = c.markers.splice(idx, 1)[0]; let linkedLine = null; if (removedMarker.lineId) { const lIdx = (c.lines || []).findIndex(l => l.id === removedMarker.lineId); if (lIdx !== -1) linkedLine = c.lines.splice(lIdx, 1)[0]; } c.historyStack.push({ type: 'erase', targetType: 'marker', item: removedMarker, linkedLine }); } touchDirty(); saveAll(); }); };

            const makeBlankMarkerData = () => ({ val: '', name: '', customCode: '', targetPageId: '', cadType: '', w_in: '', h_in: '', d_in: '', w: '', d: '', h: '', t: '', h_bottom: '', t_stone: '', d_stone: '', t_frame: '', h_top: '', w_side: '', d_out: '' });
            const createPointMarker = (x, y, forceType) => { checkBranchNeed(() => { const c = targetCanvas.value; if (!c) return; c.markers ||= []; c.historyStack ||= []; c.redoStack = []; const markerId = Date.now(); const newMarker = { id: markerId, lineId: null, x, y, w: 140, h: 56, type: forceType, textColor: forceType === 'stamp' ? null : defaultTextColor.value, data: makeBlankMarkerData() }; updateMarkerSize(newMarker); c.markers.push(newMarker); c.historyStack.push({ type: 'marker', markerId }); touchDirty(); activeMarker.value = newMarker; if (forceType === 'stamp') { stampFilter.value = 'hot'; showQuickAddStamp.value = false; focusedInput.value = 'stamp'; showTopSheet.value = true; } else { showTopTextBar.value = true; nextTick(() => topTextInputRef.value?.focus()); } saveAll(); }); };
            const placeCadBlockAt = (x, y) => { const def = CAD_DEFS[selectedCadType.value]; if (!def) return; checkBranchNeed(() => { const c = targetCanvas.value; if (!c) return; c.markers ||= []; c.historyStack ||= []; c.redoStack = []; const markerId = Date.now(); const newMarker = { id: markerId, lineId: null, x, y, w: def.w, h: def.h, type: 'cad', color: drawColor.value, rot: 0, scale: 1, flipX: 1, flipY: 1, data: { ...makeBlankMarkerData(), cadType: selectedCadType.value } }; c.markers.push(newMarker); c.historyStack.push({ type: 'marker', markerId }); activeMarker.value = newMarker; showTopTextBar.value = true; touchDirty(); saveAll(); }); };
            const onMarkerPointerStart = (marker, e, pane = activePane.value) => { focusPane(pane); if (e.touches?.length > 1 || isPinching || showBranchPrompt.value) return; if (showQuickPageNav.value) showQuickPageNav.value = false; if (showQuickPageNavB.value) showQuickPageNavB.value = false; if (drawMode.value === 'eraser') { onEraseTap('marker', marker, e, pane); return; } const pt = getClientPoint(e); if (drawMode.value === 'move') { e.preventDefault(); e.stopPropagation(); checkBranchNeed(() => { const target = (targetCanvas.value.markers || []).find(m => m.id === marker.id) || marker; if (showBranchPrompt.value) return; draggedMarker.value = target; activeMarker.value = target; const p = getCoords(e, pane); dragOrigin.value = { x: p.x, y: p.y }; markerOrigin.value = { x: target.x, y: target.y }; }); return; } if (drawMode.value === 'index' && ['space_tag', 'page_link'].includes(marker.type)) { e.preventDefault(); e.stopPropagation(); openIndexModalAt(marker.x, marker.y, marker); return; } if (drawMode.value === 'browse') pendingTapMarker = { marker, pane, clientX: pt.clientX, clientY: pt.clientY }; };
            const openMarkerEditor = (m, pane = activePane.value) => { focusPane(pane); if (m.type === 'page_link' && m.data?.targetPageId) { jumpToPageById(m.data.targetPageId, pane); return; } if (m.type === 'space_tag') { openIndexModalAt(m.x, m.y, m); return; } activeMarker.value = m; if (['text', 'image', 'cad'].includes(m.type)) { showTopTextBar.value = true; if (m.type === 'text') nextTick(() => topTextInputRef.value?.focus()); } else { if (m.type === 'stamp') { stampFilter.value = 'hot'; showQuickAddStamp.value = false; } showTopSheet.value = true; focusedInput.value = TAG_DEFS[m.type]?.fields[0]?.key || 'val'; } };

            const beginPinch = (t1, t2, pane = 'A') => { isPinching = true; pinchPane = pane; isDrawing.value = false; isPanningBrowse = false; pendingTapMarker = null; currentLine.value = null; currentWall.value = null; currentPath.value = ''; if (draggedMarker.value) { draggedMarker.value.x = markerOrigin.value.x; draggedMarker.value.y = markerOrigin.value.y; draggedMarker.value = null; } pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1; pinchStartScale = pane === 'B' ? zoomScaleB.value : zoomScale.value; pinchAnchorSvg = clientToSvgPoint((t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2, pane); };
            const onStageTouchStart = (e, pane = 'A') => { focusPane(pane); if (showQuickPageNav.value) showQuickPageNav.value = false; if (showQuickPageNavB.value) showQuickPageNavB.value = false; if (showTopSheet.value || showTopTextBar.value || showIndexModal.value || showBranchPrompt.value) return; if (e.touches.length >= 2) { e.preventDefault(); beginPinch(e.touches[0], e.touches[1], pane); return; } if (isPinching) return; touchStartTime = Date.now(); touchMoved = false; if (e.touches.length === 1 && !draggedMarker.value) { if (drawMode.value === 'browse') { isPanningBrowse = true; panPane = pane; panStartClient = { x: e.touches[0].clientX, y: e.touches[0].clientY }; panStartVb = pane === 'B' ? { x: vbXB.value, y: vbYB.value } : { x: vbX.value, y: vbY.value }; } else if (!['eraser', 'move'].includes(drawMode.value)) beginStroke(e, pane); } };
            const onStageTouchMove = (e, pane = 'A') => { if (showBranchPrompt.value) return; if (e.touches.length >= 2) { e.preventDefault(); if (!isPinching) { beginPinch(e.touches[0], e.touches[1], pane); return; } const t1 = e.touches[0], t2 = e.touches[1], curDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1; applyZoomAtClientPoint(pinchStartScale * (curDist / pinchStartDist), (t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2, pinchAnchorSvg, pinchPane); return; } if (isPinching) return; if (e.touches.length === 1) { if (pendingTapMarker && Math.hypot(e.touches[0].clientX - pendingTapMarker.clientX, e.touches[0].clientY - pendingTapMarker.clientY) > 6) pendingTapMarker = null; touchMoved = true; if (isPanningBrowse) { e.preventDefault(); panByClientDelta(e.touches[0].clientX - panStartClient.x, e.touches[0].clientY - panStartClient.y, panPane); } else moveStroke(e, pane); } };
            const onStageTouchEnd = (e, pane = 'A') => { if (e.touches.length === 0) { if (isPinching) { isPinching = false; pinchAnchorSvg = null; return; } if (isPanningBrowse) { isPanningBrowse = false; if (pendingTapMarker) { const { marker, pane: p } = pendingTapMarker; pendingTapMarker = null; openMarkerEditor(marker, p); } return; } } if (isPinching || showBranchPrompt.value) return; if (drawMode.value === 'line' && !touchMoved && (Date.now() - touchStartTime < 260) && e.touches.length === 0) { isDrawing.value = false; currentLine.value = null; const endPos = getCoords(e, pane); createPointMarker(endPos.x, endPos.y, 'stamp'); return; } if (e.touches.length === 0) endStroke(e, pane); };
            const panByClientDelta = (dxClient, dyClient, pane = 'A') => { const isB = pane === 'B', svg = isB ? svgCanvasB.value : svgCanvas.value; if (!svg) return; const pw = isB ? canvasWB.value : canvasW.value, ph = isB ? canvasHB.value : canvasH.value, zVal = isB ? zoomScaleB.value : zoomScale.value, vw = pw / zVal, vh = ph / zVal, r = svg.getBoundingClientRect(), fitScale = Math.min(r.width / vw, r.height / vh) || 1, nextX = Math.max(0, Math.min(pw - vw, panStartVb.x - dxClient / fitScale)), nextY = Math.max(0, Math.min(ph - vh, panStartVb.y - dyClient / fitScale)); if (isB) { vbXB.value = nextX; vbYB.value = nextY; } else { vbX.value = nextX; vbY.value = nextY; } };
            const onStageMouseDown = (e, pane = 'A') => { focusPane(pane); if (showQuickPageNav.value) showQuickPageNav.value = false; if (showQuickPageNavB.value) showQuickPageNavB.value = false; if (showTopSheet.value || showTopTextBar.value || showIndexModal.value || showBranchPrompt.value) return; if (e.button === 1 || isSpaceDown || (drawMode.value === 'browse' && !draggedMarker.value)) { e.preventDefault(); isPanningBrowse = true; panPane = pane; panStartClient = { x: e.clientX, y: e.clientY }; panStartVb = pane === 'B' ? { x: vbXB.value, y: vbYB.value } : { x: vbX.value, y: vbY.value }; return; } if (!draggedMarker.value && !['browse', 'eraser', 'move'].includes(drawMode.value)) beginStroke(e, pane); };
            const onStageMouseMove = (e, pane = 'A') => { if (showBranchPrompt.value) return; if (pendingTapMarker && Math.hypot(e.clientX - pendingTapMarker.clientX, e.clientY - pendingTapMarker.clientY) > 6) pendingTapMarker = null; if (isPanningBrowse) { panByClientDelta(e.clientX - panStartClient.x, e.clientY - panStartClient.y, panPane); return; } moveStroke(e, pane); };
            const onStageMouseUp = (e, pane = 'A') => { if (isPanningBrowse) { isPanningBrowse = false; if (pendingTapMarker) { const { marker, pane: p } = pendingTapMarker; pendingTapMarker = null; openMarkerEditor(marker, p); } return; } if (!showBranchPrompt.value) endStroke(e, pane); };
            const beginStroke = (e, pane = 'A') => { isDrawing.value = true; drawingPane.value = pane; startPos.value = getCoords(e, pane); if (['line', 'arrow-single', 'straight'].includes(drawMode.value)) currentLine.value = { x1: startPos.value.x, y1: startPos.value.y, x2: startPos.value.x, y2: startPos.value.y }; else if (drawMode.value === 'wall') currentWall.value = { x1: startPos.value.x, y1: startPos.value.y, x2: startPos.value.x, y2: startPos.value.y, style: wallStyle.value, color: drawColor.value }; else if (drawMode.value === 'freehand') { tempPoints = [[startPos.value.x, startPos.value.y]]; currentPath.value = `M ${startPos.value.x} ${startPos.value.y}`; } };
            const moveStroke = (e, pane = activePane.value) => { if (draggedMarker.value) { e.preventDefault(); const p = getCoords(e, pane), dx = p.x - dragOrigin.value.x, dy = p.y - dragOrigin.value.y; draggedMarker.value.x = Math.round(Math.max(0, Math.min(targetCanvasW.value, markerOrigin.value.x + dx))); draggedMarker.value.y = Math.round(Math.max(0, Math.min(targetCanvasH.value, markerOrigin.value.y + dy))); } else if (isDrawing.value) { e.preventDefault(); const p = getCoords(e, drawingPane.value); if (drawMode.value === 'line' || drawMode.value === 'arrow-single') { currentLine.value.x2 = p.x; currentLine.value.y2 = p.y; } else if (drawMode.value === 'straight' && currentLine.value) { const snapped = snapWallEnd(currentLine.value.x1, currentLine.value.y1, p.x, p.y); currentLine.value.x2 = snapped.x; currentLine.value.y2 = snapped.y; } else if (drawMode.value === 'wall' && currentWall.value) { const snapped = snapWallEnd(currentWall.value.x1, currentWall.value.y1, p.x, p.y); currentWall.value.x2 = snapped.x; currentWall.value.y2 = snapped.y; } else if (drawMode.value === 'freehand') { tempPoints.push([p.x, p.y]); currentPath.value = `M ${tempPoints.map(pt => `${pt[0]} ${pt[1]}`).join(' L ')}`; } } };
            const endStroke = (e) => { if (draggedMarker.value) { const moved = Math.hypot(draggedMarker.value.x - markerOrigin.value.x, draggedMarker.value.y - markerOrigin.value.y) > 2; draggedMarker.value = null; if (moved) { touchDirty(); saveAll(); } return; } if (!isDrawing.value) return; isDrawing.value = false; const endPos = getCoords(e, drawingPane.value); if (drawMode.value === 'cad') { currentLine.value = null; currentWall.value = null; currentPath.value = ''; placeCadBlockAt(endPos.x, endPos.y); return; } if (drawMode.value === 'index') { currentLine.value = null; currentWall.value = null; currentPath.value = ''; openIndexModalAt(endPos.x, endPos.y, null); return; } if (!targetPin.value && drawMode.value === 'pin') { currentLine.value = null; currentWall.value = null; currentPath.value = ''; checkBranchNeed(() => { const pg = targetPage.value; if (!pg) return; const pw = pg.w || 1200, ph = pg.h || 900; pg.pins ||= []; pg.historyStack ||= []; pg.redoStack = []; const newPin = { id: 'pin_' + Date.now(), name: `位置 ${pg.pins.length + 1}`, x: parseFloat(((endPos.x / pw) * 100).toFixed(2)), y: parseFloat(((endPos.y / ph) * 100).toFixed(2)), photo: null, photoId: '', w: 1200, h: 900, space: pg.space || '', markers: [], lines: [], walls: [], paths: [], historyStack: [], redoStack: [], updatedAt: Date.now() }; pg.pins.push(newPin); pg.historyStack.push({ type: 'pin', pinId: newPin.id }); touchDirty(); openPinSubPage(newPin, pg.pins.length - 1, activePane.value); saveAll(); }); return; } if (drawMode.value === 'wall' && currentWall.value) { if (Math.hypot(currentWall.value.x2 - currentWall.value.x1, currentWall.value.y2 - currentWall.value.y1) >= 12) { const wSnap = { ...currentWall.value }; checkBranchNeed(() => { const c = targetCanvas.value; c.walls ||= []; c.historyStack ||= []; c.redoStack = []; const wallId = Date.now(); c.walls.push({ ...wSnap, id: wallId }); c.historyStack.push({ type: 'wall', wallId }); touchDirty(); saveAll(); }); } currentWall.value = null; } else if (['line', 'arrow-single', 'straight'].includes(drawMode.value) && currentLine.value) { const lSnap = { ...currentLine.value }; currentLine.value = null; if (drawMode.value === 'line' && Math.hypot(lSnap.x2 - lSnap.x1, lSnap.y2 - lSnap.y1) < 14) { createPointMarker(lSnap.x2, lSnap.y2, 'stamp'); return; } if (Math.hypot(lSnap.x2 - lSnap.x1, lSnap.y2 - lSnap.y1) < 10) return; checkBranchNeed(() => { const c = targetCanvas.value; c.lines ||= []; c.markers ||= []; c.historyStack ||= []; c.redoStack = []; const lineId = Date.now(), markerId = lineId + 1, lineType = drawMode.value === 'line' ? 'measure' : drawMode.value; c.lines.push({ ...lSnap, id: lineId, type: lineType, color: lineType === 'measure' ? null : drawColor.value }); if (lineType !== 'measure') { c.historyStack.push({ type: 'line_marker', lineId, markerId: null }); touchDirty(); saveAll(); return; } const newMarker = { id: markerId, lineId, x: Math.round((lSnap.x1 + lSnap.x2) / 2), y: Math.round((lSnap.y1 + lSnap.y2) / 2), w: 140, h: 56, type: 'general', textColor: defaultTextColor.value, data: makeBlankMarkerData() }; updateMarkerSize(newMarker); c.markers.push(newMarker); c.historyStack.push({ type: 'line_marker', lineId, markerId }); touchDirty(); activeMarker.value = newMarker; focusedInput.value = 'val'; showTopSheet.value = true; saveAll(); }); } else if (drawMode.value === 'freehand' && currentPath.value) { const pSnap = currentPath.value; currentPath.value = ''; checkBranchNeed(() => { const c = targetCanvas.value; c.paths ||= []; c.historyStack ||= []; c.redoStack = []; const pathId = Date.now(); c.paths.push({ id: pathId, d: pSnap, color: drawColor.value }); c.historyStack.push({ type: 'freehand', pathId }); touchDirty(); saveAll(); }); } };

            const ensureMarkerBranched = (cb) => { if (activeMarker.value) { checkBranchNeed(() => { activeMarker.value = (targetCanvas.value.markers || []).find(m => m.id === activeMarker.value.id) || activeMarker.value; if (cb) cb(); }); } else if (cb) cb(); };
            const onMarkerTextInput = () => ensureMarkerBranched(() => { updateMarkerSize(activeMarker.value); touchDirty(); });
            const setMarkerScale = (val) => { if (!activeMarker.value) return; const s = Math.max(0.3, Math.min(3.5, Math.round(Number(val) * 100) / 100)); ensureMarkerBranched(() => { const m = activeMarker.value; m.scale = s; if (m.type === 'image') { if (!m.baseW) { m.baseW = m.w; m.baseH = m.h; } m.w = Math.round(m.baseW * s); m.h = Math.round(m.baseH * s); } touchDirty(); saveAll(); }); };
            const resizeImageMarker = (factor) => { if (activeMarker.value) setMarkerScale((activeMarker.value.scale || 1) * factor); };
            const rotateMarker = (deg) => { if (activeMarker.value) ensureMarkerBranched(() => { activeMarker.value.rot = ((activeMarker.value.rot || 0) + deg + 360) % 360; touchDirty(); saveAll(); }); };
            const flipMarker = (axis) => { if (!activeMarker.value) return; ensureMarkerBranched(() => { if (axis === 'x') activeMarker.value.flipX = (activeMarker.value.flipX || 1) * -1; else activeMarker.value.flipY = (activeMarker.value.flipY || 1) * -1; touchDirty(); saveAll(); }); };
            const setCadMarkerColor = (hex) => { drawColor.value = hex; if (activeMarker.value?.type === 'cad') ensureMarkerBranched(() => { activeMarker.value.color = hex; touchDirty(); saveAll(); }); };

            const undoLastAction = () => { checkBranchNeed(() => { const c = targetCanvas.value; if (!c?.historyStack?.length) return; c.redoStack ||= []; const act = c.historyStack.pop(), u = { type: act.type }; if (act.type === 'line_marker') { const li = c.lines.findIndex(l => l.id === act.lineId); if (li !== -1) u.line = c.lines.splice(li, 1)[0]; if (act.markerId) { const mi = c.markers.findIndex(m => m.id === act.markerId); if (mi !== -1) u.marker = c.markers.splice(mi, 1)[0]; } } else if (act.type === 'marker') { const mi = c.markers.findIndex(m => m.id === act.markerId); if (mi !== -1) u.marker = c.markers.splice(mi, 1)[0]; } else if (act.type === 'wall') { const wi = (c.walls || []).findIndex(w => w.id === act.wallId); if (wi !== -1) u.wall = c.walls.splice(wi, 1)[0]; } else if (act.type === 'freehand') { const pi = c.paths.findIndex(p => p.id === act.pathId); if (pi !== -1) u.path = c.paths.splice(pi, 1)[0]; } else if (act.type === 'erase') { u.targetType = act.targetType; u.item = act.item; u.linkedMarker = act.linkedMarker || null; u.linkedLine = act.linkedLine || null; if (act.targetType === 'wall') { c.walls ||= []; c.walls.push(act.item); } else if (act.targetType === 'path') { c.paths ||= []; c.paths.push(act.item); } else if (act.targetType === 'line') { c.lines ||= []; c.lines.push(act.item); if (act.linkedMarker) { c.markers ||= []; c.markers.push(act.linkedMarker); } } else if (act.targetType === 'marker') { c.markers ||= []; c.markers.push(act.item); if (act.linkedLine) { c.lines ||= []; c.lines.push(act.linkedLine); } } } else if (act.type === 'pin') { const pni = (c.pins || []).findIndex(p => String(p.id) === String(act.pinId)); if (pni !== -1) { u.pin = c.pins.splice(pni, 1)[0]; const pid = String(u.pin.id); c.deletedPinIds ||= []; if (!c.deletedPinIds.includes(pid)) c.deletedPinIds.push(pid); project.deletedPinIds ||= []; if (!project.deletedPinIds.includes(pid)) project.deletedPinIds.push(pid); } } else if (act.type === 'delete_pin' && act.pin) { c.pins ||= []; const insertIdx = Math.min(act.index ?? c.pins.length, c.pins.length); c.pins.splice(insertIdx, 0, act.pin); const pid = String(act.pin.id); if (c.deletedPinIds) c.deletedPinIds = c.deletedPinIds.filter(x => x !== pid); if (project.deletedPinIds) project.deletedPinIds = project.deletedPinIds.filter(x => x !== pid); u.pin = act.pin; u.index = insertIdx; showToast('↩️ 已復原釘選'); } c.redoStack.push(u); touchDirty(); saveAll(); }); };
            const redoAction = () => { checkBranchNeed(() => { const c = targetCanvas.value; if (!c?.redoStack?.length) return; const u = c.redoStack.pop(), act = { type: u.type }; if (u.type === 'erase') { act.targetType = u.targetType; act.item = u.item; act.linkedMarker = u.linkedMarker || null; act.linkedLine = u.linkedLine || null; if (u.targetType === 'wall') c.walls = (c.walls || []).filter(x => x.id !== u.item.id); else if (u.targetType === 'path') c.paths = (c.paths || []).filter(x => x.id !== u.item.id); else if (u.targetType === 'line') { c.lines = (c.lines || []).filter(x => x.id !== u.item.id); if (u.linkedMarker) c.markers = (c.markers || []).filter(x => x.id !== u.linkedMarker.id); } else if (u.targetType === 'marker') { c.markers = (c.markers || []).filter(x => x.id !== u.item.id); if (u.linkedLine) c.lines = (c.lines || []).filter(x => x.id !== u.linkedLine.id); } } else { if (u.line) { c.lines.push(u.line); act.lineId = u.line.id; } if (u.marker) { c.markers.push(u.marker); act.markerId = u.marker.id; } if (u.wall) { c.walls ||= []; c.walls.push(u.wall); act.wallId = u.wall.id; } if (u.path) { c.paths.push(u.path); act.pathId = u.path.id; } if (u.type === 'pin' && u.pin) { c.pins ||= []; c.pins.push(u.pin); act.pinId = u.pin.id; const pid = String(u.pin.id); if (c.deletedPinIds) c.deletedPinIds = c.deletedPinIds.filter(x => x !== pid); if (project.deletedPinIds) project.deletedPinIds = project.deletedPinIds.filter(x => x !== pid); } else if (u.type === 'delete_pin' && u.pin) { const pid = String(u.pin.id); c.pins = (c.pins || []).filter(p => String(p.id) !== pid); c.deletedPinIds ||= []; if (!c.deletedPinIds.includes(pid)) c.deletedPinIds.push(pid); project.deletedPinIds ||= []; if (!project.deletedPinIds.includes(pid)) project.deletedPinIds.push(pid); act.pin = u.pin; act.index = u.index; } } c.historyStack.push(act); touchDirty(); saveAll(); }); };

            const deleteMarkerTop = () => ensureMarkerBranched(() => { const c = targetCanvas.value, m = activeMarker.value; if (!m || !c) return; if (m.lineId) c.lines = (c.lines || []).filter(l => l.id !== m.lineId); c.markers = (c.markers || []).filter(x => x.id !== m.id); if (c.historyStack) c.historyStack = c.historyStack.filter(h => h.markerId !== m.id); c.redoStack = []; touchDirty(); showTopSheet.value = false; showTopTextBar.value = false; activeMarker.value = null; saveAll(); });
            const switchMarkerType = (t, fKey) => ensureMarkerBranched(() => { activeMarker.value.type = t; if (t === 'stamp') { stampFilter.value = 'hot'; showQuickAddStamp.value = false; } else if (!activeMarker.value.textColor) activeMarker.value.textColor = defaultTextColor.value; focusedInput.value = fKey; updateMarkerSize(activeMarker.value); touchDirty(); });
            const closeTopTextBar = () => { if (['stamp', 'text'].includes(activeMarker.value?.type) && !String(activeMarker.value.data.val || '').trim()) { deleteMarkerTop(); return; } showTopTextBar.value = false; saveAll(); };
            const closeTopSheet = () => { if (activeMarker.value?.type === 'stamp' && !String(activeMarker.value.data.val || '').trim()) { deleteMarkerTop(); return; } showTopSheet.value = false; saveAll(); };

            const handleKeypad = (key) => { if (!activeMarker.value || !focusedInput.value) return; ensureMarkerBranched(() => { if (focusedInput.value === 'name' || focusedInput.value === 'stamp') focusedInput.value = 'val'; const cur = String(activeMarker.value.data[focusedInput.value] || ''); if (key === 'DEL') { activeMarker.value.data[focusedInput.value] = cur.slice(0, -1); touchDirty(); } else if (key === 'ENTER') { const def = TAG_DEFS[activeMarker.value.type]; if (def) { const idx = def.fields.findIndex(x => x.key === focusedInput.value); idx >= 0 && idx < def.fields.length - 1 ? (focusedInput.value = def.fields[idx + 1].key) : closeTopSheet(); } else closeTopSheet(); } else if (cur.length < 6) { activeMarker.value.data[focusedInput.value] = cur + key; touchDirty(); } updateMarkerSize(activeMarker.value); }); };
            const applyTag = (name) => { if (activeMarker.value) ensureMarkerBranched(() => { activeMarker.value.data.name = name; focusedInput.value = 'val'; updateMarkerSize(activeMarker.value); touchDirty(); }); };
            const applyStamp = (stampOrText) => { if (!activeMarker.value) return; const isObj = typeof stampOrText === 'object' && stampOrText !== null, txt = isObj ? stampOrText.text : String(stampOrText || ''), col = isObj ? (stampOrText.color || '#ffffff') : (stampItems.value.find(x => x.text === txt)?.color || '#ffffff'); if (isObj) { stampOrText.count = (stampOrText.count || 0) + 1; saveStampStore(); } else { const matched = stampItems.value.find(x => x.text === txt); if (matched) { matched.count = (matched.count || 0) + 1; saveStampStore(); } } ensureMarkerBranched(() => { if (activeMarker.value.lineId) { targetCanvas.value.lines = (targetCanvas.value.lines || []).filter(l => l.id !== activeMarker.value.lineId); activeMarker.value.lineId = null; } activeMarker.value.type = 'stamp'; activeMarker.value.textColor = col; activeMarker.value.data.val = txt; updateMarkerSize(activeMarker.value); touchDirty(); closeTopSheet(); }); };

            const updateMarkerSize = (m) => { if (m.type === 'image' || m.type === 'cad') return; const lines = getMarkerLines(m), maxLen = Math.max(0, ...lines.map(l => l.length)); m.w = Math.max(110, (maxLen * 30 + 34) * globalFontScale.value); m.h = Math.max(50, (lines.length * 36 + 16) * globalFontScale.value); };
            const getStampColor = (m) => { if (m.textColor) return m.textColor; if (m.type === 'space_tag') return '#a855f7'; if (m.type === 'page_link') return '#38bdf8'; if (m.type === 'stamp') { const found = stampItems.value.find(x => x.text === m.data?.val); if (found?.color) return found.color; } return '#ffffff'; };
            const getTagFields = (t) => TAG_DEFS[t]?.fields || [];
            const getMarkerLines = (m) => { const def = TAG_DEFS[m.type]; if (def) return [def.title, ...def.fields.filter(f => m.data[f.key]).map(f => `${f.label}:${m.data[f.key]}`)]; if (['stamp', 'text', 'space_tag', 'page_link'].includes(m.type)) return [m.data.val || '']; return [`${m.data.name ? m.data.name + ': ' : ''}${m.data.val || ''}`]; };

            const compressImage = (file) => new Promise((res) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = (e) => { const img = new Image(); img.src = e.target.result; img.onload = () => { const c = document.createElement('canvas'), MAX = 1280; let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height; if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } } c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); res({ b64: c.toDataURL('image/jpeg', 0.72), w, h }); }; }; });
            const handleImageUpload = async (e, asNewPage = false) => { const rawFiles = Array.from(e.target.files || []); if (!rawFiles.length) return; showAddPageModal.value = false; targetPaneResetZoom(); const files = targetPin.value ? [rawFiles[0]] : rawFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })); const isBatch = files.length > 1; if (isBatch) { isProcessing.value = true; processingText.value = `準備匯入 ${files.length} 張圖紙...`; } let firstAddedIdx = -1; try { for (let i = 0; i < files.length; i++) { if (isBatch) processingText.value = `正在匯入第 ${i + 1} / ${files.length} 張圖紙...`; const res = await compressImage(files[i]); const photoId = `img_${Date.now()}_${i}_${Math.floor(Math.random() * 999)}`; photoPool.value.push({ id: photoId, photo: res.b64, w: res.w, h: res.h, author: authorName.value || '', updatedAt: Date.now() }); if (i === 0 && !asNewPage && targetCanvas.value && !targetCanvas.value.photo) { checkBranchNeed(() => { Object.assign(targetCanvas.value, { photo: res.b64, photoId, w: res.w, h: res.h, isSketch: false }); touchDirty(); firstAddedIdx = (splitMode.value && activePane.value === 'B') ? pageIndexB.value : activePageIndex.value; }); if (showBranchPrompt.value) await new Promise(r => { const timer = setInterval(() => { if (!showBranchPrompt.value) { clearInterval(timer); r(); } }, 200); }); } else { const newPg = makeEmptyPage({ photo: res.b64, photoId, w: res.w, h: res.h }); pages.value.push(newPg); dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true; if (firstAddedIdx === -1) firstAddedIdx = pages.value.length - 1; } } if (firstAddedIdx !== -1 && !targetPin.value) { if (splitMode.value && activePane.value === 'B') pageIndexB.value = firstAddedIdx; else activePageIndex.value = firstAddedIdx; } drawMode.value = 'browse'; await saveAll(); if (isBatch) showToast(`✅ 已匯入 ${files.length} 張圖紙`); } finally { isProcessing.value = false; e.target.value = ''; } };
            const processPastedBlob = async (blob, forceNewPage) => { showAddPageModal.value = false; isProcessing.value = true; processingText.value = '正在處理貼上圖片...'; try { const res = await compressImage(blob), photoId = 'img_' + Date.now() + '_' + Math.floor(Math.random() * 999); photoPool.value.push({ id: photoId, photo: res.b64, w: res.w, h: res.h, author: authorName.value || '', updatedAt: Date.now() }); if (forceNewPage || !targetCanvas.value?.photo) { targetPaneResetZoom(); if (!forceNewPage && !targetCanvas.value?.photo) checkBranchNeed(() => { Object.assign(targetCanvas.value, { photo: res.b64, photoId, w: res.w, h: res.h, isSketch: false }); touchDirty(); }); else { const newPg = makeEmptyPage({ photo: res.b64, photoId, w: res.w, h: res.h }); pages.value.push(newPg); activePageIndex.value = pages.value.length - 1; dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true; } showToast('✅ 貼上為底圖'); } else { checkBranchNeed(() => { const c = targetCanvas.value; c.markers ||= []; c.historyStack ||= []; c.redoStack = []; let tw = res.w, th = res.h; const maxS = Math.min(targetCanvasW.value, targetCanvasH.value) * 0.7; if (tw > maxS || th > maxS) { if (tw > th) { th = Math.round(th * maxS / tw); tw = maxS; } else { tw = Math.round(tw * maxS / th); th = maxS; } } const isB = splitMode.value && activePane.value === 'B', zVal = isB ? zoomScaleB.value : zoomScale.value, vx = isB ? vbXB.value : vbX.value, vy = isB ? vbYB.value : vbY.value; const vw = targetCanvasW.value / zVal, vh = targetCanvasH.value / zVal, markerId = Date.now(); const newMarker = { id: markerId, x: Math.round(vx + vw / 2), y: Math.round(vy + vh / 2), w: tw, h: th, baseW: tw, baseH: th, scale: 1, rot: 0, type: 'image', data: { b64: res.b64 } }; c.markers.push(newMarker); c.historyStack.push({ type: 'marker', markerId }); activeMarker.value = newMarker; showTopTextBar.value = true; touchDirty(); showToast('✅ 貼圖成功'); }); } drawMode.value = 'browse'; await saveAll(); } catch (_) { showToast('貼上失敗，請確定複製的是圖片'); } finally { isProcessing.value = false; } };
            const pasteFromClipboard = async (forceNewPage = false) => { try { const items = await navigator.clipboard.read(); for (const item of items) { if (item.types.some(t => t.startsWith('image/'))) { await processPastedBlob(await item.getType(item.types.find(t => t.startsWith('image/'))), forceNewPage); return; } } showToast('剪貼簿內無圖片'); } catch (_) { showToast('請使用 Ctrl+V (或 Cmd+V) 貼上'); } };
            const handleGlobalPaste = async (e) => { if (currentView.value !== 'proj' || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return; const items = e.clipboardData?.items; if (!items) return; for (let i = 0; i < items.length; i++) { if (items[i].type.indexOf('image') !== -1) { e.preventDefault(); await processPastedBlob(items[i].getAsFile(), false); return; } } };
            const handleGlobalKeydown = (e) => { if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) isSpaceDown = true; if (fullScreenIndex.value === -1) return; if (e.key === 'ArrowLeft') { e.preventDefault(); prevFullScreen(); } else if (e.key === 'ArrowRight') { e.preventDefault(); nextFullScreen(); } else if (e.key === 'Escape') { e.preventDefault(); fullScreenIndex.value = -1; } };
            const handleGlobalKeyup = (e) => { if (e.code === 'Space') isSpaceDown = false; };

            const checkAuthorName = async () => { if (currentUser.value?.name) { authorName.value = currentUser.value.name; await localforage.setItem('measure_author_name', authorName.value); return; } let name = await localforage.getItem('measure_author_name'); if (!name) { name = prompt('👤 請輸入您的稱呼或設備名稱 (例: 明哥、強哥iPad)：')?.trim(); if (name) await localforage.setItem('measure_author_name', name); } authorName.value = name || ''; };
            const changeAuthorName = async () => { const name = prompt('👤 更新顯示稱呼：', authorName.value)?.trim(); if (name) { authorName.value = name; await localforage.setItem('measure_author_name', name); } };

            const fallbackCopyTextToClipboard = (text) => { const textArea = document.createElement("textarea"); textArea.value = text; textArea.style.position = "fixed"; textArea.style.top = "0"; textArea.style.left = "0"; document.body.appendChild(textArea); textArea.focus(); textArea.select(); try { document.execCommand('copy'); showToast('🔗 已複製 WhatsApp 專屬連結'); } catch (_) { window.prompt("請手手動複製以下連結：", text); } document.body.removeChild(textArea); };
            const copyShareLink = () => { const code = String(project.code || '').trim(); if (!code) return; let baseUrl = window.location.href.split('index.html')[0]; if (!baseUrl.endsWith('/')) baseUrl += '/'; const link = baseUrl + 'view.html?code=' + code; const msg = `📋 工程度尺圖 (#${code})\n📍 地址：${project.name || '未標題'}\n👉 點擊檢視及標註意見：\n${link}`; if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(msg).then(() => showToast('🔗 已複製 WhatsApp 專屬連結')).catch(() => fallbackCopyTextToClipboard(msg)); else fallbackCopyTextToClipboard(msg); };

            onMounted(async () => {
                const bs = document.getElementById('boot-screen'); if (bs) bs.remove(); document.getElementById('app').style.display = 'flex';
                const cachedSession = await localforage.getItem('auth_session_v1');
                if (cachedSession?.user) { currentUser.value = cachedSession.user; authorName.value = cachedSession.user.name || (await localforage.getItem('measure_author_name')) || ''; authReady.value = true; } else if (cachedSession?.guest) { isGuestMode.value = true; authorName.value = (await localforage.getItem('measure_author_name')) || ''; authReady.value = true; }
                await loadStampStore(); await loadProjectList();
                if (auth) {
                    auth.getRedirectResult().catch(() => {});
                    auth.onAuthStateChanged(async (fbUser) => {
                        if (fbUser) {
                            const u = { uid: fbUser.uid, name: fbUser.displayName || fbUser.email?.split('@')[0] || '工程師', email: fbUser.email || '', photo: fbUser.photoURL || '' };
                            currentUser.value = u; isGuestMode.value = false; authReady.value = true; await localforage.setItem('auth_session_v1', { user: u });
                            const savedName = await localforage.getItem('measure_author_name'); authorName.value = savedName || u.name;
                            if (!savedName) await localforage.setItem('measure_author_name', authorName.value);
                            if (navigator.onLine) syncStampLibraryCloud(true);
                        } else if (!cachedSession?.user && !cachedSession?.guest) { authReady.value = true; }
                    });
                } else if (!authReady.value) { isGuestMode.value = true; authReady.value = true; await checkAuthorName(); }
                window.addEventListener('online', () => { cloudSyncState.value = 'ready'; showToast('🌐 網絡已恢復'); processPendingUploadQueue(false); if (currentUser.value?.uid) syncStampLibraryCloud(true); }); window.addEventListener('offline', () => { cloudSyncState.value = 'offline'; }); window.addEventListener('paste', handleGlobalPaste); window.addEventListener('keydown', handleGlobalKeydown); window.addEventListener('keyup', handleGlobalKeyup);
                if (navigator.onLine) setTimeout(() => processPendingUploadQueue(false), 1500); setInterval(() => { if (navigator.onLine) processPendingUploadQueue(true); }, 15000);
            });
            onUnmounted(() => { window.removeEventListener('paste', handleGlobalPaste); window.removeEventListener('keydown', handleGlobalKeydown); window.removeEventListener('keyup', handleGlobalKeyup); });

            const copyFullScreenImage = () => copyAnnotatedImage(fullScreenItem.value, { includeStamp: showWatermark.value, projectName: project.name, projectDate: project.date, projectAuthor: project.lastModifiedBy, itemDate: fullScreenDate.value, itemAuthor: fullScreenAuthor.value, fontScale: globalFontScale.value, getMarkerLines, getStampColor, onToast: showToast });
            const downloadFullScreenImage = () => downloadAnnotatedImage(fullScreenItem.value, { includeStamp: showWatermark.value, projectName: project.name, projectCode: project.code, projectDate: project.date, projectAuthor: project.lastModifiedBy, itemDate: fullScreenDate.value, itemAuthor: fullScreenAuthor.value, label: currentFullScreen.value?.label || '圖紙', fontScale: globalFontScale.value, getMarkerLines, getStampColor, onToast: showToast });
            const exportPdfReport = async (perPage = 1) => { showPdfModal.value = false; isProcessing.value = true; processingText.value = `正在產生 PDF (每頁 ${perPage} 張)...`; setTimeout(async () => { try { await generatePdfReport(pages.value, { code: project.code, name: project.name, date: project.date, lastModifiedBy: project.lastModifiedBy }, { perPage, fontScale: globalFontScale.value, getMarkerLines, getStampColor }); } catch (_) { alert('生成 PDF 失敗'); } finally { isProcessing.value = false; } }, 50); };

            return {
                authReady, currentUser, isGuestMode, isLoggingIn, loginWithGoogle, enterAsGuest, logoutUser,
                offlineReady, currentView, TEMPLATE_ROWS, TAG_DEFS, DIM_QUICK_ROWS, KEYPAD_KEYS, STAMP_PALETTE,
                stampCategories, stampItems, stampFilter, hotStamps, filteredCanvasStampGroups, showStampManagerModal, showNewCatForm, managerCatFilter, managerSearch, managerFilteredItems,
                newCatName, newCatIcon, newCatColor, newStampText, newStampCatId, newStampColor, showQuickAddStamp,
                getCategoryById, openStampManager, onSelectNewStampCat, addStampCategory, deleteStampCategory, addStampItem, toggleStampPin, setStampItemColor, cycleStampItemColor, editStampItemText, deleteStampItem, resetStampCounts, restoreDefaultStamps, syncStampLibraryCloud,
                CAD_CATEGORIES, cadCategory, selectedCadType, filteredCadList, getCadDef, getCadTransform, setMarkerScale, rotateMarker, flipMarker, setCadMarkerColor,
                defaultTextColor, setMarkerTextColor, getArrowMarkerId, getFsArrowMarkerId, getWallSegments,
                allProjectOptions, otherProjectOptions, showMergeProjectsModal, mergeProjCodeA, mergeProjCodeB, mergeProjNewName, openMergeProjectsModal, updateMergeDefaultName, executeMergeProjects,
                selectMode, selectedPageIds, toggleSelectMode, togglePageSelection, selectAllPages, showTransferModal, transferTargetCode, transferMode, transferNewProjName, openTransferModal, executeTransferPages,
                splitMode, activePane, focusPane, toggleSplitMode,
                pageIndexB, pinB, pinIndexB, pageB, canvasB, canvasWB, canvasHB, zoomScaleB, invZoomB, svgViewBoxB, resetZoomB,
                showQuickPageNavB, jumpToPageB, canvasBFeedbacks, svgCanvasB,
                feedbackList, showFeedbackOverlay, showFeedbackModal, currentCanvasFeedbacks, pageFeedbackCount, jumpToFeedback, resolveFeedback,
                capsuleOffset, capsuleCollapsed, startCapsuleDrag,
                masterPages, showQuickPageNav, jumpToPage, jumpToPageById, goToMasterPlan,
                showIndexModal, indexCustomCode, editingIndexMarker, placeSpaceTag, addCustomSpaceTag, placePageLink, deleteEditingIndexMarker,
                fullScreenIndex, fullScreenList, fullScreenItem, fullScreenTitle, fullScreenWatermarkBox, showWatermark, getLineStroke,
                zoomScale, invZoom, svgViewBox, stepZoom, resetZoom, onStageWheel, draggingPageIdx, dragOverPageIdx, startPageDrag,
                openFullScreenPreview, prevFullScreen, nextFullScreen, editFromFullScreen, copyFullScreenImage, downloadFullScreenImage, enterEditMode, switchToPreview, duplicateCurrentPage,
                showMergeModal, mergeableGroups, mergePageGroup, showPdfModal, showPhotoPoolModal, photoPoolList, openPhotoPool, selectFromPhotoPool, deleteFromPhotoPool,
                projectList, project, pages, activePageIndex, activePage, activePin, activePinIndex, activeCanvas, canvasW, canvasH,
                showJoinModal, inputJoinCode, showAddPageModal, showSpaceModal, spaceList, authorName, changeAuthorName, hasUnsavedCloudChanges, markProjectChanged,
                showManageModal, manageProj, openManageMenu, renameProject, duplicateProject, showCloudBrowser, cloudProjectList, openCloudBrowser, downloadFromCloudBrowser, cleanCloudGarbage,
                showBackupListModal, backupList, openBackupList, restoreBackup, drawColor, wallStyle, cloudStatusText, cloudStatusClass, showCloudDetail, toastMsg, copyShareLink,
                drawMode, drawingPane, showTopSheet, showTopTextBar, activeMarker, isProcessing, processingText, focusedInput, topTextInputRef,
                showBranchPrompt, branchOwner, branchInputValue, confirmBranch, cancelBranch, svgCanvas, currentLine, currentWall, currentPath, hasUndoItems, hasRedoItems,
                createNewProject, loadProject, deleteProject, backToProjects, copyCode, joinProjectByCode, saveAll, downloadNow, uploadNow, prevPage, nextPage, deleteCurrentPage, openPinSubPage, exitPinSubPage, onPinTap, deleteActivePin,
                setPageSpace, addCustomSpace, initSketchOnCurrent, addNewSketchPage, toggleSketchGrid, handleImageUpload, pasteFromClipboard,
                onEraseTap, resizeImageMarker, onMarkerPointerStart, onStageTouchStart, onStageTouchMove, onStageTouchEnd, onStageMouseDown, onStageMouseMove, onStageMouseUp, undoLastAction, redoAction,
                deleteMarkerTop, switchMarkerType, closeTopSheet, closeTopTextBar, onMarkerTextInput, handleKeypad, applyTag, applyStamp, getStampColor, getMarkerLines, getTagFields, exportPdfReport,
                globalFontScale, toggleFontScale
            };
        }
    }).mount('#app');
}
// === END OF app.js ===
