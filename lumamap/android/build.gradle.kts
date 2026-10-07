import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// LumaMap: la interfaz y el motor de mapping son la app web de ../web
// (WebGL2), empaquetada como assets y servida offline por WebViewAssetLoader.
// La parte nativa aporta salida HDMI/USB-C (Presentation), archivos y permisos.
android {
    namespace = "com.lumamap.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.lumamap.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "2.2.0"
    }

    sourceSets["main"].assets.srcDirs("../web")

    signingConfigs {
        // Clave de pruebas fija (incluida en el repositorio): todas las compilaciones,
        // locales o de GitHub Actions, se firman igual, así cada APK nuevo se instala
        // encima del anterior sin desinstalar ni perder proyectos.
        // Para publicar en Google Play usa tu propia clave con keystore.properties.
        create("fixed") {
            storeFile = file("lumamap-test.jks")
            storePassword = "lumamap-test"
            keyAlias = "lumamap"
            keyPassword = "lumamap-test"
        }
        val props = rootProject.file("keystore.properties")
        if (props.exists()) {
            val p = Properties().apply { props.inputStream().use { load(it) } }
            create("release") {
                storeFile = rootProject.file(p.getProperty("storeFile"))
                storePassword = p.getProperty("storePassword")
                keyAlias = p.getProperty("keyAlias")
                keyPassword = p.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("fixed")
        }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("fixed")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // La app es web + un puente pequeño: el lint de release no aporta y alarga la compilación.
        checkReleaseBuilds = false
    }

    androidResources {
        // Los .js/.css/.html se sirven tal cual; no comprimir medios ya comprimidos.
        noCompress += listOf("webm", "mp4")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.webkit)
}
