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

let onPaymentCallback: ((request: HCEPaymentRequest) => Promise<HCEPaymentResponse>) | null = null;

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
        })
      );
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
    console.log('[HSMC Pay] HCE stopped');
  }
}
