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
        { label: '', items: ['闊', '高', '深'] },
        { label: '', items: ['全闊', '全高', '全深'] },
        { label: '預位:', items: ['中>地', '中>邊'] },
        { label: '', items: ['底地v', '邊頂^', '<邊左', '邊右>'] }
    ];

    const KEYPAD_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'ENTER', 'DEL'];
    const DEFAULT_SPACES = ['總圖', '客廳', '飯廳', '玄關', '走廊', '廚房', '主人房', '睡房1', '睡房2', '書房', '工人房', '主廁', '客廁', '露台', '工作平台'];

    const STAMP_PALETTE = [
        { hex: '#ffffff', name: '白' },
        { hex: '#ef4444', name: '紅' },
        { hex: '#eab308', name: '黃' },
        { hex: '#38bdf8', name: '青' },
        { hex: '#34d399', name: '綠' }
    ];

    // 首次啟動時自動匯入「印章管理」的初始種子字庫 (共 7 大分類、74 個裝修專業印章)
    const DEFAULT_STAMP_SEED = [
        {
            id: 'cat_elec', icon: '⚡', name: '電工', defaultColor: '#ffffff',
            items: ['開關', '單蘇', '孖蘇', '燈曲', '數據', '燈線', '預埋50管', '火牛通風', '防水插', '2way', '電力路軌', '13A獨立電源', '過路箱生口', '電箱90°開合']
        },
        {
            id: 'cat_light', icon: '💡', name: '燈冷', defaultColor: '#ffffff',
            items: ['燈路軌', 'LED暖', 'LED白', 'LED中性', '分體頂迴風']
        },
        {
            id: 'cat_wood', icon: '🪵', name: '木工', defaultColor: '#ffffff',
            items: ['收口', '見光', '開背板', '生口板', '避窗簾盒', '留散熱', '要分件', '櫃眉內通', '避柱切角', '生側板', '吊柜頂加固', '分開柜座', '現場生柴']
        },
        {
            id: 'cat_door', icon: '🚪', name: '門窗', defaultColor: '#ffffff',
            items: ['留通道', '開門方向', '門洞預留', '暗門平齊', '避開窗手掣', '窗紗門動位', '鎖避位', '門套線厚度', '窗台石切平', '雙軌窗簾盒', '單軌窗簾盒']
        },
        {
            id: 'cat_kitchen', icon: '🍳', name: '廚房', defaultColor: '#ffffff',
            items: ['煙管孔', '止閥開合', '嵌入式水電後移', '雪櫃散熱', '油煙機高度', '轉角拉籃避位', '下水器避管', '檯面擋水條', '吊櫃底燈線', '吊櫃到頂', '爐邊牆距', '洗碗機排管', '背縮避喉']
        },
        {
            id: 'cat_bath', icon: '🚽', name: '浴廁', defaultColor: '#ffffff',
            items: ['鏡櫃到頂', '避水龍頭', '熱水爐檢修', '企缸擋水石埁', '浴屏避馬桶', '抽氣扇通屋外', '掛牆加固', '面盆高度', '浴櫃抽屜避隔氣']
        },
        {
            id: 'cat_living', icon: '🛋️', name: '廳房', defaultColor: '#ffffff',
            items: ['走廊淨闊度', '電視牆加固', '弱電牛箱', '掃地機充電位', '書枱穿線孔', '大角度門鉸(165°)', '避軟包', '床褥厚度避', '避燈撞門']
        }
    ];

    return { TAG_DEFS, TEMPLATE_ROWS, DIM_QUICK_ROWS, KEYPAD_KEYS, DEFAULT_SPACES, STAMP_PALETTE, DEFAULT_STAMP_SEED };
})();
// === END OF data.js ===
