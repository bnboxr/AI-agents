// HCEService.ts — Wraps the native Android HCE module for NFC tap-to-pay
//
// When phone is tapped on a POS reader, Android OS calls processCommandApdu()
// on the native HCEService.kt. That service forwards data to React Native
// via an event emitter. This module listens and responds with the payment
// payload (wallet address + signed authorization).
//
// Architecture:
//   POS Terminal → NFC Reader → Android HCE → HCEService.kt → EventEmitter
//   → HCEService.ts (this file) → WalletService → BudgetService → Response

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import * as WalletService from './WalletService';
import * as BudgetService from './BudgetService';
import * as TransactionStore from './TransactionStore';

const { HCEBridge } = NativeModules;

// Event emitter for HCE requests from native layer
let hceEventEmitter: NativeEventEmitter | null = null;

if (Platform.OS === 'android' && HCEBridge) {
  hceEventEmitter = new NativeEventEmitter(HCEBridge);
}

export interface HCEPaymentRequest {
  amount: string;
  token: string;
  contractAddress: string;
  sessionId: string;
  merchant?: string;
}

export interface HCEPaymentResponse {
  approved: boolean;
  walletAddress: string;
  signedPayload: string;
  declineReason?: string;
  sessionId: string;
}

export type POSType = 'hsmc' | 'visa' | 'mastercard' | 'generic_emv' | 'unknown';

// HSMC custom AID: F0010203040506
const HSMC_AID = [0xF0, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06];
// Standard PPSE AID: "2PAY.SYS.DDF01" → 325041592E5359532E4444463031
const PPSE_AID_HEX = '325041592E5359532E4444463031';

/**
 * Detect POS terminal type from APDU command data.
 * Analyzes the SELECT AID command to determine what payment network
 * the terminal is requesting.
 */
export function detectPOSType(apduData: number[]): POSType {
  if (apduData.length < 5) return 'unknown';

  // APDU SELECT command structure:
  // CLA(1) + INS(1) + P1(1) + P2(1) + Lc(1) + AID(Lc bytes)
  // CLA=0x00, INS=0xA4 indicates SELECT

  // Extract the AID from the SELECT command data
  const dataStart = 5;
  if (apduData.length <= dataStart) return 'unknown';

  const aidBytes = apduData.slice(dataStart);

  // Check HSMC custom AID: F0 01 02 03 04 05 06
  if (
    aidBytes.length >= HSMC_AID.length &&
    HSMC_AID.every((b, i) => aidBytes[i] === b)
  ) {
    return 'hsmc';
  }

  // Check Visa AID: starts with A0 00 00 00 03
  if (
    aidBytes.length >= 5 &&
    aidBytes[0] === 0xA0 &&
    aidBytes[1] === 0x00 &&
    aidBytes[2] === 0x00 &&
    aidBytes[3] === 0x00 &&
    aidBytes[4] === 0x03
  ) {
    return 'visa';
  }

  // Check Mastercard AID: starts with A0 00 00 00 04
  if (
    aidBytes.length >= 5 &&
    aidBytes[0] === 0xA0 &&
    aidBytes[1] === 0x00 &&
    aidBytes[2] === 0x00 &&
    aidBytes[3] === 0x00 &&
    aidBytes[4] === 0x04
  ) {
    return 'mastercard';
  }

  // Check PPSE AID: "2PAY.SYS.DDF01"
  const ppseBytes = PPSE_AID_HEX.match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) || [];
  if (
    aidBytes.length >= ppseBytes.length &&
    ppseBytes.every((b, i) => aidBytes[i] === b)
  ) {
    return 'generic_emv';
  }

  return 'unknown';
}

let onPaymentCallback: ((request: HCEPaymentRequest) => Promise<HCEPaymentResponse>) | null = null;

// Callbacks for POS type detection events
let onPOSTypeDetected: ((type: POSType, apduData: number[]) => void) | null = null;

export function setOnPOSTypeDetected(callback: (type: POSType, apduData: number[]) => void): void {
  onPOSTypeDetected = callback;
}

export function clearOnPOSTypeDetected(): void {
  onPOSTypeDetected = null;
}

// Callback for standard POS events (when virtual card is needed)
let onStandardPOSDetected: ((info: { type: POSType; message: string }) => void) | null = null;

export function setOnStandardPOSDetected(
  callback: (info: { type: POSType; message: string }) => void,
): void {
  onStandardPOSDetected = callback;
}

export function clearOnStandardPOSDetected(): void {
  onStandardPOSDetected = null;
}

// Track the last detected AID data for payment method selection
let lastDetectedAID: number[] = [];
let lastDetectedPOSType: POSType = 'unknown';

export function getLastDetectedPOS(): { type: POSType; aid: number[] } {
  return { type: lastDetectedPOSType, aid: lastDetectedAID };
}

