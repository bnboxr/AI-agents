# HSMC Pay ProGuard Rules
# Keep React Native
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }

# Keep HCE Bridge
-keep class com.hsmcpay.HCEService { *; }
-keep class com.hsmcpay.HCEBridgeModule { *; }
-keep class com.hsmcpay.HCEBridgePackage { *; }

# Keep NFC
-keep class android.nfc.** { *; }
