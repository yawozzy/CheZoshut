/* ЦеЗошит — AI-помощник (shared/ai/ai.js)
 * Генератор контента, проверка орфографии, генератор тестов, голосовой ввод.
 * Свой API-ключ пользователя, хранится ТОЛЬКО в localStorage браузера.
 * Провайдер определяется АВТОМАТИЧЕСКИ по префиксу ключа (sk-… OpenAI,
 * gsk_… Groq, sk-or-… OpenRouter, AIza… Gemini, zai… Z.AI) — учителю не нужно
 * ничего выбирать. Для остальных сервисов есть режим «Свій сервіс» (любой
 * OpenAI-совместимый эндпоинт, например tokenrouter).
 * Запросы идут напрямую из браузера — ключ не проходит ни через сервер блокнота.
 * Все вставки на страницу идут через ops (SZ.App.commitAddObj) — работает в коллабе.
 */
(function (SZ) {
  'use strict';
  const U = SZ.U;

  const KEY_STORE = 'sz:ai'; // { provider, key, model, customUrl }

  /* эндпоинты совместимы с OpenAI Chat Completions API */
  const PROVIDERS = {
    openai: { name: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
    groq: { name: 'Groq (безкоштовно)', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
    openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini' },
    gemini: { name: 'Google Gemini (безкоштовно)', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.0-flash' },
    deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
    custom: { name: 'Свій сервіс (OpenAI-сумісний)', url: '', model: '' }
  };

  /* автодетект провайдера по виду ключа — учителю не нужно выбирать руками */
  function detectProvider(key) {
    const k = (key || '').trim();
    if (/^sk-or-(v1-)?/.test(k)) return 'openrouter';
    if (/^gsk_/.test(k)) return 'groq';
    if (/^AIza[0-9A-Za-z_-]{30,}/.test(k)) return 'gemini';
    if (/^zai-|^tr_[0-9a-f]{20,}/.test(k)) return 'custom';
    if (/^sk-[0-9a-f]{32}$/.test(k)) return 'deepseek';
    if (/^sk-/.test(k)) return 'openai';
    return null;
  }

  /* ============ НАСТРОЙКИ ============ */
  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(KEY_STORE)) || {}; } catch (_) { return {}; }
  }
  function saveCfg(cfg) { localStorage.setItem(KEY_STORE, JSON.stringify(cfg)); }

  const AI = {
    configured() {
      const c = loadCfg();
      const p = PROVIDERS[c.provider];
      return !!(c.key && p && (p.url || c.customUrl));
    },
    providerName() { const c = loadCfg(); return c.provider && PROVIDERS[c.provider] ? PROVIDERS[c.provider].name : ''; },

    /* ---------- Диалог настроек ключа ---------- */
    openSettings(cb) {
      const M = SZ.Modals;
      const h = document.getElementById('sz-modals');
      const cfg = loadCfg();
      const prov = cfg.provider || 'groq';
      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal" role="dialog" aria-modal="true" aria-label="AI-налаштування">
          <h3>✨ AI-помічник</h3>
          <p class="sz-hint">Просто вставте API-ключ — сервіс визначиться автоматично
             (OpenAI, Groq, OpenRouter, Gemini, DeepSeek). Ключ зберігається лише у вашому
             браузері, запити йдуть напряму в сервіс.</p>
          <label class="sz-field"><span>API-ключ</span>
            <input class="sz-input" type="password" id="sz-ai-key" value="${U.esc(cfg.key || '')}"
                   placeholder="sk-… / gsk_… / sk-or-… / AIza…" autocomplete="off">
            <small class="dim" id="sz-ai-detected" style="display:block;margin-top:3px"></small></label>
          <label class="sz-field"><span>Провайдер (автоматично, можна змінити)</span>
            <select class="sz-input" id="sz-ai-prov">
              ${Object.entries(PROVIDERS).map(([id, p]) => `<option value="${id}" ${prov === id ? 'selected' : ''}>${p.name}</option>`).join('')}
            </select></label>
          <label class="sz-field" id="sz-ai-custom-row" style="display:${prov === 'custom' ? 'block' : 'none'}">
            <span>Адреса сервісу (OpenAI-сумісний, напр. https://…/v1/chat/completions)</span>
            <input class="sz-input" id="sz-ai-url" value="${U.esc(cfg.customUrl || '')}"
                   placeholder="https://api.tokenrouter.ai/v1/chat/completions"></label>
          <label class="sz-field"><span>Модель (необов'язково)</span>
            <input class="sz-input" id="sz-ai-model" value="${U.esc(cfg.model || '')}" placeholder=""> </label>
          <p class="sz-hint dim">Безкоштовні ключі: console.groq.com · aistudio.google.com (Gemini).
             Платні: platform.openai.com · openrouter.ai · deepseek.com</p>
          <div class="sz-modal-actions">
            <button class="sz-btn danger" id="sz-ai-clear">Забути ключ</button>
            <button class="sz-btn ghost" id="sz-ai-cancel">Скасувати</button>
            <button class="sz-btn primary" id="sz-ai-save">Зберегти</button>
          </div>
        </div>`;
      const close = () => M._close();
      const provSel = h.querySelector('#sz-ai-prov');
      const keyInp = h.querySelector('#sz-ai-key');
      const detInfo = h.querySelector('#sz-ai-detected');
      const customRow = h.querySelector('#sz-ai-custom-row');
      const modelInp = h.querySelector('#sz-ai-model');

      const syncDetected = () => {
        const id = detectProvider(keyInp.value);
        const p = id ? PROVIDERS[id] : null;
        detInfo.textContent = id ? '✓ Розпізнано: ' + p.name : '';
        if (id) {
          provSel.value = id;
          if (!modelInp.value.trim()) modelInp.placeholder = p.model || 'модель сервісу';
        }
        customRow.style.display = provSel.value === 'custom' ? 'block' : 'none';
      };
      keyInp.addEventListener('input', syncDetected);
      keyInp.addEventListener('change', syncDetected);
      provSel.addEventListener('change', () => {
        customRow.style.display = provSel.value === 'custom' ? 'block' : 'none';
        const p = PROVIDERS[provSel.value];
        if (!modelInp.value.trim()) modelInp.placeholder = p.model || 'модель сервісу';
      });
      syncDetected();

      h.querySelector('.sz-modal-back').addEventListener('click', close);
      h.querySelector('#sz-ai-cancel').addEventListener('click', close);
      h.querySelector('#sz-ai-clear').addEventListener('click', () => {
        localStorage.removeItem(KEY_STORE);
        close();
        U.toast('Ключ видалено з браузера', 'ok');
      });
      h.querySelector('#sz-ai-save').addEventListener('click', () => {
        const key = keyInp.value.trim();
        if (!key) return U.toast('Введіть API-ключ', 'warn');
        const provider = provSel.value;
        const customUrl = h.querySelector('#sz-ai-url').value.trim();
        if (provider === 'custom' && !/^https?:\/\//.test(customUrl)) {
          return U.toast('Вкажіть адресу сервісу (https://…)', 'warn');
        }
        const model = modelInp.value.trim() || PROVIDERS[provider].model || '';
        saveCfg({ provider, key, model, ...(provider === 'custom' ? { customUrl } : {}) });
        close();
        U.toast('✨ AI підключено (' + PROVIDERS[provider].name + ')', 'ok');
        if (cb) cb();
      });
      keyInp.focus();
    },

    /* гарантия настроек: если ключа нет — сначала настройки, потом продолжение */
    _ensureCfg(then) {
      if (this.configured()) return then();
      U.toast('Спочатку підключіть API-ключ ✨', 'warn');
      this.openSettings(then);
    },

    /* ============ ЗАПРОС К API ============ */
    async chat(messages, opts) {
      const cfg = loadCfg();
      const p = PROVIDERS[cfg.provider];
      const url = cfg.provider === 'custom' ? cfg.customUrl : (p && p.url);
      if (!cfg.key || !url) throw new Error('AI не налаштовано: відкрийте ✨ → API-ключ');
      const model = cfg.model || p.model;
      if (!model) throw new Error('Вкажіть модель у налаштуваннях ✨');
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.key,
          ...(cfg.provider === 'openrouter' ? { 'HTTP-Referer': location.origin, 'X-Title': 'TseZoshit' } : {})
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts && opts.temperature != null ? opts.temperature : 0.7,
          max_tokens: opts && opts.maxTokens || 1400
        })
      });
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try { const j = await res.json(); msg = (j.error && j.error.message) || (j.message) || msg; } catch (_) {}
        throw new Error(msg);
      }
      const data = await res.json();
      const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!text) throw new Error('Порожня відповідь від AI');
      return text.trim();
    },

    /* ============ ГЛАВНОЕ МЕНЮ ✨ ============ */
    openMenu() {
      this._ensureCfg(() => this._menu());
    },
    _menu() {
      const M = SZ.Modals;
      const h = document.getElementById('sz-modals');
      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal" role="dialog" aria-modal="true" aria-label="AI-помічник">
          <h3>✨ AI-помічник <span class="dim" style="font-weight:600;font-size:12px">(${U.esc(this.providerName())})</span></h3>
          <div class="sz-ai-menu">
            <button class="sz-btn wide" data-ai="gen">📝 Генератор контента <small class="dim">— вставить текст на сторінку</small></button>
            <button class="sz-btn wide" data-ai="spell">🔍 Перевірка орфографії <small class="dim">— перевірить виділений текст</small></button>
            <button class="sz-btn wide" data-ai="quiz">📊 Генератор тесту <small class="dim">— запустить тест-опитування класу</small></button>
            <button class="sz-btn wide" data-ai="voice">🎤 Голосовий ввід <small class="dim">— текст із мікрофона на сторінку</small></button>
          </div>
          <div class="sz-modal-actions">
            <button class="sz-btn ghost" data-act="cfg">🔑 API-ключ</button>
            <button class="sz-btn primary" data-act="close">Закрити</button>
          </div>
        </div>`;
      const close = () => M._close();
      h.querySelector('.sz-modal-back').addEventListener('click', close);
      h.querySelector('[data-act="close"]').addEventListener('click', close);
      h.querySelector('[data-act="cfg"]').addEventListener('click', () => this.openSettings());
      h.querySelectorAll('[data-ai]').forEach(b => b.addEventListener('click', () => {
        const mode = b.dataset.ai;
        close();
        if (mode === 'gen') this.openGenerate();
        else if (mode === 'spell') this.openSpell();
        else if (mode === 'quiz') this.openQuiz();
        else if (mode === 'voice') this.openVoice();
      }));
    },

    /* диалог с полем запроса и статусом; run(title, prompt, onResult) */
    _promptDialog(title, label, ph, run) {
      const M = SZ.Modals;
      const h = document.getElementById('sz-modals');
      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal" role="dialog" aria-modal="true" aria-label="${U.esc(title)}">
          <h3>${U.esc(title)}</h3>
          <label class="sz-field"><span>${U.esc(label)}</span>
            <textarea class="sz-input" id="sz-ai-prompt" rows="3" placeholder="${U.esc(ph || '')}"
              style="resize:vertical"></textarea></label>
          <p class="sz-ai-status dim" id="sz-ai-status"></p>
          <div class="sz-modal-actions">
            <button class="sz-btn ghost" data-act="back">← Назад</button>
            <button class="sz-btn primary" id="sz-ai-run">✨ Виконати</button>
          </div>
        </div>`;
      const status = h.querySelector('#sz-ai-status');
      const btn = h.querySelector('#sz-ai-run');
      h.querySelector('.sz-modal-back').addEventListener('click', () => M._close());
      h.querySelector('[data-act="back"]').addEventListener('click', () => { M._close(); this._menu(); });
      const ta = h.querySelector('#sz-ai-prompt');
      setTimeout(() => ta.focus(), 60);
      btn.addEventListener('click', async () => {
        const prompt = ta.value.trim();
        if (!prompt) return U.toast('Введіть запит', 'warn');
        btn.disabled = true; btn.style.opacity = '.5';
        status.className = 'sz-ai-status';
        status.textContent = '⏳ Генерація…';
        try {
          await run(prompt, status);
        } catch (e) {
          status.textContent = '❌ ' + e.message;
          U.toast('AI помилка: ' + e.message, 'error');
          btn.disabled = false; btn.style.opacity = '1';
        }
      });
    },

    /* ============ 1) ГЕНЕРАТОР КОНТЕНТА ============ */
    openGenerate() {
      this._ensureCfg(() => this._promptDialog(
        '📝 Генератор контенту',
        'Що написати на сторінці?',
        'Напр.: короткий конспект про фотосинтез для 7 класу, 5 пунктів',
        async (prompt, status) => {
          const text = await this.chat([
            { role: 'system', content: 'Ти — асистент шкільного вчителя. Пиши коротко, структуровано, простою мовою. Мова відповіді = мова запиту. Формат: чистий текст зі списками через дефіс, без markdown-розмітки на кшталт ** або ##.' },
            { role: 'user', content: prompt }
          ]);
          this._insertText(text);
          status.textContent = '✓ Вставлено на сторінку';
          U.toast('✨ Текст додано на сторінку', 'ok');
          setTimeout(() => SZ.Modals._close(), 700);
        }
      ));
    },

    /* вставка многострочного текста как текстового объекта (через ops) */
    _insertText(text) {
      if (!SZ.App.allowed('obj:text')) return U.toast(SZ.App.permDeniedMsg('obj:text'), 'warn');
      const st = SZ.App.state;
      const p = SZ.App.viewCenter();
      const lines = text.split('\n').filter(l => l.trim());
      const o = {
        type: 'text', id: U.uid('o'),
        x: Math.max(40, p.x - 280), y: Math.max(40, p.y - 60), w: 560,
        text: lines.join('\n'), size: st.fontSize || 24, fontClass: 'print',
        color: '#1d3557', align: 'left', font: 'print',
        authorId: st.userId, authorName: st.userName, authorColor: st.userColor
      };
      SZ.App.commitAddObj(o);
      return o;
    },

    /* ============ 2) ПРОВЕРКА ОРФОГРАФИИ ============ */
    openSpell() {
      const sel = [...SZ.App.state.selection];
      let textObj = null;
      if (sel.length === 1) {
        const f = SZ.App.findObjAnywhere(sel[0]);
        if (f && f.obj.type === 'text') textObj = f.obj;
      }
      const checkWhat = textObj
        ? () => Promise.resolve(textObj.text || '')
        : () => this._promptDialog('🔍 Перевірка орфографії', 'Текст для перевірки', 'Введіть текст…',
            async (prompt, status) => { await this._spellCore(prompt, status); });
      if (textObj) return this._ensureCfg(() => this._spellCore(textObj.text, null, textObj));
      this._ensureCfg(() => checkWhat());
    },
    async _spellCore(text, status, textObj) {
      const M = SZ.Modals;
      const out = await this.chat([
        { role: 'system', content: 'Ти — коректор. Знайди орфографічні та пунктуаційні помилки. Відповідай ЯДРА у форматі: спочатку «ВИПРАВЛЕНИЙ ТЕКСТ:» з повним виправленим текстом, потім розділ «ПОМИЛКИ:» зі списком виправлень (рядок — було → стало), або «помилок немає». Мова = мова тексту.' },
        { role: 'user', content: text }
      ], { temperature: 0.2 });
      const m = out.split(/ПОМИЛКИ\s*:/i);
      const corrected = (m[0] || '').replace(/ВИПРАВЛЕНИЙ ТЕКСТ\s*:?/i, '').trim();
      const errors = (m[1] || '').trim();
      const h = document.getElementById('sz-modals');
      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal" role="dialog" aria-modal="true" aria-label="Результат перевірки">
          <h3>🔍 Перевірка орфографії</h3>
          ${errors ? `<p class="sz-hint"><b>Знайдені виправлення:</b></p>
            <div class="sz-log" style="max-height:140px">${U.esc(errors).split('\n').map(l => `<div>${l}</div>`).join('')}</div>`
          : '<p class="ok-text">✓ Помилок не знайдено</p>'}
          <div class="sz-modal-actions">
            ${textObj ? '<button class="sz-btn primary" id="sz-spell-apply">✓ Замінити текст об\'єкта</button>' : ''}
            ${!textObj && corrected ? '<button class="sz-btn primary" id="sz-spell-page">📋 Вставити виправлений текст на сторінку</button>' : ''}
            <button class="sz-btn ghost" data-act="close">Закрити</button>
          </div>
        </div>`;
      h.querySelector('.sz-modal-back').addEventListener('click', () => M._close());
      h.querySelector('[data-act="close"]').addEventListener('click', () => M._close());
      const applyBtn = h.querySelector('#sz-spell-apply');
      if (applyBtn) applyBtn.addEventListener('click', () => {
        SZ.App.commitUpdObj(textObj.id, { text: corrected });
        M._close();
        U.toast('✓ Текст об\'єкта виправлено', 'ok');
      });
      const pageBtn = h.querySelector('#sz-spell-page');
      if (pageBtn) pageBtn.addEventListener('click', () => {
        this._insertText(corrected);
        M._close();
        U.toast('✨ Виправлений текст додано', 'ok');
      });
      if (status) status.textContent = '';
    },

    /* ============ 3) ГЕНЕРАТОР ТЕСТОВ → опрос класса ============ */
    openQuiz() {
      this._ensureCfg(() => this._promptDialog(
        '📊 Генератор тесту',
        'Тема тесту (питання і варіанти згенерує AI)',
        'Напр.: дієслово, 7 клас, 1 питання з 4 варіантів',
        async (prompt, status) => {
          if (!SZ.App.state.online || SZ.App.state.role !== 'teacher' && SZ.App.state.presenterId !== SZ.App.state.userId) {
            throw new Error('Тест-опитування працює лише в серверній версії (роль вчителя). Створіть сесію 👥');
          }
          const raw = await this.chat([
            { role: 'system', content: 'Ти — генератор шкільних тестів. Створ ОДНЕ питання з 4 варіантами відповіді. Відповідай ЛИШЕ валідним JSON без markdown: {"question":"...","options":["...","...","...","..."],"correct":[номер правильного варіанту, 0-3]}. Мова = мова запиту.' },
            { role: 'user', content: prompt }
          ], { temperature: 0.5 });
          let quiz;
          try {
            const m = raw.match(/\{[\s\S]*\}/);
            quiz = JSON.parse(m ? m[0] : raw);
          } catch (e) { throw new Error('AI повернув не тест: ' + raw.slice(0, 120)); }
          if (!quiz.question || !Array.isArray(quiz.options) || quiz.options.length < 2) {
            throw new Error('AI повернув неповний тест');
          }
          const correct = Array.isArray(quiz.correct) ? quiz.correct.map(Number) : [Number(quiz.correct)];
          quiz.correct = correct.filter(i => Number.isInteger(i) && i >= 0 && i < quiz.options.length);
          if (!quiz.correct.length) quiz.correct = [0];
          // запускаем опрос класса
          SZ.App.transport.send({ t: 'pollStart', poll: { question: quiz.question, options: quiz.options, correct: quiz.correct, multiple: false, durationSec: 0 } });
          status.textContent = '✓ Тест-опитування запущено';
          U.toast('📊 Тест запущено — клас відповідає', 'ok');
          setTimeout(() => SZ.Modals._close(), 600);
        }
      ));
    },

    /* ============ 4) ГОЛОСОВОЙ ВВОД ============ */
    openVoice() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return U.toast('Голосовий ввід не підтримується цим браузером (спробуйте Chrome)', 'warn');
      if (!SZ.App.allowed('obj:text')) return U.toast(SZ.App.permDeniedMsg('obj:text'), 'warn');
      const M = SZ.Modals;
      const h = document.getElementById('sz-modals');
      h.innerHTML = `
        <div class="sz-modal-back"></div>
        <div class="sz-modal" role="dialog" aria-modal="true" aria-label="Голосовий ввід">
          <h3>🎤 Голосовий ввід</h3>
          <p class="sz-hint">Натисніть «Слухати» і говоріть — текст з'явиться на сторінці. Мова розпізнається автоматично.</p>
          <div class="sz-ai-status" id="sz-voice-status" aria-live="polite">Готовий до запису</div>
          <label class="sz-field"><span>Мова</span>
            <select class="sz-input" id="sz-voice-lang">
              <option value="uk-UA">Українська</option>
              <option value="ru-RU">Русский</option>
              <option value="en-US">English</option>
            </select></label>
          <div class="sz-modal-actions">
            <button class="sz-btn ghost" id="sz-voice-stop">Вставити те, що є</button>
            <button class="sz-btn primary" id="sz-voice-start">🔴 Слухати</button>
          </div>
        </div>`;
      const status = h.querySelector('#sz-voice-status');
      let rec = null;
      let finalText = '';
      h.querySelector('.sz-modal-back').addEventListener('click', () => { try { rec && rec.stop(); } catch (_) {} M._close(); });
      const startBtn = h.querySelector('#sz-voice-start');
      const stopBtn = h.querySelector('#sz-voice-stop');
      startBtn.addEventListener('click', () => {
        try {
          rec = new SR();
          rec.lang = h.querySelector('#sz-voice-lang').value;
          rec.continuous = true;
          rec.interimResults = true;
          rec.onresult = (e) => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
              const r = e.results[i];
              if (r.isFinal) finalText += r[0].transcript + ' ';
              else interim += r[0].transcript;
            }
            status.textContent = (finalText + interim).trim() || '…';
          };
          rec.onerror = (e) => { status.textContent = '⚠ ' + (e.error === 'not-allowed' ? 'Дозвольте доступ до мікрофона' : e.error); };
          rec.onend = () => { startBtn.disabled = false; startBtn.style.opacity = '1'; };
          rec.start();
          startBtn.disabled = true; startBtn.style.opacity = '.5';
          status.textContent = '🔴 Запис… говоріть';
        } catch (e) {
          status.textContent = '⚠ ' + e.message;
        }
      });
      const finish = () => {
        try { rec && rec.stop(); } catch (_) {}
        const txt = finalText.trim();
        if (!txt) { U.toast('Нічого не розпізнано', 'warn'); return; }
        this._insertText(txt);
        M._close();
        U.toast('🎤 Текст із голосу додано на сторінку', 'ok');
      };
      stopBtn.addEventListener('click', finish);
    }
  };

  SZ.AI = AI;
})(window.SZ = window.SZ || {});
