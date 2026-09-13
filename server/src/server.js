/* ЦеЗошит — сервер (server/src/server.js)
 * Node.js + ws. Авторитарная модель: сервер хранит документ сессии,
 * применяет ops после проверки прав и бродкастит всем участникам.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const SNAP_DIR = process.env.SNAP_DIR || path.join(__dirname, '..', 'snapshots');
const MAX_MSG = 3 * 1024 * 1024;     // 3 МБ на сообщение — большие скриншоты не рвут соединение
const MAX_IMAGE_DATAURL = 2 * 1024 * 1024; // но картинки в документе ограничены 2 МБ
const RATE_LIMIT_OPS = 40;            // ops/сек от одного участника (скролл ленты не должен спотыкаться)
const RATE_LIMIT_CURSOR = 20;        // cursor/сек
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // автоснапшот каждые 5 минут
const MAX_SNAPSHOTS = 40;

/* ---------- Защита от DDoS / флуда ----------
 * Четыре уровня (не требуют внешних сервисов):
 * 1. HTTP: лимит запросов на IP (окно 10 сек) + мгновенный 429.
 * 2. Глобальный лимит одновременных WS-подключений на IP.
 * 3. Создание сессий: не более N новых сессий на IP за окно
 *    (бот не может плодить тысячи «классов» и жрать память).
 * 4. Лимит ВСЕГО живого: максимум подключений/сессий на сервере —
 *    при исчерпании новые отклоняются, сервер остаётся жив для существующих.
 * Настоящий volumetric DDoS (гигабиты трафика) глушится только на уровне
 * хостера/Cloudflare — это норма для школьного MVP, см. README.
 */
const HTTP_RATE_LIMIT = 120;          // HTTP-запросов на IP за окно
const HTTP_RATE_WINDOW_MS = 10 * 1000;
const HTTP_RATE_CACHE_MS = 60 * 1000; // память о нарушителях: лишний запрос раз в минуту не считается
const WS_MAX_PER_IP = 12;            // одновременных WS-соединений с одного IP (класс за NAT + учитель)
const SESSIONS_CREATE_PER_IP = 6;     // новых сессий на IP за окно
const SESSIONS_CREATE_WINDOW_MS = 10 * 60 * 1000; // 10 минут
const MAX_SESSIONS_TOTAL = 200;      // всего живых сессий на сервере
const MAX_WS_TOTAL = 1000;           // всего одновременных WS на сервере
const WS_IDLE_TIMEOUT_MS = 3 * 60 * 1000; // молчащий WS закрывается через 3 мин
const WS_FAILED_JOIN_LIMIT = 5;      // попыток входа с неверным кодом на IP за час
const WS_FAILED_JOIN_WINDOW_MS = 60 * 60 * 1000;

/* sliding-window rate limit: ip -> [timestamps] */
const httpBuckets = new Map();
/* ip -> счётчик живых WS */
const wsPerIp = new Map();
/* ip -> [ts создания сессий] */
const sessionCreateBuckets = new Map();
/* ip -> [ts неудачных входов] */
const failedJoinBuckets = new Map();
let wsTotal = 0;

