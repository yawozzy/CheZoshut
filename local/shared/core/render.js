/* ЦеЗошит — рендер документа на Canvas (shared/core/render.js) */
(function (SZ) {
  'use strict';
  const U = SZ.U;
  const { PAGE_W, PAGE_H, DEFAULT_FONTS } = SZ.Doc;

  /* ---------- Фоны ---------- */
  const BGRenderer = {
    ruled(ctx) {
      const step = 46, top = 140;
      ctx.strokeStyle = '#9ec3e8'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = top; y < PAGE_H - 60; y += step) { ctx.moveTo(70, y + .5); ctx.lineTo(PAGE_W - 70, y + .5); }
      ctx.stroke();
      ctx.strokeStyle = '#e8a0a0'; ctx.beginPath(); ctx.moveTo(120.5, top - 20); ctx.lineTo(120.5, PAGE_H - 60); ctx.stroke();
    },
    grid(ctx) {
      const step = 34;
      ctx.strokeStyle = '#b3d4ea'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 70; x <= PAGE_W - 70; x += step) { ctx.moveTo(x + .5, 60); ctx.lineTo(x + .5, PAGE_H - 60); }
      for (let y = 60; y <= PAGE_H - 60; y += step) { ctx.moveTo(70, y + .5); ctx.lineTo(PAGE_W - 70, y + .5); }
      ctx.stroke();
    },
    slant(ctx) {
      // Прописи: 3 линии — основная (яркая), верх/низ (тонкие) + наклонные помощники + поля
      const row = 100, top = 150;
      const main = '#8fb8de', thin = '#cfe0ee';
      // верхняя и нижняя тонкие линии каждой строки
      ctx.strokeStyle = thin; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = top; y <= PAGE_H - 80; y += row) {
        ctx.moveTo(70, y - row * 0.28 + .5); ctx.lineTo(PAGE_W - 70, y - row * 0.28 + .5);
        ctx.moveTo(70, y + row * 0.36 + .5); ctx.lineTo(PAGE_W - 70, y + row * 0.36 + .5);
      }
      ctx.stroke();
      // основная линия
      ctx.strokeStyle = main; ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let y = top; y <= PAGE_H - 80; y += row) { ctx.moveTo(70, y + .5); ctx.lineTo(PAGE_W - 70, y + .5); }
      ctx.stroke();
      // наклонные линии-помощники (60°) — внутри каждой строки, шагом ~ряд букв
      ctx.strokeStyle = '#dce9f3'; ctx.lineWidth = 1;
      ctx.beginPath();
      const slope = row * 0.64 / Math.tan(Math.PI / 3); // dx при подъёме 0.64*row
      for (let y = top; y <= PAGE_H - 80; y += row) {
        for (let x = 90; x < PAGE_W - 90; x += 120) {
          ctx.moveTo(x, y + row * 0.36); ctx.lineTo(x + slope, y - row * 0.28);
        }
      }
      ctx.stroke();
      // красная вертикаль поля
      ctx.strokeStyle = '#e8a0a0'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(120.5, top - 60); ctx.lineTo(120.5, PAGE_H - 60); ctx.stroke();
    },
    plain(ctx) { /* ничего */ }
  };

  /* ---------- Объекты ---------- */
  function drawPath(ctx, o) {
    const pts = U.smooth(o.points, 2);
    if (!pts.length) return;
    ctx.strokeStyle = o.color || '#1d3557';
    ctx.lineWidth = o.width || 3;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (pts.length === 1) { ctx.lineTo(pts[0].x + .01, pts[0].y); }
    ctx.stroke();
  }

  function drawShape(ctx, o) {
    const x = Math.min(o.x, o.x + o.w), y = Math.min(o.y, o.y + o.h);
    const w = Math.abs(o.w), h = Math.abs(o.h);
    ctx.strokeStyle = o.color || '#1d3557';
    ctx.lineWidth = o.width || 3;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (o.fill && o.fill !== 'none') ctx.fillStyle = o.fill;
    ctx.beginPath();
    switch (o.shape) {
      case 'rect':
        if (o.fill && o.fill !== 'none') ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h); break;
      case 'ellipse':
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        if (o.fill && o.fill !== 'none') ctx.fill();
        ctx.stroke(); break;
      case 'line':
        ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + o.w, o.y + o.h); ctx.stroke(); break;
      case 'arrow': {
        const x2 = o.x + o.w, y2 = o.y + o.h;
        ctx.moveTo(o.x, o.y); ctx.lineTo(x2, y2); ctx.stroke();
        const ang = Math.atan2(o.h, o.w), hl = Math.max(12, (o.width || 3) * 4);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - hl * Math.cos(ang - Math.PI / 6), y2 - hl * Math.sin(ang - Math.PI / 6));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - hl * Math.cos(ang + Math.PI / 6), y2 - hl * Math.sin(ang + Math.PI / 6));
        ctx.stroke(); break;
      }
      case 'triangle':
        ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
        if (o.fill && o.fill !== 'none') ctx.fill();
        ctx.stroke(); break;
    }
  }

  function textLines(o) {
    // примитивный wrap по ширине o.w
    const maxW = o.w || 400;
    const paras = String(o.text || '').split('\n');
    const lines = [];
    const ctx = TextMeasure.ensure();
    applyTextStyle(ctx, o);
    for (const para of paras) {
      if (!para) { lines.push(''); continue; }
      const words = para.split(' ');
      let cur = '';
      for (const wd of words) {
        const test = cur ? cur + ' ' + wd : wd;
        if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = wd; }
        else cur = test;
      }
      lines.push(cur);
    }
    return lines;
  }

  function applyTextStyle(ctx, o) {
    let f = '';
    if (o.italic) f += 'italic ';
    if (o.bold) f += 'bold ';
    const fam = DEFAULT_FONTS[o.fontClass] || DEFAULT_FONTS.print;
    ctx.font = `${f}${o.size || 24}px ${fam}`;
    ctx.fillStyle = o.color || '#1d3557';
  }

  function drawText(ctx, o) {
    const lines = textLines(o);
    const lh = (o.size || 24) * 1.35;
    let y = o.y + (o.size || 24);
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (line) {
        ctx.save();
        applyTextStyle(ctx, o);
        let x = o.x;
        const lineW = ctx.measureText(line).width;
        if (o.align === 'center') x = o.x + ((o.w || 400) - lineW) / 2;
        else if (o.align === 'right') x = o.x + (o.w || 400) - lineW;
        let dy = 0;
        if (o.sup) { ctx.font = ctx.font.replace(/(\d+)px/, (m, n) => (n * .7) + 'px'); dy = -lh * .45; }
        if (o.sub) { ctx.font = ctx.font.replace(/(\d+)px/, (m, n) => (n * .7) + 'px'); dy = lh * .2; }
        ctx.fillText(line, x, y + dy);
        if (o.underline || o.strike) {
          ctx.strokeStyle = o.color || '#1d3557';
          ctx.lineWidth = Math.max(1, (o.size || 24) / 14);
          const uy = o.strike ? y - (o.size || 24) * .35 : y + 3;
          ctx.beginPath(); ctx.moveTo(x, uy); ctx.lineTo(x + lineW, uy); ctx.stroke();
        }
        ctx.restore();
      }
      y += lh;
    }
  }

  const TextMeasure = { ctx: null, ensure() { if (!this.ctx) this.ctx = document.createElement('canvas').getContext('2d'); return this.ctx; } };

  function textHeight(o) {
    const lines = textLines(o);
    return lines.length * (o.size || 24) * 1.35 + 8;
  }

  function drawImage(ctx, o) {
    let img = ImgCache.get(o.src);
    if (!img) { ImgCache.load(o.src); }
    if (img) ctx.drawImage(img, o.x, o.y, o.w, o.h);
    else {
      ctx.fillStyle = '#eef2f7'; ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = '#b8c4d0'; ctx.setLineDash([6, 4]); ctx.strokeRect(o.x, o.y, o.w, o.h); ctx.setLineDash([]);
    }
  }

  const ImgCache = {
    map: new Map(),
    get(src) { return this.map.get(src) || null; },
    load(src, cb) {
      if (this.map.has(src)) { const v = this.map.get(src); if (cb && v) cb(v); return; }
      this.map.set(src, null); // маркер «загружается»
      const img = new Image();
      img.onload = () => { this.map.set(src, img); if (cb) cb(img); SZ.App && SZ.App.requestRender && SZ.App.requestRender(); };
      img.onerror = () => this.map.delete(src);
      img.src = src;
    },
    preload(objects, cb) {
      let n = 0;
      (objects || []).forEach(o => { if (o.type === 'image') { n++; this.load(o.src, () => { if (--n <= 0 && cb) cb(); }); } });
      if (n === 0 && cb) cb();
    }
  };

  const STICKER_COLORS = { yellow: '#fff3b0', green: '#d8f3dc', blue: '#dbe9ff', pink: '#ffd6e0', purple: '#e8d8ff' };

  function drawSticker(ctx, o) {
    const col = STICKER_COLORS[o.color] || STICKER_COLORS.yellow;
    const w = o.w || 220, h = o.h || 180;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    ctx.fillStyle = col;
    roundRect(ctx, o.x, o.y, w, h, 8);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1;
    roundRect(ctx, o.x, o.y, w, h, 8); ctx.stroke();
    ctx.save();
    ctx.font = '18px "Nunito", sans-serif';
    ctx.fillStyle = '#3a3a3a';
    wrapText(ctx, o.text || '', o.x + 14, o.y + 30, w - 28, 24, h - 40);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapText(ctx, text, x, y, maxW, lh, maxH) {
    const paras = String(text).split('\n');
    let cy = y;
    outer: for (const para of paras) {
      const words = para.split(' ');
      let cur = '';
      for (const wd of words) {
        const test = cur ? cur + ' ' + wd : wd;
        if (ctx.measureText(test).width > maxW && cur) {
          ctx.fillText(cur, x, cy); cy += lh;
          if (maxH && cy - y + lh > maxH) break outer;
          cur = wd;
        } else cur = test;
      }
      ctx.fillText(cur, x, cy); cy += lh;
      if (maxH && cy - y + lh > maxH) break;
    }
  }

  function drawTable(ctx, o) {
    const rows = o.rows || 3, cols = o.cols || 3;
    const cw = (o.w || 360) / cols;
    const cellH = 44;
    ctx.font = '16px "Nunito", sans-serif';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = o.x + c * cw, y = o.y + r * cellH;
        ctx.fillStyle = r === 0 ? (o.headerColor || '#dbe9ff') : '#ffffff';
        ctx.fillRect(x, y, cw, cellH);
        ctx.strokeStyle = o.color || '#5f7a95'; ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, cw, cellH);
        const cell = (o.cells && o.cells[r * cols + c]) || { text: '' };
        ctx.fillStyle = '#263340';
        ctx.save();
        ctx.beginPath(); ctx.rect(x + 4, y + 2, cw - 8, cellH - 4); ctx.clip();
        ctx.fillText(String(cell.text || ''), x + 10, y + cellH / 2);
        ctx.restore();
      }
    }
    ctx.textBaseline = 'alphabetic';
  }

  function drawQR(ctx, o) {
    const size = o.size || 180;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, o.x - 8, o.y - 8, size + 16, size + (o.label ? 34 : 0) + 16, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = 1;
    roundRect(ctx, o.x - 8, o.y - 8, size + 16, size + (o.label ? 34 : 0) + 16, 10);
    ctx.stroke();
    try {
      const qr = qrcode(0, 'M');
      qr.addData(String(o.data || ''), 'Byte');
      qr.make();
      const n = qr.getModuleCount();
      const cs = size / n;
      ctx.fillStyle = '#111';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(o.x + c * cs, o.y + r * cs, Math.ceil(cs), Math.ceil(cs));
    } catch (e) {
      ctx.fillStyle = '#c33'; ctx.font = '13px sans-serif';
      ctx.fillText('QR: данные слишком длинные', o.x, o.y + size / 2);
    }
    if (o.label) {
      ctx.fillStyle = '#456'; ctx.font = '600 13px "Nunito", sans-serif';
      ctx.fillText(o.label, o.x, o.y + size + 22);
    }
    ctx.restore();
  }

  function drawTimer(ctx, o) {
    const size = o.size || 160;
    let remain = o.duration || 300;
    if (o.running && o.startedAt) remain = Math.max(0, (o.duration || 300) - (Date.now() - o.startedAt) / 1000);
    const m = Math.floor(remain / 60), s = Math.floor(remain % 60);
    const txt = `${m}:${String(s).padStart(2, '0')}`;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.2)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
    ctx.fillStyle = o.fill || '#ffffff';
    ctx.beginPath(); ctx.arc(o.x + size / 2, o.y + size / 2, size / 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const frac = remain / (o.duration || 300);
    ctx.strokeStyle = remain <= 10 ? '#e63946' : (frac < .3 ? '#f4a261' : '#2a9d8f');
    ctx.lineWidth = size * .06;
    ctx.beginPath();
    ctx.arc(o.x + size / 2, o.y + size / 2, size / 2 - ctx.lineWidth / 2 - 2, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.stroke();
    const fs = size * .34;
    ctx.fillStyle = '#263340';
    ctx.font = `700 ${fs}px "Nunito", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, o.x + size / 2, o.y + size / 2);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  function drawObj(ctx, o) {
    switch (o.type) {
      case 'path': drawPath(ctx, o); break;
      case 'shape': drawShape(ctx, o); break;
      case 'text': drawText(ctx, o); break;
      case 'image': drawImage(ctx, o); break;
      case 'sticker': drawSticker(ctx, o); break;
      case 'table': drawTable(ctx, o); break;
      case 'qr': drawQR(ctx, o); break;
      case 'timer': drawTimer(ctx, o); break;
    }
    // live-набор текста другим участником — рамка его цвета + имя
    if (o._liveTyping && o.type === 'text') {
      const b = objBounds(o);
      ctx.save();
      ctx.strokeStyle = o._liveTyping.color || '#888';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      roundRect(ctx, b.x - 6, b.y - 6, b.w + 12, b.h + 12, 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '600 14px "Nunito", sans-serif';
      ctx.fillStyle = o._liveTyping.color || '#888';
      ctx.fillText((o._liveTyping.name || '') + ' друкує…', b.x, b.y - 10);
      ctx.restore();
    }
  }

  function drawPage(ctx, page, opts) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    (BGRenderer[page.background] || BGRenderer.plain)(ctx);
    for (const o of page.objects) drawObj(ctx, o);
  }

  function drawSelection(ctx, ids, doc, pageIdx) {
    const pg = (pageIdx != null && doc.pages[pageIdx]) || doc.page;
    const inv = 1 / (SZ.App.view.scale || 1);
    for (const id of ids) {
      const o = pg.objects.find(x => x.id === id);
      if (!o) continue;
      const b = objBounds(o);
      ctx.save();
      ctx.strokeStyle = '#4a7fd4';
      ctx.lineWidth = 1.6 * inv;
      ctx.setLineDash([7, 5]);
      ctx.strokeRect(b.x - 5, b.y - 5, b.w + 10, b.h + 10);
      ctx.restore();
      const hs = 9 * inv;
      ctx.fillStyle = '#4a7fd4';
      const corners = [
        [b.x - 5, b.y - 5], [b.x + b.w + 5, b.y - 5],
        [b.x - 5, b.y + b.h + 5], [b.x + b.w + 5, b.y + b.h + 5],
        [b.x + b.w / 2, b.y - 5], [b.x + b.w / 2, b.y + b.h + 5]
      ];
      for (const [hx, hy] of corners) {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }
    }
  }

  /* границы объекта (для выделения/hit-test) */
  function objBounds(o) {
    switch (o.type) {
      case 'path': {
        let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
        for (const p of (o.points || [])) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
        const pad = (o.width || 3) / 2 + 2;
        if (x1 > x2) return { x: o.points?.[0]?.x || 0, y: o.points?.[0]?.y || 0, w: 0, h: 0 };
        return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
      }
      case 'shape':
        if (o.shape === 'line' || o.shape === 'arrow') {
          const x = Math.min(o.x, o.x + o.w), y = Math.min(o.y, o.y + o.h);
          return { x: x - 6, y: y - 6, w: Math.abs(o.w) + 12, h: Math.abs(o.h) + 12 };
        }
        return { x: Math.min(o.x, o.x + o.w), y: Math.min(o.y, o.y + o.h), w: Math.abs(o.w), h: Math.abs(o.h) };
      case 'text': {
        const mctx = TextMeasure.ensure();
        const lines = textLines(o);
        let w = 0;
        for (const l of lines) w = Math.max(w, mctx.measureText(l).width);
        return { x: o.x, y: o.y, w: o.w || Math.max(w, 40), h: textHeight(o) };
      }
      case 'image': return { x: o.x, y: o.y, w: o.w, h: o.h };
      case 'sticker': return { x: o.x, y: o.y, w: o.w || 220, h: o.h || 180 };
      case 'table': return { x: o.x, y: o.y, w: o.w || 360, h: (o.rows || 3) * 44 };
      case 'qr': return { x: o.x - 8, y: o.y - 8, w: (o.size || 180) + 16, h: (o.size || 180) + (o.label ? 34 : 0) + 16 };
      case 'timer': return { x: o.x, y: o.y, w: o.size || 160, h: o.size || 160 };
    }
    return { x: o.x || 0, y: o.y || 0, w: 10, h: 10 };
  }

  /* hit-test: какой объект под точкой (верхний = последний в списке) */
  function hitTest(page, x, y) {
    for (let i = page.objects.length - 1; i >= 0; i--) {
      const o = page.objects[i];
      const b = objBounds(o);
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        if (o.type === 'path') {
          const tol = Math.max(8, (o.width || 3));
          for (let j = 1; j < o.points.length; j++) {
            if (U.distToSeg(x, y, o.points[j - 1].x, o.points[j - 1].y, o.points[j].x, o.points[j].y) <= tol) return o;
          }
        } else if (o.type === 'shape' && (o.shape === 'line' || o.shape === 'arrow')) {
          if (U.distToSeg(x, y, o.x, o.y, o.x + o.w, o.y + o.h) <= Math.max(10, o.width || 3)) return o;
        } else return o;
      }
    }
    return null;
  }

  SZ.Render = {
    drawPage, drawObj, drawSelection, objBounds, hitTest, textLines, textHeight,
    ImgCache, STICKER_COLORS, BGRenderer, TextMeasure
  };
})(window.SZ = window.SZ || {});
