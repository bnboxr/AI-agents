package com.hsmcpay

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.ReactApplication

/**
 * HCEService — Host-based Card Emulation service for NFC tap-to-pay.
 *
 * When the phone is tapped on a POS terminal, Android routes APDU commands
 * to this service. The service parses the payment request from the POS,
 * forwards it to the React Native JS layer via HCEBridge, waits for the
 * signed response, and returns it as an APDU response to the POS reader.
 *
 * Protocol (simplified for prototype):
 * - SELECT AID: POS selects the HSMC Pay AID (F0010203040506)
 * - Command APDU: Contains a JSON payment request payload
 * - Response APDU: Contains a JSON payment response (approved/declined + signature)
 */
class HCEService : HostApduService() {

    companion object {
        private const val TAG = "HSMC_HCE"
        private const val HSMC_AID = byteArrayOf(
            0xF0.toByte(), 0x01, 0x02, 0x03, 0x04, 0x05, 0x06
        )

        // APDU status word constants
        private const val SW_SUCCESS = byteArrayOf(0x90.toByte(), 0x00)
        private const val SW_FILE_NOT_FOUND = byteArrayOf(0x6A.toByte(), 0x82.toByte())
        private const val SW_WRONG_DATA = byteArrayOf(0x6A.toByte(), 0x80.toByte())

        // SELECT APDU header
        private const val CLA_SELECT = 0x00.toByte()
        private const val INS_SELECT = 0xA4.toByte()
        private const val P1_SELECT_BY_NAME = 0x04.toByte()
        private const val P2_SELECT_FIRST = 0x00.toByte()

        // Custom APDU for payment data
        private const val CLA_HSMC = 0xF0.toByte()
        private const val INS_PAYMENT_REQUEST = 0x01.toByte()

        // Pending response from JS layer
        @Volatile
        private var pendingResponse: ByteArray? = null
        private val responseLock = Object()

        /**
         * Called by HCEBridgeModule when the JS layer has a response ready
         */
        fun setResponse(response: String) {
            synchronized(responseLock) {
                pendingResponse = response.toByteArray(Charsets.UTF_8)
                responseLock.notifyAll()
            }
        }
    }

    override fun processCommandApdu(commandApdu: ByteArray, extras: Bundle?): ByteArray {
        Log.d(TAG, "Received APDU: ${commandApdu.toHex()}")

        if (commandApdu.size < 4) {
            return SW_WRONG_DATA
        }

        val cla = commandApdu[0]
        val ins = commandApdu[1]

        return when {
            // SELECT AID command
            cla == CLA_SELECT && ins == INS_SELECT -> {
                handleSelect(commandApdu)
            }
            // HSMC payment request command
            cla == CLA_HSMC && ins == INS_PAYMENT_REQUEST -> {
                handlePaymentRequest(commandApdu)
            }
            else -> {
                Log.w(TAG, "Unknown APDU command: CLA=${cla.toHex()}, INS=${ins.toHex()}")
                SW_FILE_NOT_FOUND
            }
        }
    }

    private fun handleSelect(apdu: ByteArray): ByteArray {
        // Just acknowledge the SELECT — we support the AID
        Log.d(TAG, "SELECT received — AID accepted")
        return SW_SUCCESS
    }

    private fun handlePaymentRequest(apdu: ByteArray): ByteArray {
        // Extract payload from APDU (skip header: CLA + INS + P1 + P2 + Lc)
        val dataStart = if (apdu.size > 5) 5 else apdu.size
        val payload = if (apdu.size > dataStart) {
            apdu.copyOfRange(dataStart, apdu.size)
        } else {
            ByteArray(0)
        }

        val requestJson = String(payload, Charsets.UTF_8)
        Log.d(TAG, "Payment request: $requestJson")

        // Emit event to React Native JS layer
        try {
            val reactContext = (application as ReactApplication)
                .reactNativeHost
                .reactInstanceManager
                .currentReactContext

            if (reactContext != null) {
                val eventData = Arguments.createMap().apply {
                    putString("requestJson", requestJson)
                }
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("onHCERequest", eventData)
            }

            // Wait for JS response (timeout: 10 seconds)
            synchronized(responseLock) {
                responseLock.wait(10_000)
            }

            val response = pendingResponse
            pendingResponse = null

            if (response != null) {
                Log.d(TAG, "Returning response: ${String(response, Charsets.UTF_8)}")
                // APDU response = data + SW_SUCCESS
                return response + SW_SUCCESS
            } else {
                Log.w(TAG, "No response from JS layer — timeout")
                return "{\"approved\":false,\"declineReason\":\"Timeout\"}".toByteArray(Charsets.UTF_8) + SW_SUCCESS
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error processing payment request", e)
            return SW_WRONG_DATA
        }
    }

    override fun onDeactivated(reason: Int) {
        Log.d(TAG, "HCE deactivated: reason=$reason")
        // Cleanup pending state
        synchronized(responseLock) {
            pendingResponse = null
            responseLock.notifyAll()
        }
    }

    // Utility: byte array to hex string for logging
    private fun ByteArray.toHex(): String =
        joinToString("") { "%02x".format(it) }

    private fun Byte.toHex(): String = "%02x".format(this)
}
