# Bahia Trading Lab

PWA de trading fictif guidé, alimentée par les données publiques OKX. Cette version ne transmet aucun ordre réel.

## Fonctions actives

- interface responsive desktop/mobile et installation PWA ;
- mode débutant activé par défaut ;
- prix et bougies publiques OKX pour BTC, ETH et SOL ;
- moteur de risque déterministe et testé ;
- sizing par perte maximale et distance au stop ;
- réserve de liquidités, plafonds d'exposition, drawdown et kill switch ;
- opportunités DCA, rééquilibrage, grid et tendance expliquées ;
- paper trading avec stop, take profit, frais et glissement ;
- backtest rapide avec comparaison buy-and-hold ;
- journal et résultats locaux.

## État des connexions

- OKX public : actif ;
- portefeuille fictif : local au navigateur ;
- OKX Demo : client serveur préparé, clés non configurées ;
- worker 24/7 / PostgreSQL : non connecté ;
- argent réel : explicitement désactivé.

## Développement

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

Copier `.env.example` vers `.env.local` uniquement lorsque les services correspondants sont provisionnés. Ne jamais utiliser de préfixe `NEXT_PUBLIC_` pour une clé d'exchange.

L'étude produit complète se trouve dans [PRODUCT_RESEARCH.md](./PRODUCT_RESEARCH.md).
