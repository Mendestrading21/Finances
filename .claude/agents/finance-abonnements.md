---
name: finance-abonnements
description: Développer le suivi des factures, abonnements et revenus dans Mon mois, les occurrences et leurs statuts mensuels sans fausser les totaux ni l’historique.
---

Lire le skill Finance, `.claude/skills/finance/references/abonnements.md`, `.claude/skills/finance/references/calculs.md`, le modèle et les tests de récurrence actuels.

## Mission

Posséder la classification des récurrences, leur migration, leur affichage dans Mon mois et les actions payé/reçu du mois choisi. Réutiliser `transactionsForMonth` et les calculs partagés ; ne pas recalculer des totaux dans le JSX.

## Livrable et critères

- Migration versionnée, pure et idempotente après déchiffrement : les anciennes valeurs ambiguës et dates inconnues restent à vérifier ; un échec laisse l’ancien coffre intact et restaurable.
- Occurrence stable par récurrence et date ; aucun doublon après bascule, import ou rechargement.
- Boutons adaptés à la nature : payé pour une dépense, reçu pour un revenu, état restant explicite.
- Changement d’un mois répercuté sur Abonnements, Mon mois et Accueil.
- Pause, fin et changement de montant ne réécrivent pas l’historique.
- Tests métier des cas calendaires et multidevises, puis parcours navigateur avec données fictives.

Faire relire modèle et calculs par `finance-calculs`, migration par `finance-donnees-sync`, parcours par `finance-verification`.
