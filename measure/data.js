window.MEASURE_DATA = (() => {
    // 12 個獨立結構/設備模板定義 (連同「尺寸」共 13 格)
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
            { id: 'general', l: '尺寸', f: 'val' },
            { id: 'door', l: '門洞', f: 'w_in' },
            { id: 'window', l: '窗', f: 'w_in' },
            { id: 'beam', l: '樑', f: 'w' },
            { id: 'column', l: '柱', f: 'w' },
            { id: 'protrusion', l: '凸', f: 'w' }
        ],
        [
            { id: 'pipe', l: '包喉', f: 'w' },
            { id: 'elec_box', l: '電箱', f: 'w' },
            { id: 'ac', l: '冷氣', f: 'w' },
            { id: 'fridge', l: '雪柜', f: 'w' },
            { id: 'skirting', l: '地腳線', f: 'h' },
            { id: 'reserve', l: '留位', f: 'w' },
            { id: 'avoid', l: '避', f: 'w' }
        ]
    ];

    // 「尺寸」快捷標籤排位
    const DIM_QUICK_ROWS = [
        { label: '', items: ['闊', '高', '深'] },
        { label: '', items: ['全闊', '全高', '全深'] },
        { label: '預位', items: ['中>地', '中>邊'] },
        { label: '預位', items: ['底>地', '頂>頂', '邊>邊'] }
    ];

    // 3x4 寬版數字鍵盤
    const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'DEL', '0', 'ENTER'];

    // 預設空間名稱清單
    const DEFAULT_SPACES = ['總圖', '主人房', '睡房一', '睡房二', '客廳', '飯廳', '廚房', '客廁', '套廁', '儲物室', '玄關', '露台'];

    // 8 大工種 87 個工藝印章
    const STAMP_GROUPS = [
        {
            id: 'elec', icon: '⚡', name: '水電', color: '#eab308', badgeClass: 'text-amber-700 bg-amber-50 border-amber-200', btnClass: 'border-amber-300 text-amber-900',
            rows: [['開關', '單蘇', '孖蘇', '燈曲', '數據', '燈線', '預埋50管', '火牛通風', '防水插', '2way', '電力路軌', '13A獨立電源', '過路箱生口', '電箱90°開合']]
        },
        {
            id: 'light', icon: '💡', name: '燈冷', color: '#facc15', badgeClass: 'text-yellow-700 bg-yellow-50 border-yellow-300', btnClass: 'border-yellow-300 text-yellow-900',
            rows: [['燈路軌', 'LED暖', 'LED白', 'LED中性', '分體頂迴風']]
        },
        {
            id: 'masonry', icon: '🧱', name: '泥水', color: '#ef4444', badgeClass: 'text-red-600 bg-red-50 border-red-200', btnClass: 'border-red-200 text-red-700',
            rows: [
                ['需清拆', '可保留', '實地台', '石屎座'],
                ['牆體不平', '空鼓', '滲水', '局部凸出'],
                ['暗牆加固', '磁磚碰角', '石屎墩防水', '地漏坡度', '馬桶去水']
            ]
        },
        {
            id: 'wood', icon: '🪵', name: '木工', color: '#f97316', badgeClass: 'text-orange-600 bg-orange-50 border-orange-200', btnClass: 'border-orange-300 text-orange-800',
            rows: [['收口', '見光', '開背板', '生口板', '避窗簾盒', '留散熱', '要分件', '櫃眉內通', '避柱切角', '生側板', '吊柜頂加固', '分開柜座', '現場生柴']]
        },
        {
            id: 'doorwin', icon: '🚪', name: '門窗', color: '#3b82f6', badgeClass: 'text-blue-600 bg-blue-50 border-blue-200', btnClass: 'border-blue-200 text-blue-700',
            rows: [['留通道', '開門方向', '門洞預留', '暗門平齊', '避開窗手掣', '窗紗門動位', '鎖避位', '門套線厚度', '窗台石切平', '雙軌窗簾盒', '單軌窗簾盒']]
        },
        {
            id: 'kitchen', icon: '🍳', name: '廚房', color: '#22c55e', badgeClass: 'text-emerald-700 bg-emerald-50 border-emerald-200', btnClass: 'border-emerald-300 text-emerald-800',
            rows: [['煙管孔', '止閥開合', '嵌入式水電後移', '雪櫃散熱', '油煙機高度', '轉角拉籃避位', '下水器避管', '檯面擋水條', '吊櫃底燈線', '吊櫃到頂', '爐邊牆距', '洗碗機排管', '背縮避喉']]
        },
        {
            id: 'bath', icon: '🚽', name: '浴室', color: '#06b6d4', badgeClass: 'text-cyan-700 bg-cyan-50 border-cyan-200', btnClass: 'border-cyan-300 text-cyan-800',
            rows: [['鏡櫃到頂', '避水龍頭', '熱水爐檢修', '企缸擋水石埁', '浴屏避馬桶', '抽氣扇通屋外', '掛牆加固', '面盆高度', '浴櫃抽屜避隔氣']]
        },
        {
            id: 'living', icon: '🛋️', name: '廳房', color: '#c084fc', badgeClass: 'text-purple-700 bg-purple-50 border-purple-200', btnClass: 'border-purple-300 text-purple-800',
            rows: [['走廊淨闊度', '電視牆加固', '弱電牛箱', '掃地機充電位', '書枱穿線孔', '大角度門鉸(165°)', '避軟包', '床褥厚度避', '避燈撞門']]
        }
    ];

    const STAMP_COLOR_MAP = {};
    STAMP_GROUPS.forEach(g => g.rows.forEach(r => r.forEach(item => { STAMP_COLOR_MAP[item] = g.color; })));

    return { TAG_DEFS, TEMPLATE_ROWS, DIM_QUICK_ROWS, KEYPAD_KEYS, DEFAULT_SPACES, STAMP_GROUPS, STAMP_COLOR_MAP };
})();
// === END OF data.js ===
