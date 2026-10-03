package com.lujan.mapping.ui

import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.lujan.mapping.LujanApp
import com.lujan.mapping.core.model.OutputTarget
import com.lujan.mapping.display.ProjectionPresentation
import com.lujan.mapping.ui.theme.LujanTheme
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private val vm: EditorViewModel by viewModels()
    private var presentation: ProjectionPresentation? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        setContent {
            LujanTheme {
                EditorScreen(vm)
            }
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.CREATED) {
                combine(
                    vm.projection,
                    vm.displays,
                    vm.project.map { it.output.target }.distinctUntilChanged(),
                ) { proj, displays, target -> Triple(proj.active, displays.firstOrNull()?.id, target) }
                    .distinctUntilChanged()
                    .collect { (active, displayId, target) -> updateOutputs(active, displayId, target) }
            }
        }
    }

    /**
     * Shows the clean projector output on the external display while projecting.
     * The phone keeps the editor (or the fullscreen output in INTERNAL/BOTH mode).
     */
    private fun updateOutputs(active: Boolean, displayId: Int?, target: OutputTarget) {
        if (active) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val wantExternal = active && target != OutputTarget.INTERNAL && displayId != null
        if (!wantExternal) {
            dismissPresentation()
            return
        }
        val display = (application as LujanApp).graph.displayMonitor.presentationDisplay(displayId) ?: run {
            dismissPresentation(); return
        }
        if (presentation?.display?.displayId == display.displayId && presentation?.isShowing == true) return
        dismissPresentation()
        val p = ProjectionPresentation(this, display, vm.engine)
        p.setOnDismissListener { if (presentation === p) presentation = null }
        try {
            p.show()
            presentation = p
        } catch (e: WindowManager.InvalidDisplayException) {
            Log.w(TAG, "external display vanished", e)
        }
    }

    private fun dismissPresentation() {
        val p = presentation ?: return
        presentation = null
        p.dismiss()
    }

    override fun onDestroy() {
        dismissPresentation()
        super.onDestroy()
    }

    /** Bluetooth / USB keyboard shortcuts. */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && handleShortcut(event)) return true
        return super.dispatchKeyEvent(event)
    }

    private fun handleShortcut(e: KeyEvent): Boolean {
        val ctrl = e.isCtrlPressed
        val step = if (e.isShiftPressed) 10f else 1f
        when (e.keyCode) {
            KeyEvent.KEYCODE_SPACE -> vm.togglePlay()
            KeyEvent.KEYCODE_DPAD_LEFT -> vm.nudge(-step, 0f)
            KeyEvent.KEYCODE_DPAD_RIGHT -> vm.nudge(step, 0f)
            KeyEvent.KEYCODE_DPAD_UP -> vm.nudge(0f, -step)
            KeyEvent.KEYCODE_DPAD_DOWN -> vm.nudge(0f, step)
            KeyEvent.KEYCODE_PAGE_UP -> vm.selectAdjacentLayer(1)
            KeyEvent.KEYCODE_PAGE_DOWN -> vm.selectAdjacentLayer(-1)
            KeyEvent.KEYCODE_TAB -> vm.cycleCorner()
            KeyEvent.KEYCODE_FORWARD_DEL, KeyEvent.KEYCODE_DEL -> vm.requestDeleteSelected()
            KeyEvent.KEYCODE_Z -> if (ctrl) { if (e.isShiftPressed) vm.redo() else vm.undo() } else return false
            KeyEvent.KEYCODE_Y -> if (ctrl) vm.redo() else return false
            KeyEvent.KEYCODE_S -> if (ctrl) vm.save() else return false
            KeyEvent.KEYCODE_D -> if (ctrl) vm.editor.value.selectedLayerId?.let { vm.duplicateLayer(it) } else return false
            KeyEvent.KEYCODE_G -> vm.toggleGrid()
            KeyEvent.KEYCODE_P -> if (vm.projection.value.active) vm.stopProjection() else vm.startProjection()
            KeyEvent.KEYCODE_ESCAPE -> {
                if (vm.editor.value.selectedCorner != null) vm.selectCorner(null) else vm.selectLayer(null)
            }
            else -> return false
        }
        return true
    }

    private companion object {
        const val TAG = "MainActivity"
    }
}
