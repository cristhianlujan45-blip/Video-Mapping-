pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "LujanMapping"

include(":core")
include(":app")

// LumaMap: app de video mapping táctil (motor web WebGL2 + salida HDMI nativa).
include(":lumamap")
project(":lumamap").projectDir = file("lumamap/android")
