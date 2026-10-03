# kotlinx.serialization: keep generated serializers of the project model (in :core).
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.lujan.mapping.core.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.lujan.mapping.core.**$$serializer { *; }
-keepclassmembers enum com.lujan.mapping.core.** { *; }
