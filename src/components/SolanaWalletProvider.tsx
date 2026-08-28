import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { CoinbaseWalletAdapter } from "@solana/wallet-adapter-coinbase";
import "@solana/wallet-adapter-react-ui/styles.css";

// Use Solana devnet for now, mainnet in production
const SOLANA_RPC = typeof process !== "undefined" && process.env.SOLANA_RPC_URL
  ? process.env.SOLANA_RPC_URL
  : "https://api.devnet.solana.com";

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    new CoinbaseWalletAdapter(),
  ], []);

  return (
    <ConnectionProvider endpoint={SOLANA_RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function SolanaConnectButton() {
  return <WalletMultiButton className="solana-wallet-button" />;
}
