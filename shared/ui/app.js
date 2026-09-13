/* ЦеЗошит — каркас приложения (shared/ui/app.js)
 * Модель вида: все страницы склеены в вертикальную «ленту» (world).
 * Тетрадь во всю ширину экрана, скролл вниз создаёт новую страницу.
 * Инструменты — правая панель (rail, toolbar.js).
 */
(function (SZ) {
  'use strict';
  const U = SZ.U;
  const { PAGE_W, PAGE_H } = SZ.Doc;
  const PAGE_GAP = 28;
  const RAIL_W = 64;

  const App = {
    doc: null,
    history: null,
    view: { scale: 0.5, x: 0, y: 0 },
    state: {
      userId: U.uid('u'), userName: '', userColor: U.PALETTE[Math.floor(Math.random() * U.PALETTE.length)],
      role: 'solo',
      tool: 'pen', penColor: '#1d3557', penWidth: 3, fillColor: 'none',
      shape: 'rect', fontSize: 24, fontClass: 'print',
      selection: new Set(), editingTextId: null,
      sessionCode: null, participants: [], permissions: null, presenterId: null,
      showAuthors: false, online: false, version: 1
    },
    transport: null,
    previewObj: null,
    rubberBand: null,
    peers: new Map(),
    _livePeers: null,
    _rafPending: false,
    _strokePageIdx: 0,
    _maxTouched: 0,
    _lastCursorSend: 0,
    _lastLiveSend: 0,
    toast(msg, kind) { SZ.U.toast(msg, kind); },

    /* ================= INIT ================= */
    init(opts) {
      opts = opts || {};
      this.state.userName = localStorage.getItem('sz:name') || '';
      this.canvas = document.getElementById('sz-canvas');
      this.overlay = document.getElementById('sz-overlay');
      this.wrapper = document.getElementById('sz-page-wrap');
      this.ctx = this.canvas.getContext('2d');
      this.octx = this.overlay.getContext('2d');
      const saved = opts.doc || SZ.Storage.load();
      this.doc = new SZ.Doc(saved);
      this.history = new SZ.History(120);
      this._initPointer();
      this._initKeyboard();
      this._initDnd();
      SZ.Modals && SZ.Modals.init();
      SZ.Topbar && SZ.Topbar.init();
      SZ.Toolbar && SZ.Toolbar.init();
      SZ.Collab && SZ.Collab.UI && SZ.Collab.UI.init();
      this._timerTick = setInterval(() => {
        if (this.doc.pages.some(p => p.objects.some(o => o.type === 'timer' && o.running))) this.requestRender();
      }, 500);
      this._resizeCanvases();
      this._fitZoom();
      this.requestRender();
      this.applyTool();
      window.addEventListener('resize', U.debounce(() => {
        this._resizeCanvases(); this._fitZoom(); this.requestRender();
      }, 100));
    },

    /* ================= МИР (лента страниц) ================= */
    worldY(i) { return i * (PAGE_H + PAGE_GAP); },
    worldH() { return this.doc.pages.length * (PAGE_H + PAGE_GAP) - PAGE_GAP; },
    pageAtWorld(wy) { return U.clamp(Math.floor(wy / (PAGE_H + PAGE_GAP)), 0, this.doc.pages.length - 1); },
    toWorld(sx, sy) { return { x: (sx - this.view.x) / this.view.scale, y: (sy - this.view.y) / this.view.scale }; },
    worldToScreen(wx, wy) { return { x: wx * this.view.scale + this.view.x, y: wy * this.view.scale + this.view.y }; },

    viewCenter() {
      const wrap = this.wrapper;
      const w = this.toWorld(wrap.clientWidth / 2, wrap.clientHeight / 2);
      const i = this.pageAtWorld(w.y);
      this.doc.active = i;
      return { x: w.x, y: w.y - this.worldY(i) };
    },

    _fitZoom() {
      const wrap = this.wrapper;
      const cx = (wrap.clientWidth - 76) / 2, cy = wrap.clientHeight / 2;
      const before = this.toWorld(cx, cy);
      this.view.scale = this._minScale(); // ровно «по ширине экрана»
      const after = this.worldToScreen(before.x, before.y);
      this.view.x += cx - after.x;
      this.view.y += cy - after.y;
      this.clampView();
      this.requestRender();
    },

    /* минимальный зум: тетрадь всегда занимает всю ширину экрана */
    _minScale() {
      const wrap = this.wrapper;
      const mobile = window.innerWidth <= 720;
      const railPad = mobile ? 52 : 76;
      return Math.max(0.02, (wrap.clientWidth - railPad - 24) / PAGE_W);
    },

    zoomBy(f, cx, cy) {
      const wrap = this.wrapper;
      const c = cx == null ? (wrap.clientWidth - 76) / 2 : cx;
      const cyv = cy == null ? wrap.clientHeight / 2 : cy;
      const before = this.toWorld(c, cyv);
      // грань: от «тетрадь по ширине экрана» до 6x
      const next = this.view.scale * f;
      const min = this._minScale();
      if (next < min && this.view.scale <= min) { this._fitZoom(); return; }
      this.view.scale = U.clamp(next, min, 6);
      const after = this.worldToScreen(before.x, before.y);
      this.view.x += c - after.x;
      this.view.y += cyv - after.y;
      this.clampView();
      this._maybeGrow();
      this._trimAuto();
      this.requestRender();
    },

    clampView() {
      const wrap = this.wrapper, v = this.view;
      const mobile = window.innerWidth <= 720;
      const rightPad = mobile ? 52 : 76; // rail overlay справа
      const usableW = wrap.clientWidth - rightPad;
      const pw = PAGE_W * v.scale;
      if (pw <= usableW) {
        v.x = (usableW - pw) / 2;
      } else {
        v.x = U.clamp(v.x, usableW - pw, 0);
      }
      // Внизу всегда разрешаем запас в пол-страницы ЗА последней страницей —
      // лента «бесконечная», скролл не должен биться об пол до создания страницы.
      const wh = this.worldH() * v.scale;
      v.y = U.clamp(v.y, wrap.clientHeight - wh - PAGE_H * v.scale * 0.5 - 60, -60);
      const centerW = (wrap.clientHeight / 2 - v.y) / v.scale;
      const pi = this.pageAtWorld(centerW);
      // скролл «трогает» страницу — она не будет удалена авто-чисткой
      this._maxTouched = Math.max(this._maxTouched, pi);
      if (pi !== this.doc.active) { this.doc.active = pi; this.syncPagesUI(); }
    },

    /* бесконечный лист: доскроллил до низа непустой страницы → новая страница */
    _maybeGrow() {
      const wrap = this.wrapper, v = this.view;
      const pages = this.doc.pages;
      const last = pages.length - 1;
      if (last < 0) return;
      // не спамим: не чаще раза в 700мс
      const now = Date.now();
      if (this._lastGrow && now - this._lastGrow < 700) return;
      const bottomW = (wrap.clientHeight - v.y) / v.scale;
      if (bottomW > this.worldY(last) + PAGE_H * 0.75 && this.allowed('pages')) {
        this._lastGrow = now;
        this._addAutoPage();
      }
    },
    _addAutoPage() {
      const pages = this.doc.pages;
      const pg = SZ.Doc.page(pages[pages.length - 1].background);
      pg.auto = 1;
      const at = pages.length;
      // запоминаем, что видел пользователь (верх экрана в мировых координатах)
      const topW = -this.view.y / this.view.scale;
      pages.push(pg);
      // на сервер шлём редко (throttle выше не даёт потока), и НЕ ждём ответа
      if (this.transport && this.state.online) {
        this.transport.send({ t: 'op', op: { t: 'addPage', at, bg: pg.background, pageId: pg.id } });
      }
      this.clampView();
      // БЕЗ телепорта: восстанавливаем верх экрана там, где он был
      this.view.y = -topW * this.view.scale;
      this.clampView();
      this.syncPagesUI();
    },
    /* вверх по пустым авто-страницам — убираем их; тоже не чаще раза в 800мс.
     * НО: не убираем страницу, которая ВИДИНА на экране — иначе «телепорт» назад. */
    _trimAuto() {
      const now = Date.now();
      if (this._lastTrim && now - this._lastTrim < 800) return;
      const pages = this.doc.pages;
      const wrap = this.wrapper, v = this.view;
      // мировая координата верхнего края экрана
      const topW = -v.y / v.scale;
      let changed = false;
      while (pages.length > 1) {
        const lastIdx = pages.length - 1;
        const p = pages[lastIdx];
        if (!p.auto || p.objects.length) break;
        // страница видна (хотя бы её верх на экране) — не трогаем
        const pageTopW = this.worldY(lastIdx);
        if (pageTopW < topW + PAGE_H) break;
        // также не уходим глубже последней тронутой
        if (lastIdx <= this._maxTouched) break;
        pages.pop();
        changed = true;
        if (this.transport && this.state.online) {
          this.transport.send({ t: 'op', op: { t: 'delPage', pageId: p.id } });
        }
      }
      if (changed) { this._lastTrim = now; this.clampView(); this.syncPagesUI(); }
    },

    _resizeCanvases() {
      const w = this.wrapper.clientWidth, h = this.wrapper.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      for (const c of [this.canvas, this.overlay]) {
        c.width = w * dpr; c.height = h * dpr;
        c.style.width = w + 'px'; c.style.height = h + 'px';
        c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    },

    /* ================= POINTER ================= */
    _initPointer() {
      const cv = this.canvas;
      const screenXY = (e) => {
        const r = cv.getBoundingClientRect();
        const t = U.evTarget(e);
        return { sx: t.clientX - r.left, sy: t.clientY - r.top };
      };
      let down = false;

      cv.addEventListener('pointerdown', (e) => {
        if (e.button === 1) { // средняя кнопка — всегда панорама
          this._panning = { sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
          cv.setPointerCapture(e.pointerId);
          cv.style.cursor = 'grabbing';
          e.preventDefault();
          return;
        }
        if (this.state.editingTextId && this._textEditor && !this._textEditor.contains(e.target)) this.commitTextEdit();
        down = true;
        cv.setPointerCapture(e.pointerId);
        const pan = (e.button === 0 && (e.ctrlKey || e.altKey || this._spacePan)) || e.button === 2;
        if (pan) {
          this._panning = { sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
          cv.style.cursor = 'grabbing';
          return;
        }
        const tool = SZ.Tools.get(this.state.tool);
        if (!tool) return;
        if (tool.perm && !this.allowed(tool.perm)) {
          this.toast(this.permDeniedMsg(tool.perm), 'warn');
          return;
        }
        e.preventDefault();
        const s = screenXY(e);
        const w = this.toWorld(s.sx, s.sy);
        const pi = this.pageAtWorld(w.y);
        this._strokePageIdx = pi;
        this._maxTouched = Math.max(this._maxTouched, pi);
        this.doc.active = pi;
        this.syncPagesUI();
        tool.onDown && tool.onDown({ x: w.x, y: w.y - this.worldY(pi) }, e);
        this.requestRender();
      });

      cv.addEventListener('pointermove', (e) => {
        const s = screenXY(e);
        if (this._panning) {
          this.view.x = this._panning.vx + (e.clientX - this._panning.sx);
          this.view.y = this._panning.vy + (e.clientY - this._panning.sy);
          this.clampView();
          this._maybeGrow();
          this.requestRender();
          return;
        }
        const w = this.toWorld(s.sx, s.sy);
        if (this.state.online) this._sendCursor(w.x, w.y);
        if (!down) return;
        const tool = SZ.Tools.get(this.state.tool);
        if (tool && tool.onMove) {
          tool.onMove({ x: w.x, y: w.y - this.worldY(this._strokePageIdx) }, e);
          this.requestRender();
        }
      });

      const up = (e) => {
        if (this._panning) { this._panning = null; this.applyTool(); return; }
        if (!down) return;
        down = false;
        const tool = SZ.Tools.get(this.state.tool);
        if (tool && tool.onUp) {
          const s = screenXY(e);
          const w = this.toWorld(s.sx, s.sy);
          tool.onUp({ x: w.x, y: w.y - this.worldY(this._strokePageIdx) }, e);
        }
        this.requestRender();
      };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);

      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        // Стандарт для тачпадов/мыши: колесо = скролл ленты, Ctrl+колесо = зум
        if (e.ctrlKey || e.metaKey) {
          const r = cv.getBoundingClientRect();
          this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
        } else {
          this.view.y -= e.deltaY;
          if (e.deltaX) this.view.x -= e.deltaX;
          this.clampView();
          this._maybeGrow();
          this._trimAuto();
          this.requestRender();
        }
      }, { passive: false });

      cv.addEventListener('contextmenu', (e) => e.preventDefault());

      let pinch = null;
      cv.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          const [a, b] = e.touches;
          pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), cy: (a.clientY + b.clientY) / 2 };
          down = false;
        }
      }, { passive: true });
      cv.addEventListener('touchmove', (e) => {
        if (pinch && e.touches.length === 2) {
          const [a, b] = e.touches;
          const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          const r = cv.getBoundingClientRect();
          this.zoomBy(d / pinch.d, (a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top);
          pinch.d = d;
        }
      }, { passive: true });
      cv.addEventListener('touchend', () => { pinch = null; }, { passive: true });
    },
    _sendCursor(wx, wy) {
      const now = Date.now();
      if (now - this._lastCursorSend < 50) return;
      this._lastCursorSend = now;
      if (this.transport && this.state.online) this.transport.send({ t: 'cursor', x: wx, y: wy });
    },

    /* ================= KEYBOARD ================= */
    _initKeyboard() {
      window.addEventListener('keydown', (e) => {
        const tag = (e.target.tagName || '').toLowerCase();
        const inInput = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
        if (inInput) return;
        const mod = e.ctrlKey || e.metaKey;
        // хоткеи через e.code — работают в любой раскладке (укр/рус/англ)
        if (mod && e.code === 'KeyZ') {
          e.preventDefault();
          if (e.shiftKey) this.redo(); else this.undo();
        } else if (mod && e.code === 'KeyY') { e.preventDefault(); this.redo(); }
        else if (mod && e.code === 'KeyA' && this.state.tool === 'select') {
          e.preventDefault();
          const pg = this.doc.pages[this.doc.active];
          pg.objects.forEach(o => this.state.selection.add(o.id));
          this.requestRender();
        } else if (mod && (e.code === 'Equal' || e.code === 'NumpadAdd')) { e.preventDefault(); this.zoomBy(1.15); }
        else if (mod && e.code === 'Minus') { e.preventDefault(); this.zoomBy(1 / 1.15); }
        else if (mod && e.code === 'Digit0') { e.preventDefault(); this._fitZoom(); }
        else if (!mod && (e.code === 'Delete' || e.code === 'Backspace')) {
          if (this.state.selection.size) { e.preventDefault(); this.deleteSelection(); }
        } else if (e.code === 'Space' && !e.repeat) {
          // пробел — временная панорама
          e.preventDefault();
          this._spacePan = true;
          this.canvas.style.cursor = 'grab';
        } else if (!mod && !e.altKey) {
          const map = { KeyV: 'select', KeyP: 'pen', KeyE: 'eraser', KeyS: 'shape', KeyT: 'text' };
          const k = map[e.code];
          if (k && SZ.Tools.get(k)) { e.preventDefault(); this.setTool(k); }
          else if (e.code === 'Escape') { this.state.selection.clear(); this._hideProps(); this.requestRender(); }
        }
      });
      window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
          this._spacePan = false;
          this.applyTool();
        }
      });
    },

    /* ================= DnD / paste ================= */
    _initDnd() {
      const cv = this.canvas;
      cv.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
      cv.addEventListener('drop', async (e) => {
        e.preventDefault();
        const f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) {
          if (!this.allowed('obj:image')) return this.toast(this.permDeniedMsg('obj:image'), 'warn');
          try { await SZ.Insert.fileImage(f); } catch (err) { this.toast(err.message, 'error'); }
        }
      });
      window.addEventListener('paste', async (e) => {
        if (this.state.editingTextId) return;
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (const it of items) {
          if (it.type && it.type.startsWith('image/')) {
            const f = it.getAsFile();
            if (f) {
              if (!this.allowed('obj:image')) return this.toast(this.permDeniedMsg('obj:image'), 'warn');
              try { await SZ.Insert.fileImage(f); } catch (err) { this.toast(err.message, 'error'); }
            }
            return;
          }
        }
      });
    },

    /* ================= RENDER ================= */
    requestRender() {
      if (this._rafPending) return;
      this._rafPending = true;
      requestAnimationFrame(() => { this._rafPending = false; this.render(); });
    },
    render() {
      const { ctx, view } = this;
      const w = this.wrapper.clientWidth, h = this.wrapper.clientHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.scale, view.scale);
      const pages = this.doc.pages;
      const first = this.pageAtWorld((0 - view.y) / view.scale - PAGE_GAP);
      const last = this.pageAtWorld((h - view.y) / view.scale + PAGE_GAP);
      for (let i = first; i <= last; i++) {
        const pg = pages[i];
        if (!pg) continue;
        const oy = this.worldY(i);
        ctx.save();
        ctx.translate(0, oy);
        // бумага с мягкой тенью — листы «стопкой» на белом фоне
        ctx.save();
        ctx.shadowColor = 'rgba(30,50,80,.16)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 3;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, PAGE_W, PAGE_H);
        ctx.restore();
        // клип содержимого страницы
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, PAGE_W, PAGE_H); ctx.clip();
        SZ.Render.drawPage(ctx, pg, {});
        // live-пути и превью — на активную страницу
        if (i === this._strokePageIdx) {
          if (this.previewObj) SZ.Render.drawObj(ctx, this.previewObj);
          if (this.rubberBand) {
            const b = this.rubberBand;
            ctx.strokeStyle = '#4a7fd4'; ctx.lineWidth = 2 / view.scale; ctx.setLineDash([6, 4]);
            ctx.strokeRect(Math.min(b.x, b.x + b.w), Math.min(b.y, b.y + b.h), Math.abs(b.w), Math.abs(b.h));
            ctx.setLineDash([]);
          }
        }
        if (this._livePeers) {
          for (const lp of this._livePeers.values()) {
            if (lp && lp.pageIdx === i) SZ.Render.drawObj(ctx, lp.obj);
          }
        }
        ctx.restore();
        ctx.restore();
        // выделение поверх (на активной странице)
        if (i === this.doc.active && this.state.tool === 'select' && this.state.selection.size) {
          ctx.save();
          ctx.translate(0, oy);
          ctx.beginPath(); ctx.rect(0, 0, PAGE_W, PAGE_H); ctx.clip();
          SZ.Render.drawSelection(ctx, this.state.selection, this.doc, i);
          ctx.restore();
        }
        // номер страницы
        ctx.save();
        ctx.fillStyle = '#a09478';
        ctx.font = `${16 / view.scale}px "Nunito", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('— ' + (i + 1) + ' —', PAGE_W / 2, oy + PAGE_H + PAGE_GAP * .7);
        ctx.restore();
      }
      ctx.restore();
      this.renderOverlay();
      SZ.Toolbar && SZ.Toolbar.sync();
    },
    renderOverlay() {
      const o = this.octx, view = this.view;
      const w = this.wrapper.clientWidth, h = this.wrapper.clientHeight;
      o.clearRect(0, 0, w, h);
      for (const [id, c] of this.peers) {
        if (!c) continue;
        const s = this.worldToScreen(c.x, c.y);
        if (s.x < -60 || s.y < -60 || s.x > w + 60 || s.y > h + 60) continue;
        o.save();
        o.fillStyle = c.color || '#888';
        o.beginPath();
        o.moveTo(s.x, s.y); o.lineTo(s.x + 14, s.y + 5); o.lineTo(s.x + 9, s.y + 9); o.lineTo(s.x + 5, s.y + 14);
        o.closePath(); o.fill();
        o.strokeStyle = '#fff'; o.lineWidth = 1.5; o.stroke();
        o.font = '600 12px "Nunito", sans-serif';
        const label = c.name || 'Ученик';
        const tw = o.measureText(label).width + 10;
        o.fillStyle = c.color || '#888';
        roundRectO(o, s.x + 12, s.y + 16, tw, 18, 9); o.fill();
        o.fillStyle = '#fff';
        o.fillText(label, s.x + 17, s.y + 29);
        o.restore();
      }
    },

    /* ================= TOOLS ================= */
    setTool(id) {
      const t = SZ.Tools.get(id);
      if (!t) return;
      if (t.perm && !this.allowed(t.perm)) { this.toast(this.permDeniedMsg(t.perm), 'warn'); return; }
      if (this.state.editingTextId) this.commitTextEdit();
      this.state.tool = id;
      this.state.selection.clear();
      this._hideProps();
      this.applyTool();
      SZ.Toolbar && SZ.Toolbar.setActive(id);
      this.requestRender();
    },
    applyTool() {
      const t = SZ.Tools.get(this.state.tool);
      this.canvas.style.cursor = (t && t.cursor) || 'default';
    },
    isTouch: matchMedia('(pointer: coarse)').matches,

    /* ================= OPS / COMMIT ================= */
    _pageId() { return this.doc.pages[this._strokePageIdx || 0].id; },
    commitAddObj(obj, after) {
      const pageIdx = this._strokePageIdx;
      const pageId = this.doc.pages[pageIdx].id;
      const op = { t: 'addObj', pageId, obj };
      SZ.Ops.apply(this.doc, op);
      this.history.push({ do: op, undo: { t: 'delObj', pageId, id: obj.id } });
      this.afterLocalOp(op);
      this._maxTouched = Math.max(this._maxTouched, pageIdx);
      if (after) after();
      this.requestRender();
      SZ.Storage.autosave();
    },
    commitUpdObj(id, patch, undoPatch) {
      const pageId = this._pageIdForObj(id);
      const o = this.findObjAnywhere(id);
      if (!o) return;
      if (!undoPatch) {
        undoPatch = {};
        for (const k in patch) undoPatch[k] = o[k];
      }
      const op = { t: 'updObj', pageId, id, patch };
      SZ.Ops.apply(this.doc, op);
      this.history.push({ do: op, undo: { t: 'updObj', pageId, id, patch: undoPatch } });
      this.afterLocalOp(op);
      this.requestRender();
      SZ.Storage.autosave();
    },
    commitDelObj(id) {
      const pageId = this._pageIdForObj(id);
      const o = this.findObjAnywhere(id);
      if (!o) return;
      const idx = o.page.objects.indexOf(o.obj);
      const clone = U.clone(o.obj);
      const op = { t: 'delObj', pageId, id };
      SZ.Ops.apply(this.doc, op);
      this.history.push({ do: op, undo: { t: 'addObj', pageId, obj: clone, _index: idx } });
      this.afterLocalOp(op);
      this.requestRender();
      SZ.Storage.autosave();
    },
    /* найти объект по id на любой странице: {page, obj} */
    findObjAnywhere(id) {
      for (const pg of this.doc.pages) {
        const o = pg.objects.find(x => x.id === id);
        if (o) return { page: pg, obj: o };
      }
      return null;
    },
    _pageIdForObj(id) {
      const f = this.findObjAnywhere(id);
      return f ? f.page.id : this.doc.pages[this.doc.active].id;
    },
    commitBulk(entries) {
      const dos = [], undos = [];
      for (const en of entries) { if (SZ.Ops.apply(this.doc, en.do)) { dos.push(en.do); undos.unshift(en.undo); } }
      if (dos.length) {
        this.history.push({ do: { t: 'bulk', ops: dos }, undo: { t: 'bulk', ops: undos } });
        for (const op of dos) this.afterLocalOp(op);
      }
      this.requestRender();
      SZ.Storage.autosave();
    },
    commitOps(ops, undoOps) {
      for (const op of ops) SZ.Ops.apply(this.doc, op);
      this.history.push({ do: { t: 'bulk', ops }, undo: { t: 'bulk', ops: undoOps || [] } });
      for (const op of ops) this.afterLocalOp(op);
      this.requestRender();
      SZ.Storage.autosave();
    },
    emitLive(path) {
      const now = Date.now();
      if (now - this._lastLiveSend < 40) return;
      this._lastLiveSend = now;
      if (this.transport && this.state.online) {
        this.transport.send({ t: 'live', obj: { ...path, points: path.points.slice(-30) }, pageIdx: this._strokePageIdx });
      }
    },
    afterLocalOp(op) {
      if (this.transport && this.state.online) {
        this.transport.send({ t: 'op', op, v: ++this.state.version });
      }
    },
    applyRemote(op) {
      const ok = SZ.Ops.apply(this.doc, op);
      if (ok) {
        if (op.t === 'rename') SZ.Topbar && SZ.Topbar.sync();
        this.requestRender();
        SZ.Storage.autosave();
      }
    },

    undo() {
      if (!this.history.canUndo()) return;
      const inv = this.history.undo();
      if (inv) this.applySelfOrRemote(inv, true);
      this.requestRender();
    },
    redo() {
      if (!this.history.canRedo()) return;
      const d = this.history.redo();
      if (d) this.applySelfOrRemote(d, false);
      this.requestRender();
    },
    applySelfOrRemote(op, isUndo) {
      if (op.t === 'restorePages') {
        this.doc.pages = op.pages;
        this.doc.active = U.clamp(op.active != null ? op.active : this.doc.active, 0, this.doc.pages.length - 1);
        this._maxTouched = this.doc.pages.length - 1;
        this.syncPagesUI();
        this.clampView();
        SZ.Storage.autosave();
        return;
      }
      const checkAuthor = (o) => {
        if (this.state.role === 'teacher' || this.state.role === 'solo' || this.state.presenterId === this.state.userId) return true;
        return !o.authorId || o.authorId === this.state.userId;
      };
      const opsList = op.t === 'bulk' ? op.ops : [op];
      for (const o of opsList) {
        if (o.obj && !checkAuthor(o.obj)) { this.toast('Можна скасовувати лише свої дії', 'warn'); return; }
        if (o.t === 'delObj') {
          const f = this.findObjAnywhere(o.id);
          if (f && !checkAuthor(f.obj)) { this.toast('Можна скасовувати лише свої дії', 'warn'); return; }
        }
        if (isUndo && (o.t === 'addPage' || o.t === 'delPage' || o.t === 'dupPage') &&
            this.state.role === 'student' && this.state.presenterId !== this.state.userId) {
          this.toast('Скасувати зміну сторінок може лише вчитель', 'warn');
          return;
        }
      }
      for (const o of opsList) SZ.Ops.apply(this.doc, o);
      this.syncPagesUI();
      if (this.transport && this.state.online) this.transport.send({ t: 'op', op, v: ++this.state.version });
      SZ.Storage.autosave();
    },

    deleteSelection() {
      if (!this.allowed('delete')) return this.toast(this.permDeniedMsg('delete'), 'warn');
      const pg = this.doc.pages[this.doc.active];
      const entries = [];
      for (const id of this.state.selection) {
        const o = pg.objects.find(x => x.id === id);
        if (!o) continue;
        if (this.state.role === 'student' && this.state.presenterId !== this.state.userId && o.authorId && o.authorId !== this.state.userId) {
          this.toast('Учень може видаляти лише свої об’єкти', 'warn');
          continue;
        }
        entries.push({
          do: { t: 'delObj', pageId: pg.id, id },
          undo: { t: 'addObj', pageId: pg.id, obj: U.clone(o), _index: pg.objects.indexOf(o) }
        });
      }
      if (entries.length) this.commitBulk(entries);
      this.state.selection.clear();
      this.requestRender();
    },

    /* ================= ТЕКСТ-РЕДАКТОР ================= */
    startTextEdit(o, isNew) {
      if (this.state.editingTextId) this.commitTextEdit();
      this.state.editingTextId = o.id;
      const f = this.findObjAnywhere(o.id);
      const pageIdx = f ? this.doc.pages.indexOf(f.page) : this.doc.active;
      this._editPageIdx = pageIdx;
      const ed = document.createElement('textarea');
      ed.className = 'sz-textedit';
      const s = this.worldToScreen(o.x, this.worldY(pageIdx) + o.y);
      const scale = this.view.scale;
      const fam = SZ.Doc.DEFAULT_FONTS[o.fontClass] || SZ.Doc.DEFAULT_FONTS.print;
      let fstyle = '';
      if (o.italic) fstyle += 'italic ';
      if (o.bold) fstyle += 'bold ';
      ed.style.left = s.x + 'px';
      ed.style.top = (s.y - 4 * scale) + 'px';
      ed.style.width = Math.max(80, (o.w || 400) * scale) + 'px';
      ed.style.font = `${fstyle}${(o.size || 24) * scale}px ${fam}`;
      ed.style.color = o.color || '#1d3557';
      ed.style.lineHeight = 1.35;
      ed.value = o.text || '';
      ed.rows = 1;
      ed.placeholder = 'Введіть текст…';
      this._textEditor = ed;
      this.wrapper.appendChild(ed);
      const autoSize = () => {
        ed.style.height = 'auto';
        ed.style.height = Math.max(30, ed.scrollHeight) + 'px';
      };
      ed.addEventListener('input', autoSize);
      // LIVE-текст: во время ввода шлём промежуточный текст другим участникам
      ed.addEventListener('input', () => {
        this._liveTextSend && clearTimeout(this._liveTextSend);
        this._liveTextSend = setTimeout(() => {
          if (this.state.editingTextId !== o.id) return;
          if (this.transport && this.state.online) {
            const f = this.findObjAnywhere(o.id);
            if (f) this.transport.send({
              t: 'liveText', pageId: f.page.id, id: o.id, text: ed.value, color: this.state.userColor, name: this.state.userName
            });
          }
        }, 350);
      });
      autoSize();
      setTimeout(() => { ed.focus(); if (isNew) ed.select(); }, 30);
      ed.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) this.commitTextEdit();
      });
      ed.addEventListener('blur', () => setTimeout(() => this.commitTextEdit(), 80));
    },
    commitTextEdit() {
      const id = this.state.editingTextId;
      if (!id) return;
      this.state.editingTextId = null;
      const ed = this._textEditor;
      this._textEditor = null;
      if (!ed) return;
      const txt = ed.value;
      ed.remove();
      const f = this.findObjAnywhere(id);
      if (!f) return;
      const pageId = f.page.id;
      if (!txt.trim()) {
        const op = { t: 'delObj', pageId, id };
        SZ.Ops.apply(this.doc, op);
        this.history.push({ do: op, undo: { t: 'addObj', pageId, obj: U.clone(f.obj), _index: f.page.objects.length } });
        this.afterLocalOp(op);
        this.requestRender();
        return;
      }
      if (txt !== f.obj.text) {
        this.commitUpdObj(id, { text: txt });
      }
    },

    startStickerEdit(o) {
      SZ.Modals.prompt('Стікер', 'Текст нотатки:', o.text || '', (val) => {
        if (val != null && val.trim()) this.commitUpdObj(o.id, { text: val });
      });
    },
    startTableEdit(o) {
      SZ.Modals.tableEditor(o, (cells, rows, cols) => {
        this.commitUpdObj(o.id, { cells, rows, cols });
      });
    },

    /* ================= ПРАВА ================= */
    setPermissions(perms) {
      this.state.permissions = perms;
      const t = SZ.Tools.get(this.state.tool);
      if (t && t.perm && !this.allowed(t.perm)) this.setTool('select');
      SZ.Toolbar && SZ.Toolbar.sync();
      SZ.Collab && SZ.Collab.UI && SZ.Collab.UI.syncBanner && SZ.Collab.UI.syncBanner();
      this.requestRender();
    },
    allowed(perm) {
      const st = this.state;
      if (st.role === 'solo' || st.role === 'teacher') return true;
      if (st.presenterId === st.userId) return true;
      // временный grant после поднятой руки (плюс к базовым правам)
      const g = st.handGrant;
      if (g && g.tools && perm && g.tools[perm] === true) return true;
      const p = st.permissions;
      if (!p) return true;
      if (p.blocked && p.blocked.includes(st.userId)) return false;
      if (p.globalEdit === false && !(g && g.tools && perm && g.tools[perm] === true)) {
        if (perm && g && g.tools && g.tools[perm] === true) return true;
        return false;
      }
      if (perm && p.tools && p.tools[perm] === false) {
        if (g && g.tools && g.tools[perm] === true) return true;
        return false;
      }
      return true;
    },
    permDeniedMsg(perm) {
      const names = {
        'obj:path': 'рисование', 'obj:shape': 'фигуры', 'obj:text': 'текст', 'obj:image': 'изображения',
        'obj:sticker': 'стікери', 'obj:table': 'таблиці', 'obj:qr': 'QR-коди', 'obj:timer': 'таймери',
        'delete': 'видалення об’єктів', 'pages': 'зміна сторінок', 'export': 'експорт'
      };
      return `Дію «${names[perm] || perm}» заборонено вчителем ✋`;
    },

    setTransport(tr) {
      if (this.transport) { try { this.transport.close(); } catch (_) {} }
      this.transport = tr;
    },

    /* ================= СТРАНИЦЫ ================= */
    addPage() {
      if (!this.allowed('pages')) return this.toast(this.permDeniedMsg('pages'), 'warn');
      const snapshot = this._pagesSnapshot();
      const pg = this.doc.addPage(this.doc.active);
      this._pageOp({ t: 'addPage', at: this.doc.pages.indexOf(pg), bg: pg.background }, { t: 'restorePages', pages: snapshot, active: this.doc.active });
      this.gotoPage(this.doc.pages.indexOf(pg));
    },
    dupPage() {
      if (!this.allowed('pages')) return this.toast(this.permDeniedMsg('pages'), 'warn');
      const snapshot = this._pagesSnapshot();
      const src = this.doc.page;
      const newId = SZ.Ops.apply(this.doc, { t: 'dupPage', pageId: src.id });
      this._pageOp({ t: 'dupPage', pageId: src.id }, { t: 'restorePages', pages: snapshot, active: this.doc.active });
      const idx = this.doc.pages.findIndex(p => p.id === newId);
      if (idx >= 0) this.gotoPage(idx);
    },
    delPage(id) {
      if (!this.allowed('pages')) return this.toast(this.permDeniedMsg('pages'), 'warn');
      id = id || this.doc.pages[this.doc.active].id;
      if (this.doc.pages.length <= 1) return this.toast('Не можна видалити останню сторінку', 'warn');
      const snapshot = this._pagesSnapshot();
      SZ.Ops.apply(this.doc, { t: 'delPage', pageId: id });
      this._pageOp({ t: 'delPage', pageId: id }, { t: 'restorePages', pages: snapshot, active: this.doc.active });
      this.clampView();
      this.syncPagesUI();
    },
    setPageBg(bg) {
      const prev = this.doc.pages[this.doc.active].background;
      const pageId = this.doc.pages[this.doc.active].id;
      SZ.Ops.apply(this.doc, { t: 'setBg', pageId, bg });
      this._pageOp({ t: 'setBg', pageId, bg }, { t: 'setBg', pageId, bg: prev });
      this.syncPagesUI();
      SZ.Storage.autosave();
    },
    _pagesSnapshot() { return U.clone(this.doc.pages); },
    _pageOp(op, undoOp) {
      this.history.push({ do: op, undo: undoOp || null });
      if (this.transport && this.state.online) this.transport.send({ t: 'op', op });
      this.requestRender();
      SZ.Storage.autosave();
    },
    gotoPage(i) {
      const idx = U.clamp(i, 0, this.doc.pages.length - 1);
      this.doc.active = idx;
      this._maxTouched = Math.max(this._maxTouched, idx);
      // центрируем страницу по вертикали
      const wrap = this.wrapper;
      this.view.y = wrap.clientHeight / 2 - (this.worldY(idx) + PAGE_H / 2) * this.view.scale;
      this.clampView();
      this.state.selection.clear();
      this.syncPagesUI();
      this.requestRender();
    },
    syncPagesUI() {
      SZ.PagesBar && SZ.PagesBar.render();
      SZ.Toolbar && SZ.Toolbar.syncZoomLabel && SZ.Toolbar.syncZoomLabel();
    },

    _hideProps() { SZ.Toolbar && SZ.Toolbar.hideProps(); },

    setLivePeer(userId, obj, pageIdx) {
      if (!this._livePeers) this._livePeers = new Map();
      if (!obj) this._livePeers.delete(userId);
      else this._livePeers.set(userId, { obj, pageIdx: pageIdx || this._strokePageIdx });
      this.requestRender();
    }
  };

  function roundRectO(o, x, y, w, h, r) {
    o.beginPath();
    o.moveTo(x + r, y);
    o.arcTo(x + w, y, x + w, y + h, r);
    o.arcTo(x + w, y + h, x, y + h, r);
    o.arcTo(x, y + h, x, y, r);
    o.arcTo(x, y, x + w, y, r);
    o.closePath();
  }

  SZ.App = App;
})(window.SZ = window.SZ || {});
