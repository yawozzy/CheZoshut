/* ЦеЗошит — хранилище (shared/ui/storage.js)
 * localStorage: документ + настройки. Экспорт/импорт JSON.
 */
(function (SZ) {
  'use strict';
  const U = SZ.U;
  const KEY = 'sovezoshit:doc';
  const KEY_SET = 'sovezoshit:settings';

  const Storage = {
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) { console.warn('load failed', e); }
      return null;
    },
    autosave: U.debounce(function () {
      try {
        const json = SZ.App.doc.toJSON();
        localStorage.setItem(KEY, JSON.stringify(json));
      } catch (e) {
        // квота — пытаемся без картинок
        console.warn('autosave quota, strip images', e);
        try {
          const json = SZ.App.doc.toJSON();
          let n = 0;
          json.pages.forEach(p => p.objects.forEach(o => { if (o.type === 'image') { o.src = ''; n++; } }));
          localStorage.setItem(KEY, JSON.stringify(json));
          if (n) U.toast('Сховище заповнене — частина картинок не збережена', 'warn');
        } catch (e2) { U.toast('Не вдалося зберегти (сховище переповнено)', 'error'); }
      }
    }, 800),
    saveNow() { this.autosave(); U.toast('Збережено ✓', 'ok'); },
    clear() { localStorage.removeItem(KEY); },
    settings: {
      get() { try { return JSON.parse(localStorage.getItem(KEY_SET) || '{}'); } catch (e) { return {}; } },
      set(k, v) { const s = this.get(); s[k] = v; localStorage.setItem(KEY_SET, JSON.stringify(s)); }
    },

    exportFile() {
      const json = SZ.App.doc.toJSON();
      const blob = new Blob([JSON.stringify(json)], { type: 'application/json' });
      const name = (SZ.App.doc.title || 'bloknot').replace(/[^\wа-яА-ЯёЁ -]/g, '') + '.sznote.json';
      U.download(name, blob);
    },
    importFile(file, cb) {
      const r = new FileReader();
      r.onload = () => {
        try {
          const data = JSON.parse(r.result);
          if (!data || !Array.isArray(data.pages) || !data.pages.length) throw new Error('bad');
          if (SZ.App.state.online) return U.toast('Спочатку вийдіть зі спільної сесії', 'warn');
          SZ.App.doc = new SZ.Doc(data);
          SZ.App.history.clear();
          SZ.App.doc.active = 0;
          SZ.App._maxTouched = 0;
          SZ.App._fitZoom();
          SZ.App.syncPagesUI();
          SZ.App.requestRender();
          Storage.autosave();
          U.toast('Зошит імпортовано ✓', 'ok');
          cb && cb(true);
        } catch (e) { U.toast('Файл пошкоджений або не є зошитом', 'error'); cb && cb(false); }
      };
      r.readAsText(file);
    },

    /* экспорт страницы как PNG */
    exportPagePNG(pageIndex) {
      if (!SZ.App.allowed('export')) return U.toast(SZ.App.permDeniedMsg('export'), 'warn');
      const idx = pageIndex == null ? SZ.App.doc.active : pageIndex;
      const page = SZ.App.doc.pages[idx];
      if (!page) return;
      const c = document.createElement('canvas');
      c.width = SZ.Doc.PAGE_W; c.height = SZ.Doc.PAGE_H;
      const ctx = c.getContext('2d');
      SZ.Render.ImgCache.preload(page.objects, () => {
        SZ.Render.drawPage(ctx, page, {});
        c.toBlob((b) => U.download(`sovezoshit-page-${idx + 1}.png`, b), 'image/png');
      });
    },

    /* печать/PDF всех страниц */
    printDoc() {
      if (!SZ.App.allowed('export')) return U.toast(SZ.App.permDeniedMsg('export'), 'warn');
      const pages = SZ.App.doc.pages;
      SZ.Render.ImgCache.preload([].concat(...pages.map(p => p.objects)), () => {
        const parts = [];
        let done = 0;
        pages.forEach((p, i) => {
          const c = document.createElement('canvas');
          c.width = SZ.Doc.PAGE_W; c.height = SZ.Doc.PAGE_H;
          SZ.Render.drawPage(c.getContext('2d'), p, {});
          parts.push(c.toDataURL('image/jpeg', 0.88));
        });
        const html = `<!doctype html><html><head><title>${U.esc(SZ.App.doc.title)}</title>
          <style>@page{size:A4;margin:0}body{margin:0}img{display:block;width:100%;page-break-after:always}</style></head>
          <body>${parts.map(s => `<img src="${s}">`).join('')}</body></html>`;
        const w = window.open('', '_blank');
        if (!w) return U.toast('Дозвольте спливаючі вікна для друку', 'warn');
        w.document.write(html);
        w.document.close();
        setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 400);
      });
    }
  };

  SZ.Storage = Storage;
})(window.SZ = window.SZ || {});
