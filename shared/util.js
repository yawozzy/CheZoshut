/* ЦеЗошит — утилиты */
(function (SZ) {
  'use strict';

  const U = {};

  U.uid = (p) => (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  U.debounce = (fn, ms) => {
    let t;
    const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    d.cancel = () => clearTimeout(t);
    return d;
  };

  U.throttle = (fn, ms) => {
    let last = 0, t = null, pend = null;
    return (...a) => {
      const now = Date.now();
      if (now - last >= ms) { last = now; fn(...a); }
      else {
        pend = a;
        if (!t) t = setTimeout(() => { t = null; last = Date.now(); fn(...(pend || a)); }, ms - (now - last));
      }
    };
  };

  U.esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // палитра для участников (vivid, различимые)
  U.PALETTE = ['#e63946', '#e76f51', '#f4a261', '#2a9d8f', '#118ab2', '#457b9d', '#6a4c93', '#9d4edd'];

  U.SESSION_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих символов
  U.genSessionCode = () => {
    let s = '';
    for (let i = 0; i < 6; i++) s += U.SESSION_ALPHABET[Math.floor(Math.random() * U.SESSION_ALPHABET.length)];
    return s;
  };

  U.download = (name, blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  U.fmtTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  U.fmtDateTime = (ts) => new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  // toast-стек: уведомления складываются, максимум 4, старые вытесняются
  U.toast = (msg, kind) => {
    const box = document.getElementById('sz-toasts');
    if (!box) return console.log('[toast]', kind || 'info', msg);
    const t = document.createElement('div');
    t.className = 'sz-toast ' + (kind || 'info');
    t.textContent = msg;
    box.appendChild(t);
    // лимит стека: не более 4 — верхние вытесняются
    while (box.children.length > 4) box.firstElementChild.remove();
    // клик — закрыть
    t.addEventListener('click', () => t.remove());
    // авто-скрытие с плавностью
    const life = kind === 'error' ? 5000 : 2800;
    setTimeout(() => {
      t.style.transition = 'opacity .35s, transform .35s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(6px) scale(.96)';
      setTimeout(() => t.remove(), 380);
    }, life);
  };

  // deep-ish clone для JSON-объектов
  U.clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

  // события
  U.evTarget = (e) => (e.changedTouches ? e.changedTouches[0] : e);
  U.evXY = (e) => {
    const t = U.evTarget(e);
    return { x: t.clientX, y: t.clientY };
  };

  // сглаживание пути (скользящее среднее)
  U.smooth = (pts, k) => {
    if (!pts || pts.length < 3) return pts;
    k = k || 2;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      let sx = 0, sy = 0, n = 0;
      for (let j = Math.max(0, i - k); j <= Math.min(pts.length - 1, i + k); j++) { sx += pts[j].x; sy += pts[j].y; n++; }
      out.push({ x: sx / n, y: sy / n });
    }
    return out;
  };

  // расстояние точка-отрезок
  U.distToSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = U.clamp(t, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

  // урезание dataURL для экономии — нет, возвращаем как есть
  SZ.U = U;
})(window.SZ = window.SZ || {});
