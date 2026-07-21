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

        // Custom APDU for payment data
        private const val CLA_HSMC = 0xF0.toByte()
        private const val INS_PAYMENT_REQUEST = 0x01.toByte()

        // Standard EMV APDU commands
        private const val CLA_EMV = 0x00.toByte()
        private const val INS_GPO = 0xA8.toByte()    // Get Processing Options
        private const val INS_READ_RECORD = 0xB2.toByte()
        private const val INS_GET_DATA = 0xCA.toByte()

        // ─── Standard EMV SELECT Response ──────────────────────────
        // FCI template with Payment System Environment
        private val EMV_SELECT_RESPONSE = byteArrayOf(
            0x6F.toByte(), 0x2E, // FCI template, length 46
            0x84.toByte(), 0x0E, // DF Name
            0x32, 0x50, 0x41, 0x59, 0x2E, 0x53, 0x59, 0x53, 0x2E, 0x44, 0x44, 0x46, 0x30, 0x31, // "2PAY.SYS.DDF01"
            0xA5.toByte(), 0x1C, // FCI Proprietary template
            0xBF, 0x0C, 0x19,   // FCI Issuer Discretionary Data
            0x61.toByte(), 0x17, // Directory Entry
            0x4F, 0x07,         // ADF Name (length 7)
            0xA0.toByte(), 0x00, 0x00, 0x00, 0x03, 0x10, 0x10, // Sample Visa AID
            0x50, 0x0C,         // Application Label
            0x48, 0x53, 0x4D, 0x43, 0x20, 0x50, 0x61, 0x79, 0x20, 0x43, 0x61, 0x72, 0x64 // "HSMC Pay Card"
        )

        // ─── EMV GPO Response (AFL + AIP) ──────────────────────────
        private val EMV_GPO_RESPONSE = byteArrayOf(
            0x80.toByte(), 0x0A, // Template
            0x1C, 0x00,           // Application Interchange Profile
            0x08, 0x01, 0x01, 0x00, // Application File Locator
            0x10, 0x01, 0x05, 0x00,
            0x18, 0x01, 0x02, 0x01
        )

        // ─── EMV Read Record Response (track 2 equivalent data) ───
        private val EMV_READ_RECORD_RESPONSE = byteArrayOf(
            0x70.toByte(), 0x1A, // Record Template
            0x57.toByte(), 0x12, // Track 2 Equivalent Data
            // PAN: 4761739001010119D (example HSMC virtual card PAN)
            0x47.toByte(), 0x61, 0x73, 0x90, 0x01, 0x01, 0x01, 0x19,
            0xD1.toByte(), 0x12, 0x31, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0F,
            0x5F.toByte(), 0x20, 0x04, // Cardholder Name (empty for virtual)
            0x20, 0x20, 0x20, 0x20
        )

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
                    // Also emit via onHCERequest for JS to handle
                    emitHCERequest("{\"type\":\"hsmc_select\"}")
                    return SW_SUCCESS
                }

                if (isPPSE) {
                    Log.d(TAG, "PPSE (standard EMV) selected - returning EMV FCI")
                    return EMV_SELECT_RESPONSE + SW_SUCCESS
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

    // ─── Standard EMV Handlers ─────────────────────────────────────

    /**
     * Handle Get Processing Options (GPO) for EMV card emulation.
     * Returns Application Interchange Profile and Application File Locator.
     */
    private fun handleEMVGPO(apdu: ByteArray): ByteArray {
        Log.d(TAG, "EMV GPO received — returning AIP + AFL")
        return EMV_GPO_RESPONSE + SW_SUCCESS
    }

    /**
     * Handle Read Record for EMV card emulation.
     * Returns track 2 equivalent data (PAN, expiry, etc.)
     */
    private fun handleEMVReadRecord(apdu: ByteArray): ByteArray {
        Log.d(TAG, "EMV Read Record received")
        return EMV_READ_RECORD_RESPONSE + SW_SUCCESS
    }

    /**
     * Handle Get Data for EMV card emulation.
     */
    private fun handleEMVGetData(apdu: ByteArray): ByteArray {
        Log.d(TAG, "EMV Get Data received")
        // Return empty — terminal will proceed with what it has
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
