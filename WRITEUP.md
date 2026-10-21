# LastSeenIMD — One-Page Write-Up

**Live:** https://lastseen-4pu.pages.dev · **Film:** [docs/launch.mp4](docs/launch.mp4) · **Contract:** [contracts/](contracts/)

## The problem

In 2025, 80,000 people had a personal crypto wallet emptied, and $713 million was taken that way (Chainalysis). Drainer victims lost about $790 each (Scam Sniffer). The best-known investigator only takes cases above $250,000. Everyone else gets a block explorer they cannot read and a "recovery" scammer in their DMs.

## What we built

A free, beginner-first case file for any wallet. Paste an address and LastSeenIMD:

- checks **28 EVM chains and Solana** for activity, and reads every chain the wallet has used in full;
- finds the fingerprints of a **stolen key** — funds leaving in transactions someone else signed, EIP-7702 takeovers, delegations to unknown contracts — plus **address poisoning** and **drain bursts**;
- **follows the money** two hops out, labels 104,212 known addresses, and spots **exchange deposit addresses**;
- explains everything as **text messages in plain words**, with an objectives checklist, 20+ charts, a GLM 5.3 analyst note, a SubQ second opinion, AI contract audits, and X posts that mention the address;
- lets the owner connect a wallet (Privy) to **revoke** permissions.

The look is a *Fears to Fathom*-style horror game: a PS1-rendered night scene, VHS tape, a scored soundtrack, because losing your savings feels exactly like that.

## Where the IMD swarm comes in

**The swarm is the judge.** `LastSeenRegistry` (Robinhood Chain) turns a case into one yes/no question the IdentityMD agents answer from chain data. The contract pays 0.5 IMD from a shared pool, so victims pay nothing. Only an EIP-712 answer that at least 4 of 5 agents signed puts the attacker on a public **do-not-send list** any wallet can read for free.

**Victims hire hunters.** A victim posts an IMD reward and prepays the swarm's fee for a number of checks. Hunters bring leads from any wallet, with no name: an on-chain hop, or a public page tying the thief to an account. The swarm judges each lead; a confirmed one pays the hunter a quarter of the reward, and a wrong one's 0.5 IMD stake pays for its own check. Whistleblowers send **private tips sealed in their browser** to the victim's key; the server stores only ciphertext.

**Anyone can hire the swarm to audit a contract** (1 IMD, half of it refilling the victims' pool), or get a free AI audit of pasted Solidity.

20 Foundry tests pass with IMD's 200,000-gas callback. Every question the contract asks passed IdentityMD's `/requests/check` with no wording blockers.

## Proof it works

A real compromised wallet (the author's own) scored **0/100** on the first Ethereum-only version and **97/100** after the rebuild. The sweeper was found taking funds with its own transactions on **5 chains**, one of them an EIP-7702 transaction only the stolen key could sign. The wallet is delegated to a different unknown contract on each of 5 chains, and 18 address-poisoning attempts sit in its history. Vitalik's wallet and a Binance hot wallet are not flagged.

## Honest limits

Recent history only (300–500 transfers per chain, signer check on the latest 40 outgoing transactions). Today's prices. Labels are incomplete. Nothing is traceable inside an exchange. The registry is written and tested but not yet launched, so no real swarm verdict, hunt or swarm audit has run; the free AI audit and sealed tips work today. Wallet connect and revoke are untested with a real wallet. It never recovers funds, and says so.

## Stack

Cloudflare Pages + Functions + Workers AI (GLM 5.3) · SubQ · Alchemy · Three.js · ECharts · Web Audio · Privy · Solidity + Foundry · IdentityMD oracle · Blender + HyperFrames for the film.
