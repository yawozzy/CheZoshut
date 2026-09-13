/* Smoke-тест сервера: учитель создаёт сессию, ученик подключается,
 * проверяем права, ops, rate limit, руку, презентера, снапшоты. */
'use strict';
const WebSocket = require('ws');

const URL = 'ws://127.0.0.1:3100';
let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ FAIL: ' + name + (extra ? ' — ' + extra : '')); }
}
function connect(qs) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL + '/?' + qs);
    const msgs = [];
    const waiters = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      msgs.push(m);
      let i = 0;
      while (i < waiters.length) {
        if (waiters[i].t === m.t) { waiters[i].res(m); waiters.splice(i, 1); }
        else i++;
      }
    });
    ws.on('open', () => res(ws));
    ws.on('error', rej);
    ws._msgs = msgs;
    // ждём только НОВОЕ сообщение (пришедшее после вызова)
    ws.waitMsg = (t, ms) => {
      const seen = msgs.length;
      return new Promise((r) => {
        const w = { t, res: (m) => r(m) };
        waiters.push(w);
        if (ms !== 0) setTimeout(() => {
          const idx = waiters.indexOf(w);
          if (idx >= 0) { waiters.splice(idx, 1); r(null); }
        }, ms || 2500);
        void seen;
      });
    };
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('1) Учитель создаёт сессию');
  const t = await connect('role=teacher&name=ТестУчитель&uid=TEACHER1');
  const welcome = await t.waitMsg('welcome');
  check('welcome с кодом', !!welcome && /^[A-Z0-9]{6}$/.test(welcome.code), welcome && welcome.code);
  const code = welcome.code;
  check('роль teacher', welcome.role === 'teacher');
  check('документ с 1 страницей', welcome.doc && welcome.doc.pages.length === 1);

  console.log('2) Ученик подключается');
  const s = await connect('join=' + code + '&role=student&name=Аня&uid=STUDENT1');
  const sw = await s.waitMsg('welcome');
  check('ученик получил welcome', !!sw && sw.role === 'student');
  const parts = await t.waitMsg('participants');
  check('учитель видит 2 участника', parts && parts.list.length === 2, JSON.stringify(parts));

  console.log('3) Ops: ученик рисует — все получают');
  const pathOp = { t: 'op', op: { t: 'addObj', pageId: welcome.doc.pages[0].id, obj: { id: 'obj1', type: 'path', points: [{ x: 1, y: 1 }], authorId: 'STUDENT1' } } };
  s.send(JSON.stringify(pathOp));
  const echo = await t.waitMsg('op');
  check('учитель получил op ученика', echo && echo.op && echo.op.obj && echo.op.obj.id === 'obj1');

  console.log('4) Права: запрещаем рисование — сервер отклоняет');
  t.send(JSON.stringify({ t: 'perms', patch: { type: 'setTool', tool: 'obj:path', value: false } }));
  await sleep(150);
  s.send(JSON.stringify({ t: 'op', op: { t: 'addObj', pageId: welcome.doc.pages[0].id, obj: { id: 'obj2', type: 'path', points: [], authorId: 'STUDENT1' } } }));
  const err1 = await s.waitMsg('error');
  check('obj2 отклонён с сообщением', !!err1 && /малювання/i.test(err1.msg), JSON.stringify(err1));
  const dup = t._msgs.find(m => m.t === 'op' && m.op && m.op.obj && m.op.obj.id === 'obj2');
  check('отклонённый op не бродкастится', !dup);

  console.log('5) Права: глобальный «только просмотр»');
  t.send(JSON.stringify({ t: 'perms', patch: { type: 'setGlobal', value: false } }));
  await sleep(150);
  s.send(JSON.stringify({ t: 'op', op: { t: 'addObj', pageId: welcome.doc.pages[0].id, obj: { id: 'obj3', type: 'text', text: 'x', authorId: 'STUDENT1' } } }));
  const err2 = await s.waitMsg('error');
  check('в режиме просмотра любой op отклонён', !!err2 && /перегляд/i.test(err2.msg), JSON.stringify(err2));
  t.send(JSON.stringify({ t: 'perms', patch: { type: 'setGlobal', value: true } }));
  await sleep(150);

  console.log('6) Чужие объекты: ученик не может править объект учителя');
  t.send(JSON.stringify({ t: 'op', op: { t: 'addObj', pageId: welcome.doc.pages[0].id, obj: { id: 'tobj1', type: 'text', text: 'учитель', authorId: 'TEACHER1' } } }));
  await sleep(200);
  t.send(JSON.stringify({ t: 'perms', patch: { type: 'setTool', tool: 'obj:path', value: true } }));
  await sleep(200);
  s.send(JSON.stringify({ t: 'op', op: { t: 'updObj', pageId: welcome.doc.pages[0].id, id: 'tobj1', patch: { text: 'взлом' } } }));
  const err3 = await s.waitMsg('error');
  check('правка чужого отклонена', !!err3 && /свої/i.test(err3.msg), JSON.stringify(err3));
  // стирание чужого (канал ластика delObj) — тоже отклоняется
  s.send(JSON.stringify({ t: 'op', op: { t: 'delObj', pageId: welcome.doc.pages[0].id, id: 'tobj1' } }));
  const err3b = await s.waitMsg('error');
  check('стирание чужого отклонено (ластик)', !!err3b && /свої/i.test(err3b.msg), JSON.stringify(err3b));

  console.log('7) Подмена авторства отклоняется');
  s.send(JSON.stringify({ t: 'op', op: { t: 'addObj', pageId: welcome.doc.pages[0].id, obj: { id: 'obj4', type: 'text', text: 'fake', authorId: 'TEACHER1' } } }));
  const err4 = await s.waitMsg('error');
  check('подмена authorId отклонена', !!err4, JSON.stringify(err4));

  console.log('8) Ведущий: ученик получает все права');
  t.send(JSON.stringify({ t: 'setPresenter', userId: 'STUDENT1' }));
  await sleep(150);
  s.send(JSON.stringify({ t: 'op', op: { t: 'addObj', pageId: welcome.doc.pages[0].id, obj: { id: 'obj5', type: 'path', points: [], authorId: 'STUDENT1' } } }));
  const echo2 = await t.waitMsg('op');
  check('ведущий рисует несмотря на запрет', echo2 && echo2.op.obj && echo2.op.obj.id === 'obj5');

  console.log('9) Рука поднята');
  s.send(JSON.stringify({ t: 'hand' }));
  const hand = await t.waitMsg('hand');
  check('учитель видит ✋', !!hand && hand.name === 'Аня');

  console.log('10) Rate limit');
  // 80 ops без пауз — блокируется при лимите 40/сек
  for (let i = 0; i < 80; i++) {
    t.send(JSON.stringify({ t: 'op', op: { t: 'addObj', pageId: welcome.doc.pages[0].id, obj: { id: 'flood' + i, type: 'path', points: [], authorId: 'TEACHER1' } } }));
  }
  await sleep(800);
  const gotErr = t._msgs.some(m => m.t === 'error' && (/багато/i.test(m.msg) || /много/i.test(m.msg)));
  check('флуд блокируется', gotErr);
  await sleep(1300); // bucket полностью очистился перед следующими тестами

  console.log('11) Снапшоты');
  t.send(JSON.stringify({ t: 'snapshotSave' }));
  await sleep(200);
  t.send(JSON.stringify({ t: 'snapshotList' }));
  const snaps = await t.waitMsg('snapshotList');
  check('снапшот в списке', snaps && snaps.list.length >= 1);
  const sid = snaps.list[snaps.list.length - 1].id;
  t.send(JSON.stringify({ t: 'snapshotRestore', id: sid }));
  const restored = await s.waitMsg('snapshot');
  check('ученик получил восстановленный doc', restored && restored.doc);

  console.log('12) Кик ученика');
  t.send(JSON.stringify({ t: 'kick', userId: 'STUDENT1' }));
  const kicked = await s.waitMsg('kicked');
  check('ученик получил kicked', !!kicked);
  await sleep(200);
  s.close();

  console.log('13) Ученик не может быть вторым учителем');
  const s2 = await connect('join=' + code + '&role=teacher&name=Злой&uid=HACKER1');
  const err5 = await s2.waitMsg('error');
  check('второй учитель отклонён', !!err5 && /учитель/i.test(err5.msg), JSON.stringify(err5));
  s2.close();

  console.log('14) Несуществующий код');
  const s3 = await connect('join=ZZZZZZ&role=student&name=НЕТ&uid=X1');
  const err6 = await s3.waitMsg('error');
  check('нет сессии — ошибка', !!err6 && /Сессия не найдена/i.test(err6.msg));
  s3.close();

  console.log('15) Тест-опросы: учитель создаёт, ученики отвечают, reveal показывает кто что выбрал');
  const sA = await connect('join=' + code + '&role=student&name=Оля&uid=POLL_A');
  await sA.waitMsg('welcome');
  const sB = await connect('join=' + code + '&role=student&name=Ігор&uid=POLL_B');
  await sB.waitMsg('welcome');
  await sleep(400); // ждём, пока сервер увидит обоих учеников в users

  // ученик не может стартовать опрос: сообщения об ошибке нет, просто игнор
  sA.send(JSON.stringify({ t: 'pollStart', poll: { question: 'x', options: ['a', 'b'], correct: [0] } }));
  await sleep(300);
  check('ученик не может создать опрос', !t._msgs.some(m => m.t === 'poll' && m.poll));
  // STUDENT1 кикнут ранее, но ещё числится 60 сек (grace-период до удаления)
  const swB = sB._msgs.find(m => m.t === 'welcome');
  check('в сессии ученики: Аня(офлайн) + Оля + Ігор', swB && swB.users.filter(u => u.role === 'student').length === 3,
    JSON.stringify(swB && swB.users));

  // учитель запускает опрос
  t.send(JSON.stringify({ t: 'pollStart', poll: { question: 'Столиця Франції?', options: ['Париж', 'Лондон', 'Мадрид'], correct: [0] } }));
  const pStart = await sA.waitMsg('poll');
  check('ученик получил опрос', !!pStart && pStart.poll && pStart.poll.question === 'Столиця Франції?');
  check('правильный ответ скрыт до reveal', !('correct' in pStart.poll) && !('answers' in pStart.poll));
  // expected = все ученики сессии, вкл. офлайн Аню (grace 60с); авто-reveal не сработает раньше времени
  check('счётчик ожидаемых = 3 (Аня офлайн в grace-периоде)', pStart.poll.expectedCount === 3, JSON.stringify(pStart.poll));
  await sleep(150); // teacher тоже получает poll — пропускаем его, чтобы не мешал waitMsg

  // двойной ответ отклоняется
  sA.send(JSON.stringify({ t: 'pollAnswer', choice: [0] }));
  await sleep(150);
  sA.send(JSON.stringify({ t: 'pollAnswer', choice: [1] }));
  const perr2 = await sA.waitMsg('error');
  check('повторный ответ отклонён', !!perr2 && /відповіли/i.test(perr2.msg), JSON.stringify(perr2));

  // некорректный выбор отклоняется
  sB.send(JSON.stringify({ t: 'pollAnswer', choice: [99] }));
  const perr3 = await sB.waitMsg('error');
  check('несуществующий вариант отклонён', !!perr3 && /Некоректна/i.test(perr3.msg), JSON.stringify(perr3));

  // авто-reveal: оба онлайн-ученика ответили — результаты показываются сами
  // (офлайн-Аня в grace-периоде не блокирует: считается только connected)
  sB.send(JSON.stringify({ t: 'pollAnswer', choice: [1] }));
  let revealed = null;
  for (let i = 0; i < 6 && !revealed; i++) {
    const m = await t.waitMsg('poll', 800);
    if (m && m.poll && m.poll.revealed) revealed = m;
  }
  check('авто-reveal, когда все ответили', !!revealed && revealed.poll && revealed.poll.revealed === true);
  if (!revealed) throw new Error('no reveal');
  check('правильный ответ в reveal', revealed.poll.correct && revealed.poll.correct[0] === 0);
  const ansNames = (revealed.poll.answers || []).map(a => a.name).sort();
  check('видно, кто отвечал', ansNames.join(',') === 'Ігор,Оля', JSON.stringify(ansNames));
  const olya = (revealed.poll.answers || []).find(a => a.name === 'Оля');
  const ihor = (revealed.poll.answers || []).find(a => a.name === 'Ігор');
  check('видно, кто что выбрал', olya && olya.choice[0] === 0 && ihor && ihor.choice[0] === 1, JSON.stringify(revealed.poll.answers));

  // ручной reveal: новый опрос, ученики НЕ отвечают — учитель показывает результаты сам
  t.send(JSON.stringify({ t: 'pollStart', poll: { question: 'Скільки буде 3×3?', options: ['6', '9'], correct: [1] } }));
  await sA.waitMsg('poll');
  await sleep(150);
  t.send(JSON.stringify({ t: 'pollReveal' }));
  let manual = null;
  for (let i = 0; i < 6 && !(manual && manual.poll && manual.poll.revealed); i++) {
    const m = await t.waitMsg('poll', 800);
    if (m) manual = m;
  }
  check('reveal по команде учителя (без ответов)', !!manual && manual.poll && manual.poll.revealed === true);

  // новый участник получает в welcome состояние reveal
  const sC = await connect('join=' + code + '&role=student&name=Пізно&uid=POLL_C');
  const cWelcome = await sC.waitMsg('welcome');
  check('новый участник получает reveal в welcome', !!cWelcome && cWelcome.poll && cWelcome.poll.revealed === true);
  sC.send(JSON.stringify({ t: 'pollAnswer', choice: [0] }));
  const perr4 = await sC.waitMsg('error');
  check('ответ после reveal отклонён', !!perr4 && /завершено/i.test(perr4.msg), JSON.stringify(perr4));

  // учитель закрывает опрос
  t.send(JSON.stringify({ t: 'pollClose' }));
  const closed = await sA.waitMsg('poll');
  check('опрос закрыт для всех', !!closed && closed.poll === null);
  sA.close(); sB.close(); sC.close();
  await sleep(300); // ждём фактического закрытия сокетов

  console.log('16) Тест-опрос: таймер durationSec и reveal вручную');
  t.send(JSON.stringify({ t: 'pollStart', poll: { question: '2+2?', options: ['3', '4'], correct: [1], durationSec: 1 } }));
  await t.waitMsg('poll');
  // время вышло — авто-reveal по таймеру
  let byTimer = null;
  for (let i = 0; i < 8 && !(byTimer && byTimer.poll && byTimer.poll.revealed); i++) {
    const m = await t.waitMsg('poll', 800);
    if (m) byTimer = m;
  }
  check('авто-reveal по таймеру', !!byTimer && byTimer.poll && byTimer.poll.revealed === true);
  // повторный reveal ничего не ломает
  t.send(JSON.stringify({ t: 'pollReveal' }));
  await sleep(250);
  t.send(JSON.stringify({ t: 'pollClose' }));
  await sleep(150);

  console.log('17) Анти-DDoS: лимит WS на IP и флуд созданием сессий');
  // учитель + 3 ученика уже создали 4 соединения с 127.0.0.1 в этом тесте
  // (sA, sB, sC закрыты, но соединения t + s3(закрыт)… считаем текущие)
  // открываем соединения, пока не превысим лимит 12 на IP
  const spam = [];
  let rejected = false;
  for (let i = 0; i < 15; i++) {
    const ws = new WebSocket(URL + '/?join=' + code + '&role=student&name=spam' + i + '&uid=SPAM' + i);
    ws.on('close', (c, reason) => {
      if (String(reason).includes('too many') || c === 1013) rejected = true;
    });
    spam.push(ws);
    await sleep(30);
  }
  await sleep(500);
  check('превышение лимита WS на IP отклоняется', rejected);
  spam.forEach(ws => { try { ws.close(); } catch (_) {} });
  await sleep(300);

  // флуд созданием сессий: больше 6 новых сессий за окно — отклоняем
  let sessionFloodRejected = false;
  const flood = [];
  for (let i = 0; i < 8; i++) {
    const ws = new WebSocket(URL + '/?role=teacher&name=flood' + i + '&uid=FLOOD' + i);
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'error' && /забагато запитів/i.test(m.msg || '')) sessionFloodRejected = true;
    });
    flood.push(ws);
    await sleep(50);
  }
  await sleep(500);
  check('флуд созданием сессий отклоняется', sessionFloodRejected);
  flood.forEach(ws => { try { ws.close(); } catch (_) {} });
  await sleep(300);

  // HTTP rate limit: 150 запросов подряд → 429
  const http = require('http');
  let got429 = false;
  const hits = await Promise.all(Array.from({ length: 150 }, (_, i) =>
    new Promise((r) => {
      http.get('http://127.0.0.1:3100/index.html', (res) => { res.resume(); r(res.statusCode); })
        .on('error', () => r(0));
    })));
  got429 = hits.some(c => c === 429);
  check('HTTP-флуд получает 429', got429);
  await sleep(500);

  // брутфорс кодов: 6 неудачных входов → следующие молча закрываются
  const bf = [];
  let bfClosed = false;
  for (let i = 0; i < 8; i++) {
    const ws = new WebSocket(URL + '/?join=WRONG' + i + '&role=student&name=bf&uid=BF' + i);
    ws.on('close', (c, reason) => {
      if (c === 1013 || String(reason).includes('attempts')) bfClosed = true;
    });
    bf.push(ws);
    await sleep(40);
  }
  await sleep(400);
  check('брутфорс кодов пресекается', bfClosed);
  bf.forEach(ws => { try { ws.close(); } catch (_) {} });

  t.close();
  console.log(failures === 0 ? '\n=== ВСЕ ТЕСТЫ ПРОШЛИ ===' : `\n=== ПРОВАЛОВ: ${failures} ===`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(2); });
