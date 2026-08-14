# Bahia — audit produit et architecture cible

Date : 14 août 2026

## Conclusion exécutive

Bahia ne doit pas être construit comme un « bot IA qui devine le marché ». Le produit crédible est un **laboratoire de décision et d'exécution à risque borné** : il observe plusieurs marchés, détecte des régimes et opportunités, explique ses conclusions, puis transmet uniquement des intentions validées à un moteur déterministe.

La première version financièrement raisonnable doit cibler **OKX Spot + OKX Demo**, BTC/USDT et ETH/USDT, sans levier. Le DEX et l'arbitrage multi-exchange viennent ensuite. Avec 100 USDT, les frais, spreads, montants minimaux, gas et capital fragmenté rendent l'arbitrage cross-exchange rarement pertinent.

Il est impossible de garantir un produit « gagnant ». Le contrat produit réaliste est : exécution correcte, pertes bornées, mesures honnêtes, explicabilité, reprise après incident et passage progressif paper → demo → réel.

## Audit du dépôt actuel

État observé au 14 août 2026 :

- PWA Next.js 16 et React 19, responsive desktop/mobile, déployée sur Vercel.
- Cotations et bougies publiques OKX pour BTC, ETH et SOL via des Route Handlers serveur.
- Paper trading local avec frais, glissement, stops, objectifs, journal, export CSV et sauvegarde JSON.
- Moteur de risque déterministe testé : sizing par le stop, plafonds d'exposition, réserve, perte quotidienne, drawdown et kill switch.
- Analyse descriptive : SMA 20/50, RSI 14, ATR, volatilité annualisée, régime et score de risque.
- Statistiques : profit factor, espérance, payoff, séries, drawdown réalisé, durée, ventilation par actif et qualité d'échantillon.
- Connecteur OKX Demo côté serveur prêt, mais non configuré en production.

Limites restantes : pas de compte utilisateur, pas de stockage PostgreSQL, pas de worker 24/7, pas de flux privé, pas de réconciliation d'ordres et aucune autorisation de trading réel. La version publiée est donc **complète pour apprendre et simuler**, pas pour confier de vrais fonds.

## Ce que font les références sérieuses

### Produits commerciaux

| Produit / famille | Points forts à reprendre | Limites à éviter |
|---|---|---|
| Pionex | Grid, DCA, rebalancing, spot-futures, presets simples, mobile | Marketing de performance, stratégies faciles à mal paramétrer |
| 3Commas / Cryptohopper / Bitsgap | Smart orders, multi-exchange, paper trading, marketplace de signaux | Complexité, abonnements, dépendance aux API tierces |
| Terminaux avancés | Ordres conditionnels, alertes, portefeuille consolidé | Interface intimidante pour un débutant |

### Benchmark UX actualisé

- **3Commas** utilise un parcours de démarrage progressif, des cartes de stratégies avec dépôt minimum, APY/backtest et drawdown, ainsi qu'un guide débutant. Bahia reprend le stepper et la comparaison, mais remplace l'APY promotionnel par un score d'éléments non prédictif et un avertissement d'échantillon.
- **Coinrule** rend l'automatisation accessible avec une logique « si ceci, alors cela » et des modèles sans code. Bahia conserve des choix exprimés par intention — observer, fractionner, rééquilibrer — avant d'exposer le jargon.
- **Cryptohopper** associe paper trading, backtests, constructeur de stratégies et déclencheurs. Bahia reprend la séquence construire → tester → activer, avec des limites de risque visibles avant l'action.
- **Pionex / OKX** rendent Grid, DCA et Smart Portfolio très accessibles. Bahia ajoute une contrainte : une Grid est refusée hors range et l'arbitrage reste verrouillé sans deuxième plateforme, capital prépositionné et calcul des coûts.

