# Démarrer l’amélioration V2 dans Claude Code

Ouvrir le dépôt **`Mendestrading21/Finances`** dans Claude Code avec Node et pnpm disponibles, puis copier le texte ci-dessous. Les données financières privées ne doivent pas être ajoutées au dépôt public.

```text
Reprends Finance depuis l’état réel du dépôt Mendestrading21/Finances et mène
la tranche d’amélioration V2 jusqu’à une livraison vérifiée.

Commence par lire AGENTS.md, CLAUDE.md, .claude/skills/finance/SKILL.md,
docs/STATUS.md, docs/AUDIT_UI_V2.md, docs/PLAN_AMELIORATION_V2.md et les
références du skill correspondant au premier lot. Vérifie le HEAD, le diff,
les workflows, la CI et le site GitHub Pages. Préserve tout travail plus
récent que les SHA documentés.

Mon objectif est de garder l’application noire, sobre, simple et rapide,
tout en la rendant plus aboutie : cartes moins hautes, listes plus claires,
icônes homogènes, identité d’établissement discrète, tri financier du plus
gros au plus petit, sélecteur Janvier–Décembre, Mon mois qui réunit factures, abonnements et revenus avec leurs statuts
mensuels Payé/Reçu/Pas encore payé ou reçu. Le logo Finance doit aussi être
amélioré et rester original.

Utilise le coordinateur et les spécialistes du dépôt. Répartis les fichiers
qui peuvent avancer sans conflit ; fais relire modèle, calculs, migration,
SVG, coffre et publication par un autre agent. Ne lance pas tous les agents
pour une tâche minuscule. Conserve dans docs/STATUS.md ce qui est prévu,
développé, testé, livré ou bloqué.

Traite les lots dans l’ordre des dépendances :

1. reproduis et mesure l’état actuel avec la démonstration fictive ;
2. classe les récurrences sans transformer toutes les charges en abonnements ;
3. fais évoluer le modèle des occurrences et migre les coffres/exports anciens sans perte ;
4. remplace le contrôle technique YYYY-MM par des mois français et une année, puis ajoute les actions Marquer payé/Marquer reçu et leur correction ;
5. suis factures, abonnements et revenus dans Mon mois, sur ce modèle partagé ;
6. centralise le tri multidevise et sépare les valeurs impossibles à comparer ;
7. transforme comptes et abonnements en listes compactes ;
8. applique une seule famille d’icônes et un registre local d’établissements ;
9. propose puis intègre un logo original et toutes ses déclinaisons PWA ;
10. vérifie, capture, publie et contrôle la CI ainsi que GitHub Pages.

Applique docs/RECHERCHE_UI_V2.md avant toute dépendance. Lucide React est le
candidat principal pour les icônes, mais vérifie version, licence, bundle et
accessibilité avant de l’ajouter. N’installe pas plusieurs familles. Conserve
le CSS actuel ; ne migre pas vers Tailwind, shadcn ou Tremor pour une simple
refonte. Garde les SVG de graphiques tant qu’un besoin réel ne justifie pas
Recharts. Aucun logo distant au rendu ; tout SVG doit être local et nettoyé.

Respecte les règles financières : inconnu n’est pas zéro, ancien n’est pas
actuel, prévu n’est pas payé, un mois budgétaire n’est pas une date de
règlement, les transferts n’augmentent pas revenus/dépenses et un compte
d’investissement n’est pas additionné à ses positions deux fois. Un bouton
de statut agit sur l’occurrence du mois choisi, conserve l’historique et ne
crée aucun doublon. Une valeur sans taux va dans À valoriser.

Distingue la cohorte d’échéances et le flux réalisé : une charge due en février
et payée le 2 mars est soldée pour février, mais son débit est un flux de mars.
N’utilise jamais les paiements du mois pour calculer directement le reste dû
des échéances du mois.

Le dépôt est public. Ne publie jamais fichier Notion privé, reçu, sauvegarde,
export, secret, identifiant de source ou capture personnelle. Les fixtures et
captures versionnées restent explicitement fictives. Ne crée pas de service
payant ni de connexion bancaire.

À chaque lot, exécute les tests utiles. Avant livraison finale, passe les
commandes du package.json pour typecheck, tests, build et Playwright. Vérifie
390 × 844, 834 × 1112 et 1 440 × 1 000, clavier, focus, états vides, montants
longs, verrouillage, rechargement et restauration. Fais des captures avant et
après sur données fictives. Publie les changements relus dans main sans
force-push, surveille la CI puis contrôle la version réellement déployée.

Avance de façon autonome dans ce périmètre. Si un accès manque, termine les
lots indépendants et consigne le blocage exact. Ne t’arrête pas à un rapport
ou une maquette lorsque le code, les tests et la publication sont possibles.

À la fin, donne : pages et parcours modifiés, migrations, résultats de tests,
captures, commit, CI, URL déployée, limites et prochaine action concrète.
```

Le skill contient les règles détaillées ; ce prompt lance la tranche. Claude doit vérifier l’état courant au lieu de considérer les SHA ou totaux historiques comme toujours valides.
