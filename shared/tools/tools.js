/* ЦеЗошит — инструменты (shared/tools/tools.js)
 * pt — координаты в пространстве активной страницы.
 * Во время рисования previewObj рендерится КАЖДЫЙ кадр — живой предпросмотр.
 */
(function (SZ) {
  'use strict';
  const U = SZ.U;

  const Tools = {
    registry: new Map(),
    register(t) { this.registry.set(t.id, t); },
    get(id) { return this.registry.get(id); }
  };

  /* ---------- ПЕРО ---------- */
  Tools.register({
    id: 'pen', label: 'Перо', icon: '✏️', perm: 'obj:path', cursor: 'crosshair',
    onDown(pt) {
      const st = SZ.App.state;
      this._path = {
        type: 'path', id: U.uid('o'), points: [{ x: pt.x, y: pt.y }],
        color: st.penColor, width: st.penWidth,
        authorId: st.userId, authorName: st.userName, authorColor: st.userColor
      };
      SZ.App.previewObj = this._path; // ЖИВОЙ ПРЕДПРОСМОТР сразу
      SZ.App.requestRender();
    },
    onMove(pt) {
      if (!this._path) return;
      const pts = this._path.points;
      const last = pts[pts.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 0.8) {
        pts.push({ x: pt.x, y: pt.y });
        SZ.App.emitLive(this._path);
      }
    },
    onUp() {
      if (!this._path) return;
      const p = this._path;
      this._path = null;
      SZ.App.previewObj = null;
      if (p.points.length < 2) p.points.push({ x: p.points[0].x + .01, y: p.points[0].y });
      SZ.App.commitAddObj(p);
      if (SZ.App.transport && SZ.App.state.online) SZ.App.transport.send({ t: 'liveEnd' });
    }
  });

  /* ---------- ЛАСТИК ---------- */
  Tools.register({
    id: 'eraser', label: 'Ластик', icon: '🧽', perm: 'delete', cursor: 'cell',
    onDown(pt) { this._erased = []; this._warned = false; this._eraseAt(pt); },
    onMove(pt) { if (this._erased) this._eraseAt(pt); },
    onUp() {
      if (this._erased && this._erased.length) {
        SZ.App.commitBulk(this._erased.map(({ obj, page, index }) => ({
          do: { t: 'delObj', pageId: page.id, id: obj.id },
          undo: { t: 'addObj', pageId: page.id, obj, _index: index }
        })));
      }
      this._erased = null;
    },
    /* можно ли стирать этот объект: только свой (учитель/ведущий — любые) */
    _canErase(o) {
      const st = SZ.App.state;
      if (st.role === 'teacher' || st.role === 'solo' || st.presenterId === st.userId) return true;
      return !o.authorId || o.authorId === st.userId;
    },
    _eraseAt(pt) {
      const app = SZ.App;
      const pg = app.doc.pages[app._strokePageIdx];
      if (!pg) return;
      const R = 16 / (app.view.scale || 1);
      const hit = SZ.Render.hitTest(pg, pt.x, pt.y);
      if (hit && !this._canErase(hit)) {
        // чужой объект — не стираем; подсказываем один раз за проход
        if (!this._warned) {
          this._warned = true;
          U.toast('Гумка діє лише на ваші об’єкти ✋', 'warn');
        }
        return;
      }
      if (hit && !this._erased.some(e => e.obj.id === hit.id)) {
        this._erased.push({ obj: hit, page: pg, index: pg.objects.indexOf(hit) });
        const op = { t: 'delObj', pageId: pg.id, id: hit.id };
        SZ.Ops.apply(app.doc, op);
        app.afterLocalOp(op);
        app.requestRender();
      }
    }
  });

  /* ---------- ФИГУРЫ ---------- */
  Tools.register({
    id: 'shape', label: 'Фигуры', icon: '▭', perm: 'obj:shape', cursor: 'crosshair',
    onDown(pt) {
      const st = SZ.App.state;
      this._s = {
        type: 'shape', id: U.uid('o'), shape: st.shape || 'rect',
        x: pt.x, y: pt.y, w: 0, h: 0,
        color: st.penColor, width: st.penWidth, fill: st.fillColor || 'none',
        authorId: st.userId, authorName: st.userName, authorColor: st.userColor
      };
      SZ.App.previewObj = this._s;
      SZ.App.requestRender();
    },
    onMove(pt) {
      if (!this._s) return;
      this._s.w = pt.x - this._s.x;
      this._s.h = pt.y - this._s.y;
    },
    onUp() {
      if (!this._s) return;
      const s = this._s;
      this._s = null;
      SZ.App.previewObj = null;
      if (Math.abs(s.w) < 4 && Math.abs(s.h) < 4) { s.w = 120; s.h = 90; }
      SZ.App.commitAddObj(s);
    }
  });

  /* ---------- ВЫДЕЛЕНИЕ ---------- */
  Tools.register({
    id: 'select', label: 'Выделить', icon: '⬚', perm: null, cursor: 'default',
    onDown(pt, e) {
      const app = SZ.App;
      const pg = app.doc.pages[app._strokePageIdx];
      const hit = SZ.Render.hitTest(pg, pt.x, pt.y);
      if (hit) {
        if (!app.state.selection.has(hit.id)) {
          if (!e || (!e.shiftKey && !app.isTouch)) app.state.selection.clear();
          app.state.selection.add(hit.id);
        }
        this._snap = {};
        for (const id of app.state.selection) {
          const o = pg.objects.find(x => x.id === id);
          if (o) this._snap[id] = { ...o, points: o.points ? o.points.slice() : undefined };
        }
        this._pg = pg;
        this._start = pt;
        this._bounds = this._boundsOf(app.state.selection, pg);
        this._mode = this._handleAt(pt, this._bounds) || 'move';
        app.requestRender();
      } else {
        if (!e || !e.shiftKey) app.state.selection.clear();
        this._rubber = { x: pt.x, y: pt.y, w: 0, h: 0 };
        app.rubberBand = this._rubber;
        app.requestRender();
      }
    },
    onMove(pt) {
      const app = SZ.App;
      const pg = this._pg || app.doc.pages[app._strokePageIdx];
      if (this._rubber) {
        this._rubber.w = pt.x - this._rubber.x;
        this._rubber.h = pt.y - this._rubber.y;
        app.state.selection.clear();
        const b = {
          x: Math.min(this._rubber.x, this._rubber.x + this._rubber.w),
          y: Math.min(this._rubber.y, this._rubber.y + this._rubber.h),
          w: Math.abs(this._rubber.w), h: Math.abs(this._rubber.h)
        };
        for (const o of pg.objects) {
          const ob = SZ.Render.objBounds(o);
          if (ob.x >= b.x && ob.y >= b.y && ob.x + ob.w <= b.x + b.w && ob.y + ob.h <= b.y + b.h) app.state.selection.add(o.id);
        }
        app.requestRender();
        return;
      }
      if (!this._start || !this._snap) return;
      const dx = pt.x - this._start.x, dy = pt.y - this._start.y;
      if (this._mode === 'move') {
        for (const id in this._snap) {
          const o = pg.objects.find(x => x.id === id);
          if (o) { o.x = this._snap[id].x + dx; o.y = this._snap[id].y + dy; }
        }
      } else {
        const b0 = this._bounds;
        let nx = b0.x, ny = b0.y, nw = b0.w, nh = b0.h;
        if (this._mode.includes('e')) nw = b0.w + dx;
        if (this._mode.includes('s')) nh = b0.h + dy;
        if (this._mode.includes('w')) { nx = b0.x + dx; nw = b0.w - dx; }
        if (this._mode.includes('n')) { ny = b0.y + dy; nh = b0.h - dy; }
        const sx = nw / (b0.w || 1), sy = nh / (b0.h || 1);
        for (const id in this._snap) {
          const o = pg.objects.find(x => x.id === id);
          const s0 = this._snap[id];
          if (!o) continue;
          if (o.type === 'path') {
            o.points = s0.points.map(p => ({ x: b0.x + (p.x - b0.x) * sx, y: b0.y + (p.y - b0.y) * sy }));
          } else if (o.type === 'text') {
            o.x = nx + (s0.x - b0.x) * sx;
            o.y = ny + (s0.y - b0.y) * sy;
            o.w = Math.max(40, (s0.w || b0.w) * sx);
          } else {
            o.x = nx + (s0.x - b0.x) * sx;
            o.y = ny + (s0.y - b0.y) * sy;
            if (o.shape === 'line' || o.shape === 'arrow') { o.w = s0.w * sx; o.h = s0.h * sy; }
            else { o.w = Math.max(8, (s0.w || 40) * sx); o.h = Math.max(8, (s0.h || 40) * sy); }
          }
        }
      }
      app.requestRender();
    },
    onUp() {
      const app = SZ.App;
      const pg = this._pg;
      app.rubberBand = null;
      if (this._rubber) { this._rubber = null; app.requestRender(); return; }
      if (this._snap && pg) {
        const entries = [];
        for (const id in this._snap) {
          const o = pg.objects.find(x => x.id === id);
          const s0 = this._snap[id];
          if (o && (o.x !== s0.x || o.y !== s0.y || o.w !== s0.w || o.h !== s0.h)) {
            entries.push({
              do: { t: 'updObj', pageId: pg.id, id, patch: { x: o.x, y: o.y, w: o.w, h: o.h, points: o.points ? o.points.slice() : undefined } },
              undo: { t: 'updObj', pageId: pg.id, id, patch: { x: s0.x, y: s0.y, w: s0.w, h: s0.h, points: s0.points ? s0.points.slice() : undefined } }
            });
          }
        }
        if (entries.length) app.commitBulk(entries);
      }
      this._snap = null; this._start = null; this._mode = null; this._pg = null;
    },
    _boundsOf(sel, pg) {
      let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
      for (const id of sel) {
        const o = pg.objects.find(x => x.id === id);
        if (!o) continue;
        const b = SZ.Render.objBounds(o);
        x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
      }
      return x1 > x2 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    },
    _handleAt(pt, b) {
      const t = 12 / (SZ.App.view.scale || 1);
      const near = (hx, hy) => Math.abs(pt.x - hx) < t && Math.abs(pt.y - hy) < t;
      if (near(b.x, b.y)) return 'nw';
      if (near(b.x + b.w, b.y)) return 'ne';
      if (near(b.x, b.y + b.h)) return 'sw';
      if (near(b.x + b.w, b.y + b.h)) return 'se';
      if (near(b.x + b.w / 2, b.y)) return 'n';
      if (near(b.x + b.w / 2, b.y + b.h)) return 's';
      return null;
    }
  });

  /* ---------- ТЕКСТ ---------- */
  Tools.register({
    id: 'text', label: 'Текст', icon: 'T', perm: 'obj:text', cursor: 'text',
    onDown(pt) {
      const app = SZ.App;
      const pg = app.doc.pages[app._strokePageIdx];
      const hit = SZ.Render.hitTest(pg, pt.x, pt.y);
      if (hit && hit.type === 'text') {
        const idx = app.doc.pages.indexOf(pg);
        app._strokePageIdx = idx;
        app.startTextEdit(hit, false);
        return;
      }
      const st = app.state;
      const o = {
        type: 'text', id: U.uid('o'), x: pt.x, y: pt.y, w: 420,
        text: '', size: st.fontSize || 24, color: st.penColor,
        bold: false, italic: false, underline: false, strike: false, sup: false, sub: false,
        align: 'left', fontClass: st.fontClass || 'print',
        authorId: st.userId, authorName: st.userName, authorColor: st.userColor
      };
      app.commitAddObj(o, () => app.startTextEdit(o, true));
    }
  });

  SZ.Tools = Tools;
})(window.SZ = window.SZ || {});
