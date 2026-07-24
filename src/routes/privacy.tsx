import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  const today = new Date().toISOString().split("T")[0];
  return (
    <div className="min-h-dvh bg-[#080a0f] pt-20 pb-12">
      <div className="mx-auto max-w-3xl px-6">
        <div className="glass-card p-8 sm:p-12">
          <div className="flex items-center gap-3 mb-8">
            <span className="text-2xl font-black text-[#00e676] font-mono">{">"}</span>
            <h1 className="text-3xl font-bold text-[#e0e6ed] font-mono">PRIVACY POLICY</h1>
          </div>
          <p className="text-[#546e7a] text-sm font-mono mb-8">Last updated: {today}</p>
          <div className="space-y-8 text-[#b0bec5] text-sm leading-relaxed">
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">1. INTRODUCTION</h2>
              <p>This Privacy Policy explains how HSMC collects, uses, and protects your personal data. We are committed to GDPR compliance.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">2. DATA WE COLLECT</h2>
              <ul className="list-disc pl-6 space-y-1 text-[#546e7a]">
                <li><strong className="text-[#b0bec5]">Wallet addresses</strong> — Public blockchain addresses you connect.</li>
                <li><strong className="text-[#b0bec5]">Transaction metadata</strong> — On-chain transaction hashes and timestamps.</li>
                <li><strong className="text-[#b0bec5]">Technical data</strong> — IP address, browser type, device information.</li>
                <li><strong className="text-[#b0bec5]">Usage data</strong> — Pages visited, features used, session duration.</li>
                <li><strong className="text-[#b0bec5]">Cookies</strong> — Session tokens, preferences, analytics identifiers.</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">3. HOW WE USE YOUR DATA</h2>
              <ul className="list-disc pl-6 space-y-1 text-[#546e7a]">
                <li>Provide and maintain platform functionality.</li>
                <li>Process transactions and settlement.</li>
                <li>Improve platform performance and security.</li>
                <li>Comply with legal obligations.</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">4. DATA STORAGE & SECURITY</h2>
              <p>We implement industry-standard encryption (AES-256-GCM) for sensitive data at rest and TLS 1.3 for data in transit. Wallet private keys are stored encrypted.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">5. YOUR GDPR RIGHTS</h2>
              <ul className="list-disc pl-6 space-y-1 text-[#546e7a]">
                <li>Right to access, rectification, erasure, restrict processing, data portability, object, and withdraw consent.</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">6. COOKIE POLICY</h2>
              <p>We use essential cookies for security and session management. Optional analytics cookies help us improve the platform.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">7. THIRD-PARTY SERVICES</h2>
              <p>We integrate with blockchain networks, DEX protocols, and market data providers. We do not share personal data with third parties for marketing.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">8. CONTACT & DPO</h2>
              <p>For privacy-related inquiries, contact us through platform support channels.</p>
            </section>
          </div>
          <div className="mt-10 pt-6 border-t border-[#1a1f2e]">
            <Link to="/" className="text-[#00e676] hover:text-[#00bcd4] font-mono text-sm transition-colors">← Back to Home</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
