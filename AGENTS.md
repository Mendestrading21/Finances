# Finance — instructions communes

Ce dépôt porte **Finance**, l’application personnelle de budget et de patrimoine d’Elio. La cible canonique est `Mendestrading21/Finances`. Les demandes des 17 et 18 septembre 2026 autorisent son développement et la publication du code dans ce dépôt. Les permissions effectives de l’environnement et les protections GitHub restent applicables.

## Entrée

Lire `.claude/skills/finance/SKILL.md`, `docs/STATUS.md`, `docs/PLAN.md` et, pour la tranche actuelle, `docs/AUDIT_UI_V2.md` puis `docs/PLAN_AMELIORATION_V2.md`. `DEMARRER_CLAUDE.md` est le point d’entrée humain. Ne pas appliquer les choix de Budget, Vertex ou d’un autre dépôt historique.

## Règles non négociables du projet

- Données personnelles, sources Notion brutes, reçus, sauvegardes et secrets hors Git ; fixtures et captures versionnées fictives et identifiées.
- Inconnu distinct de zéro ; ancien distinct d’actuel ; prévu distinct de reçu/payé.
- Transferts internes exclus des revenus/dépenses ; compte d’investissement et positions jamais additionnés deux fois.
- Un modèle et des calculs partagés entre les sept pages, dont Abonnements. Une saisie ne doit pas produire des copies divergentes.
- Thème « Midnight Glass » (noir graphite, cartes en verre fumé, accent unique bleu glacier `#A8BCE8`, voir `.claude/skills/finance/references/design.md`) ; interface française, lisible sur iPhone/iPad/Windows.
- Conserver React/TypeScript/Vite ; changement de version pour une raison vérifiable, pas une migration d’architecture gratuite. Le lockfile et la politique d’installation font foi.
- Préserver les travaux existants et l’historique. Pas de force-push, désactivation de protections ni nouvelle permission globale.

## Travail en équipe

Les onze rôles sont définis dans `.claude/agents/`, avec spécialistes Abonnements et Identité visuelle. Le coordinateur peut déléguer des tâches bornées et indépendantes. Attribuer les fichiers avant édition et relire indépendamment calculs, import, migration, chiffrement, SVG, sauvegardes et accès. L’auteur ne signe pas sa propre revue.

## Vérifier et terminer

Lire les commandes du `package.json` courant ; respecter le gestionnaire et le lockfile du dépôt. Vérifier typecheck, tests utiles et build, puis les parcours/captures concernés. Ne pas annoncer une commande qui n’a pas été exécutée.

Maintenir `docs/STATUS.md` avec état réel, preuves et prochaine action. Publier le code autorisé après revue et contrôles ; vérifier séparément le commit, la CI et GitHub Pages. Le dépôt étant public, contrôler explicitement l’absence de données privées avant chaque publication. Un accès manquant se décrit précisément pendant que le travail indépendant continue.
