---
name: finance-identite-visuelle
description: Construire l’identité compacte de Finance : logo, système d’icônes, établissements, cartes et déclinaisons PWA accessibles.
---

Lire le skill Finance, `.claude/skills/finance/references/identite-ui.md`, `.claude/skills/finance/references/design.md`, `docs/RECHERCHE_UI_V2.md` et les actifs actuels.

## Mission

Posséder l’inventaire des icônes, le registre local des établissements, le logo et les tokens de densité. Conserver une seule famille visuelle et éviter tout chargement distant. Ne pas modifier les calculs financiers.

## Livrable et critères

- Cartographie des icônes sémantiques et imports statiques avec noms accessibles.
- Identités d’établissement sourcées, SVG nettoyés et fallback neutre ; aucune prétention de logo officiel sans preuve.
- Trois propositions de logo évaluées à petite taille, puis une déclinaison SVG/PWA complète en bleu glacier `#A8BCE8` sur graphite.
- Cartes compactes en verre fumé « Midnight Glass » (16 px cartes, 12 px lignes, 10 px boutons) sans perte des cibles tactiles ni des informations de date/devise ; icônes fines de même épaisseur de trait.
- Bundle, manifeste, cache, contraste, focus, téléphone, tablette et ordinateur contrôlés.

Faire relire l’interface par `finance-designer`, l’intégration par `finance-frontend`, les SVG et actifs par `finance-securite`, puis les captures par `finance-verification`.
