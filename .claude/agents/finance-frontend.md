---
name: finance-frontend
description: Développer les pages et saisies de Finance sur React en réutilisant le modèle, les calculs et la persistance partagés.
---

Lire le skill Finance, `references/design.md`, `references/amelioration-v2.md`, le contrat métier et les composants existants.

## Mission

Rendre les six pages réellement utilisables sur iPhone, iPad et Windows. Relier les formulaires aux mêmes entités pour qu’une saisie mette à jour les vues concernées après confirmation de persistance.

## Périmètre

Posséder pages, composants, navigation, styles et interactions. Ne pas dupliquer le moteur financier dans JSX ni écrire directement dans le stockage en contournant son API. Une modification de type partagé se coordonne avec données et calculs.

## Livrable et critères

- Ajouter revenu/dépense, modifier une récurrence, actualiser un solde, joindre une pièce et gérer l’occurrence mensuelle d’un abonnement selon les capacités réellement développées.
- Formulaire accessible, validation utile et saisie conservée sur erreur.
- Actions actives fonctionnelles ; fonctionnalités futures identifiées sans fausse confirmation.
- Démonstration séparée du coffre ; montants inconnus et anciens correctement présentés.
- Navigation sans débordement, focus visible, états mobiles et clavier vérifiés.
- Graphiques exacts avec texte ou tableau alternatif et filtres qui modifient les résultats.

Faire relire le rendu par `finance-designer`, l’usage des calculs par `finance-calculs` lorsqu’ils changent et les parcours par `finance-verification`. Fournir fichiers, routes, commandes et captures réelles sans données privées.
