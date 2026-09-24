# Finance

Budget et patrimoine personnels, en français, avec interface « Midnight Glass » (noir graphite, verre fumé, bleu glacier) adaptée à l’iPhone, à l’iPad et à l’ordinateur.

**Reprise Claude / Codex : [DEMARRER_CLAUDE.md](DEMARRER_CLAUDE.md).** Le skill maître est [.claude/skills/finance/SKILL.md](.claude/skills/finance/SKILL.md), accompagné de onze missions spécialisées. L’état de livraison vérifié est dans [docs/STATUS.md](docs/STATUS.md). La tranche compacte avec page Abonnements, tri, icônes et nouveau logo est définie dans [docs/PLAN_AMELIORATION_V2.md](docs/PLAN_AMELIORATION_V2.md).

## Démarrer

Node 24 et pnpm 11.19.0.

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

Ouvrir l’adresse locale affichée. Créer un coffre avec une phrase secrète de 12 caractères minimum, ou choisir **Voir la démonstration** (données fictives séparées). Le coffre exige HTTPS en hébergement, ou localhost en développement.

## Données personnelles

Dans **Documents et réglages**, importer le fichier Finance JSON privé préparé séparément, vérifier l’aperçu et confirmer. Les éléments incomplets restent à vérifier ; les dates de capture ne deviennent pas des dates de solde. Les données et documents ne sont jamais intégrés au code ou aux captures du dépôt.

Le coffre est chiffré sur le navigateur. Exporter une **sauvegarde chiffrée** pour la conserver ou la transférer à un autre appareil ; à l’ouverture de Finance, choisir **Restaurer une sauvegarde** et saisir la même phrase secrète. L’export JSON est en clair et doit rester dans un emplacement privé. Il n’y a pas de récupération de phrase secrète.

Cette version conserve les données sur chaque appareil. Elle ne propose pas encore de synchronisation bancaire ou cloud. Les soldes sont des observations datées : enregistrer un paiement n’invente pas un nouveau solde bancaire. Les règles exactes sont documentées et testées.

## Vérifier et construire

```sh
pnpm run typecheck
pnpm run test
pnpm run build
pnpm exec playwright install chromium
pnpm run test:e2e
```

Le build `dist/` contient uniquement l’application et sa démonstration fictive. Il peut être servi par un hébergement statique HTTPS. Le service worker met en cache uniquement ces fichiers, jamais le coffre. Publication du code sur GitHub et mise en ligne d’un site sont deux états suivis séparément dans `docs/STATUS.md`.

Les tests navigateur du dépôt utilisent des données synthétiques. Les captures sont de vrais rendus du navigateur, pas des maquettes. Émulation de dimensions ne signifie pas validation sur un appareil physique.

## Repères

- `src/domain/` : données, calculs exacts et import idempotent.
- `src/vault.ts` : chiffrement et sauvegarde atomique.
- `src/components/` : saisie, icônes et graphiques.
- `docs/CORRESPONDANCE_NOTION.md` : correspondance et règles d’import.
- `docs/RECHERCHE_OUTILS.md` : choix documentés, licences et limites de recherche.
- `legacy/habitudes/` : prototype initial conservé ; son stockage reste intact.
