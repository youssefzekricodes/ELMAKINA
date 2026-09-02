# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ── Capacitor ────────────────────────────────────────────────────────────────
# The bridge resolves plugins BY NAME at runtime: JavaScript calls "AdMob", and Java looks the
# class up reflectively. R8 sees no caller, renames the class, and the app builds perfectly and
# then fails on the first plugin call with a message that names nothing useful. Keep them.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class com.capacitorjs.** { *; }
-keep class com.getcapacitor.community.admob.** { *; }

# WebView JS interfaces are called from JavaScript, which R8 also cannot see.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
