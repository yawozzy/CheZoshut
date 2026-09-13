/* ЦеЗошит — модальные окна и общие диалоги (shared/ui/modals.js) */
(function (SZ) {
  'use strict';
  const U = SZ.U;

  const Modals = {
    init() {
      this.host = document.getElementById('sz-modals');
    },
    _close() { this.host.innerHTML = ''; },

    /* form: [{name, label, value, ph, type}] -> cb(vals) */
    form(title, fields, cb, opts) {
      const h = this.host;
      h.innerHTML = `
        <div class="sz-modal-back" role="presentation"></div>
        <div class="sz-modal" role="dialog" aria-modal="true" aria-label="${U.esc(title)}">
          <h3>${U.esc(title)}</h3>
          <form>
            ${fields.map(f => `
              <label class="sz-field">
                <span>${U.esc(f.label)}</span>
                ${f.type === 'select'
                  ? `<select name="${f.name}" class="sz-input">${f.options.map(o => `<option value="${U.esc(o[0])}" ${String(o[0]) === String(f.value) ? 'selected' : ''}>${U.esc(o[1])}</option>`).join('')}</select>`
                  : `<input name="${f.name}" class="sz-input" type="${f.type || 'text'}" value="${U.esc(f.value == null ? '' : f.value)}" placeholder="${U.esc(f.ph || '')}">`}
              </label>`).join('')}
            <div class="sz-modal-actions">
              <button type="button" class="sz-btn ghost" data-act="cancel">Скасувати</button>
              <button type="submit" class="sz-btn primary">Гаразд</button>
            </div>
          </form>
        </div>`;
      const back = h.querySelector('.sz-modal-back');
      const formEl = h.querySelector('form');
      const close = () => this._close();
      back.addEventListener('click', close);
      h.querySelector('[data-act="cancel"]').addEventListener('click', close);
      formEl.addEventListener('submit', (e) => {
        e.preventDefault();
        const vals = {};
        fields.forEach(f => { vals[f.name] = formEl.elements[f.name].value; });
        this._close();
        cb(vals);
      });
      const first = formEl.querySelector('input,select,textarea');
      if (first) setTimeout(() => first.focus(), 50);
    },

    prompt(title, label, value, cb) {
      this.form(title, [{ name: 'v', label, value }], v => cb(v.v));
    },

    confirm(title, msg, cb) {
      const h = this.host;
      h.innerHTML = `
        <div class="sz-modal-back" role="presentation"></div>
        <div class="sz-modal small" role="alertdialog" aria-modal="true" aria-label="${U.esc(title)}">
          <h3>${U.esc(title)}</h3>
          <p>${U.esc(msg)}</p>
          <div class="sz-modal-actions">
            <button class="sz-btn ghost" data-act="no">Скасувати</button>
            <button class="sz-btn danger" data-act="yes">Підтвердити</button>
          </div>
        </div>`;
      const close = () => this._close();
      h.querySelector('.sz-modal-back').addEventListener('click', close);
      h.querySelector('[data-act="no"]').addEventListener('click', close);
      h.querySelector('[data-act="yes"]').addEventListener('click', () => { close(); cb(); });
      const yes = h.querySelector('[data-act="yes"]');
      if (yes) setTimeout(() => yes.focus(), 50);
    },

    info(title, html) {
      const h = this.host;
      h.innerHTML = `
        <div class="sz-modal-back" role="presentation"></div>
        <div class="sz-modal" role="dialog" aria-modal="true" aria-label="${U.esc(title)}">
          <h3>${U.esc(title)}</h3>
          <div class="sz-modal-body">${html}</div>
          <div class="sz-modal-actions"><button class="sz-btn primary" data-act="ok">Зрозуміло</button></div>
        </div>`;
      h.querySelector('.sz-modal-back').addEventListener('click', () => this._close());
      h.querySelector('[data-act="ok"]').addEventListener('click', () => this._close());
      const ok = h.querySelector('[data-act="ok"]');
      if (ok) setTimeout(() => ok.focus(), 50);
    },

    /* редактор таблицы */
    tableEditor(o, cb) {
      const h = this.host;
      const render = (rows, cols, cells) => {
        let tableHtml = '';
        for (let r = 0; r < rows; r++) {
          tableHtml += '<tr>';
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            tableHtml += `<td><input class="sz-input" data-i="${idx}" value="${U.esc(cells[idx]?.text || '')}" aria-label="Комірка ${r + 1}-${c + 1}"></td>`;
          }
          tableHtml += '</tr>';
        }
        h.innerHTML = `
          <div class="sz-modal-back"></div>
          <div class="sz-modal wide" role="dialog" aria-modal="true" aria-label="Редактор таблиці">
            <h3>Таблица</h3>
            <div class="sz-table-ed-size">
              <label class="sz-field">Рядків: <select class="sz-input" data-rows>${[2, 3, 4, 5, 6].map(n => `<option ${n === rows ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
              <label class="sz-field">Стовпців: <select class="sz-input" data-cols>${[2, 3, 4, 5, 6].map(n => `<option ${n === cols ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            </div>
            <table class="sz-table-ed">${tableHtml}</table>
            <div class="sz-modal-actions">
              <button class="sz-btn ghost" data-act="cancel">Скасувати</button>
              <button class="sz-btn danger" data-act="del">🗑 Видалити таблицю</button>
              <button class="sz-btn primary" data-act="ok">Зберегти</button>
            </div>
          </div>`;
        const back = h.querySelector('.sz-modal-back');
        back.addEventListener('click', () => this._close());
        h.querySelector('[data-act="cancel"]').addEventListener('click', () => this._close());
        h.querySelector('[data-act="del"]').addEventListener('click', () => { this._close(); SZ.App.commitDelObj(o.id); });
        h.querySelector('[data-act="ok"]').addEventListener('click', () => {
          const inputs = h.querySelectorAll('[data-i]');
          const newCells = Array.from({ length: rows * cols }, () => ({ text: '' }));
          inputs.forEach(inp => { newCells[+inp.dataset.i] = { text: inp.value }; });
          this._close();
          cb(newCells, rows, cols);
        });
        h.querySelector('[data-rows]').addEventListener('change', (e) => {
          const newRows = +e.target.value;
          const newCells = Array.from({ length: newRows * cols }, (_, i) => cells[i] || { text: '' });
          render(newRows, cols, newCells);
        });
        h.querySelector('[data-cols]').addEventListener('change', (e) => {
          const newCols = +e.target.value;
          const newCells = Array.from({ length: rows * newCols }, (_, i) => {
            const r = Math.floor(i / newCols), c = i % newCols;
            return (c < cols && cells[r * cols + c]) || { text: '' };
          });
          render(rows, newCols, newCells);
        });
        const fi = h.querySelector('[data-i]');
        if (fi) setTimeout(() => fi.focus(), 60);
      };
      render(o.rows || 3, o.cols || 3, o.cells || []);
    }
  };

  SZ.Modals = Modals;
})(window.SZ = window.SZ || {});
