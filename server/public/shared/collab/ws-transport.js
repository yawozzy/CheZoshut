/* ЦеЗошит — серверный WebSocket-транспорт (shared/collab/ws-transport.js)
 * Клиент подключается к текущему origin: ws(s)://host/?role=…&join=…&name=…&uid=…
 * Тот же код работает и для локальной версии, если сервер доступен.
 */
(function (SZ) {
  'use strict';
  const U = SZ.U;

  function makeWsTransport(opts) {
    const st = SZ.App.state;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = (opts && opts.serverUrl) || '';
    const url = new URL(proto + '//' + (base ? base.replace(/^wss?:\/\//, '') : location.host));
    url.searchParams.set('uid', st.userId);
    if (opts.role) url.searchParams.set('role', opts.role);
    if (opts.code) url.searchParams.set('join', opts.code);
    if (opts.name) url.searchParams.set('name', st.userName || '');
    if (sessionStorage.getItem('sz:lastcode')) url.searchParams.set('restore', '1');

    let ws;
    try {
      ws = new WebSocket(url.toString());
    } catch (e) {
      const dead = { onmessage: null, onstatus: null, send() {}, close() {} };
      setTimeout(() => dead.onstatus && dead.onstatus('error', e.message), 0);
      return dead;
    }

    const tr = {
      onmessage: null,
      onstatus: null,
      ws,
      send(m) {
        if (ws.readyState === 1) ws.send(JSON.stringify(m));
      },
      close() { try { ws.close(); } catch (_) {} }
    };

    ws.onopen = () => tr.onstatus && tr.onstatus('open');
    ws.onclose = () => tr.onstatus && tr.onstatus('closed');
    ws.onerror = () => tr.onstatus && tr.onstatus('error');
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch (_) { return; }
      // сервер шлёт курсоры с цветом/именем — пробрасываем
      tr.onmessage && tr.onmessage(m);
    };
    return tr;
  }

  SZ.WsTransport = makeWsTransport;
})(window.SZ = window.SZ || {});
