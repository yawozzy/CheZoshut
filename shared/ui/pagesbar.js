/* ЦеЗошит — индикатор страниц (shared/ui/pagesbar.js)
 * Лента бесконечная: скролл сам создаёт страницы. Здесь только индикатор.
 */
(function (SZ) {
  'use strict';
  const U = SZ.U;

  const PagesBar = {
    init() {
      this.el = document.getElementById('sz-pages');
    },
    render() {
      const doc = SZ.App.doc;
      if (!this.el) return;
      this.el.innerHTML = '';
      const cur = doc.active + 1;
      const b = document.createElement('button');
      b.className = 'sz-page active';
      b.textContent = `📄 ${cur} / ${doc.pages.length}`;
      b.setAttribute('aria-label', `Страница ${cur} из ${doc.pages.length}`);
      b.setAttribute('aria-current', 'page');
      b.title = 'Натисніть, щоб обрати сторінку';
      b.addEventListener('click', () => SZ.PagesBar.pickPage());
      this.el.appendChild(b);
    },
    pickPage() {
      const M = SZ.Modals;
      const doc = SZ.App.doc;
      const h = document.getElementById('sz-modals');
      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal small" role="dialog" aria-modal="true" aria-label="Перейти до сторінки">
          <h3>Перейти до сторінки</h3>
          <div class="sz-pagelist">
            ${doc.pages.map((p, i) => `
              <button class="sz-btn ${i === doc.active ? 'primary' : ''}" data-i="${i}">
                📄 ${i + 1} · ${p.objects.length} об’єкт(ів)
              </button>`).join('')}
          </div>
          <div class="sz-modal-actions"><button class="sz-btn ghost" data-act="close">Закрыть</button></div>
        </div>`;
      h.querySelector('.sz-modal-back').addEventListener('click', () => M._close());
      h.querySelector('[data-act="close"]').addEventListener('click', () => M._close());
      h.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => {
        SZ.App.gotoPage(+b.dataset.i);
        M._close();
      }));
    }
  };

  SZ.PagesBar = PagesBar;
})(window.SZ = window.SZ || {});
