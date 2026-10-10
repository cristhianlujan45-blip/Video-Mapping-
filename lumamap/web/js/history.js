// web/js/history.js
// Deshacer / rehacer por instantáneas del proyecto (JSON). Simple y a prueba de
// errores: cualquier edición, por compleja que sea, se puede revertir.
export class History {
  constructor(limit = 80) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.last = null;
  }
  /** Fija el estado base (p. ej. al abrir un proyecto) sin crear un paso. */
  reset(project) {
    this.undoStack = []; this.redoStack = [];
    this.last = JSON.stringify(project);
  }
  /** Registra un paso si el proyecto cambió desde el último registro. */
  commit(project) {
    const now = JSON.stringify(project);
    if (now === this.last) return false;
    if (this.last !== null) this.undoStack.push(this.last);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.last = now;
    return true;
  }
  undo() {
    if (!this.undoStack.length) return null;
    this.redoStack.push(this.last);
    this.last = this.undoStack.pop();
    return JSON.parse(this.last);
  }
  redo() {
    if (!this.redoStack.length) return null;
    this.undoStack.push(this.last);
    this.last = this.redoStack.pop();
    return JSON.parse(this.last);
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
