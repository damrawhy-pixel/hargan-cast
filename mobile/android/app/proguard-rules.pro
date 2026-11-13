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

# --- Hargan Cast -------------------------------------------------------------
# The PlayStation core (native/ps-core/mobile/jni.c) calls PsCore.onLine and
# PsCore.onFeedback by name, and Capacitor finds plugins and their methods by
# reflection. Keep the app's own classes whole; they are small.
-keep class app.hargan.** { *; }
-keepclasseswithmembernames class * { native <methods>; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * { @com.getcapacitor.PluginMethod public <methods>; }
# Line numbers in crash reports from Google Play.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
