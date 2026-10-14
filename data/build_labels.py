# Builds public/labels/<xx>.json shards from dawsbot/eth-labels (MIT) plus a short list of major exchange hot wallets.
import csv, collections, json, os
rows = sorted(csv.DictReader(open('accounts.csv', encoding='utf8')), key=lambda r: r['chainId'] != '1')  # every chain; Ethereum wins a tie
EX = set('binance bitfinex bitget bithumb bitmart bitmex bitstamp bittrex blofin-exchange cex-io coinbase crypto-com delta-exchange deribit gate-io gemini kraken kucoin mexc okx poloniex upbit bilaxy huobi htx bybit otc fiat-gateway payments'.split())
EXT = ['binance', 'coinbase', 'kraken', 'okx', 'bybit', 'kucoin', 'huobi', 'htx', 'gate.io', 'gemini', 'bitfinex', 'crypto.com', 'mexc', 'upbit', 'bitstamp', 'bitget']
SWAP = set('dex sushiswap pancakeswap kyberswap paraswap airswap balancer curve-finance curve-fi uniswap 1inch 0x-protocol bancor changenow'.split())


def kind(label, tag):
    l, t = label.lower(), tag.lower()
    if 'tornado' in l or 'mixer' in l or 'tornado' in t: return 'mixer'
    if 'ofac' in l or 'sanction' in l: return 'sanctioned'
    if any(w in l for w in ('exploit', 'hack', 'heist', 'phish', 'scam')) or l == 'blocked' or any(w in t for w in ('fake', 'phish', 'exploiter', 'drainer')): return 'bad'
    if l in EX or any(t.startswith(e) for e in EXT): return 'exchange'
    if 'bridge' in l or l in ('wormhole', 'stargate', 'allbridge', 'debridge', 'layer-2'): return 'bridge'
    if l in SWAP: return 'swap'
    return 'other'


PRI = {'mixer': 6, 'sanctioned': 5, 'bad': 4, 'exchange': 3, 'bridge': 2, 'swap': 1, 'other': 0}
m = {}
for r in rows:
    a = r['address'].lower(); k = kind(r['label'], r['nameTag'])
    if a not in m or PRI[k] > PRI[m[a][0]]: m[a] = [k, (r['nameTag'] or r['label'])[:60]]
MAJOR = {
    '0x28c6c06298d514db089934071355e5743bf21d60': 'Binance 14', '0x21a31ee1afc51d94c2efccaa2092ad1028285549': 'Binance 15',
    '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': 'Binance 16', '0xf977814e90da44bfa03b6295a0616a897441acec': 'Binance 8',
    '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8': 'Binance 7', '0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be': 'Binance 1',
    '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': 'Coinbase 1', '0x503828976d22510aad0201ac7ec88293211d23da': 'Coinbase 2',
    '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43': 'Coinbase 10', '0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0': 'Kraken 4',
    '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b': 'OKX', '0xf89d7b9c864f589bbf53a82105107622b35eaa40': 'Bybit',
    '0x2b5634c42055806a59e9107ed44d43c426e58258': 'KuCoin', '0x876eabf441b2ee5b5b0554fd502a8e0600950cfa': 'Bitfinex',
    '0x0d0707963952f2fba59dd06f2b425ace40b492fe': 'Gate.io',
}
EXTRA = {
    '0xf70da97812cb96acdf810712aa562db8dfa3dbef': ['bridge', 'Relay: Solver'], '0x4cd00e387622c35bddb9b4c962c136462338bc31': ['bridge', 'Relay: Depository'],
    '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae': ['bridge', 'LI.FI: Diamond'], '0xca11bde05977b3631167028862be2a173976ca11': ['other', 'Multicall3'],
}
m.update(EXTRA)
for a, n in MAJOR.items():
    if a not in m or m[a][0] == 'other': m[a] = ['exchange', n]
out = '../public/labels'; os.makedirs(out, exist_ok=True)
sh = collections.defaultdict(dict)
for a, v in m.items(): sh[a[2:4]][a] = v
for k, v in sh.items(): open(f'{out}/{k}.json', 'w', encoding='utf8').write(json.dumps(v, separators=(',', ':'), ensure_ascii=False))
print(len(m), collections.Counter(v[0] for v in m.values()))
