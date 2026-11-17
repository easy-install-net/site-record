window.MEASURE_EXPORT = (() => {
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

    const buildWallSegments = (w) => {
        if (!w) return [];
        const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = Math.hypot(dx, dy);
        if (L < 4) return [];
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
                    segs.push({
                        x1: w.x1 + (c + t0) * ux + t0 * nx, y1: w.y1 + (c + t0) * uy + t0 * ny,
                        x2: w.x1 + (c + t1) * ux + t1 * nx, y2: w.y1 + (c + t1) * uy + t1 * ny,
                        isHatch: true
                    });
                }
            }
        }
        return segs;
    };

    const getLineStroke = (l, alpha = 0.75) => {
        if (!l.type || l.type === 'measure') return `rgba(255, 0, 68, ${alpha})`;
        const legacy = { red: '#ef4444', gray: '#9ca3af', white: '#ffffff' };
        return legacy[l.color] || l.color || '#ef4444';
    };

    // 單行正中上方・高通透 CAD 圖籤膠囊
    const buildWatermarkBox = (item, opts = {}) => {
        const pName = String(opts.projectName || '').trim();
        const spName = String(item?.space || '').trim();
        const leftPart = [pName, spName].filter(Boolean).join(' · ');
        const dStr = opts.itemDate || item?.date || opts.projectDate || '';
        const aStr = opts.itemAuthor || item?.author || opts.projectAuthor || '';
        const rightPart = [dStr, aStr].filter(Boolean).join(' · ');
        const text = [leftPart, rightPart].filter(Boolean).join('  ｜  ');
        if (!text) return null;
        const canvasWidth = opts.canvasWidth || item?.w || 1200;
        const w = Math.min(canvasWidth - 20, Math.max(120, Math.ceil(measureStrWidth(text, 13) + 24)));
        const h = 26;
        const x = Math.max(10, Math.round((canvasWidth - w) / 2));
        const y = 8;
        return { x, y, w, h, text };
    };

    const renderAnnotatedCanvas = (canvasObj, opts = {}) => new Promise(async (resolve) => {
        const img = new Image();
        img.src = canvasObj.photo;
        await new Promise(r => { img.onload = r; img.onerror = r; });

        const c = document.createElement('canvas');
        const w = canvasObj.w || 1200, h = canvasObj.h || 900;
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const markerImages = {};
        for (const m of (canvasObj.markers || [])) {
            if (m.type === 'image' && m.data?.b64) {
                const im = new Image();
                im.src = m.data.b64;
                await new Promise(r => { im.onload = r; im.onerror = r; });
                markerImages[m.id] = im;
            }
        }

        if (opts.includeStamp !== false) {
            const wm = buildWatermarkBox(canvasObj, { ...opts, canvasWidth: w });
            if (wm) {
                ctx.save();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.56)';
                drawRoundRect(ctx, wm.x, wm.y, wm.w, wm.h, 6);
                ctx.fill();
                ctx.lineWidth = 1.2;
                ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
                ctx.stroke();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.font = 'bold 13px sans-serif';
                ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
                ctx.fillText(wm.text, wm.x + wm.w / 2, wm.y + wm.h / 2);
                ctx.restore();
            }
        }

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        (canvasObj.walls || []).forEach(wObj => {
            ctx.strokeStyle = wObj.color || '#111827';
            buildWallSegments(wObj).forEach(seg => {
                ctx.lineWidth = seg.isHatch ? 2.5 : 3.5;
                ctx.beginPath(); ctx.moveTo(seg.x1, seg.y1); ctx.lineTo(seg.x2, seg.y2); ctx.stroke();
            });
        });

        (canvasObj.lines || []).forEach(l => {
            if (l.type === 'arrow-single') {
                const hex = getLineStroke(l);
                ctx.strokeStyle = hex; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
                ctx.save();
                ctx.fillStyle = hex;
                ctx.translate(l.x2, l.y2);
                ctx.rotate(Math.atan2(l.y2 - l.y1, l.x2 - l.x1));
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-9, 4.5); ctx.lineTo(-9, -4.5); ctx.closePath();
                ctx.fill();
                ctx.restore();
            } else if (l.type === 'straight') {
                ctx.strokeStyle = getLineStroke(l); ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
            } else {
                ctx.save();
                ctx.setLineDash([14, 10]);
                ctx.strokeStyle = getLineStroke(l, 0.7); ctx.lineWidth = 5;
                ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
                ctx.restore();
            }
        });

        (canvasObj.paths || []).forEach(p => {
            ctx.strokeStyle = p.color || '#3b82f6'; ctx.lineWidth = 6;
            ctx.stroke(new Path2D(p.d));
        });

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fontScale = opts.fontScale || 0.6;
        const getLines = opts.getMarkerLines || ((m) => [m.data?.val || '']);
        const getColor = opts.getStampColor || ((m) => m.textColor || '#ffffff');

        (canvasObj.markers || []).forEach(m => {
            if (m.type === 'cad') {
                window.MEASURE_CAD?.drawOnCanvas?.(ctx, m);
            } else if (m.type === 'image') {
                if (markerImages[m.id]) {
                    ctx.save();
                    ctx.translate(m.x, m.y);
                    ctx.rotate(((m.rot || 0) * Math.PI) / 180);
                    ctx.drawImage(markerImages[m.id], -m.w / 2, -m.h / 2, m.w, m.h);
                    ctx.restore();
                }
            } else {
                const lines = getLines(m), color = getColor(m);
                ctx.font = `900 ${28 * fontScale}px sans-serif`;
                const startY = m.y - ((lines.length - 1) * 34 * fontScale) / 2;
                lines.forEach((line, i) => {
                    const y = startY + i * 34 * fontScale;
                    ctx.lineWidth = 7 * fontScale;
                    ctx.strokeStyle = '#000';
                    ctx.lineJoin = 'round';
                    ctx.strokeText(line, m.x, y);
                    ctx.fillStyle = color;
                    ctx.fillText(line, m.x, y);
                });
            }
        });

        (canvasObj.pins || []).forEach((pin, idx) => {
            const px = (pin.x / 100) * w, py = (pin.y / 100) * h;
            ctx.beginPath(); ctx.arc(px, py - 22, 20, 0, 2 * Math.PI);
            ctx.fillStyle = '#dc2626'; ctx.fill();
            ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.font = 'bold 22px sans-serif';
            ctx.fillText(idx + 1, px, py - 22);
        });

        resolve(c);
    });

    const copyAnnotatedImage = async (item, opts = {}) => {
        if (!item?.photo) return;
        const c = await renderAnnotatedCanvas(item, opts);
        try {
            if (navigator.clipboard && window.ClipboardItem) {
                const blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(), 'image/png'));
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                opts.onToast?.('✅ 已複製圖片');
                return;
            }
        } catch (_) {}
        try {
            const blob = await new Promise(res => c.toBlob(res, 'image/png'));
            const file = new File([blob], 'measure.png', { type: 'image/png' });
            if (navigator.canShare?.({ files: [file] })) {
                await navigator.share({ files: [file] });
                return;
            }
        } catch (_) {}
        alert('此瀏覽器不支援直接複製圖片，請按旁邊「⬇️下載」');
    };

    const downloadAnnotatedImage = async (item, opts = {}) => {
        if (!item?.photo) return;
        try {
            const dStr = sanitizeFilename(opts.itemDate || getTodayStr());
            const c = await renderAnnotatedCanvas(item, opts);
            const url = URL.createObjectURL(await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92)));
            const a = document.createElement('a');
            a.href = url;
            a.download = `${sanitizeFilename(opts.projectName || '工程')}_#${opts.projectCode || ''}_${sanitizeFilename(opts.label || '圖紙')}_${dStr}.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            opts.onToast?.('✅ 已下載圖片');
        } catch (_) {
            alert('下載圖片失敗');
        }
    };

    const generatePdfReport = async (pagesList, projectInfo, opts = {}) => {
        const perPage = opts.perPage || 1;
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const PAGE_W = 1240, PAGE_H = 1754, validPages = [];

        (pagesList || []).forEach((pg, pIdx) => {
            const pgDate = pg.date || projectInfo.date || getTodayStr();
            const pgAuthor = pg.author || projectInfo.lastModifiedBy || '未知';
            if (pg.photo) {
                validPages.push({ ...pg, date: pgDate, author: pgAuthor, pdfLabel: `P${pIdx + 1}${pg.space ? ' [' + pg.space + ']' : ''}` });
            }
            (pg.pins || []).forEach((pin, pinIdx) => {
                if (pin.photo) {
                    validPages.push({ ...pin, date: pgDate, author: pgAuthor, pdfLabel: `P${pIdx + 1} 📍釘選#${pinIdx + 1}${pin.space ? ' [' + pin.space + ']' : ''}` });
                }
            });
        });

        if (!validPages.length) {
            alert('沒有可輸出的圖紙！');
            return;
        }

        const uniqueDates = [...new Set(validPages.map(p => p.date).filter(Boolean))];
        const headerDate = uniqueDates.length > 1 ? `${uniqueDates[0]} ~ ${uniqueDates[uniqueDates.length - 1]}` : (uniqueDates[0] || getTodayStr());
        const fileDateTag = sanitizeFilename(uniqueDates[uniqueDates.length - 1] || getTodayStr());
        const baseRenderOpts = {
            includeStamp: true,
            projectName: projectInfo.name || '',
            projectDate: projectInfo.date || '',
            projectAuthor: projectInfo.lastModifiedBy || '',
            fontScale: opts.fontScale || 0.6,
            getMarkerLines: opts.getMarkerLines,
            getStampColor: opts.getStampColor
        };

        if (perPage > 1) {
            const cols = perPage === 4 ? 2 : 1, rows = 2;
            const totalPdf = Math.ceil(validPages.length / perPage), mx = 45, topY = 115, gap = 24;
            const cellW = Math.floor((PAGE_W - mx * 2 - (cols - 1) * gap) / cols);
            const cellH = Math.floor((PAGE_H - topY - 45 - (rows - 1) * gap) / rows);

            for (let pIdx = 0; pIdx < totalPdf; pIdx++) {
                if (pIdx > 0) doc.addPage();
                const c = document.createElement('canvas'); c.width = PAGE_W; c.height = PAGE_H;
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
                ctx.fillStyle = '#000'; ctx.font = 'bold 34px sans-serif';
                ctx.fillText(`${projectInfo.name || '工程度尺'} (#${projectInfo.code})`, mx, 60);
                ctx.font = 'bold 21px sans-serif'; ctx.fillStyle = '#4b5563';
                ctx.fillText(`日期: ${headerDate}   |   共 ${validPages.length} 張   |   第 ${pIdx + 1} / ${totalPdf} 頁`, mx, 94);

                for (let j = 0; j < perPage; j++) {
                    const pg = validPages[pIdx * perPage + j];
                    if (!pg) break;
                    const cx = mx + (j % cols) * (cellW + gap), cy = topY + Math.floor(j / cols) * (cellH + gap);
                    ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 2; ctx.strokeRect(cx, cy, cellW, cellH);
                    ctx.fillStyle = '#f3f4f6'; ctx.fillRect(cx + 1, cy + 1, cellW - 2, 44);
                    ctx.fillStyle = '#111827'; ctx.font = 'bold 20px sans-serif';
                    ctx.fillText(`${pg.pdfLabel} (${pg.date})`.slice(0, cols === 1 ? 56 : 32), cx + 14, cy + 30);

                    const im = await renderAnnotatedCanvas(pg, { ...baseRenderOpts, itemDate: pg.date, itemAuthor: pg.author });
                    const maxW = cellW - 20, maxH = cellH - 60;
                    let dw = maxW, dh = (im.height / im.width) * dw;
                    if (dh > maxH) { dh = maxH; dw = (im.width / im.height) * dh; }
                    ctx.drawImage(im, cx + 10 + (maxW - dw) / 2, cy + 52 + (maxH - dh) / 2, dw, dh);
                }
                doc.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, 210, 297);
            }
        } else {
            for (let i = 0; i < validPages.length; i++) {
                if (i > 0) doc.addPage();
                const pg = validPages[i], c = document.createElement('canvas'); c.width = PAGE_W; c.height = PAGE_H;
                const ctx = c.getContext('2d');
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
                ctx.fillStyle = '#000'; ctx.font = 'bold 38px sans-serif';
                ctx.fillText(`${projectInfo.name || '工程度尺'} (#${projectInfo.code}) — ${pg.pdfLabel}`, 50, 65);
                ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = '#4b5563';
                ctx.fillText(`日期: ${pg.date}   |   最後修改: ${pg.author}`, 50, 102);

                const im = await renderAnnotatedCanvas(pg, { ...baseRenderOpts, itemDate: pg.date, itemAuthor: pg.author });
                const maxW = PAGE_W - 100, maxH = PAGE_H - 180;
                let dw = maxW, dh = (im.height / im.width) * dw;
                if (dh > maxH) { dh = maxH; dw = (im.width / im.height) * dh; }
                ctx.drawImage(im, 50 + (maxW - dw) / 2, 130, dw, dh);
                doc.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, 210, 297);
            }
        }

        const modeTag = perPage === 4 ? '4合1' : perPage === 2 ? '2合1' : '單頁';
        doc.save(`${sanitizeFilename(projectInfo.name || '工程')}_#${projectInfo.code}_${fileDateTag}_${modeTag}.pdf`);
    };

    return {
        buildWallSegments,
        getLineStroke,
        buildWatermarkBox,
        renderAnnotatedCanvas,
        copyAnnotatedImage,
        downloadAnnotatedImage,
        generatePdfReport
    };
})();
// === END OF export.js ===
