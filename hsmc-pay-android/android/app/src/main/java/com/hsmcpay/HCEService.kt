package com.hsmcpay

import android.nfc.cardemulation.HostApduService
import android.os.Bundle
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.ReactApplication
import org.json.JSONException
import org.json.JSONObject

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
 *
 * Enhanced with:
 * - Standard EMV card emulation for Visa/Mastercard terminals
 * - Raw APDU forwarding to JS for POS type detection
 */
class HCEService : HostApduService() {

    companion object {
        private const val TAG = "HSMC_HCE"
        private const val HSMC_AID = byteArrayOf(
            0xF0.toByte(), 0x01, 0x02, 0x03, 0x04, 0x05, 0x06
        )

        // Standard payment AIDs
        private val PPSE_AID = "2PAY.SYS.DDF01".toByteArray(Charsets.UTF_8)

        // APDU status word constants
        private val SW_SUCCESS = byteArrayOf(0x90.toByte(), 0x00)
        private val SW_FILE_NOT_FOUND = byteArrayOf(0x6A.toByte(), 0x82.toByte())
        private val SW_WRONG_DATA = byteArrayOf(0x6A.toByte(), 0x80.toByte())
        private val SW_CONDITIONS_NOT_SATISFIED = byteArrayOf(0x69.toByte(), 0x85.toByte())

        // SELECT APDU header
        private const val CLA_SELECT = 0x00.toByte()
        private const val INS_SELECT = 0xA4.toByte()
        private const val P1_SELECT_BY_NAME = 0x04.toByte()
        private const val P2_SELECT_FIRST = 0x00.toByte()

        // HSMC custom AID for the native wallet payment path
        private const val CLA_HSMC = 0xF0.toByte()
        private const val INS_PAYMENT_REQUEST = 0x01.toByte()

        // Standard EMV APDU commands. HSMC Pay has NO issued card (no card
        // issuer pipeline), so these always return a clean refusal status
        // (SW_CONDITIONS_NOT_SATISFIED). No fabricated PAN/expiry/CVV data is
        // ever handed to a terminal.
        private const val CLA_EMV = 0x00.toByte()
        private const val INS_GPO = 0xA8.toByte()    // Get Processing Options
        private const val INS_READ_RECORD = 0xB2.toByte()
        private const val INS_GET_DATA = 0xCA.toByte()

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

        // Forward raw APDU to JS layer for POS type detection
        emitRawAPDU(commandApdu)

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
            // Standard EMV: Get Processing Options
            cla == CLA_EMV && ins == INS_GPO -> {
                handleEMVGPO(commandApdu)
            }
            // Standard EMV: Read Record
            cla == CLA_EMV && ins == INS_READ_RECORD -> {
                handleEMVReadRecord(commandApdu)
            }
            // Standard EMV: Get Data
            cla == CLA_EMV && ins == INS_GET_DATA -> {
                handleEMVGetData(commandApdu)
            }
            else -> {
                Log.w(TAG, "Unknown APDU command: CLA=${cla.toHex()}, INS=${ins.toHex()}")
                SW_FILE_NOT_FOUND
            }
        }
    }

    /**
     * Emit raw APDU data to React Native for POS type detection.
     */
    private fun emitRawAPDU(apdu: ByteArray) {
        try {
            val reactContext = (application as ReactApplication)
                .reactNativeHost
                .reactInstanceManager
                .currentReactContext

            if (reactContext != null) {
                val eventData = Arguments.createMap().apply {
                    putString("apduHex", apdu.toHex())
                }
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("onRawAPDU", eventData)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to emit raw APDU", e)
        }
    }

    private fun handleSelect(apdu: ByteArray): ByteArray {
        Log.d(TAG, "SELECT received")

        // Extract AID from SELECT command to determine response type
        if (apdu.size > 5) {
            val lc = apdu[4].toInt() and 0xFF
            if (lc > 0 && apdu.size >= 5 + lc) {
                val aid = apdu.copyOfRange(5, 5 + lc)

                // Check if this is HSMC or standard payment AID
                val isHSMC = HSMC_AID.size == aid.size && HSMC_AID.contentEquals(aid)
                val isPPSE = PPSE_AID.size == aid.size && PPSE_AID.contentEquals(aid)

                if (isHSMC) {
                    Log.d(TAG, "HSMC AID selected")
                    // A SELECT is not a payment request. Do NOT emit an
                    // onHCERequest event here: the JS layer would treat it as a
                    // payment, respond with a decline, and that stale response
                    // would then be returned for the real payment APDU.
                    return SW_SUCCESS
                }

                if (isPPSE) {
                    Log.d(TAG, "PPSE (standard EMV) selected — no issued card, refusing")
                    // A standard-EMV terminal is probing for a Visa/MC
                    // application. HSMC Pay has no issued card, so signal
                    // "conditions not satisfied" — the POS will treat this as
                    // the absence of a usable card rather than receiving a
                    // fabricated card payload.
                    return SW_CONDITIONS_NOT_SATISFIED
                }
            }
        }

        // Default: acknowledge
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
        Log.d(TAG, "Payment request received (${requestJson.length} bytes)")

        // sessionId ties the JS response back to this exact APDU exchange.
        val requestSessionId = runCatching { JSONObject(requestJson).optString("sessionId") }
            .getOrDefault("")

        try {
            // Emit event to React Native JS layer
            emitHCERequest(requestJson)

            // Wait for the JS response correlated to this session (10s timeout)
            val response = waitForMatchingResponse(requestSessionId, 10_000)

            if (response != null) {
                Log.d(TAG, "Returning response (${response.size} bytes)")
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

    /**
     * Emit the payment request to React Native as a flat map matching the
     * HCEPaymentRequest interface consumed by HCEService.ts:
     * { amount, token, contractAddress, sessionId, merchant }.
     */
    private fun emitHCERequest(requestJson: String) {
        try {
            val reactContext = (application as ReactApplication)
                .reactNativeHost
                .reactInstanceManager
                .currentReactContext

            if (reactContext != null) {
                val eventData = Arguments.createMap()
                try {
                    val request = JSONObject(requestJson)
                    eventData.putString("amount", request.optString("amount"))
                    eventData.putString("token", request.optString("token"))
                    eventData.putString("contractAddress", request.optString("contractAddress"))
                    eventData.putString("sessionId", request.optString("sessionId"))
                    if (request.has("merchant")) {
                        eventData.putString("merchant", request.optString("merchant"))
                    }
                } catch (e: JSONException) {
                    // Malformed request — emit an empty amount; the JS layer
                    // will decline with a clear "Invalid payment amount" error.
                    Log.w(TAG, "Malformed payment request JSON", e)
                    eventData.putString("amount", "")
                }
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("onHCERequest", eventData)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to emit HCE request", e)
        }
    }

    /**
     * Wait for a JS response whose sessionId matches the current payment
     * request.
     *
     * A previous NFC tap can deliver a late response (e.g. the JS layer was
     * still waiting on the biometric prompt when the previous session timed
     * out). Without correlation, that stale signature would be returned for
     * the next tap — an authorization replay across sessions. Stale responses
     * are discarded and the wait continues until the deadline.
     */
    private fun waitForMatchingResponse(requestSessionId: String, timeoutMs: Long): ByteArray? {
        val deadline = System.currentTimeMillis() + timeoutMs
        synchronized(responseLock) {
            while (System.currentTimeMillis() < deadline) {
                val candidate = pendingResponse
                if (candidate != null) {
                    val candidateSessionId = runCatching {
                        JSONObject(String(candidate, Charsets.UTF_8)).optString("sessionId")
                    }.getOrDefault("")
                    if (requestSessionId.isEmpty() || candidateSessionId == requestSessionId) {
                        pendingResponse = null
                        return candidate
                    }
                    // Stale response for a different session — discard and keep waiting
                    pendingResponse = null
                }
                responseLock.wait(200)
            }
            return null
        }
    }

    // ─── Standard EMV Handlers (refuse — no issued card) ──────────

    /**
     * Get Processing Options for EMV emulation. There is no issued card, so
     * this is always refused cleanly (never fabricated card data).
     */
    private fun handleEMVGPO(apdu: ByteArray): ByteArray {
        Log.d(TAG, "EMV GPO received — refusing (no issued card)")
        return SW_CONDITIONS_NOT_SATISFIED
    }

    /**
     * Read Record for EMV emulation. No issued card exists, so no track-2
     * equivalent (PAN/expiry) data is ever returned — refused cleanly.
     */
    private fun handleEMVReadRecord(apdu: ByteArray): ByteArray {
        Log.d(TAG, "EMV Read Record received — refusing (no issued card)")
        return SW_CONDITIONS_NOT_SATISFIED
    }

    /**
     * Get Data for EMV emulation. No issued card exists — refused cleanly.
     */
    private fun handleEMVGetData(apdu: ByteArray): ByteArray {
        Log.d(TAG, "EMV Get Data received — refusing (no issued card)")
        return SW_CONDITIONS_NOT_SATISFIED
    }

    // ─── Utility ───────────────────────────────────────────────────

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