Sources officielles consultées le 14 août 2026 : [interface 3Commas](https://help.3commas.io/en/articles/3108945-dashboard-the-3commas-user-interface), [présentation Coinrule](https://help.coinrule.com/articles/711711-what-is-coinrule), [fonctionnalités Cryptohopper](https://www.cryptohopper.com/features/all-features/strategies), [paper trading Cryptohopper](https://www.cryptohopper.com/features/paper-trading), [bots OKX](https://www.okx.com/en-us/help/what-are-okx-eeas-crypto-trading-bots-and-how-do-i-utilize-them), [Spot Grid OKX](https://www.okx.com/en-us/help/spot-grid-bot-faq).

La meilleure idée produit de Pionex est l'association « régime de marché → stratégie adaptée » : grid en marché latéral, tendance quand le marché est directionnel, rebalancing pour un portefeuille long terme. Un grid n'est pas un arbitrage sans risque : il peut accumuler un actif qui baisse et sous-performer un simple achat en forte hausse.

### Briques open source

| Projet | Utilité pour Bahia | Décision |
|---|---|---|
| Freqtrade | Backtest, dry-run, hyperopt, protections, détection du lookahead | Référence principale pour la validation des stratégies |
| Hummingbot | Connecteurs CEX/DEX, market making et contrôleur d'arbitrage | Référence pour connecteurs, DEX et arbitrage futur |
| CCXT | API unifiée pour plus de 100 exchanges, données et ordres | Adaptateur multi-CEX secondaire ; OKX natif pour les fonctions critiques |
| Jesse | Backtests, Monte Carlo, recherche et comparaison | Référence pour tests de robustesse et UX recherche |

Ne pas forker entièrement ces projets. Bahia doit encapsuler des briques éprouvées derrière ses propres interfaces (`MarketData`, `ExecutionVenue`, `Strategy`, `RiskEngine`) pour éviter un verrouillage technique.

Sources : [Freqtrade — stratégie et dry-run](https://www.freqtrade.io/en/stable/strategy-101/), [Freqtrade — lookahead analysis](https://www.freqtrade.io/en/stable/lookahead-analysis/), [Hummingbot — connecteurs DEX](https://hummingbot.org/gateway/connectors/), [CCXT — manuel](https://github.com/ccxt/ccxt/wiki/manual), [Jesse — Monte Carlo](https://docs.jesse.trade/docs/monte-carlo/).

## Les stratégies à proposer

### Niveau 1 — approprié avec 100 USDT

1. **Observation / alertes** : aucun ordre, opportunités expliquées.
2. **DCA adaptatif** : achats périodiques, ralentis si volatilité extrême.
3. **Rebalancing** : maintien d'une allocation BTC/ETH/USDT, avec seuil minimal supérieur aux frais.
4. **Grid spot prudent** : uniquement en régime latéral, plage et stop global obligatoires.
5. **Tendance spot** : entrée après confirmation, stop et taille calculés par le risque.

### Niveau 2 — après validation

6. **Arbitrage triangulaire sur un même exchange** : évite les transferts inter-exchanges mais exige des carnets temps réel et trois exécutions quasi atomiques.
7. **Cash-and-carry / spot–futures** : delta neutre en théorie, mais soumis au funding, à la marge, à l'ADL et au risque de liquidation.
8. **Arbitrage cross-exchange** : capital prépositionné sur chaque plateforme, rééquilibrage et inventaire nécessaires.

### Niveau 3 — DEX

9. **Meilleure route de swap** via un agrégateur, pas via un routeur maison. 1inch peut répartir un swap entre plusieurs sources de liquidité et chaînes.
10. **Arbitrage DEX/CEX** seulement avec simulation de transaction, gas, MEV, slippage, finalité et échec de transaction.
11. **Fourniture de liquidité concentrée** comme produit séparé, avec risque de perte impermanente clairement affiché.

Source : [1inch Classic Swap / Pathfinder](https://business.1inch.com/portal/documentation/apis/swap/classic-swap/introduction), [Hummingbot Gateway](https://hummingbot.org/gateway/connectors/).

## Architecture recommandée

```text
PWA Next.js (desktop + mobile)
        |
API Gateway + Auth + rate limits
        |
Portfolio / Strategy / Opportunity services
        |
Risk Engine ----> Policy & Kill Switch
        |
Order Manager ----> idempotency / state machine / reconciliation
        |
OKX native connector | CCXT adapters | Hummingbot Gateway DEX
        |
PostgreSQL + Redis/queue + immutable audit log
        |
Worker 24/7 + WebSockets + monitoring + alerting
```

### Séparation obligatoire

- **IA** : résume, classe, explique, propose un scénario et signale l'incertitude.
- **Stratégies** : produisent des intentions structurées et reproductibles.
- **Risk Engine** : accepte, réduit ou refuse chaque intention.
- **Order Manager** : exécute avec identifiant idempotent, suit les fills et réconcilie l'exchange.
- **Clés API** : uniquement côté serveur, chiffrées, permission `Trade` sans `Withdraw`, idéalement sous-compte et IP autorisées.

L'IA ne doit jamais signer une transaction, contourner le Risk Engine ou modifier ses limites en production.

## Moteur d'opportunités « vivant »

Chaque opportunité doit être un objet explicable :

```json
{
  "venue": "OKX",
  "instrument": "BTC-USDT",
  "strategy": "rebalance",
  "regime": "range",
  "expected_edge_bps": 34,
  "all_costs_bps": 18,
  "confidence": 0.61,
  "max_loss_usdt": 0.50,
  "expires_at": "...",
  "evidence": ["volatilité", "spread", "profondeur"],
  "rejection_reasons": []
}
```

Une proposition est masquée si l'avantage attendu net est inférieur aux coûts et à une marge de sécurité. Le score ne doit jamais être présenté comme une probabilité de gain sans calibration statistique.

## Backtests et validation

Une stratégie ne peut passer au réel qu'après :

1. données historiques versionnées et contrôle des trous ;
2. frais réels, spread, slippage et délais simulés ;
3. test anti-lookahead et anti-surapprentissage ;
4. train / validation / test chronologique ;
5. walk-forward sur plusieurs régimes ;
6. Monte Carlo et stress tests ;
7. comparaison à buy-and-hold et à une stratégie nulle ;
8. plusieurs semaines de forward-test ;
9. OKX Demo avec reconnexions et fills réels simulés par l'exchange ;
10. réel avec très petit capital, spot uniquement, limites strictes.

L'API officielle OKX fournit REST, WebSockets publics/privés et un environnement Demo. Certaines fonctions comme retraits et dépôts ne sont pas disponibles en Demo : [documentation OKX API v5](https://www.okx.com/docs-v5/).

## Risque adapté à 100 USDT

- Spot uniquement au départ ; aucun levier.
- Perte maximale par décision : 0,25 à 0,50 USDT.
- Perte quotidienne maximale : 1 USDT.
- Exposition crypto maximale débutant : 20 à 30 USDT.
- Réserve USDT : au moins 50 %.
- Un seul bot actif et une ou deux positions maximum.
- Pas de trade si le coût total estimé dépasse 25 à 35 % de l'edge attendu.
- Kill switch sur données périmées, divergence de solde, erreur de réconciliation ou volatilité extrême.

Ces valeurs sont des limites de lancement prudentes à tester, pas une recommandation personnalisée.

## Expérience débutant et direction visuelle

Le design doit rester futuriste mais calme : surfaces sombres ou claires très simples, grands espacements, une couleur d'accent, typographie nette, aucune pluie de néons.

Mode débutant :

- une action principale par écran ;
- traduction de chaque terme (« rebalancing = remettre le portefeuille dans ses proportions ») ;
- montant maximal perdu affiché avant le rendement potentiel ;
- aperçu avant confirmation ;
- explication de chaque refus ;
- comparaison « ne rien faire » ;
- score d'incertitude et fraîcheur des données ;
- PWA installable avec navigation mobile native-like.

## Conformité produit

Une application purement personnelle qui commande le propre compte de son utilisateur n'a pas le même périmètre qu'un service proposé au public. Dès que Bahia fournit professionnellement du conseil personnalisé, de la gestion de portefeuille ou exécute/transmet des ordres pour des clients, le cadre MiCA/PSCA doit être analysé avant lancement.

Depuis le 1er juillet 2026, l'AMF indique qu'un acteur fournissant ces services en France doit disposer du statut approprié. La conception doit donc privilégier au départ un **outil non custodial, contrôlé par l'utilisateur**, avec partenariats auprès de plateformes autorisées et validation juridique avant commercialisation.

Sources : [AMF — professionnel crypto et PSCA](https://www.amf-france.org/fr/espace-epargnants/proteger-son-epargne/crypto-actifs-bitcoin-etc/investir-en-crypto-monnaies-quel-professionnel-choisir), [AMF — MiCA](https://www.amf-france.org/fr/actualites-publications/dossiers-thematiques/mica), [OKX autorisé en France](https://www.amf-france.org/fr/espace-epargnants/proteger-son-epargne/listes-blanches/psanpsca/okcoin-europe-limited).

## Décision produit recommandée

### Bahia V1

- PWA desktop/mobile.
- Compte utilisateur et portefeuille fictif durable.
- Données OKX temps réel.
- Détecteur de régime : tendance, range, stress.
- DCA, rebalancing, grid spot prudent, tendance spot.
- Backtest et forward-test reproductibles.
- Coach IA explicatif, jamais exécuteur.
- OKX Demo avec moteur d'ordres complet.

### Bahia V1.5

- OKX réel spot, petit capital et activation progressive.
- Alertes, rapports, fiscalité exportable.
- Multi-utilisateur et observabilité renforcée.

### Bahia V2

- CCXT pour autres CEX autorisés.
- Arbitrage triangulaire et spot–futures après validation.
- DEX via Hummingbot Gateway / agrégateurs.

## Prochaine étape avant développement

1. Valider ce périmètre V1.
2. Initialiser un dépôt Git propre et archiver le prototype.
3. Repartir sur une architecture monorepo avec contrats typés.
4. Écrire les tests du Risk Engine et de l'Order Manager avant l'interface.
5. Construire ensuite la PWA et brancher OKX Demo.

Ne pas pousser le prototype actuel comme base « finale » : il est incomplet et l'interface V2 ne possède pas son moteur JavaScript.
