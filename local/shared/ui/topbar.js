/* ЦеЗошит — верхняя панель (shared/ui/topbar.js)
 * Минималистичная: лого, название, настройки (⚙), совместная работа (👥).
 * Фон страницы, экспорт/импорт, AI — внутри «Настроек».
 */
(function (SZ) {
  'use strict';
  const U = SZ.U;

  const BGS = [
    ['ruled', 'Лінійка', '▬▬▬'],
    ['grid', 'Клітинка', '▦'],
    ['slant', 'Прописи', '╲╲╲'],
    ['plain', 'Чистий лист', '▢']
  ];

  const Topbar = {
    init() {
      this.el = document.getElementById('sz-topbar');
      this._build();
    },

    _build() {
      const el = this.el;
      el.innerHTML = '';

      const brand = document.createElement('div');
      brand.className = 'sz-brand';
      brand.innerHTML = `<span class="sz-logo" aria-hidden="true">📓</span>`;
      const title = document.createElement('input');
      title.className = 'sz-title-input';
      title.value = SZ.App.doc.title;
      title.setAttribute('aria-label', 'Название блокнота');
      title.addEventListener('change', () => {
        SZ.App.doc.title = title.value || 'Зошит';
        // синхронизация названия у всех участников
        if (SZ.App.transport && SZ.App.state.online) SZ.App.transport.send({ t: 'op', op: { t: 'rename', title: SZ.App.doc.title } });
        SZ.Storage.autosave();
      });
      // чужое rename — обновить поле
      this._titleEl = title;
      brand.appendChild(title);
      el.appendChild(brand);

      const sp = () => { const s = document.createElement('div'); s.className = 'sz-spacer'; return s; };
      el.appendChild(sp());

      // Налаштування
      const setBtn = document.createElement('button');
      setBtn.className = 'sz-tbtn';
      setBtn.id = 'sz-settings-btn';
      setBtn.title = 'Налаштування'; setBtn.setAttribute('aria-label', 'Налаштування');
      setBtn.innerHTML = '<span class="sz-tbtn-ic">⚙</span>';
      setBtn.addEventListener('click', () => this.openSettings());
      el.appendChild(setBtn);

      // AI-помічник
      const aiBtn = document.createElement('button');
      aiBtn.className = 'sz-tbtn';
      aiBtn.id = 'sz-ai-btn';
      aiBtn.title = 'AI-помічник';
      aiBtn.setAttribute('aria-label', 'AI-помічник');
      aiBtn.innerHTML = '<span class="sz-tbtn-ic">✨</span>';
      aiBtn.addEventListener('click', () => SZ.AI && SZ.AI.openMenu());
      el.appendChild(aiBtn);

      // Спільна робота
      this.collabBtn = document.createElement('button');
      this.collabBtn.className = 'sz-tbtn';
      this.collabBtn.id = 'sz-collab-btn';
      this.collabBtn.title = 'Спільна робота';
      this.collabBtn.setAttribute('aria-label', 'Спільна робота');
      this.collabBtn.innerHTML = '<span class="sz-tbtn-ic">👥</span>';
      this.collabBtn.addEventListener('click', () => SZ.Collab.UI.openDialog());
      el.appendChild(this.collabBtn);

      this.sync();
    },

    /* ============ НАСТРОЙКИ ============ */
    openSettings() {
      const M = SZ.Modals;
      const app = SZ.App;
      const bg = app.doc.pages[app.doc.active].background;
      const h = document.getElementById('sz-modals');
      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal" role="dialog" aria-modal="true" aria-label="Налаштування">
          <h3>⚙ Налаштування</h3>

          <h4>Формат сторінки</h4>
          <div class="sz-set-bg" role="group" aria-label="Формат сторінки">
            ${BGS.map(([id, name, ic]) => `
              <button class="sz-bgbtn ${bg === id ? 'active' : ''}" data-bg="${id}">
                <span class="sz-bgbtn-ic">${ic}</span>
                <span>${name}</span>
              </button>`).join('')}
          </div>

          <h4>Сторінки</h4>
          <div class="sz-tp-row">
            <button class="sz-btn" id="sz-set-dup">⧉ Дублювати сторінку</button>
            <button class="sz-btn danger" id="sz-set-del">🗑 Видалити сторінку</button>
          </div>

          <h4>Файли</h4>
          <div class="sz-tp-row">
            <button class="sz-btn" id="sz-set-save">💾 Сохранить</button>
            <button class="sz-btn" id="sz-set-export">⬇ Завантажити зошит</button>
            <button class="sz-btn" id="sz-set-import">⬆ Відкрити з файла</button>
          </div>
          <div class="sz-tp-row">
            <button class="sz-btn" id="sz-set-png">🖼 Сторінка в PNG</button>
            <button class="sz-btn" id="sz-set-print">🖨 Друк / PDF</button>
          </div>

          <h4>Ваше ім’я</h4>
          <label class="sz-field"><span>Як вас бачать учасники сесії</span>
            <input class="sz-input" id="sz-set-name" value="${U.esc(app.state.userName)}" placeholder="Иван Иванович"></label>

          <div class="sz-modal-actions">
            <button class="sz-btn primary" data-act="close">Закрити</button>
          </div>
        </div>`;

      const close = () => M._close();
      h.querySelector('.sz-modal-back').addEventListener('click', close);
      h.querySelector('[data-act="close"]').addEventListener('click', close);

      h.querySelectorAll('[data-bg]').forEach(b => b.addEventListener('click', () => {
        app.setPageBg(b.dataset.bg);
        h.querySelectorAll('[data-bg]').forEach(x => x.classList.toggle('active', x.dataset.bg === b.dataset.bg));
      }));
      h.querySelector('#sz-set-dup').addEventListener('click', () => { close(); app.dupPage(); });
      h.querySelector('#sz-set-del').addEventListener('click', () => { close(); app.delPage(); });
      h.querySelector('#sz-set-save').addEventListener('click', () => SZ.Storage.saveNow());
      h.querySelector('#sz-set-export').addEventListener('click', () => { SZ.Storage.exportFile(); });
      h.querySelector('#sz-set-import').addEventListener('click', () => {
        close();
        const i = document.createElement('input');
        i.type = 'file'; i.accept = '.json,application/json';
        i.addEventListener('change', () => { if (i.files[0]) SZ.Storage.importFile(i.files[0]); });
        i.click();
      });
      h.querySelector('#sz-set-png').addEventListener('click', () => SZ.Storage.exportPagePNG());
      h.querySelector('#sz-set-print').addEventListener('click', () => { close(); SZ.Storage.printDoc(); });
      h.querySelector('#sz-set-name').addEventListener('change', (e) => {
        const v = e.target.value.trim().slice(0, 40);
        if (v) { app.state.userName = v; localStorage.setItem('sz:name', v); U.toast('Ім’я збережено', 'ok'); }
      });
    },

    sync() {
      // название обновилось (в т.ч. от сервера)
      if (this._titleEl && document.activeElement !== this._titleEl && this._titleEl.value !== SZ.App.doc.title) {
        this._titleEl.value = SZ.App.doc.title;
      }
      if (!this.collabBtn) return;
      const st = SZ.App.state;
      this.collabBtn.classList.toggle('online', st.online);
      this.collabBtn.title = st.online
        ? `Сессия ${st.sessionCode}: ${st.participants.length} учасн. — відкрити панель`
        : 'Спільна робота (створити чи підключитися)';
      const cnt = st.online && st.participants.length ? `<span class="sz-badge">${st.participants.length}</span>` : '';
      this.collabBtn.innerHTML = `<span class="sz-tbtn-ic">👥</span>${cnt}`;
    }
  };

  SZ.Topbar = Topbar;
})(window.SZ = window.SZ || {});
