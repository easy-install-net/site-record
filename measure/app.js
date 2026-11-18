if (!window.Vue || !window.MEASURE_DATA || !window.MEASURE_CAD) {
    const msg = !window.Vue ? 'Vue 引擎載入失敗，請檢查網絡連線' : (!window.MEASURE_DATA ? '資料檔 data.js 載入失敗' : '圖塊檔 cad.js 載入失敗');
    if (window.__showBootError) window.__showBootError(msg);
    else alert(msg);
} else {
    const { createApp, ref, reactive, computed, onMounted, onUnmounted, nextTick } = Vue;
    const { TAG_DEFS, TEMPLATE_ROWS, DIM_QUICK_ROWS, KEYPAD_KEYS, DEFAULT_SPACES, STAMP_PALETTE, DEFAULT_STAMP_SEED } = window.MEASURE_DATA;
    const { CAD_CATEGORIES, CAD_DEFS, CAD_LIST, drawOnCanvas: drawCadOnCanvas } = window.MEASURE_CAD;

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
            if (firebase.auth) {
                auth = firebase.auth();
                auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
            }
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

    const measureStrWidth = (str, charPx) => {
        let total = 0;
        for (const ch of String(str || '')) total += /[^\x00-\xff]/.test(ch) ? charPx : charPx * 0.56;
        return total;
    };

    const drawRoundRect = (ctx, x, y, w, h, r) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    };

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

    const CAD_SHAPE_PRESETS = {
        box: [{ t: 'rect', x: -26, y: -16, w: 52, h: 32, sw: 3, fillBg: true }, { t: 'line', x1: -26, y1: -16, x2: 26, y2: 16, sw: 2 }],
        circle: [{ t: 'circle', cx: 0, cy: 0, r: 22, sw: 3, fillBg: true }, { t: 'circle', cx: 0, cy: 0, r: 5, sw: 2.5 }],
        cross: [{ t: 'rect', x: -20, y: -20, w: 40, h: 40, sw: 2.5, fillBg: true }, { t: 'line', x1: -20, y1: -20, x2: 20, y2: 20, sw: 2.5 }, { t: 'line', x1: 20, y1: -20, x2: -20, y2: 20, sw: 2.5 }],
        switch: [{ t: 'circle', cx: -10, cy: 10, r: 7, sw: 3, fillBg: true }, { t: 'line', x1: -5, y1: 5, x2: 16, y2: -16, sw: 3 }, { t: 'line', x1: 10, y1: -16, x2: 18, y2: -8, sw: 2.5 }],
        socket: [{ t: 'circle', cx: 0, cy: 4, r: 16, sw: 3, fillBg: true }, { t: 'line', x1: -18, y1: 20, x2: 18, y2: 20, sw: 3 }, { t: 'line', x1: -6, y1: -4, x2: -6, y2: 8, sw: 2.5 }, { t: 'line', x1: 6, y1: -4, x2: 6, y2: 8, sw: 2.5 }],
        light: [{ t: 'circle', cx: 0, cy: 0, r: 16, sw: 3, fillBg: true }, { t: 'line', x1: -24, y1: 0, x2: -18, y2: 0, sw: 2.5 }, { t: 'line', x1: 18, y1: 0, x2: 24, y2: 0, sw: 2.5 }, { t: 'line', x1: 0, y1: -24, x2: 0, y2: -18, sw: 2.5 }, { t: 'line', x1: 0, y1: 18, x2: 0, y2: 24, sw: 2.5 }],
        ac: [{ t: 'rect', x: -30, y: -14, w: 60, h: 28, rx: 3, sw: 3, fillBg: true }, { t: 'line', x1: -24, y1: 6, x2: 24, y2: 6, sw: 2.5 }, { t: 'line', x1: -24, y1: 10, x2: 24, y2: 10, sw: 2 }],
        drain: [{ t: 'circle', cx: 0, cy: 0, r: 20, sw: 3, fillBg: true }, { t: 'circle', cx: 0, cy: 0, r: 9, sw: 2 }, { t: 'line', x1: -20, y1: 0, x2: 20, y2: 0, sw: 2 }, { t: 'line', x1: 0, y1: -20, x2: 0, y2: 20, sw: 2 }]
    };

    createApp({
        setup() {
            const currentUser = ref(null);
            const authorName = ref(''), hasUnsavedCloudChanges = ref(false), dirtyPageIds = new Set();
            let unsubPages = null, unsubFeedback = null, isPushing = false, isAutoQueueing = false;

            const currentView = ref('dir'), showWatermark = ref(true), globalFontScale = ref(0.6);
            const defaultTextColor = ref('#ffffff');

            // =========================================================================
            // 🔒 Google 帳號永久登入 ＆ 帳號工程/圖庫自動同步
            // =========================================================================
            const loginWithGoogle = async () => {
                if (!auth) return alert('登入模組未就緒，請重新整理網頁');
                if (!navigator.onLine) return alert('請先連接網絡再綁定 Google 帳號');
                isProcessing.value = true; processingText.value = '正在連接 Google 帳號...';
                try {
                    const provider = new firebase.auth.GoogleAuthProvider();
                    const res = await auth.signInWithPopup(provider);
                    if (res?.user) {
                        currentUser.value = res.user;
                        if (!authorName.value && res.user.displayName) {
                            authorName.value = res.user.displayName;
                            await localforage.setItem('measure_author_name', res.user.displayName);
                        }
                        await syncUserOwnedProjects();
                        await syncUserLibrariesCloud(true);
                        showToast(`✅ 已綁定 ${res.user.displayName || res.user.email}`);
                    }
                } catch (e) {
                    if (e?.code !== 'auth/popup-closed-by-user') {
                        alert('Google 登入失敗：' + (e.message || '請檢查瀏覽器彈窗設定'));
                    }
                } finally {
                    isProcessing.value = false;
                }
            };

            const logoutGoogle = async () => {
                if (!confirm('確定要登出 Google 帳號嗎？（本機已下載的工程仍會保留）')) return;
                if (auth) await auth.signOut().catch(() => {});
                currentUser.value = null;
                showToast('已登出 Google 帳號');
            };
const syncUserOwnedProjects = async () => {
                if (!db || !navigator.onLine || !currentUser.value) return;
                const uid = currentUser.value.uid;
                try {
                    const hiddenList = (await localforage.getItem('local_hidden_projects')) || [];
                    const hiddenSet = new Set(hiddenList.map(String));
                    const snaps = await withTimeout(db.collection('site_projects').where('ownerId', '==', uid).get(), 12000);
                    for (const doc of snaps.docs) {
                        const code = String(doc.id);
                        if (hiddenSet.has(code)) continue;
                        const pd = doc.data() || {};
                        const localProj = await localforage.getItem('proj_' + code);
                        if (!localProj || ((pd.updatedAt || 0) > (localProj.lastSyncAt || 0) && !localProj.pendingUpload)) {
                            const fullData = await fetchCompleteProjectData(code);
                            if (fullData) {
                                fullData.ownerId = uid;
                                fullData.pendingUpload = false;
                                await localforage.setItem('proj_' + code, fullData);
                            }
                        }
                    }
                    await loadProjectList();
                } catch (_) {}
            };

            

            // =========================================================================
            // 🏷️ 目錄印章管理引擎 (7 大分類・74 個專業預設印章・加星置頂・改色・雲端同步)
            // =========================================================================
            const stampCategories = ref([]);
            const stampItems = ref([]);
            const stampUpdatedAt = ref(0);
            const stampFilter = ref('all');
            const showStampManagerModal = ref(false);
            const managerCatFilter = ref('all');
            const newCatName = ref(''), newStampText = ref(''), newStampCatId = ref(''), newStampColor = ref('#ffffff');

            const STAMP_GROUPS = computed(() => stampCategories.value.map(c => {
                const items = stampItems.value.filter(it => it.catId === c.id).map(it => it.text);
                const rows = [];
                for (let i = 0; i < items.length; i += 6) rows.push(items.slice(i, i + 6));
                return {
                    id: c.id, icon: c.icon || '🏷️', name: c.name,
                    badgeClass: 'bg-zinc-100 text-zinc-700 border-zinc-300',
                    rows: rows.length ? rows : [[]]
                };
            }));
            const filteredStampGroups = computed(() => STAMP_GROUPS.value.filter(g => stampFilter.value === 'all' || stampFilter.value === g.id));
            const pinnedStampList = computed(() => stampItems.value.filter(x => x.pinned));
            const managerFilteredItems = computed(() => {
                if (managerCatFilter.value === 'pinned') return stampItems.value.filter(x => x.pinned);
                if (managerCatFilter.value === 'all') return stampItems.value;
                return stampItems.value.filter(x => x.catId === managerCatFilter.value);
            });
            const getCategoryById = (catId) => stampCategories.value.find(c => c.id === catId) || { id: catId, icon: '🏷️', name: '其他', defaultColor: '#ffffff' };

            const saveStampStore = async () => {
                stampUpdatedAt.value = Date.now();
                await localforage.setItem('dynamic_stamp_store_v11', {
                    seedVersion: 'v11.1',
                    categories: JSON.parse(JSON.stringify(stampCategories.value || [])),
                    items: JSON.parse(JSON.stringify(stampItems.value || [])),
                    updatedAt: stampUpdatedAt.value
                });
                if (currentUser.value?.uid && db && navigator.onLine) {
                    syncUserLibrariesCloud(true).catch(() => {});
                }
            };

            const buildSeedStampData = () => {
                const cats = [], items = [];
                (DEFAULT_STAMP_SEED || []).forEach((g, gIdx) => {
                    cats.push({ id: g.id, icon: g.icon || '🏷️', name: g.name, defaultColor: g.defaultColor || '#ffffff' });
                    (g.items || []).forEach((txt, iIdx) => {
                        items.push({ id: `st_${g.id}_${iIdx}_${gIdx}`, catId: g.id, text: txt, color: g.defaultColor || '#ffffff', count: 0, pinned: false });
                    });
                });
                return { cats, items };
            };

            const loadStampStore = async () => {
                const saved = await localforage.getItem('dynamic_stamp_store_v11');
                if (saved && saved.seedVersion === 'v11.1' && Array.isArray(saved.categories) && saved.categories.length) {
                    stampCategories.value = saved.categories;
                    stampItems.value = saved.items || [];
                    stampUpdatedAt.value = saved.updatedAt || Date.now();
                } else {
                    const { cats, items } = buildSeedStampData();
                    // 保留舊版中用戶自建的印章
                    const oldSaved = await localforage.getItem('dynamic_stamp_store_v1');
                    if (oldSaved?.items?.length) {
                        const customOld = oldSaved.items.filter(x => String(x.id).startsWith('st_custom_') || String(x.id).startsWith('st_legacy_') || x.pinned);
                        if (customOld.length) {
                            cats.unshift({ id: 'cat_custom', icon: '⭐', name: '自訂', defaultColor: '#ffffff' });
                            customOld.forEach((it, idx) => {
                                if (!items.some(x => x.text === it.text)) {
                                    items.unshift({ id: `st_migrated_${idx}`, catId: 'cat_custom', text: it.text, color: it.color || '#ffffff', count: it.count || 0, pinned: true });
                                }
                            });
                        }
                    }
                    stampCategories.value = cats;
                    stampItems.value = items;
                    await saveStampStore();
                }
                if (!newStampCatId.value && stampCategories.value.length) newStampCatId.value = stampCategories.value[0].id;
            };

            const openStampManager = () => {
                managerCatFilter.value = 'all';
                if (!newStampCatId.value && stampCategories.value.length) {
                    newStampCatId.value = stampCategories.value[0].id;
                    newStampColor.value = stampCategories.value[0].defaultColor || '#ffffff';
                }
                showStampManagerModal.value = true;
            };
            const onSelectNewStampCat = () => {
                const cat = getCategoryById(newStampCatId.value);
                if (cat?.defaultColor) newStampColor.value = cat.defaultColor;
            };
            const addStampCategory = async () => {
                const name = String(newCatName.value || '').trim();
                if (!name) return showToast('請輸入新分類名稱');
                if (stampCategories.value.some(c => c.name === name)) return showToast('此分類已存在');
                const id = 'cat_' + Date.now();
                stampCategories.value.unshift({ id, icon: '🏷️', name, defaultColor: '#ffffff' });
                newCatName.value = '';
                newStampCatId.value = id;
                await saveStampStore();
                showToast(`✅ 已建立分類「${name}」`);
            };
            const addStampItem = async (applyImmediately = false) => {
                const txt = String(newStampText.value || '').trim();
                if (!txt) return showToast('請輸入印章字眼');
                const catId = newStampCatId.value || stampCategories.value[0]?.id || 'cat_elec';
                const color = newStampColor.value || '#ffffff';
                let existing = stampItems.value.find(it => it.text === txt && it.catId === catId);
                if (!existing) {
                    existing = { id: 'st_custom_' + Date.now(), catId, text: txt, color, count: 0, pinned: true };
                    stampItems.value.unshift(existing);
                } else {
                    existing.color = color;
                    existing.pinned = true;
                }
                newStampText.value = '';
                await saveStampStore();
                if (applyImmediately && activeMarker.value) applyStamp(existing);
                else showToast(`✅ 已加入印章「${txt}」`);
            };
            const toggleStampPin = async (item) => { item.pinned = !item.pinned; await saveStampStore(); };
            const setStampItemColor = async (item, hex) => { item.color = hex; await saveStampStore(); };
            const editStampItemText = async (item) => {
                const next = prompt('修改印章字眼：', item.text)?.trim();
                if (next && next !== item.text) { item.text = next; await saveStampStore(); showToast('✅ 已更新印章'); }
            };
            const deleteStampItem = async (itemId) => { stampItems.value = stampItems.value.filter(x => x.id !== itemId); await saveStampStore(); };
            const restoreDefaultStamps = async () => {
                if (!confirm('補回所有預設 74 個專業印章？（你自訂的印章會保留）')) return;
                const { cats, items } = buildSeedStampData();
                cats.forEach(c => { if (!stampCategories.value.some(x => x.id === c.id)) stampCategories.value.push(c); });
                items.forEach(it => { if (!stampItems.value.some(x => x.text === it.text && x.catId === it.catId)) stampItems.value.push(it); });
                await saveStampStore();
                showToast('✅ 已補回全部預設印章');
            };
            const promptCustomStamp = async () => {
                const txt = prompt('輸入自訂印章字眼：')?.trim();
                if (!txt) return;
                if (!stampCategories.value.some(c => c.id === 'cat_custom')) {
                    stampCategories.value.unshift({ id: 'cat_custom', icon: '⭐', name: '自訂', defaultColor: '#ffffff' });
                }
                let item = stampItems.value.find(x => x.text === txt);
                if (!item) {
                    item = { id: 'st_custom_' + Date.now(), catId: 'cat_custom', text: txt, color: '#ffffff', count: 1, pinned: true };
                    stampItems.value.unshift(item);
                    await saveStampStore();
                }
                applyStamp(item);
            };

            // =========================================================================
            // 🏛️ AutoCAD 圖庫目錄管理引擎 (實時縮圖預覽・上傳/貼上圖案・自由增減)
            // =========================================================================
            const showCadManager = ref(false), cadMgrFilter = ref('all');
            const newCadCat = ref('arch'), newCadShape = ref('box'), newCadLabel = ref(''), newCadImgB64 = ref('');
            const customCadBlocks = ref([]), pinnedCadIds = ref([]), hiddenCadIds = ref([]);

            const previewNewCadShapes = computed(() => CAD_SHAPE_PRESETS[newCadShape.value] || CAD_SHAPE_PRESETS.box);

            const getCadPreviewViewBox = (item) => {
                const hw = Math.max(42, Math.round((item?.w || 80) * 0.65));
                const hh = Math.max(42, Math.round((item?.h || 80) * 0.65));
                return `${-hw} ${-hh} ${hw * 2} ${hh * 2}`;
            };

            const compressCadIcon = (fileOrBlob) => new Promise((res) => {
                const reader = new FileReader(); reader.readAsDataURL(fileOrBlob);
                reader.onload = (e) => {
                    const img = new Image(); img.src = e.target.result;
                    img.onload = () => {
                        const c = document.createElement('canvas'), MAX = 180;
                        let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
                        if (w > MAX || h > MAX) {
                            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                            else { w = Math.round(w * MAX / h); h = MAX; }
                        }
                        c.width = w; c.height = h;
                        c.getContext('2d').drawImage(img, 0, 0, w, h);
                        res(c.toDataURL('image/png'));
                    };
                };
            });

            const handleNewCadImage = async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                newCadImgB64.value = await compressCadIcon(f);
                if (!newCadLabel.value.trim()) {
                    newCadLabel.value = f.name.replace(/\.[^.]+$/, '').slice(0, 12);
                }
                e.target.value = '';
                showToast('✅ 已載入圖案預覽，按「加入」即可存入圖庫');
            };

            const loadCadStore = async () => {
                const saved = await localforage.getItem('custom_cad_store_v1');
                if (saved) {
                    customCadBlocks.value = saved.custom || [];
                    pinnedCadIds.value = saved.pinned || [];
                    hiddenCadIds.value = saved.hidden || [];
                }
            };
            const saveCadStore = async () => {
                await localforage.setItem('custom_cad_store_v1', {
                    custom: JSON.parse(JSON.stringify(customCadBlocks.value)),
                    pinned: [...pinnedCadIds.value],
                    hidden: [...hiddenCadIds.value]
                });
                if (currentUser.value?.uid && db && navigator.onLine) {
                    syncUserLibrariesCloud(true).catch(() => {});
                }
            };

            const syncUserLibrariesCloud = async (silent = false) => {
                if (!db || !navigator.onLine) {
                    if (!silent) alert('請先連接網絡再同步');
                    return;
                }
                const uid = currentUser.value?.uid;
                if (!uid) {
                    if (!silent) alert('請先綁定 Google 帳號即可跨裝置自動同步圖庫與印章');
                    return;
                }
                if (!silent) { isProcessing.value = true; processingText.value = '正在同步印章與圖庫...'; }
                try {
                    const docRef = db.collection('user_libraries').doc(String(uid));
                    const snap = await withTimeout(docRef.get(), 12000);
                    if (snap.exists && silent) {
                        // 上傳本機最新狀態覆蓋雲端
                    }
                    await withTimeout(docRef.set({
                        stampCategories: JSON.parse(JSON.stringify(stampCategories.value)),
                        stampItems: JSON.parse(JSON.stringify(stampItems.value)),
                        customCadBlocks: JSON.parse(JSON.stringify(customCadBlocks.value)),
                        pinnedCadIds: [...pinnedCadIds.value],
                        hiddenCadIds: [...hiddenCadIds.value],
                        updatedAt: Date.now()
                    }, { merge: true }), 12000);
                    if (!silent) showToast(`☁️ 已同步 ${stampItems.value.length} 個印章與圖庫至帳號`);
                } catch (e) {
                    if (!silent) alert('同步失敗：' + e.message);
                } finally {
                    if (!silent) isProcessing.value = false;
                }
            };
            const syncStampLibraryCloud = () => syncUserLibrariesCloud(false);

            const allCadManageList = computed(() => {
                const builtIn = CAD_LIST.map(x => ({
                    ...x, isCustom: false,
                    pinned: pinnedCadIds.value.includes(x.id),
                    hidden: hiddenCadIds.value.includes(x.id)
                }));
                const custom = customCadBlocks.value.map(x => ({
                    ...x, isCustom: true,
                    pinned: pinnedCadIds.value.includes(x.id),
                    hidden: hiddenCadIds.value.includes(x.id)
                }));
                return [...custom, ...builtIn].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
            });

            const filteredCadManageList = computed(() => allCadManageList.value.filter(x => cadMgrFilter.value === 'all' || x.cat === cadMgrFilter.value));

            const cadCategory = ref('arch'), selectedCadType = ref('door_single');
            const filteredCadList = computed(() => allCadManageList.value.filter(x => !x.hidden && x.cat === cadCategory.value));

            const getCadDef = (type) => {
                if (CAD_DEFS[type]) return CAD_DEFS[type];
                return customCadBlocks.value.find(x => x.id === type) || null;
            };
           const getCadTransform = (m) => {
                const sx = (m.scale || 1) * (m.scaleX || 1) * (m.flipX || 1);
                const sy = (m.scale || 1) * (m.scaleY || 1) * (m.flipY || 1);
                return `translate(${m.x}, ${m.y}) rotate(${m.rot || 0}) scale(${sx}, ${sy})`;
            };

            const openCadManager = () => { cadMgrFilter.value = 'all'; newCadLabel.value = ''; newCadImgB64.value = ''; showCadManager.value = true; };
            const addCustomCadBlock = async () => {
                const label = String(newCadLabel.value || '').trim();
                if (!label) return showToast('請輸入圖塊名稱');
                const id = 'cad_custom_' + Date.now();
                if (newCadImgB64.value) {
                    customCadBlocks.value.unshift({ id, cat: newCadCat.value || 'arch', label, w: 72, h: 72, imgB64: newCadImgB64.value });
                } else {
                    const shapes = JSON.parse(JSON.stringify(CAD_SHAPE_PRESETS[newCadShape.value] || CAD_SHAPE_PRESETS.box));
                    customCadBlocks.value.unshift({ id, cat: newCadCat.value || 'arch', label, w: 64, h: 64, shapes });
                }
                pinnedCadIds.value.push(id);
                newCadLabel.value = '';
                newCadImgB64.value = '';
                await saveCadStore();
                showToast(`✅ 已加入圖塊「${label}」`);
            };
            const deleteCustomCadBlock = async (id) => {
                if (!confirm('確定要刪除此自訂圖塊嗎？')) return;
                customCadBlocks.value = customCadBlocks.value.filter(x => x.id !== id);
                pinnedCadIds.value = pinnedCadIds.value.filter(x => x !== id);
                await saveCadStore();
                showToast('🗑️ 已刪除圖塊');
            };
            const togglePinCad = async (id) => {
                if (pinnedCadIds.value.includes(id)) pinnedCadIds.value = pinnedCadIds.value.filter(x => x !== id);
                else pinnedCadIds.value.push(id);
                await saveCadStore();
            };
            const toggleHideCad = async (id) => {
                if (hiddenCadIds.value.includes(id)) hiddenCadIds.value = hiddenCadIds.value.filter(x => x !== id);
                else hiddenCadIds.value.push(id);
                await saveCadStore();
            };

            const drawCustomCadOnCanvas = (ctx, m, customCadImages = {}) => {
                const def = getCadDef(m.data?.cadType);
                if (!def) return;
                if (CAD_DEFS[m.data?.cadType]) { drawCadOnCanvas(ctx, m); return; }
                ctx.save();
                ctx.translate(m.x, m.y);
                ctx.rotate(((m.rot || 0) * Math.PI) / 180);
                ctx.scale((m.scale || 1) * (m.flipX || 1), (m.scale || 1) * (m.flipY || 1));
                if (def.imgB64 && customCadImages[def.id]) {
                    const dw = def.w || 72, dh = def.h || 72;
                    ctx.drawImage(customCadImages[def.id], -dw / 2, -dh / 2, dw, dh);
                } else {
                    ctx.strokeStyle = m.color || '#111827';
                    (def.shapes || []).forEach(s => {
                        ctx.lineWidth = s.sw || 2.5;
                        if (s.t === 'rect') {
                            if (s.fillBg) { ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.fillRect(s.x, s.y, s.w, s.h); }
                            ctx.strokeRect(s.x, s.y, s.w, s.h);
                        } else if (s.t === 'circle') {
                            ctx.beginPath(); ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
                            if (s.fillBg) { ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.fill(); }
                            ctx.stroke();
                        } else if (s.t === 'line') {
                            ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
                        }
                    });
                }
                ctx.restore();
            };
            const projectList = ref([]), allProjectOptions = ref([]);
            const project = reactive({ code: '', name: '', date: '', ownerId: '', deletedPageIds: [], deletedPinIds: [], pageOrderUpdatedAt: 0, lastSyncAt: 0, lastModifiedBy: '' });
            const pages = ref([]), photoPool = ref([]);

            const splitMode = ref(false), activePane = ref('A');
            const activePageIndex = ref(0), activePin = ref(null), activePinIndex = ref(0);
            const pageIndexB = ref(0), pinB = ref(null), pinIndexB = ref(0);

            const activePage = computed(() => pages.value[activePageIndex.value] || null);
            const activeCanvas = computed(() => activePin.value || activePage.value);
            const canvasW = computed(() => activeCanvas.value?.w || 1200);
            const canvasH = computed(() => activeCanvas.value?.h || 900);

            const pageB = computed(() => pages.value[pageIndexB.value] || null);
            const canvasB = computed(() => pinB.value || pageB.value);
            const canvasWB = computed(() => canvasB.value?.w || 1200);
            const canvasHB = computed(() => canvasB.value?.h || 900);

            const targetPage = computed(() => (splitMode.value && activePane.value === 'B') ? pageB.value : activePage.value);
            const targetPin = computed(() => (splitMode.value && activePane.value === 'B') ? pinB.value : activePin.value);
            const targetCanvas = computed(() => (splitMode.value && activePane.value === 'B') ? canvasB.value : activeCanvas.value);
            const targetCanvasW = computed(() => targetCanvas.value?.w || 1200);
            const targetCanvasH = computed(() => targetCanvas.value?.h || 900);

            const focusPane = (pane) => { if (activePane.value !== pane) activePane.value = pane; };
            const toggleSplitMode = () => {
                splitMode.value = !splitMode.value;
                if (splitMode.value) {
                    if (pages.value.length > 1 && pageIndexB.value === activePageIndex.value) pageIndexB.value = activePageIndex.value === 0 ? 1 : 0;
                    pinB.value = null; resetZoomB(); activePane.value = 'A';
                    showToast('⊞ 已開啟雙頁並排編輯（點選任一邊即可繪畫）');
                } else activePane.value = 'A';
            };

            const feedbackList = ref([]), showFeedbackOverlay = ref(true), showFeedbackModal = ref(false);
            const currentCanvasFeedbacks = computed(() => {
                const pgId = String(activePage.value?.id || ''), pinId = activePin.value ? String(activePin.value.id) : '';
                if (!pgId) return [];
                return feedbackList.value.filter(f => String(f.pageId || '') === pgId && String(f.pinId || '') === pinId);
            });
            const canvasBFeedbacks = computed(() => {
                const pgId = String(pageB.value?.id || ''), pinId = pinB.value ? String(pinB.value.id) : '';
                if (!pgId) return [];
                return feedbackList.value.filter(f => String(f.pageId || '') === pgId && String(f.pinId || '') === pinId);
            });
            const pageFeedbackCount = (pgId) => feedbackList.value.filter(f => String(f.pageId || '') === String(pgId)).length;
            const jumpToFeedback = (fb) => {
                showFeedbackModal.value = false; resetZoom(); showQuickPageNav.value = false; activePane.value = 'A';
                const pIdx = pages.value.findIndex(p => String(p.id) === String(fb.pageId));
                if (pIdx === -1) { showToast('⚠️ 該意見所屬頁面已不存在'); return; }
                activePageIndex.value = pIdx;
                if (fb.pinId) {
                    const targetPinIdx = (pages.value[pIdx].pins || []).findIndex(x => String(x.id) === String(fb.pinId));
                    if (targetPinIdx !== -1) openPinSubPage(pages.value[pIdx].pins[targetPinIdx], targetPinIdx, 'A');
                    else activePin.value = null;
                } else activePin.value = null;
                showFeedbackOverlay.value = true; drawMode.value = 'browse'; currentView.value = 'proj';
            };
            const resolveFeedback = async (fbId) => {
                if (!db || !project.code || !fbId) return;
                if (!navigator.onLine) { showToast('📴 請在有網絡連線時清除意見'); return; }
                try {
                    await db.collection('site_projects').doc(String(project.code)).collection('feedback').doc(String(fbId)).delete();
                    feedbackList.value = feedbackList.value.filter(x => x.id !== fbId);
                    showToast('✅ 已跟進並清除該條意見');
                } catch (_) { showToast('⚠️ 清除失敗，請稍後再試'); }
            };

            const masterPages = computed(() => pages.value.map((pg, idx) => ({ pg, idx })).filter(x => x.pg.space === '總圖'));
            const showQuickPageNav = ref(false), showQuickPageNavB = ref(false);
            const jumpToPage = (idx) => { showQuickPageNav.value = false; switchPage(idx, 'A'); };
            const jumpToPageB = (idx) => { showQuickPageNavB.value = false; switchPage(idx, 'B'); };
            const jumpToPageById = (targetId, pane = activePane.value) => {
                if (!targetId) return;
                const idx = pages.value.findIndex(p => String(p.id) === String(targetId));
                if (idx !== -1) { switchPage(idx, pane); showToast(`↪️ 已跳轉至 P${idx + 1}${pages.value[idx].space ? ' [' + pages.value[idx].space + ']' : ''}`); }
                else showToast('⚠️ 連結的目標頁面已不存在');
            };
            const goToMasterPlan = (pane = 'A') => {
                if (!masterPages.value.length) return;
                if (masterPages.value.length === 1) { pane === 'B' ? jumpToPageB(masterPages.value[0].idx) : jumpToPage(masterPages.value[0].idx); }
                else { pane === 'B' ? (showQuickPageNavB.value = !showQuickPageNavB.value) : (showQuickPageNav.value = !showQuickPageNav.value); }
            };

            const capsuleOffset = reactive({ x: 0, y: 0 });
            const capsuleCollapsed = ref(false);
            const startCapsuleDrag = (e) => {
                const sx = e.clientX, sy = e.clientY, ox = capsuleOffset.x, oy = capsuleOffset.y;
                const onMove = (ev) => {
                    const maxX = Math.max(60, window.innerWidth / 2 - 50);
                    capsuleOffset.x = Math.max(-maxX, Math.min(maxX, ox + (ev.clientX - sx)));
                    capsuleOffset.y = Math.max(-6, Math.min(window.innerHeight - 130, oy + (ev.clientY - sy)));
                };
                const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); };
                window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
            };

            const zoomScale = ref(1), vbX = ref(0), vbY = ref(0);
            const invZoom = computed(() => 1 / Math.pow(zoomScale.value, 0.65));
            const svgViewBox = computed(() => {
                const pw = canvasW.value, ph = canvasH.value;
                const vw = Math.round((pw / zoomScale.value) * 10) / 10, vh = Math.round((ph / zoomScale.value) * 10) / 10;
                const vx = Math.max(0, Math.min(pw - vw, vbX.value)), vy = Math.max(0, Math.min(ph - vh, vbY.value));
                return `${vx} ${vy} ${vw} ${vh}`;
            });

            const zoomScaleB = ref(1), vbXB = ref(0), vbYB = ref(0);
            const invZoomB = computed(() => 1 / Math.pow(zoomScaleB.value, 0.65));
            const svgViewBoxB = computed(() => {
                const pw = canvasWB.value, ph = canvasHB.value;
                const vw = Math.round((pw / zoomScaleB.value) * 10) / 10, vh = Math.round((ph / zoomScaleB.value) * 10) / 10;
                const vx = Math.max(0, Math.min(pw - vw, vbXB.value)), vy = Math.max(0, Math.min(ph - vh, vbYB.value));
                return `${vx} ${vy} ${vw} ${vh}`;
            });

            const resetZoom = () => { zoomScale.value = 1; vbX.value = 0; vbY.value = 0; };
            const resetZoomB = () => { zoomScaleB.value = 1; vbXB.value = 0; vbYB.value = 0; };

            const getMarkerFontPx = (m) => Math.round(28 * globalFontScale.value * (m?.fontScale || 1) * 10) / 10;

            const toggleFontScale = () => {
                globalFontScale.value = globalFontScale.value <= 0.5 ? 0.65 : (globalFontScale.value <= 0.65 ? 0.85 : 0.5);
                (targetCanvas.value?.markers || []).forEach(m => updateMarkerSize(m));
                saveAll();
                showToast(`🔠 整體字體：${globalFontScale.value >= 0.85 ? '大' : (globalFontScale.value >= 0.65 ? '中' : '細')}`);
            };

            const stepMarkerFontScale = (delta) => {
                if (!activeMarker.value) return;
                ensureMarkerBranched(() => {
                    const cur = activeMarker.value.fontScale || 1;
                    activeMarker.value.fontScale = Math.max(0.5, Math.min(2.2, Math.round((cur + delta) * 100) / 100));
                    updateMarkerSize(activeMarker.value);
                    touchDirty(); saveAll();
                });
            };

            const applyZoomAtClientPoint = (nextScale, clientX, clientY, anchorSvg, pane = 'A') => {
                const isB = pane === 'B', svg = isB ? svgCanvasB.value : svgCanvas.value, pw = isB ? canvasWB.value : canvasW.value, ph = isB ? canvasHB.value : canvasH.value;
                const zRef = isB ? zoomScaleB : zoomScale, xRef = isB ? vbXB : vbX, yRef = isB ? vbYB : vbY;
                const clampedScale = Math.max(1, Math.min(5, Math.round(nextScale * 100) / 100));
                if (clampedScale <= 1) { isB ? resetZoomB() : resetZoom(); return; }
                const vw = pw / clampedScale, vh = ph / clampedScale;
                if (svg && anchorSvg) {
                    const r = svg.getBoundingClientRect(), baseFit = Math.min(r.width / pw, r.height / ph);
                    const effScale = baseFit * clampedScale, offX = r.left + (r.width - pw * baseFit) / 2, offY = r.top + (r.height - ph * baseFit) / 2;
                    zRef.value = clampedScale;
                    xRef.value = Math.max(0, Math.min(pw - vw, anchorSvg.x - (clientX - offX) / effScale));
                    yRef.value = Math.max(0, Math.min(ph - vh, anchorSvg.y - (clientY - offY) / effScale));
                } else {
                    const cx = xRef.value + (pw / zRef.value) / 2, cy = yRef.value + (ph / zRef.value) / 2;
                    zRef.value = clampedScale;
                    xRef.value = Math.max(0, Math.min(pw - vw, cx - vw / 2));
                    yRef.value = Math.max(0, Math.min(ph - vh, cy - vh / 2));
                }
            };
            const stepZoom = (delta, pane = 'A') => applyZoomAtClientPoint((pane === 'B' ? zoomScaleB.value : zoomScale.value) + delta, null, null, null, pane);
            const onStageWheel = (e, pane = 'A') => {
                const svg = pane === 'B' ? svgCanvasB.value : svgCanvas.value, cObj = pane === 'B' ? canvasB.value : activeCanvas.value;
                if (svg && cObj?.photo) applyZoomAtClientPoint((pane === 'B' ? zoomScaleB.value : zoomScale.value) * (e.deltaY < 0 ? 1.2 : 0.82), e.clientX, e.clientY, getCoords(e, pane), pane);
            };

            const fullScreenIndex = ref(-1);
            const fullScreenList = computed(() => {
                const list = [];
                pages.value.forEach((pg, pIdx) => {
                    const d = pg.date || project.date || getTodayStr(), a = pg.author || project.lastModifiedBy || '';
                    if (pg.photo) list.push({ item: pg, label: `P${pIdx + 1}${pg.space ? ' [' + pg.space + ']' : ''}`, date: d, author: a });
                    (pg.pins || []).forEach((pin, pinIdx) => { if (pin.photo) list.push({ item: pin, label: `P${pIdx + 1} 📍釘#${pinIdx + 1}${pin.space ? ' [' + pin.space + ']' : ''}`, date: pin.date || d, author: pin.author || a }); });
                });
                return list;
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
                const target = fullScreenItem.value; if (!target) return;
                const tid = String(target.id);
                fullScreenIndex.value = -1; resetZoom(); showQuickPageNav.value = false; activePane.value = 'A';
                for (let i = 0; i < pages.value.length; i++) {
                    const pg = pages.value[i];
                    if (String(pg.id) === tid) { activePageIndex.value = i; activePin.value = null; drawMode.value = 'line'; currentView.value = 'proj'; return; }
                    const pIdx = (pg.pins || []).findIndex(p => String(p.id) === tid);
                    if (pIdx !== -1) { activePageIndex.value = i; openPinSubPage(pg.pins[pIdx], pIdx, 'A'); drawMode.value = 'line'; currentView.value = 'proj'; return; }
                }
            };

            const draggingPageIdx = ref(null), dragOverPageIdx = ref(null);
            const startPageDrag = (idx) => {
                if (pages.value.length <= 1 || selectMode.value) return;
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

            const buildWatermarkBox = (item, itemDate, itemAuthor, canvasWidth = 1200) => {
                const pName = project.name?.trim() || '', spName = item?.space?.trim() || '';
                const leftPart = [pName, spName].filter(Boolean).join(' · ');
                const dStr = itemDate || item?.date || project.date || '', aStr = itemAuthor || item?.author || project.lastModifiedBy || '';
                const rightPart = [dStr, aStr].filter(Boolean).join(' · ');
                const text = [leftPart, rightPart].filter(Boolean).join('  ｜  ');
                if (!text) return null;
                const w = Math.min(canvasWidth - 20, Math.max(120, Math.ceil(measureStrWidth(text, 13) + 24))), h = 26;
                return { x: Math.max(10, Math.round((canvasWidth - w) / 2)), y: 8, w, h, text };
            };
            const fullScreenWatermarkBox = computed(() => buildWatermarkBox(fullScreenItem.value, fullScreenDate.value, fullScreenAuthor.value, fullScreenItem.value?.w || 1200));

            const showAddPageModal = ref(false), showSpaceModal = ref(false), showMergeModal = ref(false), showPdfModal = ref(false);
            const spaceList = ref([...DEFAULT_SPACES]);
            const showManageModal = ref(false), manageProj = ref({}), showCloudBrowser = ref(false), cloudProjectList = ref([]), showBackupListModal = ref(false), backupList = ref([]);
            const showPhotoPoolModal = ref(false), photoPoolList = ref([]), photoPoolTarget = ref('newPage');

const localHiddenCodes = ref([]);
            const unclaimedCloudProjects = computed(() => {
                const localCodes = new Set(projectList.value.map(p => String(p.code)));
                const hiddenSet = new Set(localHiddenCodes.value);
                const uid = currentUser.value?.uid ? String(currentUser.value.uid) : '';
                return cloudProjectList.value.filter(cp => {
                    const code = String(cp.code);
                    if (localCodes.has(code)) return false;
                    if (hiddenSet.has(code)) return true;
                    if (uid && cp.ownerId && String(cp.ownerId) === uid) return false;
                    return true;
                });
            });

            const showMergeProjectsModal = ref(false), mergeProjCodeA = ref(''), mergeProjCodeB = ref(''), mergeProjNewName = ref('');
            const selectMode = ref(false), selectedPageIds = ref([]);
            const showTransferModal = ref(false), transferTargetCode = ref(''), transferMode = ref('copy'), transferNewProjName = ref('');
            const otherProjectOptions = computed(() => allProjectOptions.value.filter(p => String(p.code) !== String(project.code)));

            const drawColor = ref('#ef4444'), wallStyle = ref('hollow'), toastMsg = ref('');
            const showToast = (msg) => { toastMsg.value = msg; setTimeout(() => { if (toastMsg.value === msg) toastMsg.value = ''; }, 3000); };

            const cloudSyncState = ref(navigator.onLine ? 'ready' : 'offline');
            const cloudStatusText = computed(() => ({ syncing: '☁️同步中', offline: '📴離線', queued: '⏳待傳', ready: '☁️v11.1' }[cloudSyncState.value] || '☁️v11.1'));
            const cloudStatusClass = computed(() =>
                cloudSyncState.value === 'syncing' ? 'bg-amber-100 text-amber-900 border-amber-300' :
                cloudSyncState.value === 'offline' ? 'bg-zinc-100 text-zinc-500 border-zinc-300' :
                cloudSyncState.value === 'queued' ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-emerald-50 text-emerald-700 border-emerald-300'
            );

            const showCloudDetail = () => {
                if (!navigator.onLine) showToast('📴 無網絡模式：照常度尺，有訊號自動上傳');
                else if (cloudSyncState.value === 'queued') processPendingUploadQueue(false);
                else showToast('v11.1 帳號自動同步・CAD縮圖圖庫・74專業印章');
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
            const touchDirty = (pg = targetPage.value) => {
                const now = Date.now(), today = getTodayStr();
                if (targetPin.value) targetPin.value.updatedAt = now;
                if (pg) { pg.updatedAt = now; pg.date = today; if (authorName.value) pg.author = authorName.value; dirtyPageIds.add(pg.id); }
                project.date = today; hasUnsavedCloudChanges.value = true;
                if (!navigator.onLine) cloudSyncState.value = 'offline';
            };

            const takenOverProjects = new Set();
            const showBranchPrompt = ref(false), branchOwner = ref(''), pendingBranchAction = ref(null), branchTargetPage = ref(null);
            const triggerBranchPrompt = (pg, owner, actionCb) => {
                isDrawing.value = false; currentLine.value = null; currentWall.value = null; currentPath.value = '';
                if (draggedMarker.value) { draggedMarker.value.x = markerOrigin.value.x; draggedMarker.value.y = markerOrigin.value.y; draggedMarker.value = null; }
                branchOwner.value = owner; branchTargetPage.value = pg; pendingBranchAction.value = actionCb; showBranchPrompt.value = true;
            };
            const doBranchCopy = (pg, me) => {
                const c = JSON.parse(JSON.stringify(pg)), sharedPhotoId = pg.photoId || ('page_' + pg.id); pg.photoId = sharedPhotoId;
                const isB = splitMode.value && activePane.value === 'B';
                const oldPinId = (isB ? pinB.value : activePin.value) ? String((isB ? pinB.value : activePin.value).id) : null;
                const newPg = makeEmptyPage({
                    space: c.space || '', date: getTodayStr(), author: me, photo: pg.photo, photoId: sharedPhotoId, w: c.w || 1200, h: c.h || 900,
                    isSketch: !!c.isSketch, hasGrid: !!c.hasGrid, markers: c.markers || [], lines: c.lines || [], walls: c.walls || [], paths: c.paths || [], pins: c.pins || [], deletedPinIds: c.deletedPinIds || []
                });
                pages.value.push(newPg);
                if (isB) { pageIndexB.value = pages.value.length - 1; if (oldPinId) pinB.value = (newPg.pins || []).find(p => String(p.id) === oldPinId) || null; }
                else { activePageIndex.value = pages.value.length - 1; if (oldPinId) activePin.value = (newPg.pins || []).find(p => String(p.id) === oldPinId) || null; }
                dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true;
                showToast(`📋 已複製為 P${pages.value.length} (保留 [${branchOwner.value}] 原圖)`);
            };
            const overwriteBranch = () => {
                const me = String(authorName.value || '').trim();
                if (project.code) takenOverProjects.add(String(project.code));
                if (branchTargetPage.value && me) branchTargetPage.value.author = me;
                const cb = pendingBranchAction.value;
                showBranchPrompt.value = false; pendingBranchAction.value = null; branchTargetPage.value = null;
                if (cb) cb();
            };
            
            const duplicateBranch = () => {
                const me = String(authorName.value || '').trim();
                if (branchTargetPage.value) doBranchCopy(branchTargetPage.value, me);
                const cb = pendingBranchAction.value;
                showBranchPrompt.value = false; pendingBranchAction.value = null; branchTargetPage.value = null;
                if (cb) cb();
            };
            const dismissBranch = () => {
                showBranchPrompt.value = false; pendingBranchAction.value = null; branchTargetPage.value = null;
            };
            const checkBranchNeed = (actionCb) => {
                const pg = targetPage.value, me = String(authorName.value || '').trim();
                if (!pg || !pg.photo || !me) return actionCb();
                if (project.code && takenOverProjects.has(String(project.code))) {
                    pg.author = me;
                    return actionCb();
                }
                const owner = String(pg.author || '').trim();
                if (!owner || owner === me) return actionCb();
                triggerBranchPrompt(pg, owner, actionCb);
            };

            const drawMode = ref('browse'), showTopSheet = ref(false), showTopTextBar = ref(false), activeMarker = ref(null);
            const isProcessing = ref(false), processingText = ref(''), focusedInput = ref('val'), topTextInputRef = ref(null), svgCanvas = ref(null), svgCanvasB = ref(null);

            const showIndexModal = ref(false), indexDraftPos = ref({ x: 0, y: 0 }), indexCustomCode = ref(''), editingIndexMarker = ref(null);
            const openIndexModalAt = (x, y, existing = null) => { indexDraftPos.value = { x, y }; editingIndexMarker.value = existing; indexCustomCode.value = existing?.data?.customCode || ''; showIndexModal.value = true; };
            const placeSpaceTag = (sp) => {
                checkBranchNeed(() => {
                    const c = targetCanvas.value; if (!c) return;
                    c.markers ||= []; c.historyStack ||= []; c.redoStack = [];
                    if (editingIndexMarker.value) {
                        const target = c.markers.find(m => m.id === editingIndexMarker.value.id);
                        if (target) { target.type = 'space_tag'; target.textColor = defaultTextColor.value !== '#ffffff' ? defaultTextColor.value : null; target.data = { ...makeBlankMarkerData(), val: sp }; updateMarkerSize(target); }
                    } else {
                        const markerId = Date.now();
                        const newMarker = { id: markerId, lineId: null, x: indexDraftPos.value.x, y: indexDraftPos.value.y, w: 140, h: 56, type: 'space_tag', textColor: defaultTextColor.value !== '#ffffff' ? defaultTextColor.value : null, data: { ...makeBlankMarkerData(), val: sp } };
                        updateMarkerSize(newMarker); c.markers.push(newMarker); c.historyStack.push({ type: 'marker', markerId });
                    }
                    touchDirty(); saveAll(); showIndexModal.value = false; editingIndexMarker.value = null;
                });
            };
            const addCustomSpaceTag = () => { const s = prompt('輸入空間或標籤名稱：')?.trim(); if (s) { if (!spaceList.value.includes(s)) spaceList.value.push(s); placeSpaceTag(s); } };
            const placePageLink = (targetPg, targetIdx) => {
                checkBranchNeed(() => {
                    const c = targetCanvas.value; if (!c) return;
                    c.markers ||= []; c.historyStack ||= []; c.redoStack = [];
                    const code = String(indexCustomCode.value || '').trim();
                    const label = code ? `${code} ➔ P${targetIdx + 1}` : `P${targetIdx + 1}${targetPg.space ? ' ' + targetPg.space : ''}`;
                    if (editingIndexMarker.value) {
                        const target = c.markers.find(m => m.id === editingIndexMarker.value.id);
                        if (target) { target.type = 'page_link'; target.data = { ...makeBlankMarkerData(), val: label, customCode: code, targetPageId: targetPg.id }; updateMarkerSize(target); }
                    } else {
                        const markerId = Date.now();
                        const newMarker = { id: markerId, lineId: null, x: indexDraftPos.value.x, y: indexDraftPos.value.y, w: 160, h: 56, type: 'page_link', data: { ...makeBlankMarkerData(), val: label, customCode: code, targetPageId: targetPg.id } };
                        updateMarkerSize(newMarker); c.markers.push(newMarker); c.historyStack.push({ type: 'marker', markerId });
                    }
                    touchDirty(); saveAll(); showIndexModal.value = false; editingIndexMarker.value = null;
                    showToast(`🔗 已連結至 P${targetIdx + 1}`);
                });
            };
            const deleteEditingIndexMarker = () => { if (!editingIndexMarker.value) return; activeMarker.value = editingIndexMarker.value; showIndexModal.value = false; editingIndexMarker.value = null; deleteMarkerTop(); };

            const activeLine = ref(null);

            const setMarkerTextColor = (colorHex) => {
                defaultTextColor.value = colorHex;
                if (activeMarker.value) {
                    ensureMarkerBranched(() => {
                        activeMarker.value.textColor = colorHex;
                        if (activeMarker.value.lineId) {
                            const linkedLine = (targetCanvas.value?.lines || []).find(l => l.id === activeMarker.value.lineId);
                            if (linkedLine) linkedLine.color = colorHex;
                        }
                        touchDirty(); saveAll();
                    });
                }
            };

            const onLinePointerStart = (line, e, pane = activePane.value) => {
                focusPane(pane);
                if (e.touches?.length > 1 || isPinching || showBranchPrompt.value) return;
                if (drawMode.value === 'eraser') { onEraseTap('line', line, e, pane); return; }
                if (drawMode.value === 'move') {
                    e.preventDefault(); e.stopPropagation();
                    activeMarker.value = null;
                    activeLine.value = line;
                }
            };

            const setActiveLineColor = (colorHex) => {
                if (!activeLine.value) return;
                checkBranchNeed(() => {
                    const target = (targetCanvas.value?.lines || []).find(l => l.id === activeLine.value.id) || activeLine.value;
                    target.color = colorHex;
                    const linkedMarker = (targetCanvas.value?.markers || []).find(m => m.lineId === target.id);
                    if (linkedMarker) linkedMarker.textColor = colorHex;
                    touchDirty(); saveAll();
                });
            };

            const deleteActiveLine = () => {
                if (!activeLine.value) return;
                checkBranchNeed(() => {
                    const c = targetCanvas.value, lid = activeLine.value.id;
                    if (c) {
                        c.lines = (c.lines || []).filter(l => l.id !== lid);
                        c.markers = (c.markers || []).filter(m => m.lineId !== lid);
                    }
                    activeLine.value = null;
                    touchDirty(); saveAll();
                });
            };

            const getArrowMarkerId = (c, suffix = '') => 'arrow-end-' + suffix + String(c || '#ef4444').replace('#', 'hex_');
            const getFsArrowMarkerId = (c) => 'fs-arrow-' + String(c || '#ef4444').replace('#', 'hex_');

            const getLineStroke = (l, alpha = 0.75) => {
                const legacy = { red: '#ef4444', gray: '#9ca3af', white: '#ffffff' };
                if (!l.type || l.type === 'measure') {
                    return l.color ? (legacy[l.color] || l.color) : `rgba(255, 0, 68, ${alpha})`;
                }
                return legacy[l.color] || l.color || '#ef4444';
            };

            const getWallSegments = (w) => buildWallSegments(w);

            const enterEditMode = (idx = 0) => { resetZoom(); showQuickPageNav.value = false; selectMode.value = false; selectedPageIds.value = []; splitMode.value = false; activePane.value = 'A'; activePageIndex.value = idx; activePin.value = null; drawMode.value = 'browse'; currentView.value = 'proj'; };
            const switchToPreview = async () => { await saveAll(); resetZoom(); showQuickPageNav.value = false; selectMode.value = false; selectedPageIds.value = []; splitMode.value = false; activePane.value = 'A'; activePin.value = null; currentView.value = 'preview'; };

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
                    Object.keys(maps).forEach(k => (pg[k] || []).forEach(x => { if (!(k === 'pins' && delPins.has(String(x.id)))) maps[k].set(String(x.id), JSON.parse(JSON.stringify(x))); }));
                });
                const mergedPg = makeEmptyPage({
                    space, date: getTodayStr(), author: (authorName.value || '團隊') + ' (合併)', photo: grp.photo, photoId: grp.key, w, h, isSketch, hasGrid,
                    lines: [...maps.lines.values()], walls: [...maps.walls.values()], paths: [...maps.paths.values()], markers: [...maps.markers.values()], pins: [...maps.pins.values()], deletedPinIds: [...delPins]
                });
                pages.value.push(mergedPg); dirtyPageIds.add(mergedPg.id); hasUnsavedCloudChanges.value = true; showMergeModal.value = false; await saveAll(); showToast(`✅ 已智能合併為 P${pages.value.length}`);
            };

            const isDrawing = ref(false), drawingPane = ref('A'), startPos = ref({ x: 0, y: 0 }), currentLine = ref(null), currentWall = ref(null), currentPath = ref('');
            let tempPoints = [];
            const draggedMarker = ref(null), dragOrigin = ref({ x: 0, y: 0 }), markerOrigin = ref({ x: 0, y: 0 });
            const hasUndoItems = computed(() => targetCanvas.value?.historyStack?.length > 0);
            const hasRedoItems = computed(() => targetCanvas.value?.redoStack?.length > 0);

            let isPinching = false, pinchPane = 'A', pinchStartDist = 0, pinchStartScale = 1, pinchAnchorSvg = null;
            let isPanningBrowse = false, panPane = 'A', panStartClient = { x: 0, y: 0 }, panStartVb = { x: 0, y: 0 };
            let touchStartTime = 0, touchMoved = false, pendingTapMarker = null;
            let isSpaceDown = false;

            const getClientPoint = (e) => e.touches?.[0] || e.changedTouches?.[0] || e;
            const clientToSvgPoint = (clientX, clientY, pane = 'A') => {
                const isB = pane === 'B', svg = isB ? svgCanvasB.value : svgCanvas.value, cObj = isB ? canvasB.value : activeCanvas.value;
                if (!svg || !cObj) return { x: 0, y: 0 };
                const pw = cObj.w || 1200, ph = cObj.h || 900;
                try {
                    const ctm = svg.getScreenCTM();
                    if (ctm) { const p = svg.createSVGPoint(); p.x = clientX; p.y = clientY; const loc = p.matrixTransform(ctm.inverse()); return { x: Math.round(Math.max(0, Math.min(pw, loc.x))), y: Math.round(Math.max(0, Math.min(ph, loc.y))) }; }
                } catch (_) {}
                const zVal = isB ? zoomScaleB.value : zoomScale.value, xVal = isB ? vbXB.value : vbX.value, yVal = isB ? vbYB.value : vbY.value;
                const vw = pw / zVal, vh = ph / zVal, vx = Math.max(0, Math.min(pw - vw, xVal)), vy = Math.max(0, Math.min(ph - vh, yVal));
                const r = svg.getBoundingClientRect(), s = Math.min(r.width / vw, r.height / vh);
                return { x: Math.round(Math.max(0, Math.min(pw, vx + (clientX - r.left - (r.width - vw * s) / 2) / s))), y: Math.round(Math.max(0, Math.min(ph, vy + (clientY - r.top - (r.height - vh * s) / 2) / s))) };
            };
            const getCoords = (e, pane = activePane.value) => { const pt = getClientPoint(e); return clientToSvgPoint(pt.clientX, pt.clientY, pane); };

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
                }
                return { w, h };
            };

            const makeEmptyPage = (ov = {}) => {
                const pg = {
                    id: 'pg_' + Date.now() + '_' + Math.floor(Math.random() * 99999), space: '', docType: '', date: ov.date || getTodayStr(), author: authorName.value || '',
                    photo: null, photoId: '', w: 1200, h: 900, isSketch: false, hasGrid: false, markers: [], lines: [], walls: [], paths: [], pins: [], deletedPinIds: [], historyStack: [], redoStack: [], updatedAt: Date.now(), ...ov
                };
                if (pg.isSketch && !pg.photo) { const size = getAdaptiveCanvasSize(); pg.w = ov.w || size.w; pg.h = ov.h || size.h; pg.photo = renderSketchDataUrl(pg.w, pg.h, !!pg.hasGrid); }
                return pg;
            };

            const getDocTypeLabel = (dt) => ({ plan: '📐平面圖', detail: '📏詳圖', photo: '📷拍攝' }[dt] || '');
            const isDrawingDocType = (dt) => dt === 'plan' || dt === 'detail';

            const insertPageSmart = (newPg, explicitAfterIdx = null) => {
                let insertIdx = pages.value.length;
                if (explicitAfterIdx !== null && explicitAfterIdx >= 0 && explicitAfterIdx < pages.value.length) {
                    insertIdx = explicitAfterIdx + 1;
                } else if (newPg.space) {
                    let lastSameGroup = -1, lastSameSpace = -1;
                    pages.value.forEach((p, i) => {
                        if (p.space === newPg.space) {
                            lastSameSpace = i;
                            if (newPg.docType && p.docType === newPg.docType) lastSameGroup = i;
                        }
                    });
                    if (lastSameGroup !== -1) insertIdx = lastSameGroup + 1;
                    else if (lastSameSpace !== -1) insertIdx = lastSameSpace + 1;
                    else if (pages.value.length > 0) insertIdx = Math.min(pages.value.length, activePageIndex.value + 1);
                } else if (pages.value.length > 0) {
                    insertIdx = Math.min(pages.value.length, activePageIndex.value + 1);
                }
                pages.value.splice(insertIdx, 0, newPg);
                project.pageOrderUpdatedAt = Date.now();
                return insertIdx;
            };

            const overviewTypeFilter = ref('all');
            const overviewSpaceFilter = ref('all');
            const drawingPageCount = computed(() => pages.value.filter(p => isDrawingDocType(p.docType)).length);
            const photoPageCount = computed(() => pages.value.filter(p => p.docType === 'photo').length);
            const overviewSpacesAvailable = computed(() => {
                const set = new Set();
                pages.value.forEach(p => { if (p.space) set.add(p.space); });
                return Array.from(set);
            });
            const filteredOverviewPages = computed(() => {
                return pages.value
                    .map((pg, idx) => ({ pg, idx }))
                    .filter(({ pg }) => {
                        if (overviewTypeFilter.value === 'drawing' && !isDrawingDocType(pg.docType)) return false;
                        if (overviewTypeFilter.value === 'photo' && pg.docType !== 'photo') return false;
                        if (overviewSpaceFilter.value !== 'all') {
                            if (overviewSpaceFilter.value === '__NONE__' && pg.space) return false;
                            if (overviewSpaceFilter.value !== '__NONE__' && pg.space !== overviewSpaceFilter.value) return false;
                        }
                        return true;
                    });
            });

            const movingPageId = ref('');
            const movingPageLabel = computed(() => {
                const idx = pages.value.findIndex(p => String(p.id) === String(movingPageId.value));
                if (idx === -1) return '';
                const pg = pages.value[idx];
                return `P${idx + 1}${pg.space ? ' [' + pg.space + ']' : ''}`;
            });
            const startMovePage = (pgId) => {
                movingPageId.value = String(movingPageId.value) === String(pgId) ? '' : String(pgId);
            };
            const insertMovingPageAfter = async (targetPgId) => {
                const fromIdx = pages.value.findIndex(p => String(p.id) === String(movingPageId.value));
                if (fromIdx === -1) { movingPageId.value = ''; return; }
                const [moved] = pages.value.splice(fromIdx, 1);
                let toIdx = 0;
                if (targetPgId !== '__START__') {
                    const targetIdx = pages.value.findIndex(p => String(p.id) === String(targetPgId));
                    toIdx = targetIdx !== -1 ? targetIdx + 1 : pages.value.length;
                }
                pages.value.splice(toIdx, 0, moved);
                activePageIndex.value = toIdx;
                movingPageId.value = '';
                project.pageOrderUpdatedAt = Date.now();
                hasUnsavedCloudChanges.value = true;
                await saveAll();
                showToast(`✅ 已調位至 P${toIdx + 1}`);
            };

            const showAutoSortModal = ref(false);
            const autoSortPages = async (mode = 'bySpace') => {
                showAutoSortModal.value = false;
                if (pages.value.length <= 1) return;
                const docRank = (dt) => ({ plan: 1, detail: 2, photo: 3 }[dt] || 4);
                const spaceRank = (sp) => {
                    if (!sp) return 999;
                    if (sp === '總圖') return 0;
                    const idx = spaceList.value.indexOf(sp);
                    return idx === -1 ? 500 : idx + 1;
                };
                const indexed = pages.value.map((pg, origIdx) => ({ pg, origIdx }));
                indexed.sort((a, b) => {
                    if (mode === 'byType') {
                        const dDiff = docRank(a.pg.docType) - docRank(b.pg.docType);
                        if (dDiff !== 0) return dDiff;
                        const sDiff = spaceRank(a.pg.space) - spaceRank(b.pg.space);
                        if (sDiff !== 0) return sDiff;
                    } else {
                        const sDiff = spaceRank(a.pg.space) - spaceRank(b.pg.space);
                        if (sDiff !== 0) return sDiff;
                        const dDiff = docRank(a.pg.docType) - docRank(b.pg.docType);
                        if (dDiff !== 0) return dDiff;
                    }
                    return a.origIdx - b.origIdx;
                });
                pages.value = indexed.map(x => x.pg);
                activePageIndex.value = 0;
                project.pageOrderUpdatedAt = Date.now();
                hasUnsavedCloudChanges.value = true;
                await saveAll();
                showToast(mode === 'byType' ? '✅ 已按「工程圖 → 拍攝」自動整理' : '✅ 已按「空間分類」自動歸隊');
            };

            const editingMetaPage = ref(null);
            const openPageMetaModal = (pg = null) => {
                editingMetaPage.value = pg;
                showSpaceModal.value = true;
            };
            const setPageDocType = (dt) => {
                if (editingMetaPage.value) {
                    editingMetaPage.value.docType = dt;
                    editingMetaPage.value.updatedAt = Date.now();
                    dirtyPageIds.add(editingMetaPage.value.id);
                    hasUnsavedCloudChanges.value = true;
                    saveAll();
                    return;
                }
                checkBranchNeed(() => {
                    if (targetPage.value) targetPage.value.docType = dt;
                    touchDirty(); saveAll();
                });
            };
            const batchSetDocType = async (dt) => {
                if (!selectedPageIds.value.length) return;
                const set = new Set(selectedPageIds.value.map(String));
                pages.value.forEach(pg => {
                    if (set.has(String(pg.id))) {
                        pg.docType = dt;
                        pg.updatedAt = Date.now();
                        dirtyPageIds.add(pg.id);
                    }
                });
                hasUnsavedCloudChanges.value = true;
                await saveAll();
                showToast(`✅ 已為 ${set.size} 頁設定為「${getDocTypeLabel(dt) || '清除分類'}」`);
            };
            const batchSetSpace = async (sp) => {
                if (!selectedPageIds.value.length) return;
                const set = new Set(selectedPageIds.value.map(String));
                pages.value.forEach(pg => {
                    if (set.has(String(pg.id))) {
                        pg.space = sp;
                        pg.updatedAt = Date.now();
                        dirtyPageIds.add(pg.id);
                    }
                });
                hasUnsavedCloudChanges.value = true;
                await saveAll();
                showToast(`✅ 已為 ${set.size} 頁標記空間「${sp}」`);
            };

            const initSketchOnCurrent = () => { if (!targetCanvas.value) return; targetPaneResetZoom(); const size = getAdaptiveCanvasSize(); Object.assign(targetCanvas.value, { photo: renderSketchDataUrl(size.w, size.h, true), w: size.w, h: size.h, isSketch: true, hasGrid: true, docType: targetCanvas.value.docType || 'plan' }); touchDirty(); drawMode.value = 'browse'; saveAll(); };
            const addNewSketchPage = (hasGrid) => { showAddPageModal.value = false; resetZoom(); const size = getAdaptiveCanvasSize(); const cur = targetPage.value; const newPg = makeEmptyPage({ space: cur?.space || '', docType: 'plan', photo: renderSketchDataUrl(size.w, size.h, hasGrid), w: size.w, h: size.h, isSketch: true, hasGrid }); const insertAt = insertPageSmart(newPg); activePageIndex.value = insertAt; dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true; drawMode.value = 'browse'; saveAll(); };
            const duplicateCurrentPage = (keepAnnotations = false) => {
                showAddPageModal.value = false; const src = targetPage.value; if (!src?.photo) return;
                resetZoom(); const sharedPhotoId = src.photoId || ('page_' + src.id); src.photoId = sharedPhotoId; const c = JSON.parse(JSON.stringify(src));
                const newPg = makeEmptyPage({
                    space: src.space || '', docType: src.docType || '', photo: src.photo, photoId: sharedPhotoId, w: src.w || 1200, h: src.h || 900, isSketch: !!src.isSketch, hasGrid: !!src.hasGrid,
                    markers: keepAnnotations ? (c.markers || []) : [], lines: keepAnnotations ? (c.lines || []) : [], walls: keepAnnotations ? (c.walls || []) : [], paths: keepAnnotations ? (c.paths || []) : [], pins: []
                });
                const srcIdx = pages.value.indexOf(src);
                const insertAt = insertPageSmart(newPg, srcIdx >= 0 ? srcIdx : null);
                if (splitMode.value && activePane.value === 'B') pageIndexB.value = insertAt;
                else activePageIndex.value = insertAt;
                dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true; drawMode.value = 'browse'; saveAll();
                showToast(keepAnnotations ? `📑 已複製整頁為 P${insertAt + 1}` : `📄 已複製純淨底圖為 P${insertAt + 1}`);
            };

            const toggleSketchGrid = () => { if (!targetCanvas.value) return; checkBranchNeed(() => { targetCanvas.value.hasGrid = !targetCanvas.value.hasGrid; targetCanvas.value.photo = renderSketchDataUrl(targetCanvas.value.w || 1200, targetCanvas.value.h || 1500, targetCanvas.value.hasGrid); touchDirty(); saveAll(); }); };
            const targetPaneResetZoom = () => { if (splitMode.value && activePane.value === 'B') resetZoomB(); else resetZoom(); };

            const switchPage = (idx, pane = 'A') => {
                if (pane === 'B') { resetZoomB(); showQuickPageNavB.value = false; pageIndexB.value = idx; pinB.value = null; }
                else { resetZoom(); showQuickPageNav.value = false; activePageIndex.value = idx; activePin.value = null; }
                drawMode.value = 'browse';
            };
            const prevPage = (pane = 'A') => { const cur = pane === 'B' ? pageIndexB.value : activePageIndex.value; if (cur > 0) switchPage(cur - 1, pane); };
            const nextPage = (pane = 'A') => { const cur = pane === 'B' ? pageIndexB.value : activePageIndex.value; if (cur < pages.value.length - 1) switchPage(cur + 1, pane); };

            const deleteCurrentPage = () => {
                if (pages.value.length <= 1) return;
                if (prompt(`⚠️ 確認刪除 P${activePageIndex.value + 1}？\n請輸入 "d" 確認：`)?.trim().toLowerCase() !== 'd') return;
                resetZoom(); showQuickPageNav.value = false; const delId = activePage.value.id; project.deletedPageIds ||= [];
                if (!project.deletedPageIds.includes(delId)) project.deletedPageIds.push(delId);
                dirtyPageIds.delete(delId); pages.value.splice(activePageIndex.value, 1);
                activePageIndex.value = Math.max(0, activePageIndex.value - 1);
                pageIndexB.value = Math.min(pageIndexB.value, pages.value.length - 1);
                project.pageOrderUpdatedAt = Date.now(); hasUnsavedCloudChanges.value = true; saveAll();
                if (db && project.code) { const ref = db.collection('site_projects').doc(String(project.code)); ref.collection('pages').doc(delId).delete().catch(() => {}); ref.set({ deletedPageIds: firebase.firestore.FieldValue.arrayUnion(delId), updatedAt: Date.now() }, { merge: true }).catch(() => {}); }
                showToast('🗑️ 已刪除頁面');
            };

            const openPinSubPage = (pin, idx, pane = 'A') => {
                const isB = pane === 'B'; isB ? resetZoomB() : resetZoom(); showQuickPageNav.value = false; showQuickPageNavB.value = false;
                const parentPg = isB ? pageB.value : activePage.value;
                Object.assign(pin, { markers: pin.markers || [], lines: pin.lines || [], walls: pin.walls || [], paths: pin.paths || [], historyStack: [], redoStack: [], w: pin.w || 1200, h: pin.h || 900, space: pin.space || parentPg?.space || '' });
                if (pin.isSketch && !pin.photo) { const size = getAdaptiveCanvasSize(); pin.photo = renderSketchDataUrl(size.w, size.h, !!pin.hasGrid); pin.w = size.w; pin.h = size.h; }
                if (isB) { pinB.value = pin; pinIndexB.value = idx; } else { activePin.value = pin; activePinIndex.value = idx; }
                drawMode.value = 'browse';
            };
            const exitPinSubPage = (pane = 'A') => { if (pane === 'B') { resetZoomB(); pinB.value = null; } else { resetZoom(); activePin.value = null; } drawMode.value = 'browse'; };
            const onPinTap = (pin, index, pane = 'A') => { focusPane(pane); if (drawMode.value === 'eraser') { showToast('📍 落釘受保護，請點入內按「🗑️刪釘」移除'); return; } openPinSubPage(pin, index, pane); };
            const deleteActivePin = async (pane = activePane.value) => {
                const isB = pane === 'B', pObj = isB ? pinB.value : activePin.value, pg = isB ? pageB.value : activePage.value;
                if (!pObj || !pg) return;
                activePane.value = pane;
                checkBranchNeed(async () => {
                    const pinId = String(pObj.id), idx = (pg.pins || []).findIndex(p => String(p.id) === pinId);
                    if (idx !== -1) {
                        const removedPin = JSON.parse(JSON.stringify(pg.pins[idx])); pg.pins.splice(idx, 1); pg.deletedPinIds ||= [];
                        if (!pg.deletedPinIds.includes(pinId)) pg.deletedPinIds.push(pinId); project.deletedPinIds ||= []; if (!project.deletedPinIds.includes(pinId)) project.deletedPinIds.push(pinId);
                        pg.historyStack ||= []; pg.redoStack = []; pg.historyStack.push({ type: 'delete_pin', pin: removedPin, index: idx });
                    }
                    touchDirty(pg); exitPinSubPage(pane); await saveAll(); showToast('🗑️ 已刪釘（按 ↶ 可復原）');
                });
            };

            const resolveMediaDoc = async (doc) => {
                const d = doc.data(); if (!d) return null; if (d.photo) return d.photo;
                if (d.chunked && d.totalChunks > 0) {
                    const snap = await withRetry(() => withTimeout(doc.ref.collection('chunks').get(), 15000));
                    const list = snap.docs.map(c => c.data()).sort((a, b) => (a.index || 0) - (b.index || 0));
                    if (list.length === d.totalChunks) return list.map(c => c.data || '').join('');
                }
                return null;
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
                showPhotoPoolModal.value = false; targetPaneResetZoom();
                if (photoPoolTarget.value === 'newPage') {
                    const cur = targetPage.value;
                    const newPg = makeEmptyPage({ space: cur?.space || '', docType: cur?.docType || 'photo', photo: item.photo, photoId: item.id, w: item.w || 1200, h: item.h || 900 });
                    const insertAt = insertPageSmart(newPg); activePageIndex.value = insertAt; dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true; showToast(`✅ 已建立 P${insertAt + 1}`); drawMode.value = 'browse'; saveAll();
                } else if (targetCanvas.value) {
                    checkBranchNeed(() => { Object.assign(targetCanvas.value, { photo: item.photo, photoId: item.id, w: item.w || 1200, h: item.h || 900, isSketch: false }); touchDirty(); drawMode.value = 'browse'; saveAll(); });
                }
            };


            
            const deleteFromPhotoPool = async (item) => {
                if (!confirm('確定要從底圖庫移除這張照片嗎？')) return;
                const fp = photoFingerprint(item.photo); photoPoolList.value = photoPoolList.value.filter(x => photoFingerprint(x.photo) !== fp); photoPool.value = photoPool.value.filter(x => photoFingerprint(x.photo) !== fp); await saveAll();
                if (db && project.code && item.id) { const mRef = db.collection('site_projects').doc(String(project.code)).collection('media').doc(String(item.id)); mRef.collection('chunks').get().then(s => s.forEach(c => c.ref.delete())).catch(() => {}); mRef.delete().catch(() => {}); }
            };

           const setPageSpace = (sp) => {
                if (editingMetaPage.value) {
                    editingMetaPage.value.space = sp;
                    editingMetaPage.value.updatedAt = Date.now();
                    dirtyPageIds.add(editingMetaPage.value.id);
                    hasUnsavedCloudChanges.value = true;
                    showSpaceModal.value = false;
                    editingMetaPage.value = null;
                    saveAll();
                    return;
                }
                checkBranchNeed(() => { if (targetCanvas.value) targetCanvas.value.space = sp; touchDirty(); showSpaceModal.value = false; saveAll(); });
            };
            
            const addCustomSpace = () => { const s = prompt('輸入空間名稱（例如：閣樓）')?.trim(); if (s) { if (!spaceList.value.includes(s)) spaceList.value.push(s); setPageSpace(s); } };

            const onEraseTap = (targetType, item, e, pane = activePane.value) => {
                focusPane(pane);
                if (drawMode.value !== 'eraser') return;
                if (e.touches?.length > 1 || isPinching || showBranchPrompt.value) return;
                e.preventDefault(); e.stopPropagation(); const targetId = item.id;
                checkBranchNeed(() => {
                    const c = targetCanvas.value; if (!c) return; c.historyStack ||= []; c.redoStack = [];
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

            const makeBlankMarkerData = () => ({ val: '', name: '', customCode: '', targetPageId: '', cadType: '', w_in: '', h_in: '', d_in: '', w: '', d: '', h: '', t: '', h_bottom: '', t_stone: '', d_stone: '', t_frame: '', h_top: '', w_side: '', d_out: '' });

            const createPointMarker = (x, y, forceType) => {
                checkBranchNeed(() => {
                    const c = targetCanvas.value; if (!c) return;
                    c.markers ||= []; c.historyStack ||= []; c.redoStack = [];
                    const markerId = Date.now();
                    const newMarker = { id: markerId, lineId: null, x, y, w: 140, h: 56, type: forceType, textColor: forceType === 'stamp' ? null : defaultTextColor.value, data: makeBlankMarkerData() };
                    updateMarkerSize(newMarker); c.markers.push(newMarker); c.historyStack.push({ type: 'marker', markerId });
                    touchDirty(); activeMarker.value = newMarker;
                    if (forceType === 'stamp') { stampFilter.value = 'all'; focusedInput.value = 'stamp'; showTopSheet.value = true; }
                    else { showTopTextBar.value = true; nextTick(() => topTextInputRef.value?.focus()); }
                    saveAll();
                });
            };

            const placeCadBlockAt = (x, y) => {
                const def = getCadDef(selectedCadType.value);
                if (!def) return;
                checkBranchNeed(() => {
                    const c = targetCanvas.value; if (!c) return;
                    c.markers ||= []; c.historyStack ||= []; c.redoStack = [];
                    const markerId = Date.now();
                    const newMarker = {
                        id: markerId, lineId: null, x, y, w: def.w || 64, h: def.h || 64,
                        type: 'cad', color: drawColor.value, rot: 0, scale: 1, flipX: 1, flipY: 1,
                        data: { ...makeBlankMarkerData(), cadType: selectedCadType.value }
                    };
                    c.markers.push(newMarker);
                    c.historyStack.push({ type: 'marker', markerId });
                    touchDirty(); saveAll();
                });
            };

            const onMarkerPointerStart = (marker, e, pane = activePane.value) => {
                focusPane(pane);
                if (e.touches?.length > 1 || isPinching || showBranchPrompt.value) return;
                if (showQuickPageNav.value) showQuickPageNav.value = false;
                if (showQuickPageNavB.value) showQuickPageNavB.value = false;
                if (drawMode.value === 'eraser') { onEraseTap('marker', marker, e, pane); return; }
                const pt = getClientPoint(e);
                if (drawMode.value === 'move') {
                    e.preventDefault(); e.stopPropagation();
                    checkBranchNeed(() => {
                        const target = (targetCanvas.value.markers || []).find(m => m.id === marker.id) || marker;
                        if (showBranchPrompt.value) return;
                        activeLine.value = null;
                        draggedMarker.value = target; activeMarker.value = target;
                        const p = getCoords(e, pane);
                        dragOrigin.value = { x: p.x, y: p.y }; markerOrigin.value = { x: target.x, y: target.y };
                    });
                    return;
                }
                if (drawMode.value === 'index' && ['space_tag', 'page_link'].includes(marker.type)) {
                    e.preventDefault(); e.stopPropagation();
                    openIndexModalAt(marker.x, marker.y, marker);
                    return;
                }
                if (drawMode.value === 'browse') {
                    pendingTapMarker = { marker, pane, clientX: pt.clientX, clientY: pt.clientY };
                }
            };

            const openMarkerEditor = (m, pane = activePane.value) => {
                focusPane(pane);
                if (m.type === 'page_link' && m.data?.targetPageId) { jumpToPageById(m.data.targetPageId, pane); return; }
                if (m.type === 'space_tag') { openIndexModalAt(m.x, m.y, m); return; }
                activeMarker.value = m;
                if (['text', 'image', 'cad'].includes(m.type)) {
                    showTopTextBar.value = true;
                    if (m.type === 'text') nextTick(() => topTextInputRef.value?.focus());
                } else {
                    if (m.type === 'stamp') stampFilter.value = 'all';
                    showTopSheet.value = true;
                    focusedInput.value = TAG_DEFS[m.type]?.fields[0]?.key || 'val';
                }
            };

            const beginPinch = (t1, t2, pane = 'A') => {
                isPinching = true; pinchPane = pane; isDrawing.value = false; isPanningBrowse = false; pendingTapMarker = null; currentLine.value = null; currentWall.value = null; currentPath.value = '';
                if (draggedMarker.value) { draggedMarker.value.x = markerOrigin.value.x; draggedMarker.value.y = markerOrigin.value.y; draggedMarker.value = null; }
                pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1;
                pinchStartScale = pane === 'B' ? zoomScaleB.value : zoomScale.value;
                pinchAnchorSvg = clientToSvgPoint((t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2, pane);
            };

            const onStageTouchStart = (e, pane = 'A') => {
                focusPane(pane);
                if (showQuickPageNav.value) showQuickPageNav.value = false;
                if (showQuickPageNavB.value) showQuickPageNavB.value = false;
                if (showTopSheet.value || showTopTextBar.value || showIndexModal.value || showBranchPrompt.value) return;
                if (e.touches.length >= 2) { e.preventDefault(); beginPinch(e.touches[0], e.touches[1], pane); return; }
                if (isPinching) return;
                touchStartTime = Date.now(); touchMoved = false;
                if (e.touches.length === 1 && !draggedMarker.value) {
                    if (drawMode.value === 'browse') {
                        isPanningBrowse = true; panPane = pane;
                        panStartClient = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                        panStartVb = pane === 'B' ? { x: vbXB.value, y: vbYB.value } : { x: vbX.value, y: vbY.value };
                    } else if (!['eraser', 'move'].includes(drawMode.value)) beginStroke(e, pane);
                }
            };

            const onStageTouchMove = (e, pane = 'A') => {
                if (showBranchPrompt.value) return;
                if (e.touches.length >= 2) {
                    e.preventDefault(); if (!isPinching) { beginPinch(e.touches[0], e.touches[1], pane); return; }
                    const t1 = e.touches[0], t2 = e.touches[1], curDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) || 1;
                    applyZoomAtClientPoint(pinchStartScale * (curDist / pinchStartDist), (t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2, pinchAnchorSvg, pinchPane);
                    return;
                }
                if (isPinching) return;
                if (e.touches.length === 1) {
                    if (pendingTapMarker && Math.hypot(e.touches[0].clientX - pendingTapMarker.clientX, e.touches[0].clientY - pendingTapMarker.clientY) > 6) pendingTapMarker = null;
                    touchMoved = true;
                    if (isPanningBrowse) { e.preventDefault(); panByClientDelta(e.touches[0].clientX - panStartClient.x, e.touches[0].clientY - panStartClient.y, panPane); }
                    else moveStroke(e, pane);
                }
            };

            const onStageTouchEnd = (e, pane = 'A') => {
                if (e.touches.length === 0) {
                    if (isPinching) { isPinching = false; pinchAnchorSvg = null; return; }
                    if (isPanningBrowse) {
                        isPanningBrowse = false;
                        if (pendingTapMarker) { const { marker, pane: p } = pendingTapMarker; pendingTapMarker = null; openMarkerEditor(marker, p); }
                        return;
                    }
                }
                if (isPinching || showBranchPrompt.value) return;
                if (drawMode.value === 'line' && !touchMoved && (Date.now() - touchStartTime < 260) && e.touches.length === 0) {
                    isDrawing.value = false; currentLine.value = null;
                    const endPos = getCoords(e, pane); createPointMarker(endPos.x, endPos.y, 'stamp'); return;
                }
                if (e.touches.length === 0) endStroke(e, pane);
            };

            const panByClientDelta = (dxClient, dyClient, pane = 'A') => {
                const isB = pane === 'B', svg = isB ? svgCanvasB.value : svgCanvas.value; if (!svg) return;
                const pw = isB ? canvasWB.value : canvasW.value, ph = isB ? canvasHB.value : canvasH.value, zVal = isB ? zoomScaleB.value : zoomScale.value;
                const vw = pw / zVal, vh = ph / zVal, r = svg.getBoundingClientRect(), fitScale = Math.min(r.width / vw, r.height / vh) || 1;
                const nextX = Math.max(0, Math.min(pw - vw, panStartVb.x - dxClient / fitScale)), nextY = Math.max(0, Math.min(ph - vh, panStartVb.y - dyClient / fitScale));
                if (isB) { vbXB.value = nextX; vbYB.value = nextY; } else { vbX.value = nextX; vbY.value = nextY; }
            };

            const onStageMouseDown = (e, pane = 'A') => {
                focusPane(pane);
                if (showQuickPageNav.value) showQuickPageNav.value = false;
                if (showQuickPageNavB.value) showQuickPageNavB.value = false;
                if (showTopSheet.value || showTopTextBar.value || showIndexModal.value || showBranchPrompt.value) return;
                if (e.button === 1 || isSpaceDown || (drawMode.value === 'browse' && !draggedMarker.value)) {
                    e.preventDefault(); isPanningBrowse = true; panPane = pane;
                    panStartClient = { x: e.clientX, y: e.clientY };
                    panStartVb = pane === 'B' ? { x: vbXB.value, y: vbYB.value } : { x: vbX.value, y: vbY.value };
                    return;
                }
                if (!draggedMarker.value && !['browse', 'eraser', 'move'].includes(drawMode.value)) beginStroke(e, pane);
            };
            const onStageMouseMove = (e, pane = 'A') => {
                if (showBranchPrompt.value) return;
                if (pendingTapMarker && Math.hypot(e.clientX - pendingTapMarker.clientX, e.clientY - pendingTapMarker.clientY) > 6) pendingTapMarker = null;
                if (isPanningBrowse) { panByClientDelta(e.clientX - panStartClient.x, e.clientY - panStartClient.y, panPane); return; }
                moveStroke(e, pane);
            };
            const onStageMouseUp = (e, pane = 'A') => {
                if (isPanningBrowse) {
                    isPanningBrowse = false;
                    if (pendingTapMarker) { const { marker, pane: p } = pendingTapMarker; pendingTapMarker = null; openMarkerEditor(marker, p); }
                    return;
                }
                if (!showBranchPrompt.value) endStroke(e, pane);
            };

            const beginStroke = (e, pane = 'A') => {
                isDrawing.value = true; drawingPane.value = pane; startPos.value = getCoords(e, pane);
                if (['line', 'arrow-single', 'straight'].includes(drawMode.value)) currentLine.value = { x1: startPos.value.x, y1: startPos.value.y, x2: startPos.value.x, y2: startPos.value.y };
                else if (drawMode.value === 'wall') currentWall.value = { x1: startPos.value.x, y1: startPos.value.y, x2: startPos.value.x, y2: startPos.value.y, style: wallStyle.value, color: drawColor.value };
                else if (drawMode.value === 'freehand') { tempPoints = [[startPos.value.x, startPos.value.y]]; currentPath.value = `M ${startPos.value.x} ${startPos.value.y}`; }
            };

            const moveStroke = (e, pane = activePane.value) => {
                if (draggedMarker.value) {
                    e.preventDefault(); const p = getCoords(e, pane), dx = p.x - dragOrigin.value.x, dy = p.y - dragOrigin.value.y;
                    draggedMarker.value.x = Math.round(Math.max(0, Math.min(targetCanvasW.value, markerOrigin.value.x + dx)));
                    draggedMarker.value.y = Math.round(Math.max(0, Math.min(targetCanvasH.value, markerOrigin.value.y + dy)));
                } else if (isDrawing.value) {
                    e.preventDefault(); const p = getCoords(e, drawingPane.value);
                    if (drawMode.value === 'line' || drawMode.value === 'arrow-single') { currentLine.value.x2 = p.x; currentLine.value.y2 = p.y; }
                    else if (drawMode.value === 'straight' && currentLine.value) { const snapped = snapWallEnd(currentLine.value.x1, currentLine.value.y1, p.x, p.y); currentLine.value.x2 = snapped.x; currentLine.value.y2 = snapped.y; }
                    else if (drawMode.value === 'wall' && currentWall.value) { const snapped = snapWallEnd(currentWall.value.x1, currentWall.value.y1, p.x, p.y); currentWall.value.x2 = snapped.x; currentWall.value.y2 = snapped.y; }
                    else if (drawMode.value === 'freehand') { tempPoints.push([p.x, p.y]); currentPath.value = `M ${tempPoints.map(pt => `${pt[0]} ${pt[1]}`).join(' L ')}`; }
                }
            };

            const endStroke = (e, pane = drawingPane.value) => {
                if (draggedMarker.value) {
                    const moved = Math.hypot(draggedMarker.value.x - markerOrigin.value.x, draggedMarker.value.y - markerOrigin.value.y) > 2;
                    draggedMarker.value = null;
                    if (moved) { touchDirty(); saveAll(); }
                    return;
                }
                if (!isDrawing.value) return;
                isDrawing.value = false; const endPos = getCoords(e, drawingPane.value);

                if (drawMode.value === 'cad') { currentLine.value = null; currentWall.value = null; currentPath.value = ''; placeCadBlockAt(endPos.x, endPos.y); return; }
                if (drawMode.value === 'index') { currentLine.value = null; currentWall.value = null; currentPath.value = ''; openIndexModalAt(endPos.x, endPos.y, null); return; }

                if (!targetPin.value && drawMode.value === 'pin') {
                    currentLine.value = null; currentWall.value = null; currentPath.value = '';
                    checkBranchNeed(() => {
                        const pg = targetPage.value; if (!pg) return;
                        const pw = pg.w || 1200, ph = pg.h || 900; pg.pins ||= []; pg.historyStack ||= []; pg.redoStack = [];
                        const newPin = { id: 'pin_' + Date.now(), name: `位置 ${pg.pins.length + 1}`, x: parseFloat(((endPos.x / pw) * 100).toFixed(2)), y: parseFloat(((endPos.y / ph) * 100).toFixed(2)), photo: null, photoId: '', w: 1200, h: 900, space: pg.space || '', markers: [], lines: [], walls: [], paths: [], historyStack: [], redoStack: [], updatedAt: Date.now() };
                        pg.pins.push(newPin); pg.historyStack.push({ type: 'pin', pinId: newPin.id });
                        touchDirty(); openPinSubPage(newPin, pg.pins.length - 1, activePane.value); saveAll();
                    });
                    return;
                }

                if (drawMode.value === 'wall' && currentWall.value) {
                    if (Math.hypot(currentWall.value.x2 - currentWall.value.x1, currentWall.value.y2 - currentWall.value.y1) >= 12) {
                        const wSnap = { ...currentWall.value };
                        checkBranchNeed(() => { const c = targetCanvas.value; c.walls ||= []; c.historyStack ||= []; c.redoStack = []; const wallId = Date.now(); c.walls.push({ ...wSnap, id: wallId }); c.historyStack.push({ type: 'wall', wallId }); touchDirty(); saveAll(); });
                    }
                    currentWall.value = null;
                } else if (['line', 'arrow-single', 'straight'].includes(drawMode.value) && currentLine.value) {
                    const lSnap = { ...currentLine.value }; currentLine.value = null;
                    if (drawMode.value === 'line' && Math.hypot(lSnap.x2 - lSnap.x1, lSnap.y2 - lSnap.y1) < 14) { createPointMarker(lSnap.x2, lSnap.y2, 'stamp'); return; }
                    if (Math.hypot(lSnap.x2 - lSnap.x1, lSnap.y2 - lSnap.y1) < 10) return;
                    checkBranchNeed(() => {
                        const c = targetCanvas.value; c.lines ||= []; c.markers ||= []; c.historyStack ||= []; c.redoStack = [];
                        const lineId = Date.now(), markerId = lineId + 1;
                        
                        const lineType = drawMode.value === 'line' ? 'measure' : drawMode.value;
                        c.lines.push({ ...lSnap, id: lineId, type: lineType, color: lineType === 'measure' ? (defaultTextColor.value !== '#ffffff' ? defaultTextColor.value : null) : drawColor.value });
                        
                        if (lineType !== 'measure') { c.historyStack.push({ type: 'line_marker', lineId, markerId: null }); touchDirty(); saveAll(); return; }
                        const newMarker = { id: markerId, lineId, x: Math.round((lSnap.x1 + lSnap.x2) / 2), y: Math.round((lSnap.y1 + lSnap.y2) / 2), w: 140, h: 56, type: 'general', textColor: defaultTextColor.value, data: makeBlankMarkerData() };
                        updateMarkerSize(newMarker); c.markers.push(newMarker); c.historyStack.push({ type: 'line_marker', lineId, markerId });
                        touchDirty(); activeMarker.value = newMarker; focusedInput.value = 'val'; showTopSheet.value = true; saveAll();
                    });
                } else if (drawMode.value === 'freehand' && currentPath.value) {
                    const pSnap = currentPath.value; currentPath.value = '';
                    checkBranchNeed(() => { const c = targetCanvas.value; c.paths ||= []; c.historyStack ||= []; c.redoStack = []; const pathId = Date.now(); c.paths.push({ id: pathId, d: pSnap, color: drawColor.value }); c.historyStack.push({ type: 'freehand', pathId }); touchDirty(); saveAll(); });
                }
            };

            const ensureMarkerBranched = (cb) => { if (activeMarker.value) { checkBranchNeed(() => { activeMarker.value = (targetCanvas.value.markers || []).find(m => m.id === activeMarker.value.id) || activeMarker.value; if (cb) cb(); }); } else if (cb) cb(); };
            const onMarkerTextInput = () => ensureMarkerBranched(() => { updateMarkerSize(activeMarker.value); touchDirty(); });


            
            const applyImageDimensions = (m) => {
                if (m.type !== 'image') return;
                if (!m.baseW) { m.baseW = m.w; m.baseH = m.h; }
                m.w = Math.round(m.baseW * (m.scale || 1) * (m.scaleX || 1));
                m.h = Math.round(m.baseH * (m.scale || 1) * (m.scaleY || 1));
            };
            const setMarkerScale = (val) => {
                if (!activeMarker.value) return;
                const s = Math.max(0.25, Math.min(4.0, Math.round(Number(val) * 100) / 100));
                ensureMarkerBranched(() => { activeMarker.value.scale = s; applyImageDimensions(activeMarker.value); touchDirty(); saveAll(); });
            };
            const setMarkerScaleX = (val) => {
                if (!activeMarker.value) return;
                const sx = Math.max(0.25, Math.min(4.0, Math.round(Number(val) * 100) / 100));
                ensureMarkerBranched(() => { activeMarker.value.scaleX = sx; applyImageDimensions(activeMarker.value); touchDirty(); saveAll(); });
            };
            const setMarkerScaleY = (val) => {
                if (!activeMarker.value) return;
                const sy = Math.max(0.25, Math.min(4.0, Math.round(Number(val) * 100) / 100));
                ensureMarkerBranched(() => { activeMarker.value.scaleY = sy; applyImageDimensions(activeMarker.value); touchDirty(); saveAll(); });
            };
            const nudgeMarker = (dx, dy) => {
                if (!activeMarker.value) return;
                ensureMarkerBranched(() => {
                    const m = activeMarker.value;
                    m.x = Math.round(Math.max(0, Math.min(targetCanvasW.value, (m.x || 0) + dx)));
                    m.y = Math.round(Math.max(0, Math.min(targetCanvasH.value, (m.y || 0) + dy)));
                    touchDirty(); saveAll();
                });
            };
            const resizeImageMarker = (factor) => { if (!activeMarker.value) return; setMarkerScale((activeMarker.value.scale || 1) * factor); };
            const rotateMarker = (deg) => { if (!activeMarker.value) return; ensureMarkerBranched(() => { activeMarker.value.rot = ((activeMarker.value.rot || 0) + deg + 360) % 360; touchDirty(); saveAll(); }); };
            const flipMarker = (axis) => { if (!activeMarker.value) return; ensureMarkerBranched(() => { if (axis === 'x') activeMarker.value.flipX = (activeMarker.value.flipX || 1) * -1; else activeMarker.value.flipY = (activeMarker.value.flipY || 1) * -1; touchDirty(); saveAll(); }); };
            const setCadMarkerColor = (hex) => { drawColor.value = hex; if (!activeMarker.value || activeMarker.value.type !== 'cad') return; ensureMarkerBranched(() => { activeMarker.value.color = hex; touchDirty(); saveAll(); }); };

            
            
            const undoLastAction = () => {
                checkBranchNeed(() => {
                    const c = targetCanvas.value; if (!c?.historyStack?.length) return; c.redoStack ||= [];
                    const act = c.historyStack.pop(), u = { type: act.type };
                    if (act.type === 'line_marker') { const li = c.lines.findIndex(l => l.id === act.lineId); if (li !== -1) u.line = c.lines.splice(li, 1)[0]; if (act.markerId) { const mi = c.markers.findIndex(m => m.id === act.markerId); if (mi !== -1) u.marker = c.markers.splice(mi, 1)[0]; } }
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
                    const c = targetCanvas.value; if (!c?.redoStack?.length) return; const u = c.redoStack.pop(), act = { type: u.type };
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

            const deleteMarkerTop = () => ensureMarkerBranched(() => { const c = targetCanvas.value, m = activeMarker.value; if (!m || !c) return; if (m.lineId) c.lines = (c.lines || []).filter(l => l.id !== m.lineId); c.markers = (c.markers || []).filter(x => x.id !== m.id); if (c.historyStack) c.historyStack = c.historyStack.filter(h => h.markerId !== m.id); c.redoStack = []; touchDirty(); showTopSheet.value = false; showTopTextBar.value = false; activeMarker.value = null; saveAll(); });
            const switchMarkerType = (t, fKey) => ensureMarkerBranched(() => { activeMarker.value.type = t; if (t === 'stamp') stampFilter.value = 'all'; else if (!activeMarker.value.textColor) activeMarker.value.textColor = defaultTextColor.value; focusedInput.value = fKey; updateMarkerSize(activeMarker.value); touchDirty(); });
            const closeTopTextBar = () => { if (['stamp', 'text'].includes(activeMarker.value?.type) && !String(activeMarker.value.data.val || '').trim()) { deleteMarkerTop(); return; } showTopTextBar.value = false; saveAll(); };
            const closeTopSheet = () => { if (activeMarker.value?.type === 'stamp' && !String(activeMarker.value.data.val || '').trim()) { deleteMarkerTop(); return; } showTopSheet.value = false; saveAll(); };

            const handleKeypad = (key) => {
                if (!activeMarker.value || !focusedInput.value) return;
                ensureMarkerBranched(() => {
                    if (focusedInput.value === 'name' || focusedInput.value === 'stamp') focusedInput.value = 'val';
                    const cur = String(activeMarker.value.data[focusedInput.value] || '');
                    if (key === 'DEL') { activeMarker.value.data[focusedInput.value] = cur.slice(0, -1); touchDirty(); }
                    else if (key === 'ENTER') {
                        const def = TAG_DEFS[activeMarker.value.type];
                        if (def) { const idx = def.fields.findIndex(x => x.key === focusedInput.value); idx >= 0 && idx < def.fields.length - 1 ? (focusedInput.value = def.fields[idx + 1].key) : closeTopSheet(); }
                        else closeTopSheet();
                    } else if (cur.length < 6) { activeMarker.value.data[focusedInput.value] = cur + key; touchDirty(); }
                    updateMarkerSize(activeMarker.value);
                });
            };

            const applyTag = (name) => { if (activeMarker.value) ensureMarkerBranched(() => { activeMarker.value.data.name = name; focusedInput.value = 'val'; updateMarkerSize(activeMarker.value); touchDirty(); }); };

            const applyStamp = (stampOrText) => {
                if (!activeMarker.value) return;
                const isObj = typeof stampOrText === 'object' && stampOrText !== null;
                const txt = isObj ? stampOrText.text : String(stampOrText || '');
                const matched = stampItems.value.find(x => x.text === txt);
                const col = isObj ? (stampOrText.color || '#ffffff') : (matched?.color || '#ffffff');
                if (matched) { matched.count = (matched.count || 0) + 1; saveStampStore(); }
                ensureMarkerBranched(() => {
                    if (activeMarker.value.lineId) { targetCanvas.value.lines = (targetCanvas.value.lines || []).filter(l => l.id !== activeMarker.value.lineId); activeMarker.value.lineId = null; }
                    activeMarker.value.type = 'stamp'; activeMarker.value.textColor = col; activeMarker.value.data.val = txt;
                    updateMarkerSize(activeMarker.value); touchDirty(); closeTopSheet();
                });
            };

            const updateMarkerSize = (m) => {
                if (m.type === 'image' || m.type === 'cad') return;
                const lines = getMarkerLines(m);
                const fPx = getMarkerFontPx(m);
                const maxW = Math.max(24, ...lines.map(l => measureStrWidth(l, fPx)));
                m.w = Math.max(36, Math.round(maxW + 10));
                m.h = Math.max(22, Math.round(lines.length * (fPx * 1.2) + 6));
            };

            const getStampColor = (m) => {
                if (m.textColor) return m.textColor;
                if (m.type === 'space_tag') return '#a855f7';
                if (m.type === 'page_link') return '#38bdf8';
                if (m.type === 'stamp') { const found = stampItems.value.find(x => x.text === m.data?.val); if (found?.color) return found.color; }
                return '#ffffff';
            };

            const getTagFields = (t) => TAG_DEFS[t]?.fields || [];
            const getMarkerLines = (m) => {
                const def = TAG_DEFS[m.type];
                if (def) return [def.title, ...def.fields.filter(f => m.data[f.key]).map(f => `${f.label}:${m.data[f.key]}`)];
                if (['stamp', 'text', 'space_tag', 'page_link'].includes(m.type)) return [m.data.val || ''];
                return [`${m.data.name ? m.data.name + ': ' : ''}${m.data.val || ''}`];
            };

            const compressImage = (file) => new Promise((res) => {
                const reader = new FileReader(); reader.readAsDataURL(file);
                reader.onload = (e) => { const img = new Image(); img.src = e.target.result; img.onload = () => { const c = document.createElement('canvas'), MAX = 1280; let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height; if (w > MAX || h > MAX) { if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } } c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); res({ b64: c.toDataURL('image/jpeg', 0.72), w, h }); }; };
            });

            const handleImageUpload = async (e, asNewPage = false, presetDocType = '') => {
                const rawFiles = Array.from(e.target.files || []); if (!rawFiles.length) return;
                showAddPageModal.value = false; targetPaneResetZoom();
                const files = targetPin.value ? [rawFiles[0]] : rawFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
                const isBatch = files.length > 1; if (isBatch) { isProcessing.value = true; processingText.value = `準備匯入 ${files.length} 張圖紙...`; }
                const curPg = targetPage.value;
                const inheritSpace = curPg?.space || '';
                const resolvedDocType = presetDocType || curPg?.docType || 'photo';
                let insertCursor = curPg ? pages.value.indexOf(curPg) : pages.value.length - 1;
                let firstAddedIdx = -1;
                try {
                    for (let i = 0; i < files.length; i++) {
                        if (isBatch) processingText.value = `正在匯入第 ${i + 1} / ${files.length} 張圖紙...`;
                        const res = await compressImage(files[i]); const photoId = `img_${Date.now()}_${i}_${Math.floor(Math.random() * 999)}`;
                        photoPool.value.push({ id: photoId, photo: res.b64, w: res.w, h: res.h, author: authorName.value || '', updatedAt: Date.now() });
                        if (i === 0 && !asNewPage && targetCanvas.value && !targetCanvas.value.photo) {
                            checkBranchNeed(() => {
                                Object.assign(targetCanvas.value, { photo: res.b64, photoId, w: res.w, h: res.h, isSketch: false, docType: targetCanvas.value.docType || resolvedDocType });
                                touchDirty();
                                firstAddedIdx = (splitMode.value && activePane.value === 'B') ? pageIndexB.value : activePageIndex.value;
                            });
                            if (showBranchPrompt.value) await new Promise(r => { const timer = setInterval(() => { if (!showBranchPrompt.value) { clearInterval(timer); r(); } }, 200); });
                        } else {
                            const newPg = makeEmptyPage({ space: inheritSpace, docType: resolvedDocType, photo: res.b64, photoId, w: res.w, h: res.h });
                            const placedIdx = insertPageSmart(newPg, insertCursor >= 0 ? insertCursor : null);
                            insertCursor = placedIdx;
                            dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true;
                            if (firstAddedIdx === -1) firstAddedIdx = placedIdx;
                        }
                    }
                    if (firstAddedIdx !== -1 && !targetPin.value) { if (splitMode.value && activePane.value === 'B') pageIndexB.value = firstAddedIdx; else activePageIndex.value = firstAddedIdx; }
                    drawMode.value = 'browse'; await saveAll(); if (isBatch) showToast(`✅ 已匯入 ${files.length} 張圖紙`);
                } finally { isProcessing.value = false; e.target.value = ''; }
            };

            

            const processPastedBlob = async (blob, forceNewPage) => {
                showAddPageModal.value = false; isProcessing.value = true; processingText.value = '正在處理貼上圖片...';
                try {
                    const res = await compressImage(blob), photoId = 'img_' + Date.now() + '_' + Math.floor(Math.random() * 999);
                    photoPool.value.push({ id: photoId, photo: res.b64, w: res.w, h: res.h, author: authorName.value || '', updatedAt: Date.now() });
                    if (forceNewPage || !targetCanvas.value?.photo) {
                        targetPaneResetZoom();
                        if (!forceNewPage && !targetCanvas.value?.photo) checkBranchNeed(() => { Object.assign(targetCanvas.value, { photo: res.b64, photoId, w: res.w, h: res.h, isSketch: false }); touchDirty(); });
                        else { const newPg = makeEmptyPage({ photo: res.b64, photoId, w: res.w, h: res.h }); pages.value.push(newPg); activePageIndex.value = pages.value.length - 1; dirtyPageIds.add(newPg.id); hasUnsavedCloudChanges.value = true; }
                        showToast('✅ 貼上為底圖');
                    } else {
                        checkBranchNeed(() => {
                            const c = targetCanvas.value; c.markers ||= []; c.historyStack ||= []; c.redoStack = [];
                            let tw = res.w, th = res.h; const maxS = Math.min(targetCanvasW.value, targetCanvasH.value) * 0.7;
                            if (tw > maxS || th > maxS) { if (tw > th) { th = Math.round(th * maxS / tw); tw = maxS; } else { tw = Math.round(tw * maxS / th); th = maxS; } }
                            const isB = splitMode.value && activePane.value === 'B', zVal = isB ? zoomScaleB.value : zoomScale.value, vx = isB ? vbXB.value : vbX.value, vy = isB ? vbYB.value : vbY.value;
                            const vw = targetCanvasW.value / zVal, vh = targetCanvasH.value / zVal, markerId = Date.now();
                            const newMarker = { id: markerId, x: Math.round(vx + vw / 2), y: Math.round(vy + vh / 2), w: tw, h: th, baseW: tw, baseH: th, scale: 1, rot: 0, type: 'image', data: { b64: res.b64 } };
                            c.markers.push(newMarker); c.historyStack.push({ type: 'marker', markerId }); activeMarker.value = newMarker; showTopTextBar.value = true; touchDirty(); showToast('✅ 貼圖成功（可用滑桿調大細）');
                        });
                    }
                    drawMode.value = 'browse'; await saveAll();
                } catch (_) { showToast('貼上失敗，請確定複製的是圖片'); } finally { isProcessing.value = false; }
            };

            const pasteFromClipboard = async (forceNewPage = false) => { try { const items = await navigator.clipboard.read(); for (const item of items) { if (item.types.some(t => t.startsWith('image/'))) { await processPastedBlob(await item.getType(item.types.find(t => t.startsWith('image/'))), forceNewPage); return; } } showToast('剪貼簿內無圖片'); } catch (_) { showToast('請使用 Ctrl+V (或 Cmd+V) 貼上'); } };
            const handleGlobalPaste = async (e) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                // 若正在開啟 CAD 圖庫管理視窗，Ctrl+V 直接貼成新圖案預覽
                if (showCadManager.value) {
                    for (let i = 0; i < items.length; i++) {
                        if (items[i].type.indexOf('image') !== -1) {
                            e.preventDefault();
                            newCadImgB64.value = await compressCadIcon(items[i].getAsFile());
                            showToast('✅ 已貼上圖案，輸入名稱後按「加入」');
                            return;
                        }
                    }
                }
                if (currentView.value !== 'proj' || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf('image') !== -1) { e.preventDefault(); await processPastedBlob(items[i].getAsFile(), false); return; }
                }
            };
            const handleGlobalKeydown = (e) => {
                if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) isSpaceDown = true;
                if (fullScreenIndex.value === -1) return;
                if (e.key === 'ArrowLeft') { e.preventDefault(); prevFullScreen(); }
                else if (e.key === 'ArrowRight') { e.preventDefault(); nextFullScreen(); }
                else if (e.key === 'Escape') { e.preventDefault(); fullScreenIndex.value = -1; }
            };
            const handleGlobalKeyup = (e) => { if (e.code === 'Space') isSpaceDown = false; };

            const saveAll = async () => {
                const code = String(project.code || '').trim(); if (!code) return;
                if (currentUser.value?.uid && !project.ownerId) project.ownerId = currentUser.value.uid;
                const cleanPages = JSON.parse(JSON.stringify(pages.value || [])).map(pg => { delete pg.historyStack; delete pg.redoStack; (pg.pins || []).forEach(p => { delete p.historyStack; delete p.redoStack; }); return pg; });
                const hasPending = hasUnsavedCloudChanges.value || dirtyPageIds.size > 0;
                await localforage.setItem('proj_' + code, { code, name: String(project.name || ''), date: String(project.date || ''), ownerId: String(project.ownerId || ''), pages: cleanPages, photoPool: JSON.parse(JSON.stringify(photoPool.value || [])), deletedPageIds: JSON.parse(JSON.stringify(project.deletedPageIds || [])), deletedPinIds: JSON.parse(JSON.stringify(project.deletedPinIds || [])), pageOrderUpdatedAt: Number(project.pageOrderUpdatedAt || 0), updatedAt: Date.now(), lastSyncAt: Number(project.lastSyncAt || 0), lastModifiedBy: String(project.lastModifiedBy || authorName.value || ''), pendingUpload: hasPending });
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
                    const pd = projDoc.data(); if (pd.name) project.name = pd.name; if (pd.date) project.date = pd.date; if (pd.lastModifiedBy) project.lastModifiedBy = pd.lastModifiedBy; if (pd.ownerId) project.ownerId = pd.ownerId;
                    const deletedSet = new Set([...(project.deletedPageIds || []), ...(pd.deletedPageIds || [])]); project.deletedPageIds = [...deletedSet];
                    const deletedPins = new Set([...(project.deletedPinIds || []).map(String), ...((pd.deletedPinIds || []).map(String))]); project.deletedPinIds = [...deletedPins];
                    const cloudPages = pagesSnap.docs.map(doc => { const r = doc.data(); return makeEmptyPage({ id: doc.id, ...r, date: r.date || pd.date || getTodayStr(), photo: (r.photoId && mediaMap.get(r.photoId)?.photo) || mediaMap.get('page_' + (r.id || doc.id))?.photo || r.photo || null, pins: (r.pins || []).map(pin => ({ ...pin, photo: (pin.photoId && mediaMap.get(pin.photoId)?.photo) || mediaMap.get(String(pin.id))?.photo || pin.photo || null })) }); });
                    const localOrderNewer = (project.pageOrderUpdatedAt || 0) > (pd.pageOrderUpdatedAt || 0); if (!localOrderNewer && pd.pageOrderUpdatedAt) project.pageOrderUpdatedAt = pd.pageOrderUpdatedAt;
                    const orderList = localOrderNewer ? [...pages.value.map(p => p.id), ...(pd.pageIds || [])] : [...(pd.pageIds || []), ...pages.value.map(p => p.id)];
                    const merged = mergePagesSmart(pages.value, cloudPages, deletedSet, orderList);
                    if (merged.length) {
                        pages.value = merged;
                        if (activePageIndex.value >= pages.value.length) activePageIndex.value = pages.value.length - 1;
                        if (pageIndexB.value >= pages.value.length) pageIndexB.value = pages.value.length - 1;
                        if (activePin.value && activePage.value) activePin.value = (activePage.value.pins || []).find(p => String(p.id) === String(activePin.value.id)) || null;
                        if (pinB.value && pageB.value) pinB.value = (pageB.value.pins || []).find(p => String(p.id) === String(pinB.value.id)) || null;
                    }
                    project.lastSyncAt = Date.now(); if (dirtyPageIds.size === 0 && !hasUnsavedCloudChanges.value) hasUnsavedCloudChanges.value = false;
                    await saveAll(); cloudSyncState.value = hasUnsavedCloudChanges.value ? 'queued' : 'ready';
                } catch (e) { cloudSyncState.value = navigator.onLine ? 'queued' : 'offline'; if (throwErr) throw e; }
            };

            const startRealtimeListener = (code) => {
                if (unsubPages) { unsubPages(); unsubPages = null; }
                if (unsubFeedback) { unsubFeedback(); unsubFeedback = null; }
                if (!db || !code) return;
                let first = true;
                unsubPages = db.collection('site_projects').doc(String(code)).collection('pages').onSnapshot(async (snap) => {
                    if (first) { first = false; return; }
                    if (isPushing || currentView.value === 'dir' || snap.metadata.hasPendingWrites || isDrawing.value || isPinching || showTopSheet.value || showTopTextBar.value || showIndexModal.value) return;
                    await pullAndMergeFromCloud(code, false); showToast('🔄 已同步最新圖紙');
                }, () => {});

                let fbFirst = true;
                unsubFeedback = db.collection('site_projects').doc(String(code)).collection('feedback').orderBy('createdAt', 'desc').onSnapshot((snap) => {
                    feedbackList.value = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    if (!fbFirst && snap.docChanges().some(c => c.type === 'added')) showToast('💬 收到師傅/業主新留言批註！');
                    fbFirst = false;
                }, () => {});
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
                const projPatch = { code, name: projObj.name || '', date: projObj.date || getTodayStr(), pageIds: rawPages.map(p => p.id), pageOrderUpdatedAt: projObj.pageOrderUpdatedAt || now, deletedPageIds: projObj.deletedPageIds?.length ? firebase.firestore.FieldValue.arrayUnion(...projObj.deletedPageIds) : [], deletedPinIds: projObj.deletedPinIds?.length ? firebase.firestore.FieldValue.arrayUnion(...projObj.deletedPinIds) : [], updatedAt: now };
                const ownerUid = projObj.ownerId || currentUser.value?.uid;
                if (ownerUid) projPatch.ownerId = ownerUid;
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
                    const now = await pushProjectPayload({ code, name: project.name, date: project.date, ownerId: project.ownerId, pages: pages.value, deletedPageIds: project.deletedPageIds, deletedPinIds: project.deletedPinIds, pageOrderUpdatedAt: project.pageOrderUpdatedAt, lastSyncAt: project.lastSyncAt }, true, onProgress);
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
                if (isAutoQueueing || !navigator.onLine || !db || isDrawing.value || isPinching || showTopSheet.value || showTopTextBar.value || showIndexModal.value || showBranchPrompt.value) return;
                const queue = (await localforage.getItem('pending_upload_queue')) || []; if (!queue.length) return; isAutoQueueing = true;
                try {
                    for (const qCode of [...queue]) {
                        if (!navigator.onLine) break;
                        if (currentView.value !== 'dir' && String(project.code) === String(qCode)) { await pullAndMergeFromCloud(qCode, false); await pushToCloud(true); await createCloudBackup(qCode); if (!silent) showToast(`✅ 已自動上傳`); }
                        else { const saved = await localforage.getItem('proj_' + qCode); if (!saved) { await updateQueue(qCode, false); continue; } saved.lastSyncAt = await pushProjectPayload(saved, false, null); saved.pendingUpload = false; await localforage.setItem('proj_' + qCode, saved); await createCloudBackup(qCode); if (!silent) showToast(`✅ 背景自動同步完成`); }
                    }
                    if (currentView.value === 'dir') await loadProjectList();
                } catch (_) {} finally { isAutoQueueing = false; }
            };
const forceSyncToCloud = async () => {
                if (!navigator.onLine) return showToast('📴 目前無網絡連線，無法同步');
                if (!db) return showToast('雲端資料庫未就緒');
                if (isProcessing.value || isPushing) return showToast('⏳ 系統正在同步中，請稍候');
                isProcessing.value = true;
                processingText.value = '正在強制同步相片與圖紙至雲端...';
                try {
                    if (currentView.value === 'proj' && project.code) {
                        await clearLocalMediaCacheForCode(project.code);
                        pages.value.forEach(p => dirtyPageIds.add(p.id));
                        markProjectChanged();
                        await saveAll();
                        await pushToCloud(true, (st) => { processingText.value = st; });
                        await pullAndMergeFromCloud(project.code, false);
                    } else {
                        await processPendingUploadQueue(false);
                        for (const item of projectList.value) {
                            const saved = await localforage.getItem('proj_' + item.code);
                            if (saved && (!saved.lastModifiedBy || saved.lastModifiedBy === authorName.value)) {
                                await clearLocalMediaCacheForCode(item.code);
                                saved.lastSyncAt = await pushProjectPayload(saved, false, (st) => { processingText.value = `${item.name || item.code}: ${st}`; });
                                saved.pendingUpload = false;
                                await localforage.setItem('proj_' + item.code, saved);
                            }
                        }
                        await syncUserOwnedProjects();
                    }
                    await syncUserLibrariesCloud(true);
                    await loadProjectList();
                    showToast('✅ 同步完成！所有相片及修改已更新');
                } catch (e) {
                    alert('同步失敗：' + e.message);
                } finally {
                    isProcessing.value = false;
                }
            };
            const createNewProject = async () => {
                await checkAuthorName(); resetZoom(); const today = getTodayStr(), firstPg = makeEmptyPage({ date: today });
                Object.assign(project, { code: Math.floor(100000 + Math.random() * 900000).toString(), name: '', date: today, ownerId: currentUser.value?.uid || '', deletedPageIds: [], deletedPinIds: [], pageOrderUpdatedAt: Date.now(), lastSyncAt: 0, lastModifiedBy: authorName.value });
                pages.value = [firstPg]; photoPool.value = []; feedbackList.value = []; activePageIndex.value = 0; activePin.value = null; pageIndexB.value = 0; pinB.value = null; splitMode.value = false; activePane.value = 'A'; dirtyPageIds.clear(); dirtyPageIds.add(firstPg.id); hasUnsavedCloudChanges.value = true;
                cloudSyncState.value = navigator.onLine ? 'queued' : 'offline'; currentView.value = 'proj'; await saveAll(); startRealtimeListener(project.code);
            };
            const copyCode = (code) => { navigator.clipboard?.writeText(code); showToast('已複製編號'); showManageModal.value = false; };
            const loadProject = async (code, openAsPreview = true) => {
                resetZoom(); showQuickPageNav.value = false; selectMode.value = false; selectedPageIds.value = []; splitMode.value = false; activePane.value = 'A'; code = String(code); project.code = code; project.deletedPageIds = []; project.deletedPinIds = []; project.pageOrderUpdatedAt = 0; pages.value = []; photoPool.value = []; feedbackList.value = []; dirtyPageIds.clear();
                const d = await localforage.getItem('proj_' + code);
                if (d) { Object.assign(project, { name: d.name || '', date: d.date || '', ownerId: d.ownerId || currentUser.value?.uid || '', deletedPageIds: d.deletedPageIds || [], deletedPinIds: d.deletedPinIds || [], pageOrderUpdatedAt: d.pageOrderUpdatedAt || 0, lastSyncAt: d.lastSyncAt || 0, lastModifiedBy: d.lastModifiedBy || '' }); if (d.pages?.length) pages.value = d.pages.map(pg => makeEmptyPage(pg)); if (d.photoPool) photoPool.value = d.photoPool; hasUnsavedCloudChanges.value = !!d.pendingUpload; } else hasUnsavedCloudChanges.value = false;
                activePageIndex.value = 0; activePin.value = null; pageIndexB.value = 0; pinB.value = null; currentView.value = openAsPreview ? 'preview' : 'proj';
                await pullAndMergeFromCloud(code, false); if (!pages.value.length) pages.value = [makeEmptyPage()]; drawMode.value = 'browse'; startRealtimeListener(code);
            };
const openProjectMap = async (proj) => {
                if (!proj) return;
                const launch = (url, label) => {
                    showToast(`🗺️ 正在開啟地圖：${label || ''}`);
                    const a = document.createElement('a');
                    a.href = url;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                };
                if (proj.mapUrl) { launch(proj.mapUrl, proj.name); return; }
                const rawName = String(proj.name || '').trim();
                if (/^https?:\/\//i.test(rawName)) { launch(rawName, '自訂連結'); return; }

                // 自動清理：1.去日期字頭 -> 2.去圖紙備註 -> 3.去樓層/單位/室號 -> 4.鎖定香港
                let cleanAddr = rawName
                    .replace(/^\d{6,8}[\s\-_]*/, '')
                    .replace(/[\s\-_]*(傢俬圖|平面圖|施工圖|度尺|報價|現場|工程|設計|修改|副本|\(.*?\)|（.*?）)+$/g, '')
                    .replace(/(\d+|[一二三四五六七八九十百]+)[樓層Ff].*$/g, '')
                    .replace(/[A-Za-z0-9]+室$/g, '')
                    .replace(/[\s\-_]*\d+[\-\/]\d+[A-Za-z]?$/g, '')
                    .trim();

                if (cleanAddr) {
                    const finalQuery = /香港|Hong\s*Kong/i.test(cleanAddr) ? cleanAddr : `香港 ${cleanAddr}`;
                    launch(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(finalQuery)}`, cleanAddr);
                    return;
                }
                const input = prompt('此工程尚未輸入地址，請輸入地址或貼上 Google Maps 連結：')?.trim();
                if (!input) return;
                const code = String(proj.code), d = await localforage.getItem('proj_' + code);
                if (/^https?:\/\//i.test(input)) {
                    proj.mapUrl = input;
                    if (d) { d.mapUrl = input; await localforage.setItem('proj_' + code, d); }
                    launch(input, '自訂連結');
                } else {
                    proj.name = input;
                    if (d) { d.name = input; d.pendingUpload = true; await localforage.setItem('proj_' + code, d); await updateQueue(code, true); }
                    const finalQuery = /香港|Hong\s*Kong/i.test(input) ? input : `香港 ${input}`;
                    launch(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(finalQuery)}`, input);
                }
            };

            
            const openManageMenu = (proj) => { manageProj.value = proj; showManageModal.value = true; };
            const renameProject = async () => {
                const newName = prompt('請輸入新的地址 / 名稱：', manageProj.value.name);
                if (newName !== null) { const trimmed = newName.trim(), code = String(manageProj.value.code), d = await localforage.getItem('proj_' + code); if (d) { d.name = trimmed; d.pendingUpload = true; await localforage.setItem('proj_' + code, d); await updateQueue(code, true); } manageProj.value.name = trimmed; if (db && navigator.onLine) db.collection('site_projects').doc(code).set({ name: trimmed, updatedAt: Date.now() }, { merge: true }).catch(() => {}); await loadProjectList(); showToast('✅ 已更新地址'); }
            };
            const duplicateProject = async () => { const d = await localforage.getItem('proj_' + manageProj.value.code); if (!d) return; const newCode = Math.floor(100000 + Math.random() * 900000).toString(); d.code = newCode; d.name = (d.name || '工程') + ' (副本)'; d.ownerId = currentUser.value?.uid || ''; d.lastSyncAt = 0; d.pendingUpload = true; await localforage.setItem('proj_' + newCode, d); await updateQueue(newCode, true); showManageModal.value = false; await loadProjectList(); showToast('✅ 已複製為新檔'); };
            const batchDeleteDocs = async (docs) => { for (let i = 0; i < docs.length; i += 400) { const b = db.batch(); docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit(); } };
            const clearLocalMediaCacheForCode = async (code) => { const prefix = `synced_media_${code}_`; const keys = await localforage.keys(); for (const k of keys) { if (k.startsWith(prefix)) await localforage.removeItem(k); } };
            const removeProjectLocalOnly = async (code) => {
                code = String(code || '').trim();
                if (!code) return;
                if (!confirm('確定只從「本機目錄」移除此工程嗎？\n（雲端備份會完整保留，不再作無謂同步；日後有需要可到右上角「☁️ 雲端」重新下載）')) return;
                await localforage.removeItem('proj_' + code);
                await clearLocalMediaCacheForCode(code);
                await updateQueue(code, false);
                const hidden = (await localforage.getItem('local_hidden_projects')) || [];
                if (!hidden.includes(code)) {
                    hidden.push(code);
                    await localforage.setItem('local_hidden_projects', hidden);
                }
                showManageModal.value = false;
                await loadProjectList();
                showToast('📱 已從本機移除（雲端仍保留，不再背景同步）');
            };
            
            const deleteProject = async (code) => {
                if (prompt('⚠️ 輸入 "dd" 確認刪除此工程：')?.trim().toLowerCase() !== 'dd') return; isProcessing.value = true; processingText.value = '正在徹底刪除工程...';
                try { await localforage.removeItem('proj_' + code); await clearLocalMediaCacheForCode(code); await updateQueue(code, false); if (db && navigator.onLine) { const ref = db.collection('site_projects').doc(String(code)); const delCol = async (sub) => { const snap = await ref.collection(sub).get(); if (sub === 'media') { for (const doc of snap.docs) await batchDeleteDocs((await doc.ref.collection('chunks').get()).docs); } await batchDeleteDocs(snap.docs); }; await Promise.all([delCol('pages'), delCol('media'), delCol('backups'), delCol('feedback')]); await ref.delete(); } showManageModal.value = false; await loadProjectList(); showToast('🗑️ 已徹底刪除'); } catch (e) { alert('清理異常：' + e.message); } finally { isProcessing.value = false; }
            };

            // 🧹 垃圾庫清單預覽 ＆ 確認徹底清除
            const showGarbagePreviewModal = (items, totalBytes, onConfirm) => {
                const old = document.getElementById('garbage-preview-modal');
                if (old) old.remove();
                const mb = (totalBytes / (1024 * 1024)).toFixed(2);
                const overlay = document.createElement('div');
                overlay.id = 'garbage-preview-modal';
                overlay.style.cssText = 'position:fixed;inset:0;z-index:110;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:16px;';
              const rowsHtml = items.map((it, idx) => `
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
            ${it.thumbUrl ? `<img data-zoom-idx="${idx}" src="${it.thumbUrl}" title="點擊放大預覽" style="width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #d1d5db;background:#fff;flex-shrink:0;cursor:zoom-in;">` : ''}
            <div style="min-width:0;flex:1;">
                <div style="font-size:12px;font-weight:900;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${it.title}</div>
                <div style="font-size:11px;color:#6b7280;font-weight:700;margin-top:2px;">${it.desc}${it.thumbUrl ? ' · <span style="color:#2563eb;">撳圖放大</span>' : ''}</div>
            </div>
            <span style="font-size:11px;font-weight:900;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;padding:2px 6px;border-radius:6px;white-space:nowrap;">${it.sizeLabel}</span>
        </div>
    `).join('');
    overlay.innerHTML = `
        <div style="background:#fff;border:1px solid #d1d5db;border-radius:14px;width:100%;max-width:420px;max-height:82vh;display:flex;flex-direction:column;padding:16px;box-shadow:0 20px 25px -5px rgba(0,0,0,0.2);">
            <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin-bottom:10px;">
                <div style="font-size:15px;font-weight:900;color:#111827;">🧹 雲端垃圾庫清單 (${items.length} 項)</div>
                <span style="font-size:11px;font-weight:900;color:#1d4ed8;background:#eff6ff;padding:2px 8px;border-radius:99px;">可釋放約 ${mb} MB</span>
            </div>
            <div style="font-size:11px;color:#4b5563;font-weight:700;margin-bottom:8px;">以下均為已刪除工程的殘留碎片，或所有現存圖紙均無使用的廢棄舊相片：</div>
            <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px;">${rowsHtml}</div>
            <div style="display:flex;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid #e5e7eb;">
                <button id="gp-cancel" style="flex:1;background:#fff;border:1px solid #d1d5db;color:#374151;padding:10px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;">取消 (保留不動)</button>
                <button id="gp-confirm" style="flex:1;background:#dc2626;border:none;color:#fff;padding:10px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;">🗑️ 確認徹底清除</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#gp-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#gp-confirm').onclick = async () => { overlay.remove(); await onConfirm(); };
    overlay.querySelectorAll('img[data-zoom-idx]').forEach(img => {
        img.onclick = () => {
            const zoom = document.createElement('div');
            zoom.style.cssText = 'position:fixed;inset:0;z-index:120;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;cursor:zoom-out;';
            zoom.innerHTML = `<img src="${img.src}" style="max-width:95vw;max-height:82vh;border-radius:8px;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,0.5);"><div style="color:#fff;font-size:12px;font-weight:700;margin-top:10px;">點擊任意位置關閉預覽</div>`;
            zoom.onclick = () => zoom.remove();
            document.body.appendChild(zoom);
        };
    });
};




                

const cleanCloudGarbage = async () => {
                if (!db || !navigator.onLine) return alert('請檢查網路連線');
                isProcessing.value = true; processingText.value = '正在逐個工程掃描雲端垃圾清單...';
                try {
                    const projSnap = await withTimeout(db.collection('site_projects').get(), 15000);
                    const activeProjMap = new Map();
                    projSnap.docs.forEach(d => activeProjMap.set(d.id, d.data() || {}));

                    const previewItems = [];
                    const orphanMediaDocs = [];
                    let totalBytes = 0;
                    const safeCutoff = Date.now() - 5 * 60 * 1000;

                    for (let i = 0; i < projSnap.docs.length; i++) {
                        const pDoc = projSnap.docs[i];
                        const code = pDoc.id;
                        const pName = pDoc.data()?.name || `#${code}`;
                        processingText.value = `正在掃描 (${i + 1}/${projSnap.docs.length})：${pName}...`;

                        const [pgSnap, mSnap] = await Promise.all([
                            withTimeout(pDoc.ref.collection('pages').get(), 12000),
                            withTimeout(pDoc.ref.collection('media').get(), 12000)
                        ]);

                        const usedSet = new Set();
                        pgSnap.docs.forEach(pgDoc => {
                            const pg = pgDoc.data() || {};
                            if (pg.photoId) usedSet.add(String(pg.photoId));
                            usedSet.add('page_' + (pg.id || pgDoc.id));
                            (pg.pins || []).forEach(pin => {
                                if (pin.photoId) usedSet.add(String(pin.photoId));
                                if (pin.id) usedSet.add(String(pin.id));
                            });
                        });

                        mSnap.docs.forEach(mDoc => {
                            const mData = mDoc.data() || {};
                            if (!usedSet.has(String(mDoc.id)) && (!mData.updatedAt || mData.updatedAt < safeCutoff)) {
                                const bLen = mData.byteLen || 150000;
                                totalBytes += bLen;
                                orphanMediaDocs.push(mDoc);
                          const dt = mData.updatedAt ? new Date(mData.updatedAt).toLocaleDateString() : '舊相片';
                    const thumbUrl = Object.values(mData).find(v => typeof v === 'string' && (v.startsWith('data:image') || v.startsWith('http'))) || '';
                    previewItems.push({
                        title: `🖼️ 無用舊底圖 (${pName})`,
                        desc: `建立於 ${dt} · 現存頁面均未引用`,
                        sizeLabel: `${Math.max(1, Math.round(bLen / 1024))} KB`,
                        thumbUrl
                    });
                            }
                        });
                    }

                    const lKeys = await localforage.keys();
                    const deadLocalKeys = [];
                    for (const k of lKeys) {
                        if (k.startsWith('synced_media_')) {
                            const cPart = k.split('_')[2];
                            if (cPart && !activeProjMap.has(cPart) && !(await localforage.getItem('proj_' + cPart))) {
                                deadLocalKeys.push(k);
                            }
                        }
                    }
                    if (deadLocalKeys.length) {
                        previewItems.push({
                            title: `📱 本機過期索引快取`,
                            desc: `共 ${deadLocalKeys.length} 筆已失效紀錄`,
                            sizeLabel: `${deadLocalKeys.length} 筆`
                        });
                    }

                    isProcessing.value = false;

                    if (!previewItems.length) {
                        showToast('✨ 雲端與本機非常乾淨，無任何垃圾碎片！');
                        return;
                    }

                    showGarbagePreviewModal(previewItems, totalBytes, async () => {
                        isProcessing.value = true;
                        processingText.value = `正在徹底清除 ${previewItems.length} 項垃圾...`;
                        try {
                            for (let i = 0; i < orphanMediaDocs.length; i++) {
                                processingText.value = `正在清除相片碎片 (${i + 1}/${orphanMediaDocs.length})...`;
                                const mDoc = orphanMediaDocs[i];
                                const cSnap = await withTimeout(mDoc.ref.collection('chunks').get(), 15000);
                                if (cSnap.docs.length) await batchDeleteDocs(cSnap.docs);
                                await mDoc.ref.delete();
                            }
                            for (const k of deadLocalKeys) await localforage.removeItem(k);
                            showToast(`🧹 已徹底清理 ${previewItems.length} 項垃圾，釋放約 ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
                        } catch (err) {
                            alert('清理過程發生異常：' + err.message);
                        } finally {
                            isProcessing.value = false;
                        }
                    });
                } catch (e) {
                    isProcessing.value = false;
                    alert('掃描失敗：' + e.message);
                }
            };

            const openBackupList = async () => { showManageModal.value = false; isProcessing.value = true; processingText.value = '正在搜尋備份...'; try { const snaps = await withTimeout(db.collection('site_projects').doc(manageProj.value.code).collection('backups').get(), 15000); backupList.value = snaps.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); showBackupListModal.value = true; } catch (e) { alert('讀取失敗：' + e.message); } finally { isProcessing.value = false; } };
            const restoreBackup = async (bkId) => {
                isProcessing.value = true; processingText.value = '正在還原紀錄...';
                try {
                    const doc = await withTimeout(db.collection('site_projects').doc(manageProj.value.code).collection('backups').doc(bkId).get(), 15000);
                    const bData = JSON.parse(doc.data().data), newCode = Math.floor(100000 + Math.random() * 900000).toString();
                    bData.code = newCode; bData.name = (bData.name || '工程') + ' (還原檔)'; bData.ownerId = currentUser.value?.uid || ''; bData.lastSyncAt = 0; bData.pendingUpload = true;
                    const curLocal = await localforage.getItem('proj_' + manageProj.value.code);
                    if (curLocal) { const pMap = new Map(); curLocal.pages.forEach(p => { if (p.photo) pMap.set(p.id, p.photo); (p.pins || []).forEach(pin => { if (pin.photo) pMap.set(pin.id, pin.photo); }); }); bData.pages.forEach(p => { p.photo = pMap.get(p.id) || null; (p.pins || []).forEach(pin => { pin.photo = pMap.get(pin.id) || null; }); }); }
                    await localforage.setItem('proj_' + newCode, bData); await updateQueue(newCode, true); showBackupListModal.value = false; await loadProjectList(); showToast('✅ 已還原為新檔');
                } catch (e) { alert('還原失敗：' + e.message); } finally { isProcessing.value = false; }
            };

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
                                result = { code, name: pd.name || '', date: pd.date || getTodayStr(), ownerId: pd.ownerId || '', pages: cloudPages.filter(p => !delSet.has(p.id)).sort((a, b) => ((pd.pageIds || []).indexOf(a.id) === -1 ? 9999 : (pd.pageIds || []).indexOf(a.id)) - ((pd.pageIds || []).indexOf(b.id) === -1 ? 9999 : (pd.pageIds || []).indexOf(b.id))), photoPool: [], deletedPageIds: pd.deletedPageIds || [], deletedPinIds: pd.deletedPinIds || [], pageOrderUpdatedAt: pd.pageOrderUpdatedAt || 0, lastSyncAt: Date.now(), lastModifiedBy: pd.lastModifiedBy || '' };
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
                const map = new Map();
                projectList.value.forEach(p => map.set(String(p.code), { ...p }));
                if (db && navigator.onLine) {
                    try {
                        const snaps = await withTimeout(db.collection('site_projects').orderBy('updatedAt', 'desc').limit(50).get(), 10000);
                        snaps.docs.forEach(d => { const data = d.data() || {}, c = String(d.id); if (data.name || data.updatedAt) { const ex = map.get(c); map.set(c, { code: c, name: data.name || ex?.name || '', date: data.date || ex?.date || '', pageCount: (data.pageIds?.length) || ex?.pageCount || 1, updatedAt: Math.max(data.updatedAt || 0, ex?.updatedAt || 0) }); } });
                    } catch (_) {}
                }
                allProjectOptions.value = Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            };

            const openMergeProjectsModal = async () => {
                isProcessing.value = true; processingText.value = '正在讀取工程清單...';
                try {
                    await refreshAllProjectOptions();
                    if (allProjectOptions.value.length < 2) { alert('至少需要 2 個工程才能合拼'); return; }
                    mergeProjCodeA.value = allProjectOptions.value[0]?.code || ''; mergeProjCodeB.value = allProjectOptions.value[1]?.code || '';
                    updateMergeDefaultName(); showMergeProjectsModal.value = true;
                } finally { isProcessing.value = false; }
            };
            const updateMergeDefaultName = () => {
                const a = allProjectOptions.value.find(x => String(x.code) === String(mergeProjCodeA.value));
                const b = allProjectOptions.value.find(x => String(x.code) === String(mergeProjCodeB.value));
                mergeProjNewName.value = (mergeProjCodeA.value && mergeProjCodeB.value) ? `${a?.name?.trim() || '工程A'} + ${b?.name?.trim() || '工程B'}` : '';
            };
            const executeMergeProjects = async () => {
                const cA = String(mergeProjCodeA.value || '').trim(), cB = String(mergeProjCodeB.value || '').trim();
                if (!cA || !cB) return alert('請選擇兩個要合拼的工程');
                if (cA === cB) return alert('請選擇兩個不同的工程');
                showMergeProjectsModal.value = false; isProcessing.value = true; processingText.value = '正在合拼圖紙...';
                try {
                    const [dataA, dataB] = await Promise.all([fetchCompleteProjectData(cA), fetchCompleteProjectData(cB)]);
                    if (!dataA || !dataB) throw new Error('無法讀取其中一份工程資料');
                    const mergedPages = [...clonePagesWithFreshIds(dataA.pages), ...clonePagesWithFreshIds(dataB.pages)];
                    if (!mergedPages.length) mergedPages.push(makeEmptyPage());
                    const seenFp = new Set(), mergedPool = [];
                    [...(dataA.photoPool || []), ...(dataB.photoPool || [])].forEach(item => { if (!item?.photo) return; const fp = photoFingerprint(item.photo); if (!seenFp.has(fp)) { seenFp.add(fp); mergedPool.push(item); } });
                    const existingCodes = new Set(allProjectOptions.value.map(x => String(x.code)));
                    let newCode = ''; do { newCode = Math.floor(100000 + Math.random() * 900000).toString(); } while (existingCodes.has(newCode));
                    const finalName = mergeProjNewName.value.trim() || `${dataA.name || '工程A'} + ${dataB.name || '工程B'}`;
                    const newProjObj = { code: newCode, name: finalName, date: getTodayStr(), ownerId: currentUser.value?.uid || '', pages: mergedPages, photoPool: mergedPool, deletedPageIds: [], deletedPinIds: [], pageOrderUpdatedAt: Date.now(), updatedAt: Date.now(), lastSyncAt: 0, lastModifiedBy: authorName.value || '', pendingUpload: true };
                    await localforage.setItem('proj_' + newCode, newProjObj); await updateQueue(newCode, true);
                    if (db && navigator.onLine) { try { const syncTs = await pushProjectPayload(newProjObj, false, (st) => { processingText.value = st; }); if (syncTs) { newProjObj.lastSyncAt = syncTs; newProjObj.pendingUpload = false; await localforage.setItem('proj_' + newCode, newProjObj); } } catch (_) {} }
                    await loadProjectList(); showToast(`✅ 已合拼為「${finalName}」（共 ${mergedPages.length} 頁）`);
                } catch (e) { alert('合拼失敗：' + e.message); } finally { isProcessing.value = false; }
            };

            const toggleSelectMode = () => { selectMode.value = !selectMode.value; selectedPageIds.value = []; };
            const togglePageSelection = (pgId) => { const idStr = String(pgId), idx = selectedPageIds.value.indexOf(idStr); if (idx === -1) selectedPageIds.value.push(idStr); else selectedPageIds.value.splice(idx, 1); };
            const selectAllPages = () => { if (selectedPageIds.value.length === pages.value.length) selectedPageIds.value = []; else selectedPageIds.value = pages.value.map(p => String(p.id)); };
            const openTransferModal = async (singlePageId = null) => {
                if (singlePageId) selectedPageIds.value = [String(singlePageId)];
                if (!selectedPageIds.value.length) { showToast('請先點選要轉檔的圖紙'); return; }
                isProcessing.value = true; processingText.value = '正在讀取工程選列...';
                try { await refreshAllProjectOptions(); transferTargetCode.value = otherProjectOptions.value[0]?.code || '__NEW__'; transferMode.value = 'copy'; transferNewProjName.value = ''; showTransferModal.value = true; } finally { isProcessing.value = false; }
            };
            const executeTransferPages = async () => {
                if (!selectedPageIds.value.length || !transferTargetCode.value) return;
                const selectedSet = new Set(selectedPageIds.value.map(String)), pickedRaw = pages.value.filter(p => selectedSet.has(String(p.id)));
                if (!pickedRaw.length) return;
                if (transferMode.value === 'move' && !confirm(`確定要將選中的 ${pickedRaw.length} 頁「移動」過去嗎？`)) return;
                showTransferModal.value = false; isProcessing.value = true; processingText.value = `正在轉移 ${pickedRaw.length} 頁圖紙...`;
                try {
                    const clonedPages = clonePagesWithFreshIds(pickedRaw); let targetCode = String(transferTargetCode.value);
                    if (targetCode === '__NEW__') {
                        const existingCodes = new Set(allProjectOptions.value.map(x => String(x.code)));
                        do { targetCode = Math.floor(100000 + Math.random() * 900000).toString(); } while (existingCodes.has(targetCode));
                        const targetName = transferNewProjName.value.trim() || `${project.name || '工程'} (分拆)`;
                        const newProjObj = { code: targetCode, name: targetName, date: getTodayStr(), ownerId: currentUser.value?.uid || '', pages: clonedPages, photoPool: [], deletedPageIds: [], deletedPinIds: [], pageOrderUpdatedAt: Date.now(), updatedAt: Date.now(), lastSyncAt: 0, lastModifiedBy: authorName.value || '', pendingUpload: true };
                        await localforage.setItem('proj_' + targetCode, newProjObj); await updateQueue(targetCode, true);
                        if (db && navigator.onLine) { try { const syncTs = await pushProjectPayload(newProjObj, false, (st) => { processingText.value = st; }); if (syncTs) { newProjObj.lastSyncAt = syncTs; newProjObj.pendingUpload = false; await localforage.setItem('proj_' + targetCode, newProjObj); } } catch (_) {} }
                    } else {
                        const targetProj = await fetchCompleteProjectData(targetCode); if (!targetProj) throw new Error('找不到目標工程');
                        targetProj.pages = [...(targetProj.pages || []), ...clonedPages]; targetProj.updatedAt = Date.now(); targetProj.pendingUpload = true;
                        await localforage.setItem('proj_' + targetCode, targetProj); await updateQueue(targetCode, true);
                        if (db && navigator.onLine) { try { const syncTs = await pushProjectPayload(targetProj, false, (st) => { processingText.value = st; }); if (syncTs) { targetProj.lastSyncAt = syncTs; targetProj.pendingUpload = false; await localforage.setItem('proj_' + targetCode, targetProj); } } catch (_) {} }
                    }
                    if (transferMode.value === 'move') {
                        project.deletedPageIds ||= []; pickedRaw.forEach(pg => { if (!project.deletedPageIds.includes(pg.id)) project.deletedPageIds.push(pg.id); dirtyPageIds.delete(pg.id); });
                        pages.value = pages.value.filter(p => !selectedSet.has(String(p.id))); if (!pages.value.length) pages.value = [makeEmptyPage()];
                        activePageIndex.value = Math.min(activePageIndex.value, pages.value.length - 1); pageIndexB.value = Math.min(pageIndexB.value, pages.value.length - 1);
                        project.pageOrderUpdatedAt = Date.now(); hasUnsavedCloudChanges.value = true; await saveAll();
                        if (db && navigator.onLine && project.code) { const curRef = db.collection('site_projects').doc(String(project.code)); pickedRaw.forEach(pg => curRef.collection('pages').doc(pg.id).delete().catch(() => {})); curRef.set({ pageIds: pages.value.map(p => p.id), deletedPageIds: firebase.firestore.FieldValue.arrayUnion(...pickedRaw.map(p => p.id)), updatedAt: Date.now() }, { merge: true }).catch(() => {}); }
                    }
                    selectMode.value = false; selectedPageIds.value = []; showToast(`✅ 已${transferMode.value === 'move' ? '移動' : '複製'} ${clonedPages.length} 頁`);
                } catch (e) { alert('轉檔失敗：' + e.message); } finally { isProcessing.value = false; }
            };

const openCloudBrowser = async () => { if (!db || !navigator.onLine) return alert('請檢查網路連線'); isProcessing.value = true; processingText.value = '正在讀取待認領雲端工程...'; try { localHiddenCodes.value = ((await localforage.getItem('local_hidden_projects')) || []).map(String); const snaps = await withTimeout(db.collection('site_projects').orderBy('updatedAt', 'desc').limit(40).get(), 10000); cloudProjectList.value = snaps.docs.map(d => ({ code: d.id, ...d.data() })).filter(d => d.name || d.updatedAt); showCloudBrowser.value = true; } catch (e) { alert('讀取目錄失敗：' + e.message); } finally { isProcessing.value = false; } };
            const downloadFromCloudBrowser = async (code) => {
                code = String(code);
                const hidden = (await localforage.getItem('local_hidden_projects')) || [];
                if (hidden.includes(code)) {
                    await localforage.setItem('local_hidden_projects', hidden.filter(c => c !== code));
                    localHiddenCodes.value = localHiddenCodes.value.filter(c => c !== code);
                }
                if (currentUser.value?.uid && db && navigator.onLine) {
                    db.collection('site_projects').doc(code).set({ ownerId: currentUser.value.uid }, { merge: true }).catch(() => {});
                }

            
                await loadProject(code, true);
                if (currentUser.value?.uid) {
                    project.ownerId = currentUser.value.uid;
                    await saveAll();
                }
                await loadProjectList();
                showToast('✅ 已認領並歸戶至目錄');
            };
            const loadProjectList = async () => { const keys = await localforage.keys(), q = (await localforage.getItem('pending_upload_queue')) || [], list = []; for (const k of keys) { if (k.startsWith('proj_')) { const d = await localforage.getItem(k); if (d?.code) { const pgs = d.pages || []; list.push({ code: d.code, name: d.name, date: d.date, pageCount: pgs.length || 1, pinCount: pgs.reduce((s, p) => s + (p.pins?.length || 0), 0), updatedAt: d.updatedAt || 0, lastModifiedBy: d.lastModifiedBy || '', pendingUpload: !!d.pendingUpload || q.includes(String(d.code)) }); } } } projectList.value = list.sort((a, b) => b.updatedAt - a.updatedAt); };

            const backToProjects = async () => {
                resetZoom(); showQuickPageNav.value = false; selectMode.value = false; selectedPageIds.value = []; splitMode.value = false; activePane.value = 'A';
                if (unsubPages) { unsubPages(); unsubPages = null; }
                if (unsubFeedback) { unsubFeedback(); unsubFeedback = null; }
                const needSync = (hasUnsavedCloudChanges.value || dirtyPageIds.size > 0) && project.code && db;
                await saveAll();
                dirtyPageIds.clear(); hasUnsavedCloudChanges.value = false; feedbackList.value = [];
                await loadProjectList();
                currentView.value = 'dir';
                if (needSync) {
                    if (!navigator.onLine) showToast('📴 離線已保存，有網絡自動上傳');
                    else { showToast('☁️ 正在背後自動同步上傳...'); processPendingUploadQueue(false); }
                }
            };

            const checkAuthorName = async () => { let name = await localforage.getItem('measure_author_name'); if (!name && currentUser.value?.displayName) { name = currentUser.value.displayName; await localforage.setItem('measure_author_name', name); } if (!name) { name = prompt('👤 請輸入您的稱呼或設備名稱 (例: 明哥、強哥iPad)：')?.trim(); if (name) await localforage.setItem('measure_author_name', name); } authorName.value = name || ''; };
            const changeAuthorName = async () => { const name = prompt('👤 更新設備稱呼：', authorName.value)?.trim(); if (name) { authorName.value = name; await localforage.setItem('measure_author_name', name); } };

            const fallbackCopyTextToClipboard = (text) => { const textArea = document.createElement("textarea"); textArea.value = text; textArea.style.position = "fixed"; textArea.style.top = "0"; textArea.style.left = "0"; document.body.appendChild(textArea); textArea.focus(); textArea.select(); try { document.execCommand('copy'); showToast('🔗 已複製 WhatsApp 專屬連結'); } catch (_) { window.prompt("請手動複製以下連結：", text); } document.body.removeChild(textArea); };
            const copyShareLink = () => {
                const code = String(project.code || '').trim(); if (!code) return; let baseUrl = window.location.href.split('index.html')[0]; if (!baseUrl.endsWith('/')) baseUrl += '/'; const link = baseUrl + 'view.html?code=' + code; const msg = `📋 工程度尺圖\n📍 地址：${project.name || '未標題'}\n👉 點擊檢視及標註意見：\n${link}`;
                if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(msg).then(() => showToast('🔗 已複製 WhatsApp 專屬連結')).catch(() => fallbackCopyTextToClipboard(msg));
                else fallbackCopyTextToClipboard(msg);
            };

            onMounted(async () => {
                const bs = document.getElementById('boot-screen'); if (bs) bs.remove(); document.getElementById('app').style.display = 'flex';
                await loadStampStore(); await loadCadStore(); await loadProjectList();
                if (auth) {
                    auth.onAuthStateChanged(async (user) => {
                        currentUser.value = user || null;
                        if (user) {
                            if (!authorName.value && user.displayName) { authorName.value = user.displayName; await localforage.setItem('measure_author_name', user.displayName); }
                            await syncUserOwnedProjects();
                        }
                    });
                }
                await checkAuthorName();
                window.addEventListener('online', () => { cloudSyncState.value = 'ready'; showToast('🌐 網絡已恢復'); processPendingUploadQueue(false); syncUserOwnedProjects(); });
                window.addEventListener('offline', () => { cloudSyncState.value = 'offline'; });
                window.addEventListener('paste', handleGlobalPaste);
                window.addEventListener('keydown', handleGlobalKeydown);
                window.addEventListener('keyup', handleGlobalKeyup);
                if (navigator.onLine) setTimeout(() => processPendingUploadQueue(false), 1500);
                setInterval(() => { if (navigator.onLine) processPendingUploadQueue(true); }, 15000);
            });

            onUnmounted(() => { window.removeEventListener('paste', handleGlobalPaste); window.removeEventListener('keydown', handleGlobalKeydown); window.removeEventListener('keyup', handleGlobalKeyup); });

            const renderAnnotatedCanvas = (canvasObj, includeStamp = true, itemDate = '', itemAuthor = '') => new Promise(async (resolve) => {
                const img = new Image(); img.src = canvasObj.photo; await new Promise(r => { img.onload = r; img.onerror = r; });
                const c = document.createElement('canvas'), w = canvasObj.w || 1200, h = canvasObj.h || 900; c.width = w; c.height = h; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
                const markerImages = {}, customCadImages = {};
                for (const m of (canvasObj.markers || [])) {
                    if (m.type === 'image' && m.data.b64) { const im = new Image(); im.src = m.data.b64; await new Promise(r => { im.onload = r; im.onerror = r; }); markerImages[m.id] = im; }
                    else if (m.type === 'cad' && m.data?.cadType) {
                        const def = getCadDef(m.data.cadType);
                        if (def?.imgB64 && !customCadImages[def.id]) { const im = new Image(); im.src = def.imgB64; await new Promise(r => { im.onload = r; im.onerror = r; }); customCadImages[def.id] = im; }
                    }
                }
                if (includeStamp) {
                    const wm = buildWatermarkBox(canvasObj, itemDate, itemAuthor, w);
                    if (wm) { ctx.save(); ctx.fillStyle = 'rgba(255, 255, 255, 0.56)'; drawRoundRect(ctx, wm.x, wm.y, wm.w, wm.h, 6); ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)'; ctx.stroke(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'; ctx.fillText(wm.text, wm.x + wm.w / 2, wm.y + wm.h / 2); ctx.restore(); }
                }
                ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                (canvasObj.walls || []).forEach(wObj => { ctx.strokeStyle = wObj.color || '#111827'; buildWallSegments(wObj).forEach(seg => { ctx.lineWidth = seg.isHatch ? 2.5 : 3.5; ctx.beginPath(); ctx.moveTo(seg.x1, seg.y1); ctx.lineTo(seg.x2, seg.y2); ctx.stroke(); }); });
                (canvasObj.lines || []).forEach(l => {
                    if (l.type === 'arrow-single') { const hex = getLineStroke(l); ctx.strokeStyle = hex; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke(); ctx.save(); ctx.fillStyle = hex; ctx.translate(l.x2, l.y2); ctx.rotate(Math.atan2(l.y2 - l.y1, l.x2 - l.x1)); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-9, 4.5); ctx.lineTo(-9, -4.5); ctx.closePath(); ctx.fill(); ctx.restore(); }
                    else if (l.type === 'straight') { ctx.strokeStyle = getLineStroke(l); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke(); }
                    else { ctx.save(); ctx.setLineDash([14, 10]); ctx.strokeStyle = getLineStroke(l, 0.7); ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke(); ctx.restore(); }
                });
                (canvasObj.paths || []).forEach(p => { ctx.strokeStyle = p.color || '#3b82f6'; ctx.lineWidth = 6; ctx.stroke(new Path2D(p.d)); });
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                (canvasObj.markers || []).forEach(m => {
                    if (m.type === 'cad') drawCustomCadOnCanvas(ctx, m, customCadImages);
                    else if (m.type === 'image') { if (markerImages[m.id]) { ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(((m.rot || 0) * Math.PI) / 180); ctx.drawImage(markerImages[m.id], -m.w / 2, -m.h / 2, m.w, m.h); ctx.restore(); } }
                    else { const lines = getMarkerLines(m), color = getStampColor(m), sc = globalFontScale.value * (m.fontScale || 1); ctx.font = `900 ${28 * sc}px sans-serif`; const startY = m.y - ((lines.length - 1) * 34 * sc) / 2; lines.forEach((line, i) => { const y = startY + i * 34 * sc; ctx.lineWidth = 7 * sc; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round'; ctx.strokeText(line, m.x, y); ctx.fillStyle = color; ctx.fillText(line, m.x, y); }); }
                });
                (canvasObj.pins || []).forEach((pin, idx) => { const px = (pin.x / 100) * w, py = (pin.y / 100) * h; ctx.beginPath(); ctx.arc(px, py - 22, 20, 0, 2 * Math.PI); ctx.fillStyle = '#dc2626'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = 'bold 22px sans-serif'; ctx.fillText(idx + 1, px, py - 22); });
                resolve(c);
            });

            const copyFullScreenImage = async () => { if (!fullScreenItem.value?.photo) return; const c = await renderAnnotatedCanvas(fullScreenItem.value, showWatermark.value, fullScreenDate.value, fullScreenAuthor.value); try { if (navigator.clipboard && window.ClipboardItem) { const blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(), 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); showToast('✅ 已複製圖片'); return; } } catch (_) {} try { const blob = await new Promise(res => c.toBlob(res, 'image/png')); const file = new File([blob], 'measure.png', { type: 'image/png' }); if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (_) {} alert('此瀏覽器不支援直接複製圖片，請按旁邊「⬇️下載」'); };
            const downloadFullScreenImage = async () => { if (!fullScreenItem.value?.photo) return; try { const dStr = sanitizeFilename(fullScreenDate.value || getTodayStr()); const c = await renderAnnotatedCanvas(fullScreenItem.value, showWatermark.value, fullScreenDate.value, fullScreenAuthor.value); const url = URL.createObjectURL(await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92))); const a = document.createElement('a'); a.href = url; a.download = `${sanitizeFilename(project.name || '工程')}_${sanitizeFilename(currentFullScreen.value?.label || '圖紙')}_${dStr}.jpg`; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 2000); showToast('✅ 已下載圖片'); } catch (_) { alert('下載圖片失敗'); } };

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
                            const cols = perPage === 4 ? 2 : 1, rows = 2, totalPdf = Math.ceil(validPages.length / perPage), mx = 45, topY = 115, gap = 24; const cellW = Math.floor((PAGE_W - mx * 2 - (cols - 1) * gap) / cols), cellH = Math.floor((PAGE_H - topY - 45 - (rows - 1) * gap) / rows);
                            for (let pIdx = 0; pIdx < totalPdf; pIdx++) {
                                if (pIdx > 0) doc.addPage(); const c = document.createElement('canvas'); c.width = PAGE_W; c.height = PAGE_H; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H); ctx.fillStyle = '#000'; ctx.font = 'bold 34px sans-serif'; ctx.fillText(`${project.name || '工程度尺'}`, mx, 60); ctx.font = 'bold 21px sans-serif'; ctx.fillStyle = '#4b5563'; ctx.fillText(`日期: ${headerDate}   |   共 ${validPages.length} 張   |   第 ${pIdx + 1} / ${totalPdf} 頁`, mx, 94);
                                for (let j = 0; j < perPage; j++) {
                                    const pg = validPages[pIdx * perPage + j]; if (!pg) break; const cx = mx + (j % cols) * (cellW + gap), cy = topY + Math.floor(j / cols) * (cellH + gap); ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 2; ctx.strokeRect(cx, cy, cellW, cellH); ctx.fillStyle = '#f3f4f6'; ctx.fillRect(cx + 1, cy + 1, cellW - 2, 44); ctx.fillStyle = '#111827'; ctx.font = 'bold 20px sans-serif'; ctx.fillText(`${pg.pdfLabel} (${pg.date})`.slice(0, cols === 1 ? 56 : 32), cx + 14, cy + 30);
                                    const im = await renderAnnotatedCanvas(pg, true, pg.date, pg.author); const maxW = cellW - 20, maxH = cellH - 60; let dw = maxW, dh = (im.height / im.width) * dw; if (dh > maxH) { dh = maxH; dw = (im.width / im.height) * dh; } ctx.drawImage(im, cx + 10 + (maxW - dw) / 2, cy + 52 + (maxH - dh) / 2, dw, dh);
                                }
                                doc.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, 210, 297);
                            }
                        } else {
                            for (let i = 0; i < validPages.length; i++) {
                                if (i > 0) doc.addPage(); const pg = validPages[i], c = document.createElement('canvas'); c.width = PAGE_W; c.height = PAGE_H; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H); ctx.fillStyle = '#000'; ctx.font = 'bold 38px sans-serif'; ctx.fillText(`${project.name || '工程度尺'} — ${pg.pdfLabel}`, 50, 65); ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = '#4b5563'; ctx.fillText(`日期: ${pg.date}   |   最後修改: ${pg.author}`, 50, 102);
                                const im = await renderAnnotatedCanvas(pg, true, pg.date, pg.author); const maxW = PAGE_W - 100, maxH = PAGE_H - 180; let dw = maxW, dh = (im.height / im.width) * dw; if (dh > maxH) { dh = maxH; dw = (im.width / im.height) * dh; } ctx.drawImage(im, 50 + (maxW - dw) / 2, 130, dw, dh); doc.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, 210, 297);
                            }
                        }
                        const modeTag = perPage === 4 ? '4合1' : perPage === 2 ? '2合1' : '單頁'; doc.save(`${sanitizeFilename(project.name || '工程')}_${fileDateTag}_${modeTag}.pdf`);
                    } catch (_) { alert('生成 PDF 失敗'); } finally { isProcessing.value = false; }
                }, 50);
            };

            return {
                offlineReady, currentView, currentUser, loginWithGoogle, logoutGoogle,
                TEMPLATE_ROWS, TAG_DEFS, DIM_QUICK_ROWS, KEYPAD_KEYS, STAMP_PALETTE,
                stampCategories, stampItems, stampFilter, showStampManagerModal, managerCatFilter, managerFilteredItems, pinnedStampList,
                newCatName, newStampText, newStampCatId, newStampColor, getCategoryById, openStampManager, onSelectNewStampCat, addStampCategory, addStampItem, toggleStampPin, setStampItemColor, editStampItemText, deleteStampItem, restoreDefaultStamps, syncStampLibraryCloud,
                STAMP_GROUPS, filteredStampGroups, promptCustomStamp,
               CAD_CATEGORIES, cadCategory, selectedCadType, filteredCadList, getCadDef, getCadTransform, setMarkerScale, setMarkerScaleX, setMarkerScaleY, nudgeMarker, rotateMarker, flipMarker, setCadMarkerColor,
                showCadManager, cadMgrFilter, newCadCat, newCadShape, newCadLabel, newCadImgB64, previewNewCadShapes, getCadPreviewViewBox, handleNewCadImage, allCadManageList, filteredCadManageList,
                openCadManager, addCustomCadBlock, deleteCustomCadBlock, togglePinCad, toggleHideCad,
                defaultTextColor, setMarkerTextColor, getArrowMarkerId, getFsArrowMarkerId,
                allProjectOptions, otherProjectOptions, showMergeProjectsModal, mergeProjCodeA, mergeProjCodeB, mergeProjNewName, openMergeProjectsModal, updateMergeDefaultName, executeMergeProjects,
                selectMode, selectedPageIds, toggleSelectMode, togglePageSelection, selectAllPages, showTransferModal, transferTargetCode, transferMode, transferNewProjName, openTransferModal, executeTransferPages,
                splitMode, activePane, focusPane, toggleSplitMode,
                pageIndexB, pinB, pinIndexB, pageB, canvasB, canvasWB, canvasHB, zoomScaleB, invZoomB, svgViewBoxB, resetZoomB,
                showQuickPageNavB, jumpToPageB, canvasBFeedbacks, svgCanvasB,
                feedbackList, showFeedbackOverlay, showFeedbackModal, currentCanvasFeedbacks, pageFeedbackCount, jumpToFeedback, resolveFeedback,
                capsuleOffset, capsuleCollapsed, startCapsuleDrag,
                masterPages, showQuickPageNav, jumpToPage, jumpToPageById, goToMasterPlan,
                showIndexModal, indexCustomCode, editingIndexMarker, placeSpaceTag, addCustomSpaceTag, placePageLink, deleteEditingIndexMarker,
                fullScreenIndex, fullScreenList, fullScreenItem, fullScreenTitle, fullScreenWatermarkBox, showWatermark, getLineStroke, getWallSegments,
                zoomScale, invZoom, svgViewBox, stepZoom, resetZoom, onStageWheel, draggingPageIdx, dragOverPageIdx, startPageDrag,
                openFullScreenPreview, prevFullScreen, nextFullScreen, editFromFullScreen, copyFullScreenImage, downloadFullScreenImage, enterEditMode, switchToPreview, duplicateCurrentPage,
                showMergeModal, mergeableGroups, mergePageGroup, showPdfModal, showPhotoPoolModal, photoPoolList, openPhotoPool, selectFromPhotoPool, deleteFromPhotoPool,
                projectList, project, pages, activePageIndex, activePage, activePin, activePinIndex, activeCanvas, canvasW, canvasH,
                showAddPageModal, showSpaceModal, spaceList, authorName, changeAuthorName, hasUnsavedCloudChanges, markProjectChanged,
                showManageModal, manageProj, openManageMenu, openProjectMap,renameProject, duplicateProject, showCloudBrowser, cloudProjectList, unclaimedCloudProjects, openCloudBrowser, downloadFromCloudBrowser, cleanCloudGarbage,
                showBackupListModal, backupList, openBackupList, restoreBackup, drawColor, wallStyle, cloudStatusText, cloudStatusClass, showCloudDetail, forceSyncToCloud,toastMsg, copyShareLink,
                drawMode, drawingPane, showTopSheet, showTopTextBar, activeMarker, isProcessing, processingText, focusedInput, topTextInputRef,
                showBranchPrompt, branchOwner, overwriteBranch, duplicateBranch, dismissBranch, svgCanvas, currentLine, currentWall, currentPath, hasUndoItems, hasRedoItems,
                createNewProject, loadProject, removeProjectLocalOnly, deleteProject, backToProjects, copyCode, saveAll, prevPage, nextPage, deleteCurrentPage, openPinSubPage, exitPinSubPage, onPinTap, deleteActivePin,
                setPageSpace, addCustomSpace, initSketchOnCurrent, addNewSketchPage, toggleSketchGrid, handleImageUpload, pasteFromClipboard,
                onEraseTap, resizeImageMarker, onMarkerPointerStart, onStageTouchStart, onStageTouchMove, onStageTouchEnd, onStageMouseDown, onStageMouseMove, onStageMouseUp, undoLastAction, redoAction,
                deleteMarkerTop, switchMarkerType, closeTopSheet, closeTopTextBar, onMarkerTextInput, handleKeypad, applyTag, applyStamp, getStampColor, getMarkerLines, getTagFields, exportPdfReport,
                globalFontScale, toggleFontScale,
                activeLine, onLinePointerStart, setActiveLineColor, deleteActiveLine, getMarkerFontPx, stepMarkerFontScale, openMarkerEditor,
                getDocTypeLabel, overviewTypeFilter, overviewSpaceFilter, drawingPageCount, photoPageCount, overviewSpacesAvailable, filteredOverviewPages,
                movingPageId, movingPageLabel, startMovePage, insertMovingPageAfter, showAutoSortModal, autoSortPages,
                editingMetaPage, openPageMetaModal, setPageDocType, batchSetDocType, batchSetSpace
            };
            };
        }
    }).mount('#app');
}
// === END OF app.js ===
