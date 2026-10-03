package com.lujan.mapping.core.history

/**
 * Snapshot based undo/redo. Because the project model is immutable, storing the
 * previous snapshot is cheap (structural sharing) and every kind of edit is undoable
 * without writing an inverse operation for each one.
 */
class History<T>(private val limit: Int = 200) {

    private val undoStack = ArrayDeque<T>()
    private val redoStack = ArrayDeque<T>()

    val canUndo: Boolean get() = undoStack.isNotEmpty()
    val canRedo: Boolean get() = redoStack.isNotEmpty()

    /** Records [previous] as the state to return to on undo. Clears the redo branch. */
    fun record(previous: T) {
        undoStack.addLast(previous)
        while (undoStack.size > limit) undoStack.removeFirst()
        redoStack.clear()
    }

    /** Returns the state to restore, or null. [current] becomes redoable. */
    fun undo(current: T): T? {
        val prev = undoStack.removeLastOrNull() ?: return null
        redoStack.addLast(current)
        return prev
    }

    fun redo(current: T): T? {
        val next = redoStack.removeLastOrNull() ?: return null
        undoStack.addLast(current)
        return next
    }

    fun clear() {
        undoStack.clear()
        redoStack.clear()
    }
}
