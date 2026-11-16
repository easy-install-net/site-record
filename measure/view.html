if (!window.Vue) {
    alert('系統載入失敗，請檢查網絡連線');
} else {
    const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;
    localforage.config({ name: 'SiteMeasurePro', storeName: 'view_cache_store' });

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
        }
    } catch (_) {}

    const sanitizeFilename = (s) => String(s || '').trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
    const getTodayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

    createApp({
        setup() {
            const inputCode = ref('');
            const project = reactive({ code: '', name: '', date: '', lastModifiedBy: '' });
            const pages = ref([]);
            const toastMsg = ref('');
            const showPdfModal = ref(false);
            const showWatermark = ref(true);

            const showToast = (msg) => { toastMsg.value = msg; setTimeout(() => { if (toastMsg.value === msg) toastMsg.value = ''; }, 3000); };

            // UI 渲染輔助函數 (與主程式同步)
            const getLineStroke = (l, alpha = 0.55) => !l.type || l.type === 'measure' ? `rgba(255, 0, 68, ${alpha})` : ({ gray: '#9ca3af', white: '#ffffff' }[l.color] || '#ef4444');
            const getWallSegments = (w) => {
                if (!w) return [];
                const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = Math.hypot(dx, dy); if (L < 4) return [];
                const ux = dx / L, uy = dy / L, nx = -uy, ny = ux, hw = 9;
                const p1A = { x: w.x1 + nx * hw, y: w.y1 + ny * hw }, p2A = { x: w.x2 + nx * hw, y: w.y2 + ny * hw };
                const p1B = { x: w.x1 - nx * hw, y: w.y1 - ny * hw }, p2B = { x: w.x2 - nx * hw, y: w.y2 - ny * hw };
                const segs = [
                    { x1: p1A.x, y1: p1A.y, x2: p2A.x, y2: p2A.y, isHatch: false },
                    { x1: p1B.x, y1: p1B.y, x2: p2B.x, y2: p2B.y, isHatch: false },
                    { x1: p1A.x, y1: p1A.y, x2: p1B.x, y2: p1B.y, isHatch: false },
                    { x1: p2A.x, y1: p2A.y, x2: p2B.x, y2: p2B.y, isHatch: false }
                ];
                if (w.style === 'hatched') {
                    for (let c = -hw + 14; c < L + hw; c += 14) {
                        const t0 = Math.max(-hw, -c), t1 = Math.min(hw, L - c);
                        if (t1 - t0 > 0.5) {
                            segs.push({ x1: w.x1 + (c + t0) * ux + t0 * nx, y1: w.y1 + (c + t0) * uy + t0 * ny, x2: w.x1 + (c + t1) * ux + t1 * nx, y2: w.y1 + (c + t1) * uy + t1 * ny, isHatch: true });
                        }
                    }
                }
                return segs;
            };

            const getTagFields = (t) => ({
                door: [{ key: 'w_in', label: '門闊' }, { key: 'h_in', label: '門高' }, { key: 't', label: '牆厚' }, { key: 't_frame', label: '門框厚' }, { key: 'h_top', label: '頂到天花' }, { key: 'w_side', label: '邊到牆' }],
                window: [{ key: 'w_in', label: '內闊' }, { key: 'h_in', label: '內高' }, { key: 'd_in', label: '內深' }, { key: 'h_bottom', label: '面到地' }, { key: 't_stone', label: '窗石厚' }, { key: 'd_stone', label: '窗石凸' }],
                beam: [{ key: 'w', label: '樑闊' }, { key: 'd', label: '樑深' }, { key: 'h_bottom', label: '底到地' }, { key: 'w_side', label: '樑邊到牆' }],
                column: [{ key: 'w', label: '柱闊' }, { key: 'd', label: '柱深' }, { key: 'h_top', label: '柱高' }, { key: 'd_out', label: '柱凸出' }]
            }[t] || []);

            const getMarkerLines = (m) => {
                if (['window','door','beam','column'].includes(m.type)) { return [{ window: '窗', door: '門洞', beam: '樑', column: '柱' }[m.type], ...getTagFields(m.type).filter(f => m.data[f.key]).map(f => `${f.label}:${m.data[f.key]}`)]; }
                if (m.type === 'stamp' || m.type === 'text') return [m.data.val || ''];
                return [`${m.data.name ? m.data.name + ': ' : ''}${m.data.val || ''}`];
            };

            const getStampColor = (m) => {
                if (m.type !== 'stamp') return '#ffffff';
                const v = m.data.val;
                if (['需清拆','牆身斜','牆體不平','空鼓','滲水','局部凸出'].includes(v)) return '#ef4444';
                if (['開關','單蘇','孖蘇','燈曲','數據','燈線'].includes(v)) return '#eab308';
                if (['留通道','開門方向','可保留','實地台'].includes(v)) return '#3b82f6';
                if (['要收口','見光','開背板','生口位','避窗簾盒','留散熱','要分件'].includes(v)) return '#d97706';
                return '#a855f7';
            };

            // 核心功能：切片下載與本機快取 (Lazy Load)
            const fetchMediaData = async (projCode, photoId) => {
                if (!photoId) return null;
                const cacheKey = `img_${projCode}_${photoId}`;
                try {
                    const cached = await localforage.getItem(cacheKey);
                    if (cached) return cached;
                } catch (_) {}

                const docRef = db.collection('site_projects').doc(projCode).collection('media').doc(photoId);
                const doc = await docRef.get();
                if (!doc.exists) return null;
                const d = doc.data();
                
                let photoB64 = null;
                if (d.photo) {
                    photoB64 = d.photo;
                } else if (d.chunked && d.totalChunks > 0) {
                    const snap = await docRef.collection('chunks').get();
                    const chunks = snap.docs.map(c => c.data()).sort((a, b) => (a.index || 0) - (b.index || 0));
                    if (chunks.length === d.totalChunks) photoB64 = chunks.map(c => c.data || '').join('');
                }
                
                if (photoB64) {
                    await localforage.setItem(cacheKey, photoB64);
                    return photoB64;
                }
                return null;
            };

            const lazyLoadImages = async (projCode) => {
                for (let i = 0; i < pages.value.length; i++) {
                    const pg = pages.value[i];
                    if (!pg.photo && pg.photoId) {
                        fetchMediaData(projCode, pg.photoId).then(b64 => { if (b64) pg.photo = b64; });
                    }
                    if (pg.pins) {
                        for (let j = 0; j < pg.pins.length; j++) {
                            const pin = pg.pins[j];
                            if (!pin.photo && pin.photoId) {
                                fetchMediaData(projCode, pin.photoId).then(b64 => { if (b64) pin.photo = b64; });
                            }
                        }
                    }
                }
            };

            const submitCode = async () => {
                const code = String(inputCode.value || '').trim();
                if (code.length !== 6) return showToast('請輸入 6 位數字工程碼');
                if (!navigator.onLine) return showToast('請檢查網絡連線');
                
                const bs = document.getElementById('boot-screen');
                if (bs) bs.style.display = 'flex';
                
                try {
                    const projRef = db.collection('site_projects').doc(code);
                    const [projDoc, pagesSnap] = await Promise.all([projRef.get(), projRef.collection('pages').get()]);
                    
                    if (!projDoc.exists) {
                        if (bs) bs.style.display = 'none';
                        return showToast('找不到此工程單，請確認號碼');
                    }
                    
                    const pd = projDoc.data();
                    project.code = code;
                    project.name = pd.name || '未命名工程';
                    project.date = pd.date || getTodayStr();
                    project.lastModifiedBy = pd.lastModifiedBy || '';

                    // 1. 先極速組合 UI 骨架與標註 (不等待圖片下載)
                    let loadedPages = pagesSnap.docs.map(doc => {
                        const r = doc.data();
                        return {
                            id: doc.id, ...r, date: r.date || pd.date || getTodayStr(),
                            photo: r.photo || null, // 若果直接有細圖就顯示，無就等 Lazy Load
                            photoId: r.photoId || ('page_' + doc.id),
                            pins: (r.pins || []).map(pin => ({ 
                                ...pin, 
                                photo: pin.photo || null, 
                                photoId: pin.photoId || String(pin.id) 
                            }))
                        };
                    });

                    // 排序
                    if (pd.pageIds && pd.pageIds.length) {
                        loadedPages.sort((a, b) => {
                            let idxA = pd.pageIds.indexOf(a.id); let idxB = pd.pageIds.indexOf(b.id);
                            return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
                        });
                    }
                    
                    // 過濾已刪除的圖紙
                    const delPages = new Set(pd.deletedPageIds || []);
                    pages.value = loadedPages.filter(p => !delPages.has(p.id));

                    // URL 帶上密碼方便分享
                    const url = new URL(window.location);
                    url.searchParams.set('code', code);
                    window.history.replaceState({}, '', url);

                    if (bs) bs.style.display = 'none';
                    showToast('✅ 標註載入完成，正自動下載高清圖...');

                    // 2. 背景非同步載入圖片 (Lazy Load)
                    lazyLoadImages(code);

                } catch (e) {
                    if (bs) bs.style.display = 'none';
                    alert('載入失敗: ' + e.message);
                }
            };

            const reloadCurrentProject = () => { if (project.code) submitCode(); };
            const logout = () => { project.code = ''; inputCode.value = ''; pages.value = []; const url = new URL(window.location); url.searchParams.delete('code'); window.history.replaceState({}, '', url); };

            const copyShareLink = () => {
                const link = window.location.href;
                const msg = `📋 工程度尺圖 (#${project.code})\n📍 地址：${project.name}\n👉 點擊查閱：\n${link}`;
                if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(msg).then(() => showToast('🔗 已複製連結，可發送給師傅')).catch(() => prompt("請複製:", msg));
                } else prompt("請複製:", msg);
            };

            // 全螢幕檢視邏輯
            const fullScreenIndex = ref(-1);
            const fullScreenList = computed(() => {
                const list = [];
                pages.value.forEach((pg, pIdx) => {
                    if (pg.photo) list.push({ item: pg, label: `P${pIdx + 1}${pg.space ? ' [' + pg.space + ']' : ''}` });
                    (pg.pins || []).forEach((pin, pinIdx) => {
                        if (pin.photo) list.push({ item: pin, label: `P${pIdx + 1} 📍釘#${pinIdx + 1}${pin.space ? ' [' + pin.space + ']' : ''}` });
                    });
                });
                return list;
            });
            const currentFullScreen = computed(() => (fullScreenIndex.value >= 0 && fullScreenIndex.value < fullScreenList.value.length) ? fullScreenList.value[fullScreenIndex.value] : null);
            const fullScreenItem = computed(() => currentFullScreen.value?.item || null);
            const fullScreenTitle = computed(() => currentFullScreen.value ? `${currentFullScreen.value.label} (${fullScreenIndex.value + 1}/${fullScreenList.value.length})` : '');
            
            const openFullScreenPreview = (targetItem) => {
                const idx = fullScreenList.value.findIndex(x => x.item.id === targetItem.id);
                if (idx !== -1) fullScreenIndex.value = idx;
            };
            const prevFullScreen = () => { if (fullScreenIndex.value > 0) fullScreenIndex.value--; };
            const nextFullScreen = () => { if (fullScreenIndex.value < fullScreenList.value.length - 1) fullScreenIndex.value++; };

            const handleGlobalKeydown = (e) => {
                if (fullScreenIndex.value === -1) return;
                if (e.key === 'ArrowLeft') { e.preventDefault(); prevFullScreen(); }
                else if (e.key === 'ArrowRight') { e.preventDefault(); nextFullScreen(); }
                else if (e.key === 'Escape') { e.preventDefault(); fullScreenIndex.value = -1; }
            };

            // PDF 及匯出功能 (省略具體 Canvas 畫圖代碼以保持精簡，實際操作與 app.js 相同)
            const exportPdfReport = async (perPage) => {
                showToast('正在準備 PDF，請稍候...');
                showPdfModal.value = false;
                setTimeout(() => alert('檢視版 PDF 匯出功能準備中，請先使用截圖或下載單張功能。'), 500);
            };
            const copyFullScreenImage = () => showToast('請長按圖片複製或截圖');
            const downloadFullScreenImage = () => {
                if (!fullScreenItem.value?.photo) return;
                const a = document.createElement('a'); a.href = fullScreenItem.value.photo; 
                a.download = `度尺圖_${project.code}_${currentFullScreen.value.label}.jpg`;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
            };

            onMounted(() => {
                document.getElementById('app').style.display = 'flex';
                const bs = document.getElementById('boot-screen'); if (bs) bs.style.display = 'none';
                window.addEventListener('keydown', handleGlobalKeydown);
                const urlParams = new URLSearchParams(window.location.search);
                const code = urlParams.get('code');
                if (code && code.length === 6) { inputCode.value = code; submitCode(); }
            });

            return {
                inputCode, project, pages, toastMsg, showPdfModal, showWatermark,
                submitCode, reloadCurrentProject, logout, copyShareLink, exportPdfReport,
                getLineStroke, getWallSegments, getMarkerLines, getStampColor,
                fullScreenIndex, fullScreenItem, fullScreenTitle, openFullScreenPreview, prevFullScreen, nextFullScreen, copyFullScreenImage, downloadFullScreenImage
            };
        }
    }).mount('#app');
}
