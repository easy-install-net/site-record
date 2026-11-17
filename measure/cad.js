window.MEASURE_CAD = (() => {
    const CAD_CATEGORIES = [
        { id: 'arch', name: '🚪 門窗牆柱' },
        { id: 'living', name: '🛋️ 廳房傢俬' },
        { id: 'bath_kit', name: '🚽 廚廁潔具' }
    ];

    const CAD_DEFS = {
        // === 1. 門窗牆柱 ===
        door_single: {
            cat: 'arch', label: '單開門', w: 90, h: 90,
            shapes: [
                { t: 'rect', x: -45, y: -45, w: 7, h: 90, sw: 2.5, fillBg: true },
                { t: 'path', d: 'M 45 45 A 90 90 0 0 0 -45 -45', sw: 1.8, dash: [6, 4] },
                { t: 'line', x1: -48, y1: 45, x2: -36, y2: 45, sw: 3 },
                { t: 'line', x1: 36, y1: 45, x2: 48, y2: 45, sw: 3 }
            ]
        },
        door_double: {
            cat: 'arch', label: '雙開門', w: 150, h: 80,
            shapes: [
                { t: 'rect', x: -75, y: -35, w: 6, h: 75, sw: 2.5, fillBg: true },
                { t: 'rect', x: 69, y: -35, w: 6, h: 75, sw: 2.5, fillBg: true },
                { t: 'path', d: 'M 0 40 A 75 75 0 0 0 -75 -35', sw: 1.8, dash: [6, 4] },
                { t: 'path', d: 'M 0 40 A 75 75 0 0 1 75 -35', sw: 1.8, dash: [6, 4] },
                { t: 'line', x1: -78, y1: 40, x2: -66, y2: 40, sw: 3 },
                { t: 'line', x1: 66, y1: 40, x2: 78, y2: 40, sw: 3 }
            ]
        },
        door_slide: {
            cat: 'arch', label: '趟門', w: 140, h: 24,
            shapes: [
                { t: 'line', x1: -70, y1: -11, x2: -70, y2: 11, sw: 3 },
                { t: 'line', x1: 70, y1: -11, x2: 70, y2: 11, sw: 3 },
                { t: 'rect', x: -68, y: -6, w: 74, h: 5, sw: 2, fillBg: true },
                { t: 'rect', x: -6, y: 1, w: 74, h: 5, sw: 2, fillBg: true }
            ]
        },
        win_std: {
            cat: 'arch', label: '三線窗', w: 120, h: 18,
            shapes: [
                { t: 'rect', x: -60, y: -9, w: 120, h: 18, sw: 2.5, fillBg: true },
                { t: 'line', x1: -60, y1: 0, x2: 60, y2: 0, sw: 1.8 }
            ]
        },
        win_bay: {
            cat: 'arch', label: '凸窗台', w: 140, h: 48,
            shapes: [
                { t: 'path', d: 'M -70 24 L -70 -24 L 70 -24 L 70 24', sw: 2.8 },
                { t: 'path', d: 'M -58 24 L -58 -12 L 58 -12 L 58 24', sw: 2 },
                { t: 'line', x1: -70, y1: 24, x2: 70, y2: 24, sw: 1.8, dash: [6, 4] }
            ]
        },
        pillar: {
            cat: 'arch', label: '實心柱', w: 46, h: 46,
            shapes: [
                { t: 'rect', x: -23, y: -23, w: 46, h: 46, sw: 2.8, fillSolid: true },
                { t: 'line', x1: -23, y1: -23, x2: 23, y2: 23, sw: 1.8 },
                { t: 'line', x1: -23, y1: 23, x2: 23, y2: -23, sw: 1.8 }
            ]
        },

        // === 2. 廳房傢俬 ===
        sofa_3: {
            cat: 'living', label: '三人梳化', w: 180, h: 80,
            shapes: [
                { t: 'rect', x: -90, y: -40, w: 180, h: 80, rx: 6, sw: 2.5, fillBg: true },
                { t: 'rect', x: -90, y: -40, w: 180, h: 20, rx: 4, sw: 2.2 },
                { t: 'rect', x: -90, y: -22, w: 20, h: 62, rx: 4, sw: 2.2 },
                { t: 'rect', x: 70, y: -22, w: 20, h: 62, rx: 4, sw: 2.2 },
                { t: 'line', x1: -23, y1: -20, x2: -23, y2: 40, sw: 1.8 },
                { t: 'line', x1: 23, y1: -20, x2: 23, y2: 40, sw: 1.8 }
            ]
        },
        sofa_l: {
            cat: 'living', label: 'L型梳化', w: 190, h: 134,
            shapes: [
                { t: 'path', d: 'M -95 -67 L 95 -67 L 95 67 L 25 67 L 25 13 L -95 13 Z', sw: 2.5 },
                { t: 'rect', x: -95, y: -67, w: 190, h: 20, sw: 2.2 },
                { t: 'rect', x: -95, y: -47, w: 20, h: 60, sw: 2.2 },
                { t: 'rect', x: 75, y: -47, w: 20, h: 114, sw: 2.2 },
                { t: 'line', x1: -25, y1: -47, x2: -25, y2: 13, sw: 1.8 },
                { t: 'line', x1: 25, y1: -47, x2: 25, y2: 13, sw: 1.8 }
            ]
        },
        coffee_tbl: {
            cat: 'living', label: '茶幾', w: 110, h: 54,
            shapes: [
                { t: 'rect', x: -55, y: -27, w: 110, h: 54, rx: 6, sw: 2.5, fillBg: true },
                { t: 'rect', x: -47, y: -20, w: 94, h: 40, rx: 3, sw: 1.6 }
            ]
        },
        tv_unit: {
            cat: 'living', label: '電視櫃', w: 160, h: 44,
            shapes: [
                { t: 'rect', x: -80, y: -22, w: 160, h: 44, sw: 2.5, fillBg: true },
                { t: 'rect', x: -55, y: -5, w: 110, h: 6, sw: 2.2 }
            ]
        },
        dining_6: {
            cat: 'living', label: '餐枱椅', w: 184, h: 100,
            shapes: [
                { t: 'rect', x: -74, y: -32, w: 148, h: 64, rx: 4, sw: 2.5, fillBg: true },
                { t: 'rect', x: -50, y: -48, w: 34, h: 12, rx: 3, sw: 2 },
                { t: 'rect', x: 16, y: -48, w: 34, h: 12, rx: 3, sw: 2 },
                { t: 'rect', x: -50, y: 36, w: 34, h: 12, rx: 3, sw: 2 },
                { t: 'rect', x: 16, y: 36, w: 34, h: 12, rx: 3, sw: 2 },
                { t: 'rect', x: -90, y: -17, w: 12, h: 34, rx: 3, sw: 2 },
                { t: 'rect', x: 78, y: -17, w: 12, h: 34, rx: 3, sw: 2 }
            ]
        },
        dining_round: {
            cat: 'living', label: '圓餐枱', w: 112, h: 112,
            shapes: [
                { t: 'circle', cx: 0, cy: 0, r: 38, sw: 2.5, fillBg: true },
                { t: 'rect', x: -16, y: -54, w: 32, h: 11, rx: 3, sw: 2 },
                { t: 'rect', x: -16, y: 43, w: 32, h: 11, rx: 3, sw: 2 },
                { t: 'rect', x: -54, y: -16, w: 11, h: 32, rx: 3, sw: 2 },
                { t: 'rect', x: 43, y: -16, w: 11, h: 32, rx: 3, sw: 2 }
            ]
        },
        bed_double: {
            cat: 'living', label: '雙人床', w: 150, h: 190,
            shapes: [
                { t: 'rect', x: -75, y: -95, w: 150, h: 190, rx: 4, sw: 2.5, fillBg: true },
                { t: 'rect', x: -75, y: -95, w: 150, h: 14, sw: 2.5 },
                { t: 'rect', x: -60, y: -72, w: 50, h: 28, rx: 5, sw: 2 },
                { t: 'rect', x: 10, y: -72, w: 50, h: 28, rx: 5, sw: 2 },
                { t: 'line', x1: -75, y1: -30, x2: 75, y2: -30, sw: 2 },
                { t: 'line', x1: -75, y1: -20, x2: 75, y2: -20, sw: 1.6 }
            ]
        },
        bed_single: {
            cat: 'living', label: '單人床', w: 96, h: 190,
            shapes: [
                { t: 'rect', x: -48, y: -95, w: 96, h: 190, rx: 4, sw: 2.5, fillBg: true },
                { t: 'rect', x: -48, y: -95, w: 96, h: 14, sw: 2.5 },
                { t: 'rect', x: -28, y: -72, w: 56, h: 28, rx: 5, sw: 2 },
                { t: 'line', x1: -48, y1: -30, x2: 48, y2: -30, sw: 2 }
            ]
        },
        wardrobe: {
            cat: 'living', label: '衣櫃', w: 160, h: 58,
            shapes: [
                { t: 'rect', x: -80, y: -29, w: 160, h: 58, sw: 2.5, fillBg: true },
                { t: 'line', x1: -80, y1: -29, x2: 80, y2: 29, sw: 1.8 },
                { t: 'line', x1: 0, y1: -29, x2: 0, y2: 29, sw: 2 }
            ]
        },
        desk: {
            cat: 'living', label: '書枱椅', w: 120, h: 86,
            shapes: [
                { t: 'rect', x: -60, y: -40, w: 120, h: 52, sw: 2.5, fillBg: true },
                { t: 'rect', x: -20, y: 18, w: 40, h: 20, rx: 6, sw: 2, fillBg: true },
                { t: 'path', d: 'M -24 34 Q 0 46 24 34', sw: 2.2 }
            ]
        },

        // === 3. 廚廁潔具 ===
        toilet: {
            cat: 'bath_kit', label: '座廁', w: 46, h: 70,
            shapes: [
                { t: 'rect', x: -22, y: -35, w: 44, h: 18, rx: 3, sw: 2.4, fillBg: true },
                { t: 'ellipse', cx: 0, cy: 10, rx: 19, ry: 25, sw: 2.4, fillBg: true },
                { t: 'ellipse', cx: 0, cy: 11, rx: 13, ry: 18, sw: 1.6 }
            ]
        },
        basin: {
            cat: 'bath_kit', label: '洗手盆', w: 66, h: 50,
            shapes: [
                { t: 'rect', x: -33, y: -25, w: 66, h: 50, rx: 3, sw: 2.4, fillBg: true },
                { t: 'ellipse', cx: 0, cy: 3, rx: 22, ry: 16, sw: 2 },
                { t: 'circle', cx: 0, cy: 3, r: 3, sw: 1.8 },
                { t: 'line', x1: 0, y1: -22, x2: 0, y2: -10, sw: 2.5 }
            ]
        },
        shower: {
            cat: 'bath_kit', label: '企缸', w: 90, h: 90,
            shapes: [
                { t: 'rect', x: -45, y: -45, w: 90, h: 90, sw: 2.5, fillBg: true },
                { t: 'line', x1: -45, y1: -45, x2: 45, y2: 45, sw: 1.6 },
                { t: 'line', x1: 45, y1: -45, x2: -45, y2: 45, sw: 1.6 },
                { t: 'circle', cx: 0, cy: 0, r: 5, sw: 2, fillBg: true }
            ]
        },
        bathtub: {
            cat: 'bath_kit', label: '浴缸', w: 150, h: 70,
            shapes: [
                { t: 'rect', x: -75, y: -35, w: 150, h: 70, rx: 4, sw: 2.5, fillBg: true },
                { t: 'rect', x: -65, y: -26, w: 130, h: 52, rx: 18, sw: 2 },
                { t: 'circle', cx: -48, cy: 0, r: 4, sw: 2 }
            ]
        },
        stove: {
            cat: 'bath_kit', label: '雙頭爐', w: 76, h: 46,
            shapes: [
                { t: 'rect', x: -38, y: -23, w: 76, h: 46, rx: 3, sw: 2.4, fillBg: true },
                { t: 'circle', cx: -18, cy: 0, r: 12, sw: 2 },
                { t: 'circle', cx: -18, cy: 0, r: 5, sw: 1.6 },
                { t: 'circle', cx: 18, cy: 0, r: 12, sw: 2 },
                { t: 'circle', cx: 18, cy: 0, r: 5, sw: 1.6 }
            ]
        },
        sink_single: {
            cat: 'bath_kit', label: '單星盆', w: 76, h: 48,
            shapes: [
                { t: 'rect', x: -38, y: -24, w: 76, h: 48, rx: 3, sw: 2.4, fillBg: true },
                { t: 'rect', x: -30, y: -15, w: 60, h: 33, rx: 6, sw: 2 },
                { t: 'circle', cx: 0, cy: 2, r: 4, sw: 1.8 },
                { t: 'line', x1: 0, y1: -22, x2: 0, y2: -11, sw: 2.5 }
            ]
        },
        sink_double: {
            cat: 'bath_kit', label: '雙星盆', w: 108, h: 48,
            shapes: [
                { t: 'rect', x: -54, y: -24, w: 108, h: 48, rx: 3, sw: 2.4, fillBg: true },
                { t: 'rect', x: -47, y: -15, w: 43, h: 32, rx: 5, sw: 2 },
                { t: 'circle', cx: -25, cy: 1, r: 3.5, sw: 1.8 },
                { t: 'rect', x: 4, y: -15, w: 43, h: 32, rx: 5, sw: 2 },
                { t: 'circle', cx: 25, cy: 1, r: 3.5, sw: 1.8 },
                { t: 'line', x1: 0, y1: -22, x2: 0, y2: -11, sw: 2.5 }
            ]
        },
        fridge_cad: {
            cat: 'bath_kit', label: '雪櫃位', w: 70, h: 70,
            shapes: [
                { t: 'rect', x: -35, y: -35, w: 70, h: 70, sw: 2.5, fillBg: true },
                { t: 'line', x1: -35, y1: 23, x2: 35, y2: 23, sw: 2 },
                { t: 'line', x1: -35, y1: -35, x2: 35, y2: 23, sw: 1.6 }
            ]
        }
    };

    const CAD_LIST = Object.entries(CAD_DEFS).map(([id, def]) => ({ id, ...def }));

    const drawOnCanvas = (ctx, m) => {
        const def = CAD_DEFS[m.data?.cadType];
        if (!def) return;
        const sc = m.scale || 1, fx = m.flipX || 1, fy = m.flipY || 1;
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(((m.rot || 0) * Math.PI) / 180);
        ctx.scale(sc * fx, sc * fy);
        ctx.strokeStyle = m.color || '#111827';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        def.shapes.forEach(s => {
            ctx.save();
            ctx.lineWidth = s.sw || 2.5;
            if (s.dash) ctx.setLineDash(s.dash);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
            if (s.t === 'rect') {
                ctx.beginPath();
                if (s.rx && ctx.roundRect) ctx.roundRect(s.x, s.y, s.w, s.h, s.rx);
                else ctx.rect(s.x, s.y, s.w, s.h);
                if (s.fillSolid) {
                    ctx.fillStyle = m.color || '#111827';
                    ctx.globalAlpha = 0.2;
                    ctx.fill();
                    ctx.globalAlpha = 1;
                } else if (s.fillBg) {
                    ctx.fill();
                }
                ctx.stroke();
            } else if (s.t === 'line') {
                ctx.beginPath();
                ctx.moveTo(s.x1, s.y1);
                ctx.lineTo(s.x2, s.y2);
                ctx.stroke();
            } else if (s.t === 'circle') {
                ctx.beginPath();
                ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
                if (s.fillBg) ctx.fill();
                ctx.stroke();
            } else if (s.t === 'ellipse') {
                ctx.beginPath();
                ctx.ellipse(s.cx, s.cy, s.rx, s.ry, 0, 0, Math.PI * 2);
                if (s.fillBg) ctx.fill();
                ctx.stroke();
            } else if (s.t === 'path') {
                ctx.stroke(new Path2D(s.d));
            }
            ctx.restore();
        });
        ctx.restore();
    };

    return { CAD_CATEGORIES, CAD_DEFS, CAD_LIST, drawOnCanvas };
})();
// === END OF cad.js ===
