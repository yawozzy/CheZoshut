/* ЦеЗошит — опросы класса (shared/collab/poll.js)
 * Учитель создаёт тест-опрос: вопрос + варианты + правильный ответ.
 * Ученики отвечают один раз; когда все ответили (или учитель завершил,
 * или вышел таймер) — всем показывается правильный ответ и кто что выбрал.
 * Работает только в серверной версии: состояние держит сервер.
 */
(function (SZ) {
  'use strict';
  const U = SZ.U;

  const Poll = {
    state: null, // последний pollState от сервера
    _timer: null, // клиентский тикер обратного отсчёта

    /* ---------- УЧИТЕЛЬ: создание опроса ---------- */
    openCreate() {
      const st = SZ.App.state;
      if (!st.online) return U.toast('Опитування працюють у серверній версії — створіть сесію 👥', 'warn');
      if (st.role !== 'teacher' && st.presenterId !== st.userId) {
        return U.toast('Створювати опитування може лише вчитель', 'warn');
      }
      const h = document.getElementById('sz-modals');
      const M = SZ.Modals;
      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal" role="dialog" aria-modal="true" aria-label="Створити опитування">
          <h3>📊 Тест-опитування для класу</h3>
          <label class="sz-field"><span>Питання</span>
            <input class="sz-input" id="sz-poll-q" maxlength="500" placeholder="Напр. Столиця Франції?"></label>
          <div id="sz-poll-opts" role="group" aria-label="Варіанти відповіді"></div>
          <div class="sz-tp-row">
            <button class="sz-btn ghost small" id="sz-poll-add" type="button">+ Варіант</button>
          </div>
          <label class="sz-switch-row small">
            <span>Кілька правильних відповідей</span>
            <input type="checkbox" id="sz-poll-multi">
            <span class="sz-switch" aria-hidden="true"></span>
          </label>
          <label class="sz-field"><span>Час на відповідь (0 — без обмеження)</span>
            <select class="sz-input" id="sz-poll-time">
              <option value="0">без обмеження</option>
              <option value="15">15 сек</option>
              <option value="30">30 сек</option>
              <option value="60">1 хв</option>
              <option value="120">2 хв</option>
            </select></label>
          <p class="sz-hint dim">✓ — позначте правильний(і) варіант(и). Учні побачать це лише після завершення.</p>
          <div class="sz-modal-actions">
            <button class="sz-btn ghost" id="sz-poll-cancel" type="button">Скасувати</button>
            <button class="sz-btn primary" id="sz-poll-go" type="button">▶ Запустити опитування</button>
          </div>
        </div>`;
      const close = () => M._close();
      h.querySelector('.sz-modal-back').addEventListener('click', close);
      h.querySelector('#sz-poll-cancel').addEventListener('click', close);

      const optsBox = h.querySelector('#sz-poll-opts');
      const addOpt = (text) => {
        const row = document.createElement('div');
        row.className = 'sz-poll-opt';
        row.innerHTML = `
          <input type="checkbox" class="sz-poll-correct" aria-label="Правильна відповідь">
          <input class="sz-input" maxlength="200" placeholder="Варіант відповіді" value="${U.esc(text || '')}">
          <button class="sz-btn small ghost" type="button" title="Прибрати варіант" aria-label="Прибрати варіант">✖</button>`;
        row.querySelector('button').addEventListener('click', () => {
          if (optsBox.children.length > 2) row.remove();
          else U.toast('Мінімум 2 варіанти', 'warn');
        });
        optsBox.appendChild(row);
      };
      addOpt(); addOpt();
      h.querySelector('#sz-poll-add').addEventListener('click', () => {
        if (optsBox.children.length >= 6) return U.toast('Максимум 6 варіантів', 'warn');
        addOpt();
        const last = optsBox.lastElementChild.querySelector('.sz-input');
        last && last.focus();
      });

      h.querySelector('#sz-poll-go').addEventListener('click', () => {
        const question = h.querySelector('#sz-poll-q').value.trim();
        if (!question) return U.toast('Введіть питання', 'warn');
        const rows = [...optsBox.querySelectorAll('.sz-poll-opt')];
        const options = rows.map(r => r.querySelector('.sz-input').value.trim());
        const correct = rows.map((r, i) => r.querySelector('.sz-poll-correct').checked ? i : -1).filter(i => i >= 0);
        if (options.some(o => !o)) return U.toast('Заповніть усі варіанти', 'warn');
        if (options.length < 2) return U.toast('Мінімум 2 варіанти', 'warn');
        if (!correct.length) return U.toast('Позначте правильну відповідь ✓', 'warn');
        const multiple = h.querySelector('#sz-poll-multi').checked;
        if (multiple && !correct.length) return U.toast('Позначте правильні відповіді ✓', 'warn');
        if (!multiple && correct.length > 1) return U.toast('Правильна відповідь лише одна (зніміть галочку «кілька»)', 'warn');
        SZ.App.transport && SZ.App.transport.send({
          t: 'pollStart',
          poll: { question, options, correct, multiple, durationSec: +h.querySelector('#sz-poll-time').value }
        });
        close();
      });
      const qEl = h.querySelector('#sz-poll-q');
      setTimeout(() => qEl.focus(), 60);
    },

    /* ---------- ПРИЁМ СОСТОЯНИЯ ОПРОСА ---------- */
    onPollState(poll, notice) {
      this.state = poll;
      if (notice) U.toast(notice, poll ? 'info' : 'info');
      if (poll) this._showDialog(poll);
      else { this._stopTimer(); this._closeDialog(); }
    },

    /* ---------- ОБЩИЙ ДИАЛОГ: идёт опрос / результаты ---------- */
    _showDialog(poll) {
      const st = SZ.App.state;
      const h = document.getElementById('sz-modals');
      const M = SZ.Modals;
      const isTeacher = st.role === 'teacher' || st.presenterId === st.userId;
      const answered = poll.answeredCount || 0;
      const expected = poll.expectedCount || 0;
      const remainMs = poll.durationSec ? Math.max(0, poll.startedAt + poll.durationSec * 1000 - Date.now()) : null;

      let body;
      if (poll.revealed) {
        // ===== РЕЗУЛЬТАТЫ =====
        const answers = poll.answers || [];
        const correct = poll.correct || [];
        const byOpt = poll.options.map((_, i) => answers.filter(a => a.choice.includes(i)));
        const maxCount = Math.max(1, ...byOpt.map(a => a.length));
        body = `
          <div class="sz-poll-results">
            ${poll.options.map((opt, i) => {
              const isCorrect = correct.includes(i);
              const choosers = byOpt[i];
              const pct = expected ? Math.round(choosers.length / expected * 100) : 0;
              return `
              <div class="sz-poll-res-row ${isCorrect ? 'correct' : ''}">
                <div class="sz-poll-res-label">
                  ${isCorrect ? '<span class="sz-pill ok">✓ правильно</span>' : ''}
                  <span>${U.esc(opt)}</span>
                </div>
                <div class="sz-poll-bar-track" role="img" aria-label="${U.esc(opt)}: ${choosers.length} відповідей (${pct}%)">
                  <div class="sz-poll-bar ${isCorrect ? 'ok' : ''}" style="width:${Math.max(4, pct)}%"></div>
                </div>
                <div class="sz-poll-res-names">
                  ${choosers.map(a => `<span class="sz-poll-who" title="${U.esc(a.name)}"><span class="sz-dot" style="background:${U.esc(a.color)}"></span>${U.esc(a.name)}</span>`).join(' ') || '<span class="dim">—</span>'}
                </div>
              </div>`;
            }).join('')}
          </div>
          <p class="sz-hint dim">Відповідали: ${answered} з ${expected}. ${correct.length ? '' : 'Правильна відповідь не була позначена.'}</p>`;
      } else if (isTeacher) {
        // ===== ИДЁТ ОПРОС (вид учителя): наблюдение =====
        const mine = poll.mine;
        body = `
          <p class="sz-hint">Триває опитування. Відповіли: <b>${answered}</b> з <b>${expected}</b>${remainMs != null ? ` · ⏰ ${this._fmtRemain(remainMs)}` : ''}</p>
          <div class="sz-poll-progress" role="progressbar" aria-valuenow="${answered}" aria-valuemax="${expected}" aria-label="Відповіли ${answered} з ${expected}">
            <div style="width:${expected ? Math.round(answered / expected * 100) : 0}%"></div>
          </div>
          <ul class="sz-poll-waiting">
            ${poll.options.map((o, i) => `<li class="dim">${U.esc(o)}</li>`).join('')}
          </ul>
          <p class="sz-hint dim">Учні зараз відповідають. Результати покажуться автоматично, коли всі відповілять, — або натисніть «Показати результати».</p>`;
      } else {
        // ===== ИДЁТ ОПРОС (вид ученика): форма ответа =====
        const mine = poll.mine;
        if (mine) {
          body = `
            <p class="ok-text">✓ Ви відповіли. Чекаємо інших…</p>
            <p class="sz-hint dim">Відповіли: ${answered} з ${expected}${remainMs != null ? ` · ⏰ ${this._fmtRemain(remainMs)}` : ''}</p>
            <ul class="sz-poll-answered-list">
              ${mine.choice.map(i => `<li>${U.esc(poll.options[i])}</li>`).join('')}
            </ul>`;
        } else {
          body = `
            <div id="sz-poll-choose" role="group" aria-label="Варіанти відповіді">
              ${poll.options.map((o, i) => `
                <label class="sz-poll-choice">
                  <input type="${poll.multiple ? 'checkbox' : 'radio'}" name="szpoll" value="${i}">
                  <span>${U.esc(o)}</span>
                </label>`).join('')}
            </div>
            ${remainMs != null ? `<p class="sz-hint dim" id="sz-poll-countdown">⏰ ${this._fmtRemain(remainMs)}</p>` : ''}`;
        }
      }

      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal ${poll.revealed ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="Опитування">
          <h3>📊 ${poll.revealed ? 'Результати опитування' : 'Опитування'}</h3>
          <p class="sz-poll-question">${U.esc(poll.question)}</p>
          ${body}
          <div class="sz-modal-actions">
            ${isTeacher && !poll.revealed ? '<button class="sz-btn danger" id="sz-poll-close">✖ Закрити без результатів</button>' : ''}
            ${isTeacher && !poll.revealed ? '<button class="sz-btn primary" id="sz-poll-reveal">📊 Показати результати</button>' : ''}
            ${poll.revealed && isTeacher ? '<button class="sz-btn" id="sz-poll-tolist">📋 Вставити результати на сторінку</button>' : ''}
            <button class="sz-btn ${isTeacher ? 'ghost' : 'primary'}" id="sz-poll-ok" ${(!isTeacher && !poll.mine && !poll.revealed) ? 'disabled style="opacity:.35"' : ''}>
              ${poll.revealed ? 'Гаразд' : (isTeacher ? 'Приховати вікно' : 'Гаразд')}
            </button>
          </div>
        </div>`;

      // ученик ещё не ответил — кнопка ответа внутри выбора
      if (!isTeacher && !poll.revealed && !poll.mine) {
        const actions = h.querySelector('.sz-modal-actions');
        const go = document.createElement('button');
        go.className = 'sz-btn primary';
        go.id = 'sz-poll-answer';
        go.textContent = '✓ Відповісти';
        go.disabled = true;
        go.style.opacity = '.35';
        actions.insertBefore(go, h.querySelector('#sz-poll-ok'));
        const inputs = h.querySelectorAll('#sz-poll-choose input');
        inputs.forEach(inp => inp.addEventListener('change', () => {
          go.disabled = ![...inputs].some(i => i.checked);
          go.style.opacity = go.disabled ? '.35' : '1';
        }));
        go.addEventListener('click', () => {
          const choice = [...inputs].filter(i => i.checked).map(i => +i.value);
          if (!choice.length) return;
          SZ.App.transport && SZ.App.transport.send({ t: 'pollAnswer', choice });
          U.toast('✓ Відповідь надіслано', 'ok');
        });
      }

      h.querySelector('#sz-poll-ok').addEventListener('click', () => M._close());
      h.querySelector('.sz-modal-back').addEventListener('click', () => M._close());
      const rev = h.querySelector('#sz-poll-reveal');
      if (rev) rev.addEventListener('click', () => SZ.App.transport && SZ.App.transport.send({ t: 'pollReveal' }));
      const cls = h.querySelector('#sz-poll-close');
      if (cls) cls.addEventListener('click', () => SZ.App.transport && SZ.App.transport.send({ t: 'pollClose' }));
      const tl = h.querySelector('#sz-poll-tolist');
      if (tl) tl.addEventListener('click', () => { this.insertResultsToPage(poll); M._close(); });

      this._restartTimer(poll);
    },

    /* таймер обратного отсчёта в диалоге */
    _restartTimer(poll) {
      this._stopTimer();
      if (!poll || poll.revealed || !poll.durationSec) return;
      const tick = () => {
        const el = document.getElementById('sz-poll-countdown');
        if (!el) { this._stopTimer(); return; }
        const remain = Math.max(0, poll.startedAt + poll.durationSec * 1000 - Date.now());
        el.textContent = '⏰ ' + this._fmtRemain(remain);
      };
      this._timer = setInterval(tick, 500);
    },
    _stopTimer() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },
    _closeDialog() {
      const dlg = document.querySelector('#sz-modals .sz-modal[aria-label="Опитування"]');
      // не закрываем, если открыт другой диалог поверх
      if (dlg) SZ.Modals._close();
    },
    _fmtRemain(ms) {
      const s = Math.ceil(ms / 1000);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    },

    /* вставка итогов опроса на страницу как таблицу (через ops — работает в коллабе) */
    insertResultsToPage(poll) {
      if (!SZ.App.allowed('obj:table')) return U.toast(SZ.App.permDeniedMsg('obj:table'), 'warn');
      const answers = poll.answers || [];
      const correct = poll.correct || [];
      // шапка: Учень | выбранный ответ | ✓/✗
      const rows = [['Учень', 'Відповідь', '✓']];
      for (const a of answers) {
        const picked = a.choice.map(i => poll.options[i]).join(', ');
        const isRight = a.choice.length === correct.length && correct.every(c => a.choice.includes(c));
        rows.push([a.name, picked, isRight ? '✓' : '✗']);
      }
      if (answers.length === 0) rows.push(['—', 'ніхто не відповів', '—']);
      const cols = 3;
      const cells = rows.flat().map(t => ({ text: String(t) }));
      const st = SZ.App.state;
      const p = SZ.App.viewCenter();
      const o = {
        type: 'table', id: U.uid('o'), x: p.x - 260, y: p.y - 40, w: 520,
        rows: rows.length, cols, cells,
        color: '#5f7a95', headerColor: '#dbe9ff',
        authorId: st.userId, authorName: st.userName, authorColor: st.userColor
      };
      SZ.App.commitAddObj(o);
      U.toast('Результати вставлено на сторінку', 'ok');
    }
  };

  /* маршрутизация сообщений: collab.js проксирует сюда */
  Poll.handleMessage = (m) => Poll.onPollState(m.poll, m.notice);

  SZ.Poll = Poll;
})(window.SZ = window.SZ || {});
