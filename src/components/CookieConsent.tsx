import { useState, useEffect } from "react";

const COOKIE_CONSENT_KEY = "hsmc-cookie-consent";

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!stored) {
      setVisible(true);
    }
  }, []);

  function accept() {
    localStorage.setItem(COOKIE_CONSENT_KEY, "accepted");
    setVisible(false);
  }

  function decline() {
    localStorage.setItem(COOKIE_CONSENT_KEY, "declined");
    setVisible(false);
  }

  if (!mounted || !visible) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 max-w-lg mx-auto">
      <div className="glass-card p-4 border border-[#1a1f2e] shadow-lg">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-[#b0bec5]">
              We use cookies for security and analytics. By continuing, you
              agree to our{" "}
              <a
                href="/privacy"
                className="text-[#00bcd4] hover:text-[#00e676] underline"
              >
                Privacy Policy
              </a>
              .
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={decline}
              className="px-3 py-1.5 rounded border border-[#1a1f2e] text-xs text-[#546e7a] hover:text-[#b0bec5] hover:border-[#546e7a] transition-colors font-mono"
            >
              Decline
            </button>
            <button
              onClick={accept}
              className="px-3 py-1.5 rounded border border-[#00e676]/50 bg-[#00e676]/10 text-xs text-[#00e676] hover:bg-[#00e676]/20 transition-colors font-mono"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
