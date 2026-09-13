/* ЦеЗошит — вставка объектов (shared/tools/insert.js)
 * Все вставки идут на активную страницу (центр экрана).
 */
(function (SZ) {
  'use strict';
  const U = SZ.U;

  const Insert = {
    image(src, w, h, at) {
      const st = SZ.App.state;
      const maxW = 560;
      let ow = w || 400, oh = h || 300;
      if (ow > maxW) { oh = oh * maxW / ow; ow = maxW; }
      const p = at || SZ.App.viewCenter();
      const o = {
        type: 'image', id: U.uid('o'), x: p.x - ow / 2, y: p.y - oh / 2, w: ow, h: oh, src,
        authorId: st.userId, authorName: st.userName, authorColor: st.userColor
      };
      SZ.Render.ImgCache.load(src);
      SZ.App.commitAddObj(o);
      return o;
    },

    /* Сжатие больших картинок: canvas-ресайз + JPEG — скриншоты не рвут соединение с сервером */
    compressDataUrl(src, maxBytes) {
      return new Promise((res) => {
        if (src.length <= maxBytes) return res(src);
        const img = new Image();
        img.onload = () => {
          const maxDim = 1600;
          const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
          let c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k));
          c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          let out = c.toDataURL('image/jpeg', 0.85);
          let q = 0.85;
          while (out.length > maxBytes && q > 0.35) {
            q -= 0.15;
            out = c.toDataURL('image/jpeg', q);
          }
          if (out.length > maxBytes && (c.width > 800 || c.height > 800)) {
            const c2 = document.createElement('canvas');
            c2.width = Math.round(c.width * 0.7); c2.height = Math.round(c.height * 0.7);
            c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height);
            out = c2.toDataURL('image/jpeg', 0.75);
          }
          res(out);
        };
        img.onerror = () => res(src);
        img.src = src;
      });
    },

    fileImage(file) {
      return new Promise((res, rej) => {
        if (!file || !/^image\//.test(file.type)) return rej(new Error('Це не зображення'));
        if (file.size > 12 * 1024 * 1024) return rej(new Error('Файл більший за 12 МБ'));
        const r = new FileReader();
        r.onload = () => {
          const img = new Image();
          img.onload = async () => {
            // скриншоты/фото сжимаем до безопасного для сервера размера
            const compressed = await Insert.compressDataUrl(r.result, 1.6 * 1024 * 1024);
            const o = Insert.image(compressed, img.naturalWidth, img.naturalHeight);
            // включаем «Выделить» и только потом выделяем (setTool очищает selection)
            SZ.App.setTool('select');
            SZ.App.state.selection.clear();
            SZ.App.state.selection.add(o.id);
            res(o);
          };
          img.onerror = rej;
          img.src = r.result;
        };
        r.onerror = rej;
        r.readAsDataURL(file);
      });
    },

    sticker(text, color) {
      const st = SZ.App.state;
      const p = SZ.App.viewCenter();
      const o = {
        type: 'sticker', id: U.uid('o'), x: p.x - 110, y: p.y - 90, w: 220, h: 180,
        text: text || 'Нотатка', color: color || 'yellow',
        authorId: st.userId, authorName: st.userName, authorColor: st.userColor
      };
      SZ.App.commitAddObj(o);
      SZ.App.startStickerEdit(o);
      return o;
    },

    table(rows, cols) {
      const st = SZ.App.state;
      const p = SZ.App.viewCenter();
      rows = rows || 3; cols = cols || 3;
      const o = {
        type: 'table', id: U.uid('o'), x: p.x - 180, y: p.y - 66, w: 360,
        rows, cols, cells: Array.from({ length: rows * cols }, () => ({ text: '' })),
        color: '#5f7a95', headerColor: '#dbe9ff',
        authorId: st.userId, authorName: st.userName, authorColor: st.userColor
      };
      SZ.App.commitAddObj(o);
      SZ.App.startTableEdit(o);
      return o;
    },

    qr(data, label, at) {
      const st = SZ.App.state;
      const size = 190;
      const p = at || SZ.App.viewCenter();
      const o = {
        type: 'qr', id: U.uid('o'), x: p.x - size / 2, y: p.y - size / 2, size,
        data, label: label || '',
        authorId: st.userId, authorName: st.userName, authorColor: st.userColor
      };
      SZ.App.commitAddObj(o);
      return o;
    },

    timer(durationMin) {
      const st = SZ.App.state;
      const p = SZ.App.viewCenter();
      const o = {
        type: 'timer', id: U.uid('o'), x: p.x - 80, y: p.y - 80, size: 160,
        duration: (durationMin || 5) * 60, running: false, startedAt: null, fill: '#ffffff',
        authorId: st.userId, authorName: st.userName, authorColor: st.userColor
      };
      SZ.App.commitAddObj(o);
      return o;
    }
  };

  SZ.Insert = Insert;
})(window.SZ = window.SZ || {});
