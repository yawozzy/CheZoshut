/* ЦеЗошит — модель документа (shared/core/doc.js)
 * Документ = { title, pages: [Page] }
 * Page = { id, background: 'ruled'|'grid'|'slant'|'plain', objects: [Obj] }
 * Obj — union по type:
 *   path   {type,points,color,width,author}
 *   shape  {type:'shape',shape:'rect'|'ellipse'|'line'|'arrow'|'triangle',x,y,w,h,color,width,fill}
 *   text   {type:'text',x,y,w,text,font,size,color,bold,italic,underline,strike,sup,sub,align,fontClass}
 *   image  {type:'image',x,y,w,h,src}
 *   sticker{type:'sticker',x,y,w,h,text,color}
 *   table  {type:'table',x,y,w,rows,cols,cells:[{text}],color,headerColor}
 *   qr     {type:'qr',x,y,size,data,label}
 *   timer  {type:'timer',x,y,size,duration,running,startedAt,fill}
 * Все объекты: id, authorId, authorName, authorColor.
 */
(function (SZ) {
  'use strict';
  const U = SZ.U;

  const PAGE_W = 1240, PAGE_H = 1754; // A4 при ~150dpi
  const BG = ['ruled', 'grid', 'slant', 'plain'];
  const DEFAULT_FONTS = { print: '"Nunito", "Segoe UI", sans-serif', hand: '"Caveat", "Segoe Script", cursive' };

  class Doc {
    constructor(data) {
      const d = data || {};
      this.title = d.title || 'Мій зошит';
      this.pages = (d.pages && d.pages.length) ? d.pages.map(p => ({
        id: p.id || U.uid('pg'),
        background: BG.includes(p.background) ? p.background : 'ruled',
        objects: Array.isArray(p.objects) ? p.objects : []
      })) : [Doc.page()];
      this.active = 0;
    }

    static page(bg) {
      return {
        id: U.uid('pg'),
        background: BG.includes(bg) ? bg : 'ruled',
        objects: []
      };
    }

    get page() { return this.pages[this.active]; }
    pageById(id) { return this.pages.find(p => p.id === id); }
    setPage(id) { const i = this.pages.findIndex(p => p.id === id); if (i >= 0) { this.active = i; return true; } return false; }

    addPage(at, bg) { const p = Doc.page(bg || this.page.background); this.pages.splice(at == null ? this.pages.length : at + 1, 0, p); return p; }
    dupPage(at) {
      const src = this.pages[at == null ? this.active : at];
      const p = JSON.parse(JSON.stringify(src));
      p.id = U.uid('pg');
      p.objects.forEach(o => o.id = U.uid('o'));
      this.pages.splice(this.pages.indexOf(src) + 1, 0, p);
      return p;
    }
    delPage(id) {
      if (this.pages.length <= 1) return false;
      const i = this.pages.findIndex(p => p.id === id);
      if (i < 0) return false;
      this.pages.splice(i, 1);
      this.active = U.clamp(this.active, 0, this.pages.length - 1);
      return true;
    }
    setBg(id, bg) { const p = this.pageById(id); if (p && BG.includes(bg)) { p.background = bg; return true; } return false; }

    findObj(id) { return this.page.objects.find(o => o.id === id); }

    // —— сериализация ——
    toJSON() { return { v: 1, title: this.title, pages: this.pages }; }
  }

  Doc.PAGE_W = PAGE_W;
  Doc.PAGE_H = PAGE_H;
  Doc.BG = BG;
  Doc.DEFAULT_FONTS = DEFAULT_FONTS;

  /* ============ ОПЕРАЦИИ (ops) ============
   * Каждый op = { t: 'addObj'|'updObj'|'delObj'|'addPage'|'delPage'|'dupPage'|'setBg', ...payload, by: userId }
   * apply(doc, op) — чистая функция применения. Возвращает true если применился.
   * Сервер применяет те же ops после валидации прав → одинаковая логика на клиенте и сервере.
   */
  const Ops = {
    apply(doc, op) {
      switch (op.t) {
        case 'addObj': {
          if (!op.obj || !op.obj.id || !op.obj.type) return false;
          const pg = op.pageId ? doc.pageById(op.pageId) : doc.page;
          if (!pg) return false;
          if (pg.objects.some(o => o.id === op.obj.id)) return true; // идемпотентность
          pg.objects.push(op.obj);
          return true;
        }
        case 'updObj': {
          const o = (op.pageId ? doc.pageById(op.pageId) : doc.page)?.objects.find(x => x.id === op.id);
          if (!o) return false;
          for (const k in op.patch) {
            if (k === 'id' || k === 'type' || k === 'authorId') continue;
            o[k] = op.patch[k];
          }
          return true;
        }
        case 'delObj': {
          const pg = op.pageId ? doc.pageById(op.pageId) : doc.page;
          if (!pg) return false;
          const i = pg.objects.findIndex(o => o.id === op.id);
          if (i < 0) return false;
          pg.objects.splice(i, 1);
          return true;
        }
        case 'addPage': {
          const p = Doc.page(op.bg);
          if (op.at != null) doc.pages.splice(op.at, 0, p); else doc.pages.push(p);
          return p.id;
        }
        case 'delPage': return Doc.prototype.delPage.call(doc, op.pageId);
        case 'dupPage': {
          const src = doc.pageById(op.pageId); if (!src) return false;
          const p = JSON.parse(JSON.stringify(src));
          p.id = U.uid('pg'); p.objects.forEach(o => o.id = U.uid('o'));
          doc.pages.splice(doc.pages.indexOf(src) + 1, 0, p);
          return p.id;
        }
        case 'setBg': return doc.setBg(op.pageId, op.bg);
        case 'rename': doc.title = op.title; return true;
        default: return false;
      }
    },
    // описать права, нужные op (для серверной валидации)
    permOf(op, objType) {
      switch (op.t) {
        case 'addObj': return 'obj:' + (objType || op.obj?.type);
        case 'updObj': return 'obj:any';
        case 'delObj': return 'delete';
        case 'addPage': case 'dupPage': return 'pages';
        case 'delPage': return 'pages';
        case 'setBg': return 'obj:any';
        case 'rename': return 'obj:any';
        default: return 'obj:any';
      }
    }
  };

  SZ.Doc = Doc;
  SZ.Ops = Ops;
})(window.SZ = window.SZ || {});
