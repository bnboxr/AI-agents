import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
});

function TermsPage() {
  const today = new Date().toISOString().split("T")[0];
  return (
    <div className="min-h-dvh bg-[#080a0f] pt-20 pb-12">
      <div className="mx-auto max-w-3xl px-6">
        <div className="glass-card p-8 sm:p-12">
          <div className="flex items-center gap-3 mb-8">
            <span className="text-2xl font-black text-[#00e676] font-mono">{">"}</span>
            <h1 className="text-3xl font-bold text-[#e0e6ed] font-mono">TERMS OF SERVICE</h1>
          </div>
          <p className="text-[#546e7a] text-sm font-mono mb-8">Last updated: {today}</p>
          <div className="space-y-8 text-[#b0bec5] text-sm leading-relaxed">
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">1. ACCEPTANCE OF TERMS</h2>
              <p>By accessing or using the HSMC platform, you agree to be bound by these Terms of Service. If you do not agree, discontinue use immediately.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">2. PLATFORM DESCRIPTION</h2>
              <p>HSMC is a decentralized finance (DeFi) platform providing automated trading, yield optimization, cryptocurrency payment processing, and related financial tools using AI agents for autonomous operation.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">3. RISK DISCLOSURE</h2>
              <p className="mb-2">Cryptocurrency trading and DeFi activities involve substantial risk of loss:</p>
              <ul className="list-disc pl-6 space-y-1 text-[#546e7a]">
                <li>Past performance does not guarantee future results.</li>
                <li>Digital assets are highly volatile and may lose all value.</li>
                <li>Smart contracts may contain bugs or vulnerabilities.</li>
                <li>Regulatory changes may affect the legality or value of digital assets.</li>
                <li>You are solely responsible for your trading decisions.</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">4. NO FINANCIAL ADVICE</h2>
              <p>Nothing on this platform constitutes financial, investment, legal, or tax advice. Consult a qualified professional before making financial decisions.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">5. USER OBLIGATIONS</h2>
              <ul className="list-disc pl-6 space-y-1 text-[#546e7a]">
                <li>Provide accurate information when using the platform.</li>
                <li>Maintain the security of your wallet and private keys.</li>
                <li>Comply with all applicable laws and regulations.</li>
                <li>Not use the platform for illegal activities, money laundering, or sanctions evasion.</li>
                <li>Be at least 18 years of age.</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">6. INTELLECTUAL PROPERTY</h2>
              <p>All code, designs, algorithms, and content on the platform are protected by intellectual property laws.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">7. LIMITATION OF LIABILITY</h2>
              <p>HSMC and its operators shall not be liable for any direct, indirect, incidental, or consequential damages arising from your use of the platform.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">8. TERMINATION</h2>
              <p>We reserve the right to suspend or terminate access at any time without prior notice.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">9. CHANGES TO TERMS</h2>
              <p>We may modify these terms at any time. Continued use constitutes acceptance.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-[#00bcd4] font-mono mb-3">10. CONTACT</h2>
              <p>For questions, contact us through the platform support channels.</p>
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
