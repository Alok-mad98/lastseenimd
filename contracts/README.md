# LastSeenRegistry

A public "do not send" list for crypto wallets, where every entry is checked and signed by the IdentityMD agent swarm.

LastSeenIMD (https://lastseen-4pu.pages.dev) finds stolen keys, sweepers and drains. This contract turns what it finds into something other apps can trust: an on-chain verdict signed by a panel of agents, not by us.

## How it works

1. **Open a case** (free). Anyone says: "address S has been taking funds out of wallet W on chain C, between blocks A and B."
2. **Ask for a verdict.** The contract pays 0.5 IMD to IdentityMD's Intake and asks one yes/no question that the agents answer from chain data. The fee comes from a shared pool when it has funds, so victims pay nothing. At least 4 of 5 agents must agree, and the answer comes back signed (EIP-712, domain "IdentityMD Oracle" v2).
3. **Only a signed "yes" counts.** It puts S on `flagged` and W on `compromised`. Any wallet, app or exchange can read both for free before sending funds.
4. **Follow the money, with a bounty.** A confirmed case can carry an IMD bounty. Hunters submit leads one hop at a time ("S sent funds to L"). The swarm checks each lead the same way, and a confirmed lead pays the hunter a quarter of what is left. The next hunter can start from L. Each lead costs the hunter 0.5 IMD, which keeps guesses expensive.

## Safety checks in the contract

- The callback is accepted only from the Intake, only for a request this contract made, only once, and only with a signature from the oracle's attester made for this contract and this chain.
- A panel below the configured size, a vote below quorum, an expired answer or a non-yes/no answer is rejected.
- Cases can only name chains the oracle reads: Ethereum, BNB Chain, Robinhood Chain, Base and Arbitrum. A question about any other chain would be refused after payment, so it is refused before.
- The owner can update the oracle settings (IdentityMD versions them), but cannot change the token while the contract holds any, and has no way to withdraw the pool or bounties.

## Tests

```bash
forge test
```

13 tests cover the full flow against a mock Intake: confirmed and rejected verdicts, forged signatures, signatures made for another contract, panels below quorum, calls not from the Intake, replays, the free pool, the hop-by-hop bounty, and that the callback selector is `0x510379c7` as IdentityMD's docs specify.

The verdict question the contract builds was run through IdentityMD's free `POST /requests/check` on 14 Oct 2026: no blockers.

## Oracle settings (Robinhood Chain, read from https://api.imd.fun/requests/capabilities on 14 Oct 2026)

| Setting | Value |
|---|---|
| Intake | `0xa43e6F75ee006411F79Ac1C84120606C2330DE82` |
| Action | `oracle.request@oracle-1` (`0x6f7261636c652e72657175657374406f7261636c652d31000000000000000000`) |
| IMD | `0x5F7Bb59365ce557C26dbcAa4EE9d39A4b95B7127` |
| Price | `500000000000000000` (0.5 IMD) |
| Attester | `0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982` |

Re-read them before launching; IdentityMD can change them.
