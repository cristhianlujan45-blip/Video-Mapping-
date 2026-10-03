package com.lujan.mapping.core.model

import com.lujan.mapping.core.geometry.LayerTransform
import com.lujan.mapping.core.geometry.Quad
import com.lujan.mapping.core.geometry.Vec2
import kotlinx.serialization.Serializable

/*
 * Immutable project model. Every edit produces a new Project instance, which makes
 * undo/redo a simple stack of snapshots and lets the render thread read a consistent
 * snapshot without locks.
 */

@Serializable
enum class BlendMode(val label: String) {
    NORMAL("Normal"),
    ADD("Add"),
    SCREEN("Screen"),
    MULTIPLY("Multiply"),
    OVERLAY("Overlay"),
    DIFFERENCE("Difference"),
    LIGHTEN("Lighten"),
    DARKEN("Darken");

    /** Modes that need the backdrop in the shader (cannot be done with glBlendFunc). */
    val needsBackdrop: Boolean get() = this == OVERLAY || this == DIFFERENCE || this == LIGHTEN || this == DARKEN
}

@Serializable
enum class ContentKind {
    /** Procedural calibration pattern with colored corner markers. */
    TEST_PATTERN,
    SOLID_COLOR,
    VIDEO,
    IMAGE,
}

/**
 * Reference to a user media file. [uri] is a SAF content:// URI with a persisted read
 * permission. [displayName] and [sizeBytes] let "Buscar archivos perdidos" find the file
 * again if it was moved.
 */
@Serializable
data class MediaRef(
    val uri: String,
    val displayName: String,
    val mimeType: String? = null,
    val sizeBytes: Long = -1,
    val width: Int = 0,
    val height: Int = 0,
    val durationMs: Long = 0,
)

@Serializable
data class LayerContent(
    val kind: ContentKind = ContentKind.TEST_PATTERN,
    val media: MediaRef? = null,
    /** ARGB color for SOLID_COLOR, tint for TEST_PATTERN. */
    val colorArgb: Long = 0xFFFFFFFF,
)

/** Content crop in UV space (0..1). */
@Serializable
data class CropRect(
    val left: Float = 0f,
    val top: Float = 0f,
    val right: Float = 1f,
    val bottom: Float = 1f,
) {
    val isFull: Boolean get() = left == 0f && top == 0f && right == 1f && bottom == 1f
}

@Serializable
enum class MaskShape(val label: String) {
    RECTANGLE("Rectángulo"),
    ELLIPSE("Círculo / elipse"),
    POLYGON("Polígono"),
    FREEHAND("Libre"),
}

/**
 * A mask in surface (UV) space, so it follows the surface when its corners move.
 * RECTANGLE / ELLIPSE: [points] holds two opposite corners of the bounding box.
 * POLYGON / FREEHAND: [points] is the closed outline.
 * A mask makes visible what is *inside* the shape; [inverted] makes the inside hidden.
 * Several masks are combined by intersection (each one can only hide more).
 */
@Serializable
data class Mask(
    val id: String,
    val name: String,
    val shape: MaskShape,
    val points: List<Vec2>,
    val inverted: Boolean = false,
    /** Edge softness in UV units (0 = hard edge). */
    val feather: Float = 0f,
    /** 1 = mask fully applied, 0 = mask has no effect. */
    val opacity: Float = 1f,
    val enabled: Boolean = true,
)

@Serializable
data class ColorAdjust(
    /** -1..1 additive. */
    val brightness: Float = 0f,
    /** 0..2, 1 = unchanged. */
    val contrast: Float = 1f,
    /** 0..2, 1 = unchanged. */
    val saturation: Float = 1f,
    /** degrees, -180..180. */
    val hue: Float = 0f,
    val invert: Boolean = false,
) {
    val isIdentity: Boolean
        get() = brightness == 0f && contrast == 1f && saturation == 1f && hue == 0f && !invert
}

@Serializable
data class Playback(
    val loop: Boolean = true,
    val speed: Float = 1f,
    val volume: Float = 1f,
    val muted: Boolean = false,
)

@Serializable
data class Layer(
    val id: String,
    val name: String,
    val visible: Boolean = true,
    val locked: Boolean = false,
    val opacity: Float = 1f,
    val blendMode: BlendMode = BlendMode.NORMAL,
    /** Base corners in normalized output space (corner pinning). */
    val corners: Quad = Quad.rect(0.5f, 0.5f, 0.5f, 0.5f),
    /** Position / scale / rotation applied on top of [corners]. */
    val transform: LayerTransform = LayerTransform(),
    val content: LayerContent = LayerContent(),
    val crop: CropRect = CropRect(),
    val flipH: Boolean = false,
    val flipV: Boolean = false,
    /** Soft edge on the surface border, in UV units (0..0.5). Useful for edge blending. */
    val edgeFeather: Float = 0f,
    val masks: List<Mask> = emptyList(),
    val color: ColorAdjust = ColorAdjust(),
    val playback: Playback = Playback(),
) {
    /** Final corners after the transform, in normalized output space. */
    fun finalQuad(aspect: Float): Quad = transform.apply(corners, aspect)
}

@Serializable
enum class OutputTarget(val label: String) {
    EXTERNAL("Pantalla externa"),
    INTERNAL("Pantalla interna"),
    BOTH("Ambas"),
}

@Serializable
enum class ScaleMode(val label: String) {
    FIT("Ajustar (mantener proporción)"),
    STRETCH("Estirar a toda la pantalla"),
}

@Serializable
data class OutputSettings(
    val width: Int = 1920,
    val height: Int = 1080,
    val fpsLimit: Int = 60,
    val scaleMode: ScaleMode = ScaleMode.FIT,
    val target: OutputTarget = OutputTarget.EXTERNAL,
) {
    val aspect: Float get() = width.toFloat() / height.toFloat()
}

@Serializable
enum class GridPattern(val label: String) {
    GRID("Cuadrícula"),
    DOTS("Puntos"),
    CROSSES("Cruces"),
    CHECKER("Damero"),
    COLOR_BARS("Colores de referencia"),
}

@Serializable
data class GridSettings(
    val enabled: Boolean = false,
    val pattern: GridPattern = GridPattern.GRID,
    /** Number of cells across the output width. */
    val divisions: Int = 16,
    /** Line thickness in output pixels. */
    val thickness: Float = 2f,
    val colorArgb: Long = 0xFFFFFFFF,
    val opacity: Float = 1f,
    /** When false the grid is drawn over black (content hidden). */
    val showContent: Boolean = true,
)

@Serializable
data class Project(
    val formatVersion: Int = CURRENT_FORMAT_VERSION,
    val id: String,
    val name: String,
    val output: OutputSettings = OutputSettings(),
    /** Bottom-to-top draw order. */
    val layers: List<Layer> = emptyList(),
    val grid: GridSettings = GridSettings(),
    val createdAt: Long = 0,
    val modifiedAt: Long = 0,
) {
    fun layer(id: String?): Layer? = if (id == null) null else layers.firstOrNull { it.id == id }

    companion object {
        const val CURRENT_FORMAT_VERSION = 1
        const val FILE_EXTENSION = "mapping"
    }
}
