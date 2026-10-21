// Detection rules shared by the scan (functions/api/scan.js) and the page, which runs the cross-chain ones again
// after it has folded several scans of the same wallet together.

// The key sweep. A thief who holds the private key signs ordinary transactions as the wallet, so "who signed" says nothing.
// What gives it away: several assets (or the same coin on several chains) going to one address the wallet never paid
// before, within hours, at the end of the wallet's activity on each chain. On its own that could be the owner moving to a
// new wallet, so it also needs a second sign: an unknown delegation, the older legacy transaction format the owner does not
// normally use, three or more chains, or three or more assets.
//   tail:   the wallet's outgoing transfers from the last two days of activity on each chain
//           { to, chain, ts, native, priced, asset, value, usd, hash, txType, signer }
//   seen:   { address: unix time this wallet first paid it }, over everything read
//   lastOn: { chain: unix time of the wallet's last outgoing transfer there }
export function findKeySweep({ tail, self, seen, lastOn, strangeCount, legacyShare }) {
  const own = tail.filter(x => x.ts && x.to !== self && (x.native || x.priced) && (!x.signer || x.signer === self) && x.ts >= (lastOn[x.chain] || 0) - 2 * 86400);
  const by = {};
  own.forEach(x => (by[x.to] = by[x.to] || []).push(x));
  const found = [];
  for (const to in by) {
    const l = by[to].sort((a, b) => a.ts - b.ts);
    const win = l.filter(x => x.ts <= l[0].ts + 12 * 3600);
    const chains = [...new Set(win.map(x => x.chain))], units = new Set(win.map(x => x.chain + ":" + x.asset)).size;
    if (units < 2) continue;
    if (seen[to] && seen[to] < l[0].ts - 86400) continue; // a regular counterparty, not a new address
    const legacy = win.some(x => x.txType === 0) && legacyShare < 0.5;
    if (!strangeCount && !legacy && chains.length < 3 && units < 3) continue;
    found.push({
      address: to, chains, count: win.length, units, usd: Math.round(win.reduce((a, x) => a + (x.usd || 0), 0) * 100) / 100, first: l[0].ts, last: win[win.length - 1].ts, legacy,
      items: win.map(x => ({ h: x.hash, ts: x.ts, c: x.chain, a: x.asset, v: x.value, u: Math.round((x.usd || 0) * 100) / 100, t: x.txType })),
    });
  }
  return found.sort((a, b) => b.chains.length - a.chains.length || b.units - a.units);
}

// The drain methods the scan checks, in the order a victim would recognise them. The page shows every one, found or not.
export const METHODS = [
  { id: "sweeper", name: "Sweeper bot", how: "The attacker's own address pulls funds out of the wallet, often within seconds of anything arriving." },
  { id: "keysweep", name: "Emptied with the stolen key", how: "The thief signs ordinary transactions as the wallet and sends everything to a new address, often on several chains at once." },
  { id: "delegation", name: "Malicious EIP-7702 delegation", how: "The wallet was set to run a contract nobody recognises. That contract can move anything the wallet holds." },
  { id: "pull", name: "Taken by someone else's transaction", how: "Tokens left in a transaction another address sent: through an approval, a permit, Permit2, setApprovalForAll, or a malicious delegate." },
  { id: "burst", name: "Drainer burst", how: "Several different assets left for one address within an hour, the shape of a drainer kit." },
  { id: "poisonloss", name: "Sent to a poisoned look-alike", how: "Real money went to a fake address planted in the history to look like one the owner uses." },
  { id: "poisoning", name: "Address poisoning attempts", how: "Fake transfers planted look-alike addresses in the history. Harmless until someone copies one." },
  { id: "approvals", name: "Dangerous permissions still open", how: "A contract flagged as malicious, or an unknown one, can still spend tokens from this wallet." },
  { id: "flagged", name: "Paid a flagged address", how: "The wallet sent funds to an address publicly labelled as a scam, phisher, mixer or sanctioned." },
];

if (typeof window !== "undefined") window.DETECT = { findKeySweep, METHODS };