function clientIp(req) {
  // за реверс-прокси (nginx) реальный IP в X-Forwarded-For (настройте proxy_set_header)
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/* очистка хвостов у бакетов (чтобы Map не рос вечно) */
function sweepBuckets() {
  const now = Date.now();
  const sweep = (map, win) => {
    for (const [ip, arr] of map) {
      while (arr.length && now - arr[0] > win) arr.shift();
      if (!arr.length) map.delete(ip);
    }
  };
  sweep(httpBuckets, HTTP_RATE_CACHE_MS);
  sweep(sessionCreateBuckets, SESSIONS_CREATE_WINDOW_MS);
  sweep(failedJoinBuckets, WS_FAILED_JOIN_WINDOW_MS);
}
setInterval(sweepBuckets, 60 * 1000).unref();

function rateLimited(map, ip, limit, windowMs) {
  const now = Date.now();
  let arr = map.get(ip);
  if (!arr) { arr = []; map.set(ip, arr); }
  while (arr.length && now - arr[0] > windowMs) arr.shift();
  if (arr.length >= limit) return true;
  arr.push(now);
  return false;
}

/* ---------- Сессии ---------- */
class Session {
  constructor(code) {
    this.code = code;
    this.doc = { v: 1, title: 'Урок', pages: [newPage('ruled')] };
    this.perms = {
      globalEdit: true,
      tools: {}, // id -> bool (false = запрещено)
      blocked: [],
      presenterId: null
    };
    this.handGrants = new Map(); // userId -> {tools, until}
    this.users = new Map();   // userId -> {ws, name, color, role, connected, lastSeen}
    this.log = [];            // журнал подключений/действий модерации
    this.snapshots = [];      // {id, ts, label, doc}
    this.teacherId = null;
    this.opCount = 0;
    this.poll = null;         // активный опрос: {id, question, options[], correct[], startedAt, durationSec, revealed, answers: Map(userId -> {choice, ts})}
    this._pollTimer = null;   // таймер автозавершения по duration
  }

  /* ---------- ОПРОСЫ КЛАССА (poll) ----------
   * Учитель запускает опрос: вопрос + варианты + правильные.
   * Ученики отвечают один раз; ответы скрыты до reveal.
   * Reveal: вручную учителем ИЛИ автоматически, когда ответили все ученики,
   * ИЛИ по таймеру durationSec. После reveal все видят, кто что выбрал.
   */
  pollStateFor(userId, role) {
    const p = this.poll;
    if (!p) return null;
    const expected = [...this.users.values()].filter(u => u.role === 'student').length;
    const answered = p.answers.size;
    const base = {
      id: p.id,
      question: p.question,
      options: p.options,
      multiple: p.multiple || false,
      startedAt: p.startedAt,
      durationSec: p.durationSec,
      revealed: !!p.revealed,
      answeredCount: answered,
      expectedCount: expected
    };
    if (p.revealed) {
      // после reveal — полная картина: кто какой ответ выбрал
      base.correct = p.correct;
      base.answers = [...p.answers.entries()].map(([uid, a]) => {
        const u = this.users.get(uid);
        return { userId: uid, name: u ? u.name : '—', color: u ? u.color : '#888', choice: a.choice, ts: a.ts };
      });
    } else {
      // до reveal ученики не видят чужих ответов
      const mine = p.answers.get(userId);
      base.mine = mine ? { choice: mine.choice } : null;
    }
    return base;
  }

  broadcastPoll(notice) {
    for (const [uid, u] of this.users) {
      if (!u.connected || u.ws.readyState !== 1) continue;
      u.ws.send(JSON.stringify({ t: 'poll', poll: this.pollStateFor(uid, u.role), notice: notice || null }));
    }
  }

  pollReveal(why) {
    const p = this.poll;
    if (!p || p.revealed) return;
    p.revealed = true;
    this._clearPollTimer();
    this.broadcastPoll(why);
    this.logAdd(`📊 Результати опитування показано (${p.answers.size} відповідей)`);
  }

  _clearPollTimer() {
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
  }

  pollStart(q) {
    this.pollClose(true);
    const options = (q.options || []).map(s => String(s || '').slice(0, 200)).filter(s => s.trim()).slice(0, 6);
    this.poll = {
      id: crypto.randomBytes(4).toString('hex'),
      question: String(q.question || '').slice(0, 500),
      options,
      multiple: !!q.multiple,
      correct: Array.isArray(q.correct) ? q.correct.filter(i => Number.isInteger(i) && i >= 0 && i < options.length).slice(0, options.length) : [],
      startedAt: Date.now(),
      durationSec: Math.max(0, Math.min(600, +q.durationSec || 0)),
      revealed: false,
      answers: new Map()
    };
    if (this.poll.durationSec > 0) {
      this._pollTimer = setTimeout(() => this.pollReveal('⏰ Час вийшов — результати показано'), this.poll.durationSec * 1000);
    }
    this.logAdd(`📊 Опитування запущено: «${this.poll.question.slice(0, 60)}» (${options.length} варіантів)`);
    this.broadcastPoll('📊 Опитування почалось — відповідайте!');
  }

  pollAnswer(userId, choice) {
    const p = this.poll;
    if (!p) return { ok: false, why: 'Опитування неактивне' };
    if (p.revealed) return { ok: false, why: 'Опитування вже завершено' };
    const u = this.users.get(userId);
    if (!u) return { ok: false, why: 'Немає такого учасника' };
    if (u.role === 'teacher') return { ok: false, why: 'Учитель не відповідає на опитування' };
    if (!Array.isArray(choice) || !choice.length || choice.length > 6) return { ok: false, why: 'Некоректна відповідь' };
    const valid = choice.every(i => Number.isInteger(i) && i >= 0 && i < p.options.length);
    if (!valid) return { ok: false, why: 'Некоректна відповідь' };
    if (!p.multiple && choice.length > 1) return { ok: false, why: 'Можна вибрати лише один варіант' };
    if (p.answers.has(userId)) return { ok: false, why: 'Ви вже відповіли' };
    p.answers.set(userId, { choice: p.multiple ? [...new Set(choice)] : [choice[0]], ts: Date.now() });
    // авто-reveal, когда ответили все подключённые ученики
    const students = [...this.users.values()].filter(x => x.role === 'student' && x.connected);
    if (students.length > 0 && students.every(x => p.answers.has(x.id))) {
      this.pollReveal('🎉 Усі відповіли — результати показано');
    } else {
      this.broadcastPoll();
    }
    return { ok: true };
  }

  /* завершить без показа ответов (или закрыть после reveal) */
  pollClose(silent) {
    const had = !!this.poll;
    this._clearPollTimer();
    this.poll = null;
    if (had && !silent) {
      this.broadcast({ t: 'poll', poll: null, notice: 'Опитування завершено' });
      this.logAdd('📊 Опитування закрито');
    }
  }


  logAdd(text) {
    const entry = { ts: Date.now(), text };
    this.log.push(entry);
    if (this.log.length > 300) this.log.shift();
    this.broadcast({ t: 'log', entry });
  }

  saveSnapshot(label) {
    const snap = { id: crypto.randomBytes(4).toString('hex'), ts: Date.now(), label: label || '', doc: JSON.parse(JSON.stringify(this.doc)) };
    this.snapshots.push(snap);
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
    persistSnapshots(this.code, this.snapshots);
    return snap;
  }

  broadcast(msg, exceptId) {
    const raw = JSON.stringify(msg);
    for (const [uid, u] of this.users) {
      if (uid === exceptId || !u.connected || u.ws.readyState !== 1) continue;
      u.ws.send(raw);
    }
  }

  sendTo(uid, msg) {
    const u = this.users.get(uid);
    if (u && u.ws && u.ws.readyState === 1) u.ws.send(JSON.stringify(msg));
  }

  participantsList() {
    return [...this.users.entries()].map(([id, u]) => ({
      userId: id, name: u.name, color: u.color, role: u.role, connected: u.connected
    }));
  }

  broadcastParticipants() {
    this.broadcast({ t: 'participants', list: this.participantsList() });
  }

  broadcastPerms(notice) {
    this.broadcast({ t: 'permissions', permissions: this.perms, notice });
  }

    /* ---------- ВАЛИДАЦИЯ ПРАВ (серверная, обязательная) ---------- */
    canDo(user, op) {
      if (user.role === 'teacher') return { ok: true };
      if (this.perms.presenterId === user.id) return { ok: true }; // ведущий может всё
      if (this.perms.blocked.includes(user.id)) return { ok: false, why: 'Ви заблоковані вчителем' };
      // временный grant после поднятой руки
      const g = this.handGrants.get(user.id);
      if (g && g.until && Date.now() > g.until) { this.handGrants.delete(user.id); }
      // инструментальные права
      let tool = null;
      switch (op.t) {
        case 'addObj': tool = 'obj:' + op.obj?.type; break;
        case 'delObj': tool = 'delete'; break;
        case 'addPage': case 'dupPage': case 'delPage': tool = 'pages'; break;
        case 'setBg': case 'updObj': case 'rename': case 'reorder': tool = null; break;
      }
      const gOK = (t) => g && g.tools && g.tools[t] === true;
      if (this.perms.globalEdit === false && !(tool && gOK(tool))) {
        return { ok: false, why: 'Вчитель увімкнув режим «лише перегляд»' };
      }
      if (tool && this.perms.tools[tool] === false && !gOK(tool)) {
        const names = {
          'obj:path': 'малювання', 'obj:shape': 'фігури', 'obj:text': 'текст', 'obj:image': 'зображення',
          'obj:sticker': 'стікери', 'obj:table': 'таблиці', 'obj:qr': 'QR-коди', 'obj:timer': 'таймери',
          'delete': 'видалення об’єктів', 'pages': 'зміна сторінок', 'export': 'експорт'
        };
        return { ok: false, why: `Дія «${names[tool] || tool}» заборонена вчителем` };
      }
      // ученик может править/удалять ТОЛЬКО свои объекты (кроме ведущего)
      if (op.t === 'updObj' || op.t === 'delObj' || op.t === 'reorder') {
        const obj = findObj(this.doc, op.pageId, op.id || op.objId);
        if (obj && obj.authorId && obj.authorId !== user.id) {
          return { ok: false, why: 'Учень може змінювати лише свої об’єкти' };
        }
      }
      if (op.t === 'addObj' && op.obj && op.obj.authorId !== user.id) {
        return { ok: false, why: 'Не можна створювати об’єкти від чужого імені' };
      }
      return { ok: true };
    }

  /* применение op к документу — зеркально клиентскому SZ.Ops.apply */
  applyOp(op) {
    const doc = this.doc;
    switch (op.t) {
      case 'addObj': {
        const pg = doc.pages.find(p => p.id === op.pageId) || doc.pages[0];
        if (!pg || !op.obj || !op.obj.id) return false;
        if (pg.objects.some(o => o.id === op.obj.id)) return true;
        // лимит размера картинки: гигантские dataURL не рвут соединение другим участникам
        if (op.obj.type === 'image' && typeof op.obj.src === 'string' && op.obj.src.length > MAX_IMAGE_DATAURL) {
          return false;
        }
        if (op._index != null) pg.objects.splice(Math.min(op._index, pg.objects.length), 0, op.obj);
        else pg.objects.push(op.obj);
        return true;
      }
      case 'updObj': {
        const o = findObj(doc, op.pageId, op.id);
        if (!o) return false;
        for (const k in op.patch) { if (k === 'id' || k === 'type' || k === 'authorId') continue; o[k] = op.patch[k]; }
        return true;
      }
      case 'delObj': {
        const pg = doc.pages.find(p => p.id === op.pageId);
        if (!pg) return false;
        const i = pg.objects.findIndex(o => o.id === op.id);
        if (i < 0) return false;
        pg.objects.splice(i, 1);
        return true;
      }
      case 'addPage': {
        const pg = newPage(op.bg);
        if (op.at != null) doc.pages.splice(Math.max(0, Math.min(op.at, doc.pages.length)), 0, pg);
        else doc.pages.push(pg);
        return true;
      }
      case 'delPage': {
        if (doc.pages.length <= 1) return false;
        const i = doc.pages.findIndex(p => p.id === op.pageId);
        if (i < 0) return false;
        doc.pages.splice(i, 1);
        return true;
      }
      case 'dupPage': {
        const src = doc.pages.find(p => p.id === op.pageId);
        if (!src) return false;
        const cp = JSON.parse(JSON.stringify(src));
        cp.id = 'pg_' + crypto.randomBytes(6).toString('hex');
        cp.objects.forEach(o => o.id = 'o_' + crypto.randomBytes(6).toString('hex'));
        doc.pages.splice(doc.pages.indexOf(src) + 1, 0, cp);
        return true;
      }
      case 'setBg': {
        const pg = doc.pages.find(p => p.id === op.pageId);
        if (pg && ['ruled', 'grid', 'slant', 'plain'].includes(op.bg)) { pg.background = op.bg; return true; }
        return false;
      }
      case 'rename': doc.title = String(op.title || '').slice(0, 120); return true;
      case 'reorder': {
        const pg = doc.pages.find(p => p.id === op.pageId);
        if (!pg) return false;
        const i = pg.objects.findIndex(o => o.id === op.id);
        if (i < 0) return false;
        const [o] = pg.objects.splice(i, 1);
        pg.objects.splice(Math.max(0, Math.min(op.to, pg.objects.length)), 0, o);
        return true;
      }
      case 'bulk': {
        let ok = false;
        for (const sub of (op.ops || [])) { if (this.applyOp(sub)) ok = true; }
        return ok;
      }
      default: return false;
    }
  }
}

function newPage(bg) {
  return { id: 'pg_' + crypto.randomBytes(6).toString('hex'), background: bg || 'ruled', objects: [] };
}
function findObj(doc, pageId, objId) {
  const pg = doc.pages.find(p => p.id === pageId);
  if (!pg) return null;
  return pg.objects.find(o => o.id === objId) || null;
}

/* ---------- Хранилище сессий ---------- */
const sessions = new Map(); // code -> Session

function genCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let s = '';
    for (let i = 0; i < 6; i++) s += abc[crypto.randomInt(abc.length)];
    if (!sessions.has(s)) return s;
  }
}

