/**
 * NFC Bridge — Desktop NFC support fallback
 *
 * When Web NFC API is not available (desktop browsers),
 * provides instructions and alternatives for NFC payments.
 */

export interface NFCBridgeStatus {
  supported: boolean;
  type: "web-nfc" | "usb-reader" | "qr-fallback" | "none";
  message: string;
}

/**
 * Check if Web NFC is available in the current browser
 */
export function checkNFCWebSupport(): boolean {
  try {
    return "NDEFReader" in window;
  } catch {
    return false;
  }
}

/**
 * Get the current NFC support status
 */
export function getNFCStatus(): NFCBridgeStatus {
  const webSupported = checkNFCWebSupport();

  if (webSupported) {
    return {
      supported: true,
      type: "web-nfc",
      message: "Web NFC is available — tap-to-pay supported on this device.",
    };
  }

  // Check if running on a platform that could support USB NFC
  const isDesktop =
    typeof navigator !== "undefined" &&
    !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isDesktop) {
    return {
      supported: false,
      type: "usb-reader",
      message:
        "Web NFC not available on desktop. Use a USB NFC reader (ACR122U) or scan the QR code instead.",
    };
  }

  return {
    supported: false,
    type: "qr-fallback",
    message: "NFC not available — use QR code payment instead.",
  };
}

/**
 * Write an NDEF message using Web NFC API
 */
export async function writeNFCMessage(
  records: NDEFRecordInit[]
): Promise<{ success: true } | { success: false; error: string }> {
  if (!checkNFCWebSupport()) {
    return {
      success: false,
      error: "Web NFC is not supported in this browser.",
    };
  }

  try {
    const ndef = new (window as any).NDEFReader();
    await ndef.scan();
    await ndef.write({ records });

    // Listen for the next read for a brief moment
    ndef.onreading = () => {
      console.log("[NFC] Tag read successfully");
    };

    ndef.onreadingerror = () => {
      console.warn("[NFC] Tag read error");
    };

    return { success: true };
  } catch (err: any) {
    console.warn("[NFC] Write error:", err);
    return {
      success: false,
      error: err?.message || "Failed to write NFC tag",
    };
  }
}

/**
 * Read an NDEF message from an NFC tag
 */
export async function readNFCMessage(): Promise<
  { success: true; records: NDEFRecord[] } | { success: false; error: string }
> {
  if (!checkNFCWebSupport()) {
    return {
      success: false,
      error: "Web NFC is not supported in this browser.",
    };
  }

  try {
    const ndef = new (window as any).NDEFReader();
    await ndef.scan();

    return new Promise((resolve) => {
      ndef.onreading = ({ message }: { message: NDEFMessage }) => {
        resolve({ success: true, records: message.records });
      };

      ndef.onreadingerror = () => {
        resolve({ success: false, error: "Failed to read NFC tag" });
      };

      // Timeout after 30 seconds
      setTimeout(() => {
        resolve({ success: false, error: "NFC read timeout — no tag detected" });
      }, 30_000);
    });
  } catch (err: any) {
    console.warn("[NFC] Read error:", err);
    return {
      success: false,
      error: err?.message || "Failed to read NFC tag",
    };
  }
}

/**
 * Desktop NFC Reader Bridge Instructions
 * For ACR122U and similar USB NFC readers
 */
export const DESKTOP_NFC_SETUP_GUIDE = {
  title: "Setup USB NFC Reader for Desktop",
  hardware: [
    "ACR122U USB NFC Reader (~$40 on Amazon)",
    "Or: ACS ACR1252U (~$60, newer model)",
  ],
  software: [
    "Install the ACS driver from https://www.acs.com.hk/en/driver/",
    "Use the NFC Tools desktop app for testing",
    "Or: install nfc-py (Python) / nfc-pcsc (Node.js)",
  ],
  steps: [
    "1. Connect the USB NFC reader to your computer",
    "2. Install the driver for your OS",
    "3. Open a WebHID/USB-compatible browser (Chrome/Edge)",
    "4. The POS terminal will detect the reader automatically",
    "5. Customer taps their phone on the reader",
  ],
  note: "Currently, Web NFC is only available on Chrome for Android. Desktop support requires a USB NFC reader with WebUSB or a native bridge app. As a simpler alternative, the QR code payment works on all devices.",
};

// Extend Window type for NDEFReader
declare global {
  interface Window {
    NDEFReader?: any;
  }
}

interface NDEFRecordInit {
  recordType: string;
  data: string;
  mediaType?: string;
}

interface NDEFRecord {
  recordType: string;
  data: DataView;
  mediaType?: string;
}

interface NDEFMessage {
  records: NDEFRecord[];
}
