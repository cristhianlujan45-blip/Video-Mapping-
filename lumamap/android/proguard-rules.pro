# Métodos expuestos a JavaScript (@JavascriptInterface) deben conservarse.
-keepclassmembers class com.lumamap.app.** {
    @android.webkit.JavascriptInterface <methods>;
}