/* ---------- Rate limiting ---------- */
function rateOk(bucket, limit) {
  const now = Date.now();
  while (bucket.length && now - bucket[0] >= 1000) bucket.shift();
  if (bucket.length >= limit) return false;
  bucket.push(now);
  return true;
}

/* ---------- Snapshots persistence ---------- */
function persistSnapshots(code, snaps) {
  try {
    if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });
    const slim = snaps.map(s => ({ id: s.id, ts: s.ts, label: s.label, doc: s.doc }));
    fs.writeFileSync(path.join(SNAP_DIR, code + '.json'), JSON.stringify(slim));
  } catch (e) { console.error('snapshot persist:', e.message); }
}
function loadSnapshots(code) {
  try {
    const f = path.join(SNAP_DIR, code + '.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {}
  return [];
}

/* ---------- HTTP: раздача статики ---------- */
const ROOT = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // --- HTTP rate limit (анти-флуд) ---
  const ip = clientIp(req);
  if (rateLimited(httpBuckets, ip, HTTP_RATE_LIMIT, HTTP_RATE_WINDOW_MS)) {
    res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '5' });
    return res.end('Too many requests');
  }
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  if (p === '/') p = '/index.html';
  // только GET/HEAD: никакого unexpected-метода-флуда
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
// таймауты медленных соединений (slowloris): 10 сек на заголовки, 20 на запрос
server.headersTimeout = 10 * 1000;
server.requestTimeout = 20 * 1000;
server.keepAliveTimeout = 15 * 1000;

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, maxPayload: MAX_MSG });

