/* ЦеЗошит — локальный транспорт-заглушка (local/transport.js)
 * Локальная версия без сервера: коллаборация через WebRTC не входит в MVP-обязательства,
 * поэтому транспорт «недоступен» и UI честно об этом сообщает.
 * (Для PeerJS-режима можно подменить эту фабрику.)
 */
(function (SZ) {
  'use strict';
  SZ.Collab.serverUrl = null;
  SZ.Collab.setTransportFactory(function () {
    throw new Error('OFFLINE');
  });
  // честный индикатор в UI
  document.addEventListener('DOMContentLoaded', () => {
    const origOpen = SZ.Collab.UI && SZ.Collab.UI.openDialog;
  });
})(window.SZ = window.SZ || {});