export function initializeHCE(): void {
  if (!hceEventEmitter) {
    console.warn('[HSMC Pay] HCE not available — requires Android with NFC HCE support');
    return;
  }

  hceEventEmitter.addListener('onHCERequest', async (request: HCEPaymentRequest) => {
    console.log('[HSMC Pay] HCE Payment Request:', JSON.stringify(request));

    try {
      const response = await processHCERequest(request);
      HCEBridge.sendResponse(JSON.stringify(response));
    } catch (error: any) {
      HCEBridge.sendResponse(
        JSON.stringify({
          approved: false,
          walletAddress: '',
          signedPayload: '',
          declineReason: error.message || 'Unknown error',
          sessionId: request.sessionId,
        }),
      );
    }
  });

  // Listen for raw APDU data from native layer (for POS type detection)
  hceEventEmitter.addListener('onRawAPDU', (event: { apduHex: string }) => {
    try {
      const apduBytes = event.apduHex.match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) || [];
      const posType = detectPOSType(apduBytes);

      lastDetectedAID = apduBytes;
      lastDetectedPOSType = posType;

      console.log(`[HSMC Pay] POS type detected: ${posType}`);

      if (onPOSTypeDetected) {
        onPOSTypeDetected(posType, apduBytes);
      }

      // For standard POS (Visa, MC, EMV), notify that virtual card is needed
      if (posType !== 'hsmc' && posType !== 'unknown') {
        const messages: Record<string, string> = {
          visa: 'This terminal accepts Visa. Use Virtual Card to pay.',
          mastercard: 'This terminal accepts Mastercard. Use Virtual Card to pay.',
          generic_emv: 'This terminal accepts card payments. Use Virtual Card.',
        };

        if (onStandardPOSDetected) {
          onStandardPOSDetected({
            type: posType,
            message: messages[posType] || 'This terminal accepts card payments.',
          });
        }
      }
    } catch (e) {
      console.warn('[HSMC Pay] Error parsing APDU:', e);
    }
  });

  console.log('[HSMC Pay] HCE initialized and listening for NFC taps');
}

export async function processHCERequest(request: HCEPaymentRequest): Promise<HCEPaymentResponse> {
  const walletAddress = await WalletService.getWalletAddress();

  if (!walletAddress) {
    return {
      approved: false,
      walletAddress: '',
      signedPayload: '',
      declineReason: 'No wallet configured. Please set up your wallet first.',
      sessionId: request.sessionId,
    };
  }

  // Parse amount to USD equivalent (token decimals handled by POS)
  const amountUsd = parseFloat(request.amount);
  if (isNaN(amountUsd) || amountUsd <= 0) {
    return {
      approved: false,
      walletAddress,
      signedPayload: '',
      declineReason: 'Invalid payment amount',
      sessionId: request.sessionId,
    };
  }

  // Check budget
  const budgetCheck = await BudgetService.checkBudget(amountUsd);
  if (!budgetCheck.approved) {
    await TransactionStore.addTransaction({
      amount: amountUsd,
      token: request.token,
      merchant: request.merchant || 'POS Terminal',
      date: Date.now(),
      status: 'insufficient',
    });

    return {
      approved: false,
      walletAddress,
      signedPayload: '',
      declineReason: `Budget exceeded. Remaining: $${budgetCheck.remaining.toFixed(2)} of $${budgetCheck.limit.toFixed(2)}`,
      sessionId: request.sessionId,
    };
  }

  // Sign payment
  try {
    const { signature } = await WalletService.signPayment({
      amount: request.amount,
      token: request.token,
      contractAddress: request.contractAddress,
      sessionId: request.sessionId,
    });

    // Record spend
    await BudgetService.recordSpend(amountUsd);
    await TransactionStore.addTransaction({
      amount: amountUsd,
      token: request.token,
      merchant: request.merchant || 'POS Terminal',
      date: Date.now(),
      status: 'approved',
      txId: request.sessionId,
    });

    return {
      approved: true,
      walletAddress,
      signedPayload: signature,
      sessionId: request.sessionId,
    };
  } catch (error: any) {
    await TransactionStore.addTransaction({
      amount: amountUsd,
      token: request.token,
      merchant: request.merchant || 'POS Terminal',
      date: Date.now(),
      status: 'declined',
    });

    return {
      approved: false,
      walletAddress,
      signedPayload: '',
      declineReason: `Signing failed: ${error.message}`,
      sessionId: request.sessionId,
    };
  }
}

export function stopHCE(): void {
  if (hceEventEmitter) {
    hceEventEmitter.removeAllListeners('onHCERequest');
    hceEventEmitter.removeAllListeners('onRawAPDU');
    clearOnPOSTypeDetected();
    clearOnStandardPOSDetected();
    console.log('[HSMC Pay] HCE stopped');
  }
}
