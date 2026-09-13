/* ЦеЗошит — история (undo/redo), командный паттерн (shared/core/history.js)
 * Каждое действие пользователя локально оборачивается в inverse-op.
 * Удаление -> op add (объекты страницы возвращаются на индекс), и т.д.
 */
(function (SZ) {
  'use strict';

  class History {
    constructor(limit) {
      this.limit = limit || 100;
      this.undoStack = [];
      this.redoStack = [];
    }

    /** push({ do: op, undo: inverseOp, label }) — do уже применён */
    push(entry) {
      this.undoStack.push(entry);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack.length = 0;
    }

    canUndo() { return this.undoStack.length > 0; }
    canRedo() { return this.redoStack.length > 0; }

    /** возвращает op для отмены (применять вызывающему) */
    undo() {
      const e = this.undoStack.pop();
      if (!e) return null;
      this.redoStack.push(e);
      return e.undo;
    }
    redo() {
      const e = this.redoStack.pop();
      if (!e) return null;
      this.undoStack.push(e);
      return e.do;
    }
    clear() { this.undoStack.length = 0; this.redoStack.length = 0; }
  }

  /* Хелперы для построения inverse-op на основе документа ДО действия */
  const Inv = {
    beforeAddObj(pageId, obj) { return { t: 'delObj', pageId, id: obj.id }; },
    beforeUpdObj(pageId, id, oldObjSnapshot) {
      const patch = {};
      for (const k in oldObjSnapshot) patch[k] = oldObjSnapshot[k];
      return { t: 'updObj', pageId, id, patch };
    },
    beforeDelObj(pageId, obj, index) {
      return { t: 'addObj', pageId, obj, _index: index };
    }
  };

  SZ.History = History;
  SZ.Inv = Inv;
})(window.SZ = window.SZ || {});
