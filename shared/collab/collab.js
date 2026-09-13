/* ЦеЗошит — коллаборация: транспорт-независимая логика (shared/collab/collab.js)
 * Отвечает за: подключение по коду, участники, права (панель учителя), курсоры,
 * историю подключений, "рука поднята", презентер, снапшоты.
 * Транспорт задаётся снаружи: SZ.Collab.connect(transportFactory)
 */
(function (SZ) {
  'use strict';
  const U = SZ.U;

  const PERMISSION_TOOLS = [
    ['obj:path', 'Малювання (перо)'],
    ['obj:shape', 'Фігури'],
    ['obj:text', 'Текст'],
    ['obj:image', 'Зображення'],
    ['obj:sticker', 'Стікери'],
    ['obj:table', 'Таблиці'],
    ['delete', 'Видалення об’єктів'],
    ['pages', 'Додавання/видалення сторінок'],
    ['export', 'Експорт і завантаження']
  ];

  const Collab = {
    UI: null, // подключается из collab-ui.js
    transportFactory: null,

    setTransportFactory(fn) { this.transportFactory = fn; },

    joinUrl() {
      const st = SZ.App.state;
      const base = location.href.split('#')[0].replace(/\?join=[^&]*/g, '');
      if (!st.sessionCode) return base;
      return base + (base.includes('?') ? '&' : '?') + 'join=' + encodeURIComponent(st.sessionCode);
    },

    /* ---------- Подключение ---------- */
    host(name) {
      const st = SZ.App.state;
      st.role = 'teacher';
      this._setName(name, true);
      this._connect({ role: 'teacher', name: st.userName });
    },
    join(code, name) {
      code = String(code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{4,8}$/.test(code)) return U.toast('Код має бути з 4–8 латинських літер/цифр', 'error');
      const st = SZ.App.state;
      st.role = 'student';
      this._setName(name, true);
      this._connect({ role: 'student', code, name: st.userName });
    },
    _setName(name, save) {
      const st = SZ.App.state;
      if (name && name.trim()) {
        st.userName = name.trim().slice(0, 40);
        if (save) localStorage.setItem('sz:name', st.userName);
      }
      if (!st.userName) {
        st.userName = (st.role === 'teacher' ? 'Вчитель' : 'Ученик') + ' ' + Math.floor(Math.random() * 90 + 10);
        localStorage.setItem('sz:name', st.userName);
      }
    },

    _connect(hello) {
      if (!this.transportFactory) {
        return U.toast('Спільна робота недоступна в цьому режимі. Використовуйте серверну версію.', 'warn');
      }
      const st = SZ.App.state;
      // если уже онлайн — переподключаемся
      if (st.online) { SZ.App.setTransport(null); st.online = false; }
      let tr;
      try {
        tr = this.transportFactory();
      } catch (e) {
        return U.toast('Не вдалося відкрити з’єднання: ' + e.message, 'error');
      }
      SZ.App.setTransport(tr);

      tr.onstatus = (s, info) => this._onStatus(s, info);
      tr.onmessage = (m) => this._onMessage(m);

      st.joining = true;
      // сохраняем для восстановления сессии
      if (hello.code) { sessionStorage.setItem('sz:lastcode', hello.code); sessionStorage.setItem('sz:lastrole', 'student'); }
      else { sessionStorage.setItem('sz:lastrole', 'teacher'); if (st.sessionCode) sessionStorage.setItem('sz:lastcode', st.sessionCode); }
      st._pendingHello = hello;

      tr.send({ t: 'hello', ...hello, userId: st.userId });
    },

    disconnect() {
      const st = SZ.App.state;
      if (SZ.App.transport) { try { SZ.App.transport.send({ t: 'bye' }); } catch (_) {} }
      SZ.App.setTransport(null);
      st.online = false;
      st.role = 'solo';
      st.participants = [];
      st.permissions = null;
      st.presenterId = null;
      SZ.App.peers.clear();
      SZ.App.state.selection.clear();
      if (SZ.Poll) SZ.Poll.onPollState(null);
      sessionStorage.removeItem('sz:lastcode');
      sessionStorage.removeItem('sz:lastrole');
      this.UI && this.UI.syncAll && this.UI.syncAll();
      SZ.Topbar && SZ.Topbar.sync();
      U.toast('Ви покинули сесію', 'info');
      SZ.App.requestRender();
    },

    /* ---------- Приём сообщений ---------- */
    _onMessage(m) {
      const st = SZ.App.state;
      switch (m.t) {
        case 'welcome': {
          st.online = true;
          st.joining = false;
          st.sessionCode = m.code;
          if (m.role) st.role = m.role;
          if (m.color) st.userColor = m.color;
          // заменить документ на серверный (единое состояние)
          if (m.doc) {
            SZ.App.doc = new SZ.Doc(m.doc);
            SZ.App.doc.active = 0;
            SZ.App.history.clear();
            SZ.App.syncPagesUI();
          }
          if (m.permissions) SZ.App.setPermissions(m.permissions);
          st.presenterId = m.presenterId || null;
          // активный опрос — если перезашли посреди урока
          if (m.poll && SZ.Poll) SZ.Poll.onPollState(m.poll);
          this.UI && this.UI.toastConnected && this.UI.toastConnected();
          this.UI && this.UI.syncAll && this.UI.syncAll();
          SZ.Topbar && SZ.Topbar.sync();
          SZ.Toolbar && SZ.Toolbar.sync();
          SZ.App.requestRender();
          break;
        }
        case 'participants': {
          st.participants = m.list || [];
          this.UI && this.UI.syncAll && this.UI.syncAll();
          SZ.Topbar && SZ.Topbar.sync();
          break;
        }
        case 'op': {
          if (m.userId === st.userId) break; // своё уже применено
          SZ.App.applyRemote(m.op);
          break;
        }
        case 'live': {
          if (m.userId === st.userId) break;
          SZ.App.setLivePeer(m.userId, m.obj);
          break;
        }
        case 'liveEnd': {
          SZ.App.setLivePeer(m.userId, null);
          break;
        }
        case 'liveText': {
          if (m.userId === st.userId) break;
          // другой участник печатает — показываем текст сразу
          const pg = m.pageId ? SZ.App.doc.pageById(m.pageId) : SZ.App.doc.pages[SZ.App.doc.active];
          const o = pg && pg.objects.find(x => x.id === m.id);
          if (o) {
            o.text = m.text;
            o._liveTyping = { color: m.color || '#888', name: m.name };
            SZ.App.requestRender();
            clearTimeout(o._liveTypingTimer);
            o._liveTypingTimer = setTimeout(() => { delete o._liveTyping; SZ.App.requestRender(); }, 2500);
          }
          break;
        }
        case 'cursor': {
          if (m.userId === st.userId) break;
          SZ.App.peers.set(m.userId, { x: m.x, y: m.y, color: m.color, name: m.name });
          SZ.App.renderOverlay();
          break;
        }
        case 'cursorOff': {
          SZ.App.peers.delete(m.userId);
          SZ.App.renderOverlay();
          break;
        }
        case 'permissions': {
          SZ.App.setPermissions(m.permissions);
          U.toast(m.notice || 'Права оновлено вчителем', 'info');
          break;
        }
        case 'presenter': {
          st.presenterId = m.presenterId;
          const who = m.presenterId === st.userId ? 'вы' : (m.name || 'ученик');
          U.toast(m.presenterId ? `Ведучий: ${who}` : 'Ведучого знято', 'info');
          SZ.Toolbar && SZ.Toolbar.sync();
          SZ.App.requestRender();
          this.UI && this.UI.syncAll && this.UI.syncAll();
          break;
        }
        case 'kicked': {
          U.toast(m.msg || 'Вчитель відключив вас від сесії', 'warn');
          this.disconnect();
          break;
        }
        case 'hand': {
          this.UI && this.UI.showHand && this.UI.showHand(m);
          break;
        }
        case 'handGrant': {
          // мне временно разрешили действия после поднятой руки
          st.handGrant = { tools: m.tools || {}, until: m.until };
          const names = [];
          if (m.tools) for (const [k, v] of Object.entries(m.tools)) if (v) names.push(k.replace('obj:', ''));
          U.toast(`✋ Вчитель дозволив вам діяти${m.expiresMin ? ` (${m.expiresMin} хв)` : ''}`, 'ok');
          this.UI && this.UI.syncAll && this.UI.syncAll();
          SZ.Toolbar && SZ.Toolbar.sync();
          break;
        }
        case 'handRevoke': {
          st.handGrant = null;
          U.toast('Дозвіл від учителя знято', 'info');
          this.UI && this.UI.syncAll && this.UI.syncAll();
          SZ.Toolbar && SZ.Toolbar.sync();
          break;
        }
        case 'log': {
          this.UI && this.UI.appendLog && this.UI.appendLog(m.entry);
          break;
        }
        case 'poll': {
          // состояние опроса: null = закрыт
          if (SZ.Poll) SZ.Poll.onPollState(m.poll, m.notice);
          break;
        }
        case 'snapshotList': {
          this.UI && this.UI.showSnapshots && this.UI.showSnapshots(m.list);
          break;
        }
        case 'snapshot': {
          if (m.doc) {
            SZ.App.doc = new SZ.Doc(m.doc);
            SZ.App.history.clear();
            SZ.App.syncPagesUI();
            SZ.App.requestRender();
            U.toast('Версію сторінки відновлено', 'ok');
          }
          break;
        }
        case 'error': {
          U.toast(m.msg || 'Помилка сесії', 'error');
          if (m.fatal) { SZ.App.setTransport(null); st.online = false; st.joining = false; }
          break;
        }
      }
    },

    _onStatus(s, info) {
      const st = SZ.App.state;
      if (s === 'open') {
        // ждём welcome
      } else if (s === 'closed' || s === 'error') {
        if (st.joining) {
          st.joining = false;
          U.toast('Не вдалося підключитися. Перевірте код та адресу сервера.', 'error');
          SZ.App.setTransport(null);
        } else if (st.online) {
          st.online = false;
          U.toast('З’єднання втрачено. Перепідключення…', 'warn');
          this._reconnect();
        }
        this.UI && this.UI.syncAll && this.UI.syncAll();
        SZ.Topbar && SZ.Topbar.sync();
      }
    },

    _reconnectAttempts: 0,
    _reconnect() {
      const st = SZ.App.state;
      const code = sessionStorage.getItem('sz:lastcode');
      const role = sessionStorage.getItem('sz:lastrole');
      if (!role) return;
      if (this._reconnectAttempts >= 10) {
        U.toast('Не вдалося відновити з’єднання. Код сесії збережено — підключіться знову через панель 👥', 'error');
        return;
      }
      this._reconnectAttempts++;
      setTimeout(() => {
        if (st.online) return;
        const hello = role === 'teacher' ? { role: 'teacher', name: st.userName } : { role: 'student', code, name: st.userName };
        this._connect(hello);
      }, Math.min(1000 * this._reconnectAttempts, 5000));
    },

    /* ---------- Вчитель: управление ---------- */
    teacherToggleGlobal(editing) {
      this._permOp({ type: 'setGlobal', value: !!editing });
    },
    teacherToggleTool(tool, value) {
      this._permOp({ type: 'setTool', tool, value: !!value });
    },
    teacherKick(userId) {
      if (SZ.App.transport) SZ.App.transport.send({ t: 'kick', userId });
    },
    teacherPresenter(userId) {
      if (SZ.App.transport) SZ.App.transport.send({ t: 'setPresenter', userId });
    },
    teacherSaveSnapshot() {
      if (SZ.App.transport) SZ.App.transport.send({ t: 'snapshotSave' });
    },
    teacherListSnapshots() {
      if (SZ.App.transport) SZ.App.transport.send({ t: 'snapshotList' });
    },
    teacherRestoreSnapshot(id) {
      if (SZ.App.transport) SZ.App.transport.send({ t: 'snapshotRestore', id });
    },
    studentHand() {
      if (SZ.App.transport) SZ.App.transport.send({ t: 'hand' });
      U.toast('✋ Ви підняли руку — вчитель це побачить', 'ok');
    },
    /* Вчитель отвечает на руку: разрешает ученику выбранные действия на время */
    grantHand(userId, tools, globalEdit) {
      if (SZ.App.transport) SZ.App.transport.send({ t: 'handGrant', userId, tools, globalEdit });
    },
    revokeHand(userId) {
      if (SZ.App.transport) SZ.App.transport.send({ t: 'handRevoke', userId });
    },
    _permOp(patch) {
      if (SZ.App.transport) SZ.App.transport.send({ t: 'perms', patch });
    }
  };

  SZ.Collab = Collab;
  SZ.Collab.PERMISSION_TOOLS = PERMISSION_TOOLS;
})(window.SZ = window.SZ || {});
