/* ЦеЗошит — главное стартовое окно (shared/ui/start.js)
 * Показывается при загрузке: локальный режим / создать сессию / подключиться.
 */
(function (SZ) {
  'use strict';
  const U = SZ.U;

  const Start = {
    init() {
      // авто-вход по ссылке ?join=CODE — окно не показываем
      const join = new URLSearchParams(location.search).get('join');
      if (join) return;
      // сессия уже была (переподключение) — сразу панель коллаба спросит имя
      this.show();
    },

    show() {
      const h = document.getElementById('sz-modals');
      const name = localStorage.getItem('sz:name') || '';
      h.innerHTML = `
        <div class="sz-start-back"></div>
        <div class="sz-start" role="dialog" aria-modal="true" aria-label="Вхід до ЦеЗошит">
          <div class="sz-start-logo">📓</div>
          <h1 class="sz-start-title">ЦеЗошит</h1>
          <p class="sz-start-sub">спільний шкільний зошит для вчителя та класу</p>

          <label class="sz-field sz-start-name">
            <span>Ваше ім’я</span>
            <input class="sz-input" id="sz-start-name" value="${U.esc(name)}" placeholder="Іван Іванович" autocomplete="name">
          </label>

          <button class="sz-btn primary sz-start-btn" id="sz-start-local">
            📓 Почати зошит <small class="sz-start-note">(локально, без класу)</small>
          </button>

          <button class="sz-btn sz-start-btn" id="sz-start-host">
            🎓 Я вчитель — створити сесію <small class="sz-start-note">(отримаєте код і QR для класу)</small>
          </button>

          <div class="sz-start-or">— або —</div>

          <form id="sz-start-join-form" class="sz-start-join">
            <input class="sz-input sz-start-code" id="sz-start-code" placeholder="КОД СЕСІЇ"
                   autocomplete="off" maxlength="8" aria-label="Код сесії">
            <button class="sz-btn" type="submit">✋ Увійти як учень</button>
          </form>
          <p class="sz-start-note dim">Код sessії показує вчитель на дошці — або відскануйте QR</p>
        </div>`;

      const nameInp = h.querySelector('#sz-start-name');
      const saveName = () => {
        const v = nameInp.value.trim().slice(0, 40);
        if (v) {
          SZ.App.state.userName = v;
          localStorage.setItem('sz:name', v);
        }
      };
      nameInp.addEventListener('change', saveName);

      h.querySelector('#sz-start-local').addEventListener('click', () => {
        saveName();
        this.close();
        SZ.App._fitZoom();
      });
      h.querySelector('#sz-start-host').addEventListener('click', () => {
        saveName();
        this.close();
        SZ.Collab.host(SZ.App.state.userName);
      });
      h.querySelector('#sz-start-join-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveName();
        const code = h.querySelector('#sz-start-code').value.trim().toUpperCase();
        if (!code) { U.toast('Введіть код сесії', 'warn'); return; }
        this.close();
        SZ.Collab.join(code, SZ.App.state.userName);
      });
      const codeInp = h.querySelector('#sz-start-code');
      codeInp.style.textTransform = 'uppercase';
      setTimeout(() => nameInp.focus(), 100);
    },

    close() {
      document.getElementById('sz-modals').innerHTML = '';
      if (!localStorage.getItem('sz:seen-welcome')) {
        localStorage.setItem('sz:seen-welcome', '1');
      }
    }
  };

  SZ.Start = Start;
})(window.SZ = window.SZ || {});
