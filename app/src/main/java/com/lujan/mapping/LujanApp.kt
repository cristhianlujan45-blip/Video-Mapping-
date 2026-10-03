package com.lujan.mapping

import android.app.Application
import com.lujan.mapping.data.ProjectRepository
import com.lujan.mapping.display.ExternalDisplayMonitor
import com.lujan.mapping.media.MediaManager
import com.lujan.mapping.render.RenderEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * Application-scoped singletons (manual DI: the graph is small, Hilt would add build
 * time and complexity without benefit). The render engine and players live here so they
 * survive activity re-creation and never interrupt the projector output.
 */
class LujanApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
    }
}

class AppGraph(app: Application) {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val renderEngine = RenderEngine()
    val mediaManager = MediaManager(app, renderEngine, appScope)
    val projectRepository = ProjectRepository(app)
    val displayMonitor = ExternalDisplayMonitor(app)
}
