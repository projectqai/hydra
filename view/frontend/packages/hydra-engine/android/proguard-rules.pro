# Hydra Engine ProGuard Rules
# Keep native methods and JNI bindings

# Keep all Hydra classes and their native methods
-keep class hydra.** { *; }

# Keep Go bindings and Seq classes
-keep class go.** { *; }
-keep class go.Seq** { *; }

# Keep all classes with native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep constructors for native callback classes
-keepclasseswithmembers class * {
    native <methods>;
}
