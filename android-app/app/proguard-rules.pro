# Keep JavascriptInterface methods exposed to https://credoapp.tech
-keepattributes *Annotation*
-keepclassmembers class tech.credoapp.credo.MainActivity$CredoJsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
