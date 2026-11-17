window.MEASURE_DATA = (() => {
    const TAG_DEFS = {
        door: { title: '門洞', fields: [{ key: 'w_in', label: '門闊' }, { key: 'h_in', label: '門高' }, { key: 't', label: '牆厚' }, { key: 't_frame', label: '門框厚' }, { key: 'h_top', label: '頂到天花' }, { key: 'w_side', label: '邊到牆' }] },
        window: { title: '窗', fields: [{ key: 'w_in', label: '內闊' }, { key: 'h_in', label: '內高' }, { key: 'd_in', label: '內深' }, { key: 'h_bottom', label: '面到地' }, { key: 't_stone', label: '窗石厚' }, { key: 'd_stone', label: '窗石凸' }] },
        beam: { title: '樑', fields: [{ key: 'w', label: '樑闊' }, { key: 'd', label: '樑深' }, { key: 'h_bottom', label: '底到地' }, { key: 'w_side', label: '樑邊到牆' }] },
        column: { title: '柱', fields: [{ key: 'w', label: '柱闊' }, { key: 'd', label: '柱深' }, { key: 'h_top', label: '柱高' }, { key: 'd_out', label: '柱凸出' }] },
        protrusion: { title: '凸', fields: [{ key: 'w', label: '闊' }, { key: 'h', label: '高' }, { key: 'd', label: '深' }] },
        pipe: { title: '包喉', fields: [{ key: 'w', label: '闊' }, { key: 'h', label: '高' }, { key: 'd', label: '深' }] },
        elec_box: { title: '電箱', fields: [{ key: 'w', label: '闊' }, { key: 'h', label: '高' }, { key: 'd', label: '深' }, { key: 'h_bottom', label: '底到地' }] },
        ac: { title: '冷氣', fields: [{ key: 'w', label: '闊' }, { key: 'h', label: '高' }, { key: 'd', label: '深' }, { key: 'h_bottom', label: '底到地' }] },
        fridge: { title: '雪柜', fields: [{ key: 'w', label: '闊' }, { key: 'h', label: '高' }, { key: 'd', label: '深' }] },
        skirting: { title: '地腳線', fields: [{ key: 'h', label: '高' }, { key: 't', label: '厚' }] },
        reserve: { title: '留位', fields: [{ key: 'w', label: '闊' }, { key: 'h', label: '高' }, { key: 'd', label: '深' }] },
        avoid: { title: '避', fields: [{ key: 'w', label: '闊' }, { key: 'h', label: '高' }, { key: 'd', label: '深' }] }
    };

    const TEMPLATE_ROWS = [
        [
            { id: 'general', l: '一般', f: 'val' }, { id: 'door', l: '門洞', f: 'w_in' }, { id: 'window', l: '窗', f: 'w_in' },
            { id: 'beam', l: '樑', f: 'w' }, { id: 'column', l: '柱', f: 'w' }, { id: 'protrusion', l: '凸', f: 'w' },
            { id: 'pipe', l: '包喉', f: 'w' }
        ],
        [
            { id: 'elec_box', l: '電箱', f: 'w' }, { id: 'ac', l: '冷氣', f: 'w' }, { id: 'fridge', l: '雪柜', f: 'w' },
            { id: 'skirting', l: '地腳線', f: 'h' }, { id: 'reserve', l: '留位', f: 'w' }, { id: 'avoid', l: '避', f: 'w' }
        ]
    ];

    const DIM_QUICK_ROWS = [
        { label: '方位', items: ['闊', '高', '深', '厚', '長'] },
        { label: '離地/頂', items: ['離地', '底到地', '面到地', '頂到天花', '淨高', '完成面'] },
        { label: '邊距', items: ['邊到牆', '左到牆', '右到牆', '中心距', '內空', '外計'] }
    ];

    const KEYPAD_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'ENTER', 'DEL'];
    const DEFAULT_SPACES = ['總圖', '客廳', '飯廳', '玄關', '走廊', '廚房', '主人房', '睡房1', '睡房2', '書房', '工人房', '主廁', '客廁', '露台', '工作平台'];

    const STAMP_PALETTE = [
        { hex: '#ffffff', name: '白' },
        { hex: '#facc15', name: '黃' },
        { hex: '#ef4444', name: '紅' },
        { hex: '#38bdf8', name: '青' },
        { hex: '#a855f7', name: '紫' },
        { hex: '#34d399', name: '綠' },
        { hex: '#fb923c', name: '橙' }
    ];

    // 首次啟動時自動匯入「印章管理」的初始種子字庫 (匯入後全部可自由增減、改色、加星、刪除)
    const DEFAULT_STAMP_SEED = [
        {
            id: 'cat_finishing', icon: '📐', name: '收口', defaultColor: '#38bdf8',
            items: ['留收口位', '鋁條收口', '玻璃膠收邊', '木線收口', '陰角平齊', '收口不見光', '假天花收口', '地腳線收口', '不銹鋼收邊', '雲石收口', '門套收口', '櫃邊封口條']
        },
        {
            id: 'cat_demo', icon: '🔨', name: '清拆', defaultColor: '#ef4444',
            items: ['清拆', '打拆', '保留', '做新', '改位', '封死', '拉平', '剷底', '清走', '見磚', '見石屎']
        },
        {
            id: 'cat_masonry', icon: '🧱', name: '泥水', defaultColor: '#fb923c',
            items: ['批盪', '盪平', '找平', '防水', '試水', '企缸級嘴', '地台去水', '斜水', '鋪磚', '掃口', '對縫', '雲石門檻', '窗台石', '英泥沙', '磚牆', '輕磚牆']
        },
        {
            id: 'cat_wood', icon: '🪵', name: '木工', defaultColor: '#facc15',
            items: ['包喉', '生口', '維修口', '假天花', '燈槽', '窗簾盒', '冷氣殼', '木器', '現場造', '廠造', '見光面', '暗門', '趟門', '掩門', '地腳線', '收口線', '加厚板', '封板']
        },
        {
            id: 'cat_elec', icon: '⚡', name: '電工', defaultColor: '#38bdf8',
            items: ['13A蘇', '雙位蘇', '孖蘇', '防水蘇', 'USB蘇', '單掣', '雙掣', '三掣', '燈位', '筒燈', '燈帶', '火牛位', '網線', 'TV天線', '電話線', '電箱', '曲架掣', '暗喉', '明喉', '入牆']
        },
        {
            id: 'cat_plumb', icon: '🚰', name: '水喉', defaultColor: '#60a5fa',
            items: ['來水', '去水', '冷熱水', '曲尺掣', '總掣', '減壓掣', '地漏', '隔氣', '煤氣喉', '熱水爐位', '洗衣機位', '星盆位', '座廁位', '洗手盆位', '花灑位', '暗喉']
        },
        {
            id: 'cat_paint', icon: '🖌️', name: '油漆', defaultColor: '#34d399',
            items: ['批灰', '油漆', '乳膠漆', '防潮底漆', '手掃漆', '焗漆', '木紋', '牆紙', '藝術漆', '執漏', '修補', '保護']
        },
        {
            id: 'cat_hvac', icon: '❄️', name: '冷氣', defaultColor: '#a855f7',
            items: ['冷氣機位', '雪種喉', '去水喉', '散熱器', '風口', '回風口', '抽氣扇', '抽油煙機喉', '穿牆窿', '鋁窗封板']
        },
        {
            id: 'cat_warn', icon: '⚠️', name: '警示', defaultColor: '#ef4444',
            items: ['主力牆', '主力柱', '橫樑', '不可拆', '不可鑽', '避開喉管', '避開電線', '現場覆尺', '待定', '業主自購', '後補']
        }
    ];

    return { TAG_DEFS, TEMPLATE_ROWS, DIM_QUICK_ROWS, KEYPAD_KEYS, DEFAULT_SPACES, STAMP_PALETTE, DEFAULT_STAMP_SEED };
})();
// === END OF data.js ===
