// Wallet connection through Privy. This is the only React on the page: a small island that renders the connect controls.
// Looking at a wallet never needs this. Connecting is for what only the owner can do: revoking a permission, opening a case.
// Built into public/privy.bundle.js with `npm run build` in this folder.
import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy, useWallets, useLogin } from "@privy-io/react-auth";

const short = a => a.slice(0, 6) + "…" + a.slice(-4);

function Connect() {
  const { ready, authenticated, logout, connectWallet } = usePrivy();
  const { wallets } = useWallets();
  const [msg, setMsg] = React.useState("");
  const { login } = useLogin({ onError: e => setMsg(e === "exited_auth_flow" ? "" : "Sign-in did not finish: " + String(e).replace(/_/g, " ")) });
  // an outside wallet (MetaMask, Rabby…) is preferred over one Privy made
  const wallet = wallets.find(w => w.walletClientType !== "privy") || wallets[0] || null;
  const address = wallet ? wallet.address : null;

  React.useEffect(() => {
    // the rest of the page is plain JavaScript; this is how it learns who is connected and how it sends a transaction
    window.LS_WALLET = wallet ? {
      address: wallet.address.toLowerCase(), signedIn: authenticated,
      async send(chainId, tx) {
        await wallet.switchChain(chainId);
        const p = await wallet.getEthereumProvider();
        return p.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, ...tx }] });
      },
      // a free signature; the bounty page turns it into the key that opens private tips
      async sign(message) {
        const p = await wallet.getEthereumProvider();
        return p.request({ method: "personal_sign", params: [message, wallet.address] });
      },
    } : null;
    document.dispatchEvent(new CustomEvent("ls-wallet", { detail: { address: wallet ? wallet.address.toLowerCase() : null, fresh: true } }));
  }, [address, authenticated]);

  const signIn = async () => {
    setMsg("Check your wallet: it is asking you to sign a message. Signing is free and moves nothing.");
    try { await wallet.loginOrLink(); setMsg(""); } catch (e) { setMsg("The signature was not completed. Open your wallet and try again."); }
  };

  if (!ready) return <button className="ghost" disabled>WALLET…</button>;
  return <>
    {!address && <button className="ghost" type="button" onClick={() => { setMsg(""); connectWallet(); }}>CONNECT WALLET</button>}
    {address && <button className="ghost" type="button" onClick={() => window.LS && window.LS.run(address)}>SCAN {short(address)}</button>}
    {address && !authenticated && <button className="ghost" type="button" onClick={signIn}>SIGN IN</button>}
    {!address && !authenticated && <button className="ghost" type="button" onClick={() => { setMsg(""); login(); }}>EMAIL</button>}
    {(address || authenticated) && <button className="ghost" type="button" onClick={async () => { try { if (authenticated) await logout(); wallets.forEach(w => w.disconnect && w.disconnect()); } catch (e) { /* some wallets cannot be disconnected from the page */ } setMsg(address && !authenticated ? "To disconnect fully, do it from inside your wallet." : ""); }}>DISCONNECT</button>}
    {msg && <span className="pmsg" role="status">{msg}</span>}
  </>;
}

const el = document.getElementById("privy");
if (el && window.PRIVY_APP_ID) {
  createRoot(el).render(
    <PrivyProvider appId={window.PRIVY_APP_ID} config={{ loginMethods: ["wallet", "email"], appearance: { theme: "dark", accentColor: "#e9d37c", walletChainType: "ethereum-only", showWalletLoginFirst: true }, embeddedWallets: { ethereum: { createOnLogin: "off" } } }}>
      <Connect />
    </PrivyProvider>);
}
