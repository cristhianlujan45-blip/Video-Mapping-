import type { Project } from '../../shared/project/model';

type Listener = (p: Project, prev: Project) => void;

/**
 * Immutable project store with snapshot undo/redo. Edits replace the root object
 * (structural sharing keeps snapshots cheap). A drag/slider gesture is ONE undo step:
 * begin() … live updates … commit().
 */
export class ProjectStore {
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private listeners = new Set<Listener>();
  private txBase: Project | null = null;
  private dirtyFlag = false;
  filePath: string | null = null;
  /** Bumped on every change (cheap change detection for React). */
  version = 0;

  constructor(public project: Project, private limit = 200) {}

  get dirty() {
    return this.dirtyFlag;
  }

  markSaved(path: string | null) {
    this.filePath = path;
    this.dirtyFlag = false;
    this.emit(this.project);
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(prev: Project) {
    this.version++;
    for (const l of this.listeners) l(this.project, prev);
  }

  /** Replaces the whole project (open / new / recovery). Clears history. */
  load(p: Project, filePath: string | null) {
    const prev = this.project;
    this.project = p;
    this.filePath = filePath;
    this.undoStack = [];
    this.redoStack = [];
    this.txBase = null;
    this.dirtyFlag = false;
    this.emit(prev);
  }

  /** One undoable edit. */
  update(fn: (p: Project) => Project, opts: { undoable?: boolean } = {}) {
    const prev = this.project;
    const next = fn(prev);
    if (next === prev) return;
    if (opts.undoable !== false && !this.txBase) {
      this.undoStack.push(prev);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
    }
    this.project = next;
    this.dirtyFlag = true;
    this.emit(prev);
  }

  begin() {
    if (!this.txBase) this.txBase = this.project;
  }

  commit() {
    if (!this.txBase) return;
    if (this.txBase !== this.project) {
      this.undoStack.push(this.txBase);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
    }
    this.txBase = null;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    this.commit();
    const p = this.undoStack.pop();
    if (!p) return;
    const prev = this.project;
    this.redoStack.push(prev);
    this.project = p;
    this.dirtyFlag = true;
    this.emit(prev);
  }

  redo() {
    const p = this.redoStack.pop();
    if (!p) return;
    const prev = this.project;
    this.undoStack.push(prev);
    this.project = p;
    this.dirtyFlag = true;
    this.emit(prev);
  }
}

// ------------------------------------------------------------------ immutable helpers

export function replaceById<T extends { id: string }>(list: T[], id: string, fn: (x: T) => T): T[] {
  let changed = false;
  const out = list.map((x) => {
    if (x.id !== id) return x;
    const n = fn(x);
    if (n !== x) changed = true;
    return n;
  });
  return changed ? out : list;
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}
