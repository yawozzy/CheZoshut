/* ЦеЗошит — правая панель инструментов (rail) + контекстные свойства (shared/ui/toolbar.js)
 * П10: инструменты справа; П4: свойства только текущего инструмента.
 */
(function (SZ) {
  'use strict';
  const U = SZ.U;

  const COLORS = ['#1d3557', '#e63946', '#e76f51', '#f4a261', '#2a9d8f', '#118ab2', '#6a4c93', '#9d4edd', '#111', '#888'];
  const FILLS = ['none', '#dbe9ff', '#d8f3dc', '#fff3b0', '#ffd6e0', '#e8d8ff', '#ffdad6'];
  const SHAPES = [['rect', '▭', 'Прямоугольник'], ['ellipse', '◯', 'Овал'], ['triangle', '△', 'Треугольник'], ['line', '╱', 'Линия'], ['arrow', '➜', 'Стрелка']];
  const FONTSIZES = [14, 18, 22, 26, 32, 42, 56];
  const PENSIZES = [2, 3, 5, 8, 12];

  const Toolbar = {
    init() {
      this.rail = document.getElementById('sz-rail');
      this.props = document.getElementById('sz-props');
      this.zoomLabel = document.getElementById('sz-zoom-label');
      this._buildRail();
      this.setActive(SZ.App.state.tool);
      this.sync();
    },

    /* ============ ПРАВАЯ ПАНЕЛЬ ============ */
    _buildRail() {
      const r = this.rail;
      r.innerHTML = '';

      const mkBtn = (id, icon, label, opts) => {
        const b = document.createElement('button');
        b.className = 'sz-rbtn' + (opts && opts.cls ? ' ' + opts.cls : '');
        b.dataset.tool = id;
        b.setAttribute('aria-label', label);
        b.title = label;
        b.innerHTML = `<span class="sz-rbtn-ic">${icon}</span>`;
        b.addEventListener('click', () => {
          if (id === 'insert') { this._toggleInsertMenu(b); return; }
          SZ.App.setTool(id);
        });
        return b;
      };
      const sep = () => { const s = document.createElement('div'); s.className = 'sz-rsep'; return s; };

      // основные инструменты
      this.btnPen = mkBtn('pen', '✏️', 'Перо (P)');
      this.btnShape = mkBtn('shape', this._shapeIcon(), 'Фігури (S)');
      this.btnText = mkBtn('text', 'T', 'Текст (T)');
      this.btnSelect = mkBtn('select', '⬚', 'Виділити (V)');
      this.btnEraser = mkBtn('eraser', '🧽', 'Гумка (E)');
      r.append(this.btnPen, this.btnShape, this.btnText, this.btnSelect, this.btnEraser, sep());

      // вставка (выпадающее меню)
      this.btnInsert = mkBtn('insert', '➕', 'Вставити об’єкт');
      this.btnInsert.dataset.tool = 'insert';
      r.appendChild(this.btnInsert);
      this.insertMenu = this._buildInsertMenu();
      document.body.appendChild(this.insertMenu);
      r.appendChild(sep());

      // undo / redo
      this.btnUndo = document.createElement('button');
      this.btnUndo.className = 'sz-rbtn'; this.btnUndo.title = 'Скасувати (Ctrl+Z)'; this.btnUndo.setAttribute('aria-label', 'Отменить');
      this.btnUndo.innerHTML = '<span class="sz-rbtn-ic">↩</span>';
      this.btnUndo.addEventListener('click', () => SZ.App.undo());
      this.btnRedo = document.createElement('button');
      this.btnRedo.className = 'sz-rbtn'; this.btnRedo.title = 'Повернути (Ctrl+Shift+Z)'; this.btnRedo.setAttribute('aria-label', 'Вернуть');
      this.btnRedo.innerHTML = '<span class="sz-rbtn-ic">↪</span>';
      this.btnRedo.addEventListener('click', () => SZ.App.redo());
      r.append(this.btnUndo, this.btnRedo, sep());

      // зум
      const zin = document.createElement('button');
      zin.className = 'sz-rbtn small'; zin.title = 'Ближче (Ctrl +)'; zin.setAttribute('aria-label', 'Приблизить');
      zin.textContent = '＋';
      zin.addEventListener('click', () => SZ.App.zoomBy(1.2));
      const zout = document.createElement('button');
      zout.className = 'sz-rbtn small'; zout.title = 'Далі (Ctrl −)'; zout.setAttribute('aria-label', 'Отдалить');
      zout.textContent = '－';
      zout.addEventListener('click', () => SZ.App.zoomBy(1 / 1.2));
      const zfit = document.createElement('button');
      zfit.className = 'sz-rbtn small'; zfit.title = 'Вмістити сторінку (Ctrl 0)'; zfit.setAttribute('aria-label', 'Вписать страницу');
      zfit.textContent = '⤢';
      zfit.addEventListener('click', () => SZ.App._fitZoom());
      r.append(zin, zout, zfit);
    },

    _shapeIcon() {
      return (SHAPES.find(s => s[0] === SZ.App.state.shape) || SHAPES[0])[1];
    },

    _buildInsertMenu() {
      const m = document.createElement('div');
      m.className = 'sz-menu sz-insert-menu';
      m.setAttribute('role', 'menu');
      m.style.display = 'none';
      const mk = (ic, label, perm, fn) => {
        const b = document.createElement('button');
        b.className = 'sz-menu-item';
        b.dataset.perm = perm || '';
        b.setAttribute('role', 'menuitem');
        b.innerHTML = `<span class="sz-tbtn-ic">${ic}</span> ${label}`;
        b.addEventListener('click', () => { m.style.display = 'none'; fn(); });
        m.appendChild(b);
        return b;
      };
      mk('🖼', 'Зображення', 'obj:image', () => this._pickImage());
      mk('🗒', 'Стікер', 'obj:sticker', () => SZ.Insert.sticker());
      mk('▦', 'Таблица', 'obj:table', () => SZ.Insert.table(3, 3));
      return m;
    },
    _toggleInsertMenu(anchor) {
      const m = this.insertMenu;
      if (m.style.display === 'none') {
        const r = anchor.getBoundingClientRect();
        m.style.display = 'block';
        m.style.left = (r.left - m.offsetWidth - 8) + 'px';
        m.style.top = Math.min(r.top, window.innerHeight - m.offsetHeight - 12) + 'px';
        setTimeout(() => {
          const close = (ev) => {
            if (!m.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) {
              m.style.display = 'none';
              document.removeEventListener('pointerdown', close);
            }
          };
          document.addEventListener('pointerdown', close);
        }, 10);
      } else {
        m.style.display = 'none';
      }
    },
    _pickImage() {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        if (f) { try { await SZ.Insert.fileImage(f); } catch (e) { U.toast(e.message, 'error'); } }
      });
      inp.click();
    },

    setActive(id) {
      this.rail.querySelectorAll('.sz-rbtn[data-tool]').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === id);
      });
      this.syncProps();
    },

    syncZoomLabel() {},

    /* ============ СВОЙСТВА ТЕКУЩЕГО ИНСТРУМЕНТА ============ */
    syncProps() {
      const st = SZ.App.state;
      const app = SZ.App;
      const p = this.props;
      // есть выделение при select — показываем свойства объекта
      const selObj = st.tool === 'select' && st.selection.size === 1
        ? app.doc.pages[app.doc.active].objects.find(o => o.id === [...st.selection][0])
        : null;
      const multi = st.tool === 'select' && st.selection.size > 1;

      p.innerHTML = '';
      const row = () => { const d = document.createElement('div'); d.className = 'sz-prop-row'; return d; };
      // select без выделения — контента нет, панель скрываем
      if (st.tool === 'select' && !selObj && !multi) { this.hideProps(); return; }
      // панель видна: настройки текущего инструмента — всегда под рукой, сверху
      this.showProps();

      const sel1 = (opts, val, cb, cls) => {
        const s = document.createElement('select');
        s.className = 'sz-input ' + (cls || '');
        for (const o of opts) {
          const op = document.createElement('option');
          op.value = o[0]; op.textContent = o[1];
          if (String(o[0]) === String(val)) op.selected = true;
          s.appendChild(op);
        }
        s.addEventListener('change', () => cb(s.value));
        return s;
      };
      const head = (t) => {
        const h = document.createElement('div');
        h.className = 'sz-prop-lab';
        h.textContent = t;
        p.appendChild(h);
      };

      /* --- свойства ВЫДЕЛЕННОГО объекта --- */
      if (selObj) {
        const o = selObj;
        head(this._objName(o));
        if (o.type === 'text') {
          const r1 = row();
          const tb = (prop, ic, title) => {
            const bt = document.createElement('button');
            bt.className = 'sz-rbtn small' + (o[prop] ? ' active' : '');
            bt.title = title; bt.setAttribute('aria-label', title); bt.innerHTML = ic;
            bt.addEventListener('click', () => {
              const v = !o[prop];
              app.commitUpdObj(o.id, { [prop]: v });
              bt.classList.toggle('active', v);
            });
            return bt;
          };
          r1.append(
            tb('bold', '<b>Ж</b>', 'Жирний'), tb('italic', '<i>К</i>', 'Курсив'),
            tb('underline', '<u>Ч</u>', 'Підкреслений'), tb('strike', '<s>З</s>', 'Закреслений'),
            tb('sup', 'x²', 'Надрядковий'), tb('sub', 'x₂', 'Підрядковий')
          );
          p.appendChild(r1);
          const r2 = row();
          r2.append(
            sel1([['left', '⯇'], ['center', '≡'], ['right', '⯈']], o.align, v => app.commitUpdObj(o.id, { align: v }), 'sz-w54'),
            sel1([['print', 'Друкований'], ['hand', 'Рукописний']], o.fontClass, v => app.commitUpdObj(o.id, { fontClass: v })),
            sel1(FONTSIZES.map(s => [s, s]), o.size, v => app.commitUpdObj(o.id, { size: +v }), 'sz-w54')
          );
          p.appendChild(r2);
          const r3 = row();
          r3.appendChild(this._colorPicker(c => app.commitUpdObj(o.id, { color: c }), o.color));
          const edit = document.createElement('button');
          edit.className = 'sz-rbtn small wide'; edit.textContent = 'Змінити текст';
          edit.addEventListener('click', () => app.startTextEdit(o));
          r3.appendChild(edit);
          p.appendChild(r3);
        } else if (o.type === 'path' || o.type === 'shape') {
          const r1 = row();
          r1.appendChild(this._colorPicker(c => app.commitUpdObj(o.id, { color: c }), o.color));
          r1.appendChild(sel1(PENSIZES.map(s => [s, s + 'px']), o.width, v => app.commitUpdObj(o.id, { width: +v }), 'sz-w64'));
          if (o.type === 'shape') {
            r1.appendChild(sel1(FILLS.map(f => [f, f === 'none' ? 'без заливки' : 'заливка']), o.fill, v => app.commitUpdObj(o.id, { fill: v })));
          }
          p.appendChild(r1);
        } else if (o.type === 'sticker') {
          const r1 = row();
          const colors = Object.keys(SZ.Render.STICKER_COLORS);
          r1.appendChild(this._swatches(colors.map(c => [c, SZ.Render.STICKER_COLORS[c]]), o.color, c => app.commitUpdObj(o.id, { color: c })));
          const edit = document.createElement('button');
          edit.className = 'sz-rbtn small'; edit.textContent = 'Текст';
          edit.addEventListener('click', () => app.startStickerEdit(o));
          r1.appendChild(edit);
          p.appendChild(r1);
        } else if (o.type === 'timer') {
          const r1 = row();
          const play = document.createElement('button');
          play.className = 'sz-rbtn small wide';
          play.textContent = o.running ? '⏸ Пауза' : '▶ Старт';
          play.addEventListener('click', () => {
            const go = !o.running;
            app.commitUpdObj(o.id, go
              ? { running: true, startedAt: Date.now() }
              : { running: false, startedAt: null, duration: Math.max(1, Math.round((o.duration || 300) - (Date.now() - (o.startedAt || Date.now())) / 1000)) });
          });
          const reset = document.createElement('button');
          reset.className = 'sz-rbtn small';
          reset.textContent = '↺';
          reset.title = 'Скинути таймер';
          reset.addEventListener('click', () => {
            const mins = prompt('Тривалість у хвилинах (1–90):', Math.round((o.duration || 300) / 60) || 5);
            if (mins && +mins >= 1 && +mins <= 90) app.commitUpdObj(o.id, { running: false, startedAt: null, duration: +mins * 60 });
          });
          r1.append(play, reset);
          p.appendChild(r1);
        } else if (o.type === 'table') {
          const r1 = row();
          const edit = document.createElement('button');
          edit.className = 'sz-rbtn small wide'; edit.textContent = 'Редагувати таблицю';
          edit.addEventListener('click', () => app.startTableEdit(o));
          r1.appendChild(edit);
          p.appendChild(r1);
        }
        // общие: слой + удаление
        const rz = row();
        const fBtn = document.createElement('button');
        fBtn.className = 'sz-rbtn small'; fBtn.textContent = '↑';
        fBtn.title = 'Шар вище'; fBtn.setAttribute('aria-label', 'Шар вище');
        fBtn.addEventListener('click', () => this._reorder(1));
        const bBtn = document.createElement('button');
        bBtn.className = 'sz-rbtn small'; bBtn.textContent = '↓';
        bBtn.title = 'Шар нижче'; bBtn.setAttribute('aria-label', 'Шар нижче');
        bBtn.addEventListener('click', () => this._reorder(-1));
        const del = document.createElement('button');
        del.className = 'sz-rbtn small danger'; del.textContent = '🗑';
        del.title = 'Видалити'; del.setAttribute('aria-label', 'Видалити объект');
        del.addEventListener('click', () => { app.commitDelObj(selObj.id); st.selection.clear(); this.syncProps(); app.requestRender(); });
        rz.append(fBtn, bBtn, del);
        p.appendChild(rz);
        return;
      }

      if (multi) {
        head(`Виділено: ${st.selection.size}`);
        const r = row();
        const del = document.createElement('button');
        del.className = 'sz-rbtn small danger wide'; del.textContent = '🗑 Видалити всё';
        del.addEventListener('click', () => { app.deleteSelection(); this.syncProps(); });
        const dup = document.createElement('button');
        dup.className = 'sz-rbtn small wide'; dup.textContent = '⧉ Дублювати';
        dup.addEventListener('click', () => {
          const pg = app.doc.pages[app.doc.active];
          pg.objects.filter(o => st.selection.has(o.id)).map(o => U.clone(o)).forEach(c => {
            c.id = U.uid('o'); c.x += 24; c.y += 24;
            app.commitAddObj(c);
          });
        });
        r.append(dup, del);
        p.appendChild(r);
        return;
      }

      /* --- свойства ИНСТРУМЕНТА: всё в одну строку, компактно --- */
      const inline = (label) => { const s = document.createElement('span'); s.className = 'sz-prop-lab inline'; s.textContent = label; return s; };
      const r = row();
      if (st.tool === 'pen') {
        r.appendChild(inline('✏️ Перо'));
        r.appendChild(this._colorPicker(c => { st.penColor = c; }, st.penColor));
        r.appendChild(sel1(PENSIZES.map(s => [s, s + 'px']), st.penWidth, v => { st.penWidth = +v; }, 'sz-w64'));
      } else if (st.tool === 'shape') {
        r.appendChild(inline('▭ Фігури'));
        SHAPES.forEach(([id, ic, name]) => {
          const b = document.createElement('button');
          b.className = 'sz-rbtn small' + (st.shape === id ? ' active' : '');
          b.title = name; b.setAttribute('aria-label', name);
          b.innerHTML = `<span class="sz-rbtn-ic">${ic}</span>`;
          b.addEventListener('click', () => {
            st.shape = id;
            this.btnShape.querySelector('.sz-rbtn-ic').textContent = ic;
            this.syncProps();
          });
          r.appendChild(b);
        });
        r.appendChild(this._colorPicker(c => { st.penColor = c; }, st.penColor));
        r.appendChild(sel1(PENSIZES.map(s => [s, s + 'px']), st.penWidth, v => { st.penWidth = +v; }, 'sz-w64'));
        const fl = document.createElement('span');
        fl.className = 'sz-swatches';
        FILLS.forEach(f => {
          const b = document.createElement('button');
          b.className = 'sz-swatch' + (st.fillColor === f ? ' sel' : '');
          if (f === 'none') { b.textContent = '∅'; b.style.fontSize = '10px'; b.style.lineHeight = '1'; b.title = 'Без заливки'; }
          else b.style.background = f;
          b.setAttribute('aria-label', f === 'none' ? 'Без заливки' : 'Заливка ' + f);
          b.addEventListener('click', () => { st.fillColor = f; this.syncProps(); });
          fl.appendChild(b);
        });
        r.appendChild(fl);
      } else if (st.tool === 'text') {
        r.appendChild(inline('T Текст'));
        r.appendChild(this._colorPicker(c => { st.penColor = c; }, st.penColor));
        r.appendChild(sel1(FONTSIZES.map(s => [s, s + 'px']), st.fontSize, v => { st.fontSize = +v; }, 'sz-w64'));
        r.appendChild(sel1([['print', 'Друкований'], ['hand', 'Рукописний']], st.fontClass, v => { st.fontClass = v; }));
      } else if (st.tool === 'eraser') {
        r.appendChild(inline('🧽 Гумка'));
        const lab = document.createElement('span');
        lab.className = 'dim';
        lab.style.fontSize = '12px';
        lab.textContent = 'Тягніть по об’єкту, щоб його видалити';
        r.appendChild(lab);
      }
      p.appendChild(r);
    },

    _reorder(dir) {
      const st = SZ.App.state;
      const app = SZ.App;
      const pg = app.doc.pages[app.doc.active];
      for (const id of st.selection) {
        const i = pg.objects.findIndex(o => o.id === id);
        if (i < 0) continue;
        const ni = U.clamp(i + dir, 0, pg.objects.length - 1);
        if (ni === i) continue;
        const [o] = pg.objects.splice(i, 1);
        pg.objects.splice(ni, 0, o);
        if (app.transport && app.state.online) app.transport.send({ t: 'op', op: { t: 'reorder', pageId: pg.id, id, to: ni } });
        app.requestRender();
      }
    },

    _objName(o) {
      return ({ path: 'Малюнок', shape: 'Фігура', text: 'Текст', image: 'Зображення', sticker: 'Стікер', table: 'Таблиця', qr: 'QR-код', timer: 'Таймер' })[o.type] || 'Об’єкт';
    },

    _colorPicker(cb, cur) {
      const wrap = document.createElement('span');
      wrap.className = 'sz-swatches';
      COLORS.forEach(c => {
        const b = document.createElement('button');
        b.className = 'sz-swatch' + (cur === c ? ' sel' : '');
        b.style.background = c;
        b.title = c; b.setAttribute('aria-label', 'Цвет ' + c);
        b.addEventListener('click', () => { cb(c); this.syncProps(); });
        wrap.appendChild(b);
      });
      const custom = document.createElement('label');
      custom.className = 'sz-swatch sz-swatch-custom';
      custom.setAttribute('aria-label', 'Свой цвет');
      custom.innerHTML = '🎨';
      const inp = document.createElement('input');
      inp.type = 'color'; inp.value = cur || '#1d3557';
      inp.style.position = 'absolute'; inp.style.inset = '0'; inp.style.opacity = '0';
      inp.addEventListener('input', () => { cb(inp.value); });
      custom.appendChild(inp);
      wrap.appendChild(custom);
      return wrap;
    },

    _swatches(list, cur, cb) {
      const wrap = document.createElement('span');
      wrap.className = 'sz-swatches';
      list.forEach(([v, color]) => {
        const b = document.createElement('button');
        b.className = 'sz-swatch' + (cur === v ? ' sel' : '');
        b.style.background = color; b.setAttribute('aria-label', 'Цвет ' + v);
        b.addEventListener('click', () => { cb(v); this.syncProps(); });
        wrap.appendChild(b);
      });
      return wrap;
    },

    sync() {
      if (this.btnUndo) {
        this.btnUndo.disabled = !SZ.App.history.canUndo();
        this.btnRedo.disabled = !SZ.App.history.canRedo();
      }
      this.rail.querySelectorAll('.sz-rbtn[data-tool]').forEach(b => {
        const t = SZ.Tools.get(b.dataset.tool);
        if (!t) return;
        if (t.perm) {
          const ok = SZ.App.allowed(t.perm);
          b.disabled = !ok;
          b.title = ok ? b.getAttribute('aria-label') : SZ.App.permDeniedMsg(t.perm);
        }
      });
      this.insertMenu && this.insertMenu.querySelectorAll('[data-perm]').forEach(b => {
        const perm = b.dataset.perm;
        if (!perm) return;
        const ok = SZ.App.allowed(perm);
        b.disabled = !ok;
      });
      this.syncProps();
    },

    hideProps() { if (this.props) this.props.style.display = 'none'; },
    showProps() { if (this.props) this.props.style.display = 'flex'; }
  };

  SZ.Toolbar = Toolbar;
})(window.SZ = window.SZ || {});
