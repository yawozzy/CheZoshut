/* ЦеЗошит — UI коллаборации: диалог подключения, панель учителя (shared/collab/collab-ui.js) */
(function (SZ) {
  'use strict';
  const U = SZ.U;

  const CollabUI = {
    init() {
      SZ.Collab.UI = this;
      this.handQueue = [];
      this.logEntries = [];
      this._banner = document.getElementById('sz-collab-banner');
      this._bindHandQueue();
      // автоприсоединение по ссылке ?join=CODE
      const join = new URLSearchParams(location.search).get('join');
      if (join) {
        setTimeout(() => SZ.Collab.UI.askName(join.toUpperCase()), 400);
      }
    },

    /* ---------- Диалог: создать / подключиться ---------- */
    openDialog() {
      const st = SZ.App.state;
      if (st.online) return this.openTeacherPanel();
      const M = SZ.Modals;
      const h = document.getElementById('sz-modals');
      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal" role="dialog" aria-modal="true" aria-label="Совместная работа">
          <h3>👥 Спільна робота</h3>
          <p class="sz-hint">Створіть сесію як <b>вчитель</b> — отримаєте код і QR для класу, або підключіться <b>учнем</b> за кодом з дошки.</p>
          <form id="sz-form-host">
            <label class="sz-field"><span>Ваше ім’я</span>
              <input class="sz-input" name="name" value="${U.esc(st.userName)}" placeholder="Іван Іванович" required></label>
            <button class="sz-btn primary wide" type="submit">🎓 Я вчитель — створити сесію</button>
          </form>
          <div class="sz-or">— или —</div>
          <form id="sz-form-join">
            <label class="sz-field"><span>Ім’я</span>
              <input class="sz-input" name="name" value="${U.esc(st.userName)}" placeholder="Аня"></label>
            <label class="sz-field"><span>Код сесії з дошки</span>
              <input class="sz-input" name="code" placeholder="напр. X7K2MP" autocomplete="off" style="text-transform:uppercase;letter-spacing:2px"></label>
            <button class="sz-btn wide" type="submit">✋ Я учень — увійти</button>
          </form>
          <p class="sz-hint dim" id="sz-collab-mode-hint"></p>
        </div>`;
      h.querySelector('.sz-modal-back').addEventListener('click', () => M._close());
      h.querySelector('#sz-form-host').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = e.target.elements.name.value;
        M._close();
        SZ.Collab.host(name);
      });
      h.querySelector('#sz-form-join').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = e.target.elements;
        M._close();
        this.askName(f.code.value, f.name.value);
      });
      const hint = h.querySelector('#sz-collab-mode-hint');
      if (SZ.Collab.serverUrl) hint.textContent = `Сервер: ${SZ.Collab.serverUrl}`;
      else hint.textContent = 'Спільна робота в локальній версії обмежена — використовуйте серверну версію (див. README).';
    },

    askName(code, presetName) {
      const st = SZ.App.state;
      if (!presetName && !st.userName) {
        SZ.Modals.form('Як вас звати?', [{ name: 'name', label: 'Имя', value: '', ph: 'Аня' }], (v) => {
          if (v.name) SZ.Collab.join(code, v.name);
          else SZ.Collab.join(code, '');
        });
      } else {
        SZ.Collab.join(code, presetName || st.userName);
      }
    },

    toastConnected() {
      const st = SZ.App.state;
      U.toast(st.role === 'teacher'
        ? `Сесія создана! Код: ${st.sessionCode}`
        : `Вы вошли в сессию ${st.sessionCode}`, 'ok');
    },

    /* ---------- Панель учителя ---------- */
    openTeacherPanel() {
      const st = SZ.App.state;
      if (st.role !== 'teacher') {
        // ученик — простая сводка
        return this.openStudentPanel();
      }
      const M = SZ.Modals;
      const h = document.getElementById('sz-modals');
      const perms = st.permissions || { globalEdit: true, tools: {} };
      const tools = perms.tools || {};
      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal wide tall" role="dialog" aria-modal="true" aria-label="Панель учителя">
          <h3>🎓 Панель вчителя — сесія ${U.esc(st.sessionCode || '')}</h3>

          <div class="sz-tp-row" id="sz-tp-share">
            <button class="sz-btn" id="sz-tp-qr">🔳 QR-код для підключення</button>
            <button class="sz-btn ghost" id="sz-tp-copy">📋 Копіювати посилання</button>
          </div>

          <div class="sz-tp-sec">
            <h4>Тест-опитування класу</h4>
            <div class="sz-tp-row">
              <button class="sz-btn" id="sz-tp-poll">📊 Створити опитування</button>
            </div>
            <p class="sz-hint dim">Учні відповідатимуть на своїх екранах; після завершення всі побачать правильну відповідь і хто що обрав.</p>
          </div>

          <div class="sz-tp-sec">
            <h4>Права учнів</h4>
            <label class="sz-switch-row">
              <span><b>Дозволити редагування всім</b><br><small class="dim">Вимкніть — режим «лише перегляд»</small></span>
              <input type="checkbox" id="sz-tp-global" ${perms.globalEdit !== false ? 'checked' : ''}>
              <span class="sz-switch" aria-hidden="true"></span>
            </label>
            <div class="sz-tp-tools" role="group" aria-label="Разрешить инструменты">
              ${SZ.Collab.PERMISSION_TOOLS.map(([id, name]) => `
                <label class="sz-switch-row small">
                  <span>${name}</span>
                  <input type="checkbox" data-tool="${id}" ${tools[id] !== false ? 'checked' : ''}>
                  <span class="sz-switch" aria-hidden="true"></span>
                </label>`).join('')}
            </div>
          </div>

          <div class="sz-tp-sec">
            <h4>Ученики (${st.participants.filter(p => p.role === 'student').length})</h4>
            <div class="sz-tp-students" id="sz-tp-students"></div>
          </div>

          <div class="sz-tp-sec">
            <h4>Історія версій сторінки</h4>
            <div class="sz-tp-row">
              <button class="sz-btn" id="sz-tp-snap">💾 Зберегти версію</button>
              <button class="sz-btn ghost" id="sz-tp-snaps">🕘 Відновити…</button>
            </div>
          </div>

          <div class="sz-tp-sec">
            <h4>Журнал подій</h4>
            <div class="sz-log" id="sz-tp-log" role="log" aria-live="polite"></div>
          </div>

          <div class="sz-modal-actions">
            <button class="sz-btn danger" id="sz-tp-exit">Вийти зі сесії</button>
            <button class="sz-btn primary" data-act="close">Закрити</button>
          </div>
        </div>`;

      const close = () => M._close();
      h.querySelector('.sz-modal-back').addEventListener('click', close);
      h.querySelector('[data-act="close"]').addEventListener('click', close);

      // QR: сразу показывает код комнаты и QR по ссылке подключения (без ввода)
      h.querySelector('#sz-tp-qr').addEventListener('click', () => {
        this.showQrModal();
      });
      // тест-опрос
      h.querySelector('#sz-tp-poll').addEventListener('click', () => {
        if (SZ.Poll) { SZ.Modals._close(); SZ.Poll.openCreate(); }
      });
      h.querySelector('#sz-tp-copy').addEventListener('click', async (e) => {
        const url = SZ.Collab.joinUrl();
        try { await navigator.clipboard.writeText(url); e.target.textContent = '✓ Скопійовано'; }
        catch (_) { prompt('Скопіюйте вручну:', url); }
      });

      // глобальный переключатель
      h.querySelector('#sz-tp-global').addEventListener('change', (e) => {
        SZ.Collab.teacherToggleGlobal(e.target.checked);
      });
      // инструменты
      h.querySelectorAll('[data-tool]').forEach(cb => {
        cb.addEventListener('change', () => SZ.Collab.teacherToggleTool(cb.dataset.tool, cb.checked));
      });

      // ученики
      this._renderStudents(h.querySelector('#sz-tp-students'));

      h.querySelector('#sz-tp-snap').addEventListener('click', () => { SZ.Collab.teacherSaveSnapshot(); U.toast('Версия сохранена', 'ok'); });
      h.querySelector('#sz-tp-snaps').addEventListener('click', () => SZ.Collab.teacherListSnapshots());
      h.querySelector('#sz-tp-exit').addEventListener('click', () => { close(); SZ.Collab.disconnect(); });

      this._renderLog(h.querySelector('#sz-tp-log'));
      this._renderBanner();
    },

    /* ---------- QR-модалка: сразу генерирует по коду комнаты ---------- */
    showQrModal() {
      const st = SZ.App.state;
      const M = SZ.Modals;
      const code = st.sessionCode;
      const url = SZ.Collab.joinUrl();
      const h = document.getElementById('sz-modals');
      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal" role="dialog" aria-modal="true" aria-label="QR для подключения">
          <h3>🔳 Підключення до класу</h3>
          <div class="sz-qr-box">
            <canvas id="sz-qr-canvas" width="240" height="240" aria-label="QR-код для підключення"></canvas>
          </div>
          <p style="text-align:center;font-size:22px;font-weight:800;letter-spacing:4px;margin:10px 0 4px">${U.esc(code || '—')}</p>
          <p class="dim" style="text-align:center;font-size:12.5px;margin:0 0 8px">код сесії — назвіть його класу</p>
          <p class="sz-hint dim" style="text-align:center;word-break:break-all">${U.esc(url)}</p>
          <div class="sz-modal-actions">
            <button class="sz-btn ghost" id="sz-qr-copy">📋 Копіювати посилання</button>
            <button class="sz-btn" id="sz-qr-page">⬇ Вставити QR на сторінку</button>
            <button class="sz-btn primary" data-act="close">Закрити</button>
          </div>
        </div>`;
      // рисуем QR на canvas
      try {
        const c = h.querySelector('#sz-qr-canvas');
        const ctx = c.getContext('2d');
        const qr = qrcode(0, 'M');
        qr.addData(url, 'Byte');
        qr.make();
        const n = qr.getModuleCount();
        const cs = 240 / n;
        ctx.fillStyle = '#111';
        for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
          if (qr.isDark(r, col)) ctx.fillRect(col * cs, r * cs, Math.ceil(cs), Math.ceil(cs));
        }
      } catch (e) { /* слишком длинный URL — не критично */ }
      const close = () => M._close();
      h.querySelector('.sz-modal-back').addEventListener('click', close);
      h.querySelector('[data-act="close"]').addEventListener('click', close);
      h.querySelector('#sz-qr-copy').addEventListener('click', async (e) => {
        try { await navigator.clipboard.writeText(url); e.target.textContent = '✓ Скопійовано'; }
        catch (_) { prompt('Скопіюйте вручну:', url); }
      });
      h.querySelector('#sz-qr-page').addEventListener('click', () => {
        close();
        SZ.Insert.qr(url, 'Скануй і увійди в клас');
        U.toast('QR додано на сторінку', 'ok');
      });
    },

    _renderStudents(container) {
      const st = SZ.App.state;
      container.innerHTML = '';
      const students = st.participants.filter(p => p.role === 'student');
      if (!students.length) {
        container.innerHTML = '<p class="dim">Поки нікого. Дайте класу код сесії або QR.</p>';
        return;
      }
      students.forEach(p => {
        const blocked = st.permissions && st.permissions.blocked && st.permissions.blocked.includes(p.userId);
        const row = document.createElement('div');
        row.className = 'sz-student-row';
        row.innerHTML = `
          <span class="sz-dot" style="background:${U.esc(p.color)}" aria-hidden="true"></span>
          <span class="sz-student-name">${U.esc(p.name)}</span>
          ${p.connected === false ? '<span class="dim">офлайн</span>' : ''}
          ${st.presenterId === p.userId ? '<span class="sz-pill gold">⭐ ведучий</span>' : ''}
          ${blocked ? '<span class="sz-pill red">заблокований</span>' : ''}
          <span class="sz-spacer"></span>
          <button class="sz-btn small ghost" data-pres="${U.esc(p.userId)}">${st.presenterId === p.userId ? 'Зняти ведучого' : '⭐ Зробити ведучим'}</button>
          <button class="sz-btn small ${blocked ? '' : 'danger'}" data-block="${U.esc(p.userId)}">${blocked ? 'Розблокувати' : '🚫 Блокувати'}</button>
          <button class="sz-btn small danger" data-kick="${U.esc(p.userId)}" title="Відключити від сесії">✖</button>`;
        container.appendChild(row);
      });
      container.querySelectorAll('[data-block]').forEach(b => b.addEventListener('click', () => {
        const uid = b.dataset.block;
        const blocked = st.permissions && st.permissions.blocked && st.permissions.blocked.includes(uid);
        SZ.Collab._permOp({ type: blocked ? 'unblock' : 'block', userId: uid });
        setTimeout(() => this._renderStudents(container), 300);
      }));
      container.querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', () => {
        SZ.Collab.teacherKick(b.dataset.kick);
        setTimeout(() => this._renderStudents(container), 300);
      }));
      container.querySelectorAll('[data-pres]').forEach(b => b.addEventListener('click', () => {
        SZ.Collab.teacherPresenter(st.presenterId === b.dataset.pres ? null : b.dataset.pres);
        setTimeout(() => this._renderStudents(container), 300);
      }));
    },

    /* ---------- Панель ученика ---------- */
    openStudentPanel() {
      const st = SZ.App.state;
      const M = SZ.Modals;
      const h = document.getElementById('sz-modals');
      const blocked = st.permissions && st.permissions.blocked && st.permissions.blocked.includes(st.userId);
      const deniedTools = [];
      if (st.permissions && st.permissions.tools) {
        for (const [id, name] of SZ.Collab.PERMISSION_TOOLS) {
          if (st.permissions.tools[id] === false || st.permissions.globalEdit === false) deniedTools.push(name);
        }
      }
      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal" role="dialog" aria-modal="true" aria-label="Сесія">
          <h3>✋ Сесія ${U.esc(st.sessionCode || '')}</h3>
          <p><span class="sz-dot" style="background:${U.esc(st.userColor)}"></span> ${U.esc(st.userName)} ${st.presenterId === st.userId ? '⭐ ви ведучий' : ''}</p>
          ${blocked ? '<p class="sz-warn">🚫 Вчитель обмежив ваші дії.</p>' : ''}
          ${!blocked && deniedTools.length ? `<p class="dim">Недоступно зараз: ${U.esc(deniedTools.join(', '))}</p>` : ''}
          ${!blocked && !deniedTools.length ? '<p class="dim ok-text">Усі інструменти доступні ✓</p>' : ''}
          <div class="sz-modal-actions">
            ${SZ.Poll && SZ.Poll.state ? '<button class="sz-btn" id="sz-sp-poll">📊 До опитування</button>' : ''}
            <button class="sz-btn" id="sz-sp-hand">✋ Підняти руку</button>
            <button class="sz-btn ghost" id="sz-sp-exit">Вийти</button>
            <button class="sz-btn primary" data-act="close">Закрити</button>
          </div>
        </div>`;
      const close = () => M._close();
      h.querySelector('.sz-modal-back').addEventListener('click', close);
      h.querySelector('[data-act="close"]').addEventListener('click', close);
      const pb = h.querySelector('#sz-sp-poll');
      if (pb) pb.addEventListener('click', () => { close(); SZ.Poll.state && SZ.Poll.onPollState(SZ.Poll.state); });
      h.querySelector('#sz-sp-hand').addEventListener('click', () => { SZ.Collab.studentHand(); close(); });
      h.querySelector('#sz-sp-exit').addEventListener('click', () => { close(); SZ.Collab.disconnect(); });
    },

    /* ---------- Рука поднята ---------- */
    _bindHandQueue() {
      setInterval(() => this._renderBanner(), 1500);
    },
    showHand(m) {
      // m: {userId, name, ts}
      if (this.handQueue.some(h => h.userId === m.userId)) return;
      this.handQueue.push(m);
      this._renderBanner();
      this._beep();
      U.toast(`✋ ${m.name} підняв(ла) руку`, 'info');
    },
    clearHand(userId) {
      this.handQueue = this.handQueue.filter(h => h.userId !== userId);
      this._renderBanner();
    },
    /* Учитель нажал на поднятую руку → выбор, что разрешить ученику */
    openHandDialog(hand) {
      const M = SZ.Modals;
      const h = document.getElementById('sz-modals');
      const TOOLS = SZ.Collab.PERMISSION_TOOLS;
      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal" role="dialog" aria-modal="true" aria-label="Піднята рука">
          <h3>✋ ${U.esc(hand.name)} підняв(ла) руку</h3>
          <p class="sz-hint">Дозвольте цьому учневі тимчасово виконувати дії — навіть якщо класу вони заборонені:</p>
          <div class="sz-tp-tools" role="group" aria-label="Дозволити дії">
            ${TOOLS.map(([id, name]) => `
              <label class="sz-switch-row small">
                <span>${name}</span>
                <input type="checkbox" data-tool="${id}" ${['obj:path', 'obj:text', 'delete'].includes(id) ? 'checked' : ''}>
                <span class="sz-switch" aria-hidden="true"></span>
              </label>`).join('')}
          </div>
          <label class="sz-field"><span>На скільки хвилин</span>
            <select class="sz-input" id="sz-hand-mins">
              <option value="5" selected>5 хвилин</option>
              <option value="10">10 хвилин</option>
              <option value="15">15 хвилин</option>
              <option value="0">до кінця уроку</option>
            </select></label>
          <div class="sz-modal-actions">
            <button class="sz-btn ghost" id="sz-hand-dismiss">Просто прибрати</button>
            <button class="sz-btn danger" id="sz-hand-revoke">Забрати дозвіл</button>
            <button class="sz-btn primary" id="sz-hand-grant">✓ Дозволити</button>
          </div>
        </div>`;
      const close = () => M._close();
      h.querySelector('.sz-modal-back').addEventListener('click', close);
      h.querySelector('#sz-hand-dismiss').addEventListener('click', () => { this.clearHand(hand.userId); close(); });
      h.querySelector('#sz-hand-revoke').addEventListener('click', () => {
        SZ.Collab.revokeHand(hand.userId);
        this.clearHand(hand.userId);
        close();
      });
      h.querySelector('#sz-hand-grant').addEventListener('click', () => {
        const tools = {};
        h.querySelectorAll('[data-tool]').forEach(cb => { tools[cb.dataset.tool] = cb.checked; });
        const mins = +h.querySelector('#sz-hand-mins').value;
        SZ.Collab.grantHand(hand.userId, tools, mins);
        this.clearHand(hand.userId);
        close();
      });
    },
    _beep() {
      try {
        const ctx = this._actx || (this._actx = new (window.AudioContext || window.webkitAudioContext)());
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 660; o.type = 'sine';
        g.gain.value = .12;
        o.connect(g).connect(ctx.destination);
        o.start();
        setTimeout(() => { g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .2); o.stop(ctx.currentTime + .25); }, 150);
      } catch (_) {}
    },

    /* ---------- Баннер ---------- */
    _renderBanner() {
      const st = SZ.App.state;
      const b = this._banner;
      if (!b) return;
      if (!st.online) { b.style.display = 'none'; return; }
      const hands = this.handQueue.slice(-3);
      const role = st.role === 'teacher' ? '🎓 Вчитель' : (st.presenterId === st.userId ? '⭐ Ведучий' : '✋ Учень');
      const deniedAll = st.role === 'student' && st.permissions && st.permissions.globalEdit === false && !st.handGrant;
      const granted = st.role === 'student' && st.handGrant;
      b.style.display = 'flex';
      b.innerHTML = `
        <span class="sz-dot" style="background:${U.esc(st.userColor)}"></span>
        <strong>${U.esc(role)} · ${U.esc(st.sessionCode || '')}</strong>
        ${deniedAll ? '<span class="sz-pill red">лише перегляд</span>' : ''}
        ${granted ? '<span class="sz-pill gold">✋ вчитель дозволив діяти</span>' : ''}
        ${st.role === 'student' ? '<button class="sz-btn small ghost" id="sz-banner-hand" title="Підняти руку">✋</button>' : ''}
        ${st.role === 'teacher' && hands.length ? hands.map((x, i) => `<button class="sz-btn small gold" data-h="${i}">✋ ${U.esc(x.name)}</button>`).join('') : ''}
        <span class="sz-spacer"></span>
        <button class="sz-btn small ghost" id="sz-banner-open" title="Панель">⚙</button>`;
      const hb = b.querySelector('#sz-banner-hand');
      if (hb) hb.addEventListener('click', () => SZ.Collab.studentHand());
      b.querySelectorAll('[data-h]').forEach(btn => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const hh = this.handQueue[+btn.dataset.h];
        if (hh) this.openHandDialog(hh);
      }));
      const ob = b.querySelector('#sz-banner-open');
      if (ob) ob.addEventListener('click', () => this.openDialog());
    },
    syncBanner() { this._renderBanner(); },

    /* ---------- Лог ---------- */
    appendLog(entry) {
      this.logEntries.push(entry);
      if (this.logEntries.length > 200) this.logEntries.shift();
      const box = document.getElementById('sz-tp-log');
      if (box) this._renderLog(box);
    },
    _renderLog(box) {
      box.innerHTML = this.logEntries.slice(-30).map(e =>
        `<div class="sz-log-row"><span class="dim">${U.fmtTime(e.ts)}</span> ${U.esc(e.text)}</div>`).join('')
        || '<p class="dim">Поки порожньо.</p>';
    },

    /* ---------- Снапшоты ---------- */
    showSnapshots(list) {
      const M = SZ.Modals;
      if (!list || !list.length) return U.toast('Збережених версій поки немає', 'info');
      const h = document.getElementById('sz-modals');
      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal" role="dialog" aria-modal="true" aria-label="Відновити версію">
          <h3>🕘 Відновити версію</h3>
          <div class="sz-log">
            ${list.map(s => `<div class="sz-log-row">
              <span>${U.esc(s.label || '')}</span> <span class="dim">${U.fmtDateTime(s.ts)}</span>
              <span class="sz-spacer"></span>
              <button class="sz-btn small danger" data-restore="${U.esc(s.id)}">Відновити</button>
            </div>`).join('')}
          </div>
          <div class="sz-modal-actions"><button class="sz-btn primary" data-act="close">Закрити</button></div>
        </div>`;
      h.querySelector('.sz-modal-back').addEventListener('click', () => M._close());
      h.querySelector('[data-act="close"]').addEventListener('click', () => M._close());
      h.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', () => {
        SZ.Collab.teacherRestoreSnapshot(b.dataset.restore);
        M._close();
      }));
    },

    syncAll() {
      this._renderBanner();
      SZ.Topbar && SZ.Topbar.sync();
    }
  };

  // объявлен раньше Collab в HTML? подключаем сами:
  SZ.Collab && (SZ.Collab.UI = CollabUI);
})(window.SZ = window.SZ || {});
