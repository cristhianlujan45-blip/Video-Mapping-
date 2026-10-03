package com.lujan.mapping.display

import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.view.Display
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.math.roundToInt

/**
 * Detects secondary displays that can host a [android.app.Presentation].
 *
 * What Android really offers (no invented capabilities):
 *  - Wired HDMI / USB-C DisplayPort Alt Mode / MHL: shows up as a presentation display
 *    *only if the phone's hardware and ROM support video out* (e.g. Samsung DeX models,
 *    many tablets, Pixel 8+ on recent Android). Otherwise nothing appears here.
 *  - Miracast / "Wireless display": also a presentation display, on devices that still
 *    ship it.
 *  - Chromecast / Google Cast screen casting: a *mirror* of the phone screen. It is not
 *    exposed as a second display to third-party apps (the Cast Remote Display API was
 *    deprecated), so the app uses INTERNAL output (fullscreen on the phone) for casting.
 */
class ExternalDisplayMonitor(context: Context) : DisplayManager.DisplayListener {

    data class ExternalDisplay(
        val id: Int,
        val name: String,
        val width: Int,
        val height: Int,
        val refreshRate: Float,
        val secure: Boolean,
        val supportedModes: List<String>,
    ) {
        val summary: String get() = "$name · ${width}x$height @ ${refreshRate.roundToInt()} Hz"
    }

    private val displayManager = context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
    private val _displays = MutableStateFlow<List<ExternalDisplay>>(emptyList())
    val displays: StateFlow<List<ExternalDisplay>> = _displays

    init {
        displayManager.registerDisplayListener(this, Handler(Looper.getMainLooper()))
        refresh()
    }

    fun presentationDisplay(id: Int? = null): Display? {
        val list = displayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)
        return if (id != null) list.firstOrNull { it.displayId == id } ?: list.firstOrNull() else list.firstOrNull()
    }

    fun refresh() {
        _displays.value = displayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)
            .filter { it.displayId != Display.DEFAULT_DISPLAY && it.isValid }
            .map { d ->
                val mode = d.mode
                ExternalDisplay(
                    id = d.displayId,
                    name = d.name ?: "Pantalla ${d.displayId}",
                    width = mode.physicalWidth,
                    height = mode.physicalHeight,
                    refreshRate = mode.refreshRate,
                    secure = (d.flags and Display.FLAG_SECURE) != 0,
                    supportedModes = d.supportedModes
                        .map { "${it.physicalWidth}x${it.physicalHeight} @ ${it.refreshRate.roundToInt()} Hz" }
                        .distinct(),
                )
            }
    }

    override fun onDisplayAdded(displayId: Int) = refresh()
    override fun onDisplayRemoved(displayId: Int) = refresh()
    override fun onDisplayChanged(displayId: Int) = refresh()
}