wss.on('connection', (ws, req) => {
  // --- анти-DDoS: лимит соединений на IP и всего ---
  const ip = clientIp(req);
  if (wsTotal >= MAX_WS_TOTAL) {
    ws.close(1013, 'server busy');
    return;
  }
  const perIp = (wsPerIp.get(ip) || 0) + 1;
  if (perIp > WS_MAX_PER_IP) {
    ws.close(1013, 'too many connections');
    return;
  }
  wsPerIp.set(ip, perIp);
  wsTotal++;
  // молчащее соединение закрываем: нечего копить тысячи «зомби»
  let idleKiller = setTimeout(() => { try { ws.terminate(); } catch (_) {} }, WS_IDLE_TIMEOUT_MS);
  const bumpIdle = () => {
    clearTimeout(idleKiller);
    idleKiller = setTimeout(() => { try { ws.terminate(); } catch (_) {} }, WS_IDLE_TIMEOUT_MS);
  };
  ws.on('message', () => bumpIdle());
  // атомарная уборка при закрытии (счётчики IP/total + таймер простоя)
  const onGone = () => {
    const n = (wsPerIp.get(ip) || 1) - 1;
    if (n <= 0) wsPerIp.delete(ip); else wsPerIp.set(ip, n);
    wsTotal = Math.max(0, wsTotal - 1);
    clearTimeout(idleKiller);
  };
  ws.on('close', onGone);
  ws.on('error', onGone);

  const url = new URL(req.url, 'http://x');
  let joinCode = (url.searchParams.get('join') || '').toUpperCase();
  let role = url.searchParams.get('role'); // teacher|student
  const name = (url.searchParams.get('name') || '').slice(0, 40);
  const userId = url.searchParams.get('uid') || 'u_' + crypto.randomBytes(6).toString('hex');
  let restore = url.searchParams.get('restore') === '1';

  let session = null;
  let user = null;
  const opBucket = [], cursorBucket = [];

  // ---- Подбор/создание сессии ----
  // Переподключение учителя: если у него уже есть живая сессия с этим uid — возвращаем в НЕЁ,
  // а не создаём новую (это чинит «перекидывает на другую сессию» после обрыва).
  const creatingSession = (role === 'teacher') && !sessions.has(joinCode);
  if (creatingSession) {
    // анти-флуд сессиями: бот не может плодить «классы» пачками
    if (sessions.size >= MAX_SESSIONS_TOTAL ||
        rateLimited(sessionCreateBuckets, ip, SESSIONS_CREATE_PER_IP, SESSIONS_CREATE_WINDOW_MS)) {
      ws.send(JSON.stringify({ t: 'error', msg: 'Сервер отримав забагато запитів — спробуйте за кілька хвилин', fatal: true }));
      return ws.close();
    }
  }
  if (role === 'teacher' && !joinCode) {
    let existing = null;
    for (const [code, s] of sessions) {
      if (s.teacherId === userId) { existing = s; break; }
    }
    if (existing) {
      session = existing;
      joinCode = existing.code;
      restore = true;
    } else {
      const code = genCode();
      session = new Session(code);
      session.snapshots = loadSnapshots(code);
      sessions.set(code, session);
      joinCode = code;
    }
  } else if (joinCode && sessions.has(joinCode)) {
    session = sessions.get(joinCode);
  } else if (role === 'teacher') {
    const code = joinCode || genCode();
    session = new Session(code);
    session.snapshots = loadSnapshots(code);
    sessions.set(code, session);
  }

  if (!session) {
    // неверный код — считаем попытки (защита от брутфорса кодов классов)
    if (rateLimited(failedJoinBuckets, ip, WS_FAILED_JOIN_LIMIT, WS_FAILED_JOIN_WINDOW_MS)) {
      return ws.close(1013, 'too many attempts');
    }
    ws.send(JSON.stringify({ t: 'error', msg: 'Сессия не найдена. Проверьте код.', fatal: true }));
    return ws.close();
  }

  // ---- Роль ----
  if (role !== 'teacher') role = 'student';
  if (role === 'teacher') {
    if (session.teacherId && session.teacherId !== userId && !restore) {
      // в сессии уже есть учитель; переподключение того же uid — ок
      ws.send(JSON.stringify({ t: 'error', msg: 'В этой сессии уже есть учитель', fatal: true }));
      return ws.close();
    }
    session.teacherId = userId;
  }

  const colors = ['#e63946', '#e76f51', '#f4a261', '#2a9d8f', '#118ab2', '#457b9d', '#6a4c93', '#9d4edd'];
  const prev = session.users.get(userId);
  user = prev || {
    id: userId, name: name || (role === 'teacher' ? 'Учитель' : 'Ученик'),
    color: colors[session.users.size % colors.length], role
  };
  user.role = role;
  user.ws = ws;
  user.connected = true;
  user.lastSeen = Date.now();
  session.users.set(userId, user);

  ws.send(JSON.stringify({
    t: 'welcome',
    code: session.code,
    role,
    color: user.color,
    doc: session.doc,
    permissions: session.perms,
    presenterId: session.perms.presenterId,
    users: session.participantsList(),
    poll: session.pollStateFor(userId, role) // активный опрос — если переподключился
  }));
  session.logAdd(`${user.name} (${role === 'teacher' ? 'учитель' : 'ученик'}) подключился`);
  session.broadcastParticipants();

  // автоснапшоты
  if (!session._snapTimer) {
    session._snapTimer = setInterval(() => {
      session.saveSnapshot('авто');
    }, SNAPSHOT_INTERVAL_MS);
  }

  const cleanup = () => {
    if (!session || !user) return;
    user.connected = false;
    session.broadcast({ t: 'cursorOff', userId });
    session.logAdd(`${user.name} отключился`);
    session.broadcastParticipants();
    // активный опрос: если все ОСТАВШИЕСЯ ученики ответили — показываем результаты
    const p = session.poll;
    if (p && !p.revealed) {
      const students = [...session.users.values()].filter(x => x.role === 'student' && x.connected);
      if (students.length > 0 && students.every(x => p.answers.has(x.id))) {
        session.pollReveal('🎉 Усі відповіли — результати показано');
      }
    }
    // удаление «мёртвых» пользователей через таймаут
    setTimeout(() => {
      const u = session.users.get(userId);
      if (u && !u.connected) {
        // если вернулся — не удаляем (u.ws обновился)
        if (u.ws === ws) {
          session.users.delete(userId);
          if (role === 'teacher' && session.teacherId === userId) session.teacherId = null;
          session.broadcastParticipants();
        }
      }
    }, 60 * 1000);
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);

  ws.on('message', (raw) => {
    if (raw.length > MAX_MSG) { ws.close(1009, 'too big'); return; }
    let m;
    try { m = JSON.parse(raw); } catch (_) { return; }
    if (!m || typeof m.t !== 'string') return;

    switch (m.t) {
      case 'op': {
        if (!rateOk(opBucket, RATE_LIMIT_OPS)) {
          return session.sendTo(userId, { t: 'error', msg: 'Занадто багато дій — сповільніться 🙂' });
        }
        if (!m.op) return;
        const verdict = session.canDo(user, m.op.t === 'bulk' ? (m.op.ops?.[0] || m.op) : m.op);
        if (!verdict.ok) {
          return session.sendTo(userId, { t: 'error', msg: verdict.why });
        }
        // bulk: проверяем каждый подпункт
        if (m.op.t === 'bulk') {
          for (const sub of (m.op.ops || [])) {
            const v = session.canDo(user, sub);
            if (!v.ok) return session.sendTo(userId, { t: 'error', msg: v.why });
          }
        }
        const applied = session.applyOp(m.op);
        if (applied) {
          session.opCount++;
          session.broadcast({ t: 'op', op: m.op, userId });
        }
        break;
      }
      case 'live': {
        if (!rateOk(opBucket, RATE_LIMIT_OPS)) return;
        const verdict = session.canDo(user, { t: 'addObj', obj: m.obj });
        if (!verdict.ok) return;
        session.broadcast({ t: 'live', userId, obj: m.obj, name: user.name, color: user.color }, userId);
        break;
      }
      case 'liveEnd': {
        session.broadcast({ t: 'liveEnd', userId }, userId);
        break;
      }
      case 'cursor': {
        if (!rateOk(cursorBucket, RATE_LIMIT_CURSOR)) return;
        session.broadcast({ t: 'cursor', userId, x: m.x, y: m.y, name: user.name, color: user.color }, userId);
        break;
      }
      case 'hand': {
        session.broadcast({ t: 'hand', userId, name: user.name, ts: Date.now() });
        session.logAdd(`✋ ${user.name} підняв(ла) руку`);
        break;
      }
      case 'handGrant': {
        if (role !== 'teacher') return;
        const mins = Math.max(0, +m.globalEdit || 0);
        const grant = {
          tools: m.tools || {},
          until: mins > 0 ? Date.now() + mins * 60000 : null,
          expiresMin: mins
        };
        session.handGrants.set(m.userId, grant);
        session.sendTo(m.userId, {
          t: 'handGrant', tools: grant.tools, until: grant.until, expiresMin: grant.expiresMin
        });
        const uname = session.users.get(m.userId)?.name || 'учень';
        session.logAdd(`✋ вчитель дозволив ${uname} діяти${mins ? ` (${mins} хв)` : ''}`);
        break;
      }
      case 'handRevoke': {
        if (role !== 'teacher') return;
        session.handGrants.delete(m.userId);
        session.sendTo(m.userId, { t: 'handRevoke' });
        session.logAdd('✋ вчитель зняв дозвіл');
        break;
      }
      case 'liveText': {
        if (!rateOk(opBucket, RATE_LIMIT_OPS)) return;
        session.broadcast({ t: 'liveText', pageId: m.pageId, id: m.id, text: String(m.text || '').slice(0, 5000), color: m.color, name: user.name, userId }, userId);
        break;
      }
      case 'perms': {
        if (role !== 'teacher') return;
        applyPermPatch(session, m.patch);
        session.broadcastPerms('Учитель обновил права');
        session.logAdd('Учитель обновил права');
        break;
      }
      case 'kick': {
        if (role !== 'teacher') return;
        const victim = session.users.get(m.userId);
        if (!victim || victim.role === 'teacher') return;
        session.sendTo(m.userId, { t: 'kicked', msg: 'Учитель отключил вас от сессии' });
        victim.ws && victim.ws.close();
        session.logAdd(`Учитель отключил ${victim.name}`);
        break;
      }
      case 'setPresenter': {
        if (role !== 'teacher') return;
        session.perms.presenterId = m.userId || null;
        const who = m.userId ? (session.users.get(m.userId)?.name || 'ученик') : null;
        session.broadcast({ t: 'presenter', presenterId: session.perms.presenterId, name: who });
        session.logAdd(who ? `⭐ ${who} теперь ведущий` : 'Ведущий снят');
        break;
      }
      case 'snapshotSave': {
        if (role !== 'teacher') return;
        const s = session.saveSnapshot('ручное');
        session.sendTo(userId, { t: 'log', entry: { ts: Date.now(), text: `💾 Версия сохранена (${new Date(s.ts).toLocaleTimeString('ru-RU')})` } });
        break;
      }
      case 'snapshotList': {
        if (role !== 'teacher') return;
        session.sendTo(userId, {
          t: 'snapshotList',
          list: session.snapshots.map(s => ({ id: s.id, ts: s.ts, label: s.label }))
        });
        break;
      }
      case 'snapshotRestore': {
        if (role !== 'teacher') return;
        const s = session.snapshots.find(x => x.id === m.id);
        if (!s) return session.sendTo(userId, { t: 'error', msg: 'Версия не найдена' });
        session.doc = JSON.parse(JSON.stringify(s.doc));
        session.logAdd(`🕘 Учитель восстановил версию от ${new Date(s.ts).toLocaleTimeString('ru-RU')}`);
        session.broadcast({ t: 'snapshot', doc: session.doc });
        break;
      }
      case 'pollStart': {
        if (role !== 'teacher') return;
        if (!m.poll || typeof m.poll.question !== 'string' || !m.poll.question.trim()) {
          return session.sendTo(userId, { t: 'error', msg: 'Питання порожнє' });
        }
        session.pollStart(m.poll);
        break;
      }
      case 'pollAnswer': {
        if (!rateOk(opBucket, RATE_LIMIT_OPS)) return;
        const verdict = session.pollAnswer(userId, m.choice);
        if (!verdict.ok) return session.sendTo(userId, { t: 'error', msg: verdict.why });
        break;
      }
      case 'pollReveal': {
        if (role !== 'teacher') return;
        session.pollReveal('📊 Вчитель показав результати');
        break;
      }
      case 'pollClose': {
        if (role !== 'teacher') return;
        session.pollClose();
        break;
      }
      case 'bye': {
        ws.close();
        break;
      }
    }
  });
});

