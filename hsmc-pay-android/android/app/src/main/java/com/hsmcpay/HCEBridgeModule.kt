package com.hsmcpay

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import android.util.Log

/**
 * HCEBridgeModule — React Native bridge for NFC HCE communication.
 *
 * Provides a two-way bridge between the native HCEService (Kotlin)
 * and the React Native JS layer (TypeScript).
 *
 * Flow:
 * 1. POS taps phone → Android routes APDU to HCEService.kt
 * 2. HCEService.kt emits "onHCERequest" event via RCTDeviceEventEmitter
 * 3. JS layer (HCEService.ts) processes the request
 * 4. JS layer calls HCEBridge.sendResponse() with the signed result
 * 5. HCEBridge.setResponse() delivers the result back to HCEService.kt
 * 6. HCEService.kt returns the APDU response to the POS reader
 */
class HCEBridgeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "HSMC_HCEBridge"
        const val NAME = "HCEBridge"
    }

    override fun getName(): String = NAME

    /**
     * Called from JS (HCEService.ts) to send payment response back to native HCE.
     * This delivers the signed (or declined) payment authorization to the
     * waiting HCEService.kt thread.
     */
    @ReactMethod
    fun sendResponse(responseJson: String) {
        Log.d(TAG, "sendResponse called from JS: $responseJson")
        HCEService.setResponse(responseJson)
    }

    /**
     * Check if NFC HCE is available on this device
     */
    @ReactMethod
    fun isHCEAvailable(promise: com.facebook.react.bridge.Promise) {
        try {
            val nfcAdapter = reactApplicationContext
                .getSystemService(android.content.Context.NFC_SERVICE) as? android.nfc.NfcAdapter
            val available = nfcAdapter != null && nfcAdapter.isEnabled
            promise.resolve(available)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }
}