function applyPermPatch(session, patch) {
  if (!patch) return;
  if (patch.type === 'setGlobal') session.perms.globalEdit = patch.value;
  else if (patch.type === 'setTool') session.perms.tools[patch.tool] = patch.value;
  else if (patch.type === 'block') {
    if (!session.perms.blocked.includes(patch.userId)) session.perms.blocked.push(patch.userId);
  } else if (patch.type === 'unblock') {
    session.perms.blocked = session.perms.blocked.filter(id => id !== patch.userId);
  }
}

server.listen(PORT, () => {
  console.log(`ЦеЗошит сервер запущено: http://localhost:${PORT}`);
  console.log(`Папка снапшотов: ${SNAP_DIR}`);
});

/* фоновая очистка мёртвых сессий (нет участников 2 часа) */
setInterval(() => {
  const now = Date.now();
  for (const [code, s] of sessions) {
    const alive = [...s.users.values()].some(u => u.connected && u.ws.readyState === 1);
    const anyRecent = [...s.users.values()].some(u => now - (u.lastSeen || 0) < 2 * 3600 * 1000);
    if (!alive && !anyRecent) {
      clearInterval(s._snapTimer);
      sessions.delete(code);
      console.log('session cleaned:', code);
    }
  }
}, 10 * 60 * 1000);
