# Amélioration V2 — parcours et densité

Lire `docs/AUDIT_UI_V2.md` avant de modifier l’application. Cette tranche affine le produit existant ; elle ne remplace ni le coffre, ni le moteur financier, ni les imports.

## Ordre de réalisation

1. Stabiliser le modèle des abonnements et la migration avant de construire la page.
2. Ajouter les sélecteurs de mois français et les actions de statut sur les occurrences.
3. Introduire les fonctions de tri partagées et vérifier les conversions.
4. Transformer les grandes grilles de comptes en listes compactes.
5. Étendre le système d’icônes et l’identité des établissements.
6. Refaire le logo et ses déclinaisons après validation de la direction visuelle.
7. Vérifier les six pages, sauvegardes, captures, CI et déploiement.

Un lot métier précède le lot visuel qui le représente. Ne pas figer une maquette d’abonnement avant d’avoir défini l’occurrence, son statut et sa migration.

## Sélecteur de période

- Afficher une rangée horizontale compacte `Janvier` à `Décembre`, navigable au clavier et défilable sur mobile.
- Afficher l’année dans un contrôle séparé avec précédent/suivant et libellé accessible.
- Mettre le mois sélectionné en évidence ; proposer `Ce mois-ci` lorsque l’utilisateur consulte une autre période.
- Conserver la valeur canonique `YYYY-MM` dans l’URL ou l’état. Le nom français est une présentation.
- Ne pas afficher un calendrier journalier pour changer de mois. Conserver les jours réels dans les opérations et leurs détails.
- Le changement de mois actualise toutes les cartes, listes, abonnements et totaux concernés sans ressaisie.

## Densité des cartes

Créer trois niveaux, avec tokens communs plutôt que des valeurs dispersées :

| Niveau     | Usage                                   | Cible ordinateur    | Cible mobile |
| ---------- | --------------------------------------- | ------------------- | ------------ |
| `hero`     | patrimoine et information principale    | 20–24 px de padding | 18–20 px     |
| `standard` | graphique ou groupe utile               | 16–20 px            | 16 px        |
| `compact`  | compte, abonnement, opération, métrique | 12–16 px            | 12–14 px     |

Une ligne compacte contient au plus : icône ou identité, titre, sous-information utile, montant, statut et menu/action. L’historique, la provenance détaillée et les explications longues se déplient. Éviter `min-height` sans justification. Les zones tactiles restent au moins 44 × 44 px même si la carte rétrécit.

## Listes et ordre

Chaque liste comparable déclare une devise d’affichage, une date commune de valorisation et la mesure triée. La clé de tri est exactement la valeur numérique principale affichée, avant formatage. Pour un mois historique, utiliser la date commune de fin de période disponible ; pour le mois courant, la dernière date commune vérifiée au plus tard aujourd’hui ; pour une projection future, réutiliser seulement une date vérifiée en l’étiquetant clairement. Si aucun taux commun n’existe, placer la ligne dans `À valoriser`.

- Comptes : valeur dans la devise d’affichage, décroissante ; dettes traitées selon la valeur patrimoniale affichée ; éléments sans taux/date dans `À valoriser`.
- Abonnements : coût normalisé mensuel décroissant par défaut seulement si cet équivalent est la valeur principale affichée ; bascule possible vers `Prochaine échéance`, qui affiche et trie le débit réel.
- Investissements et catégories : valeur décroissante dans un périmètre comparable.
- Opérations mensuelles : choix explicite entre `Montant` et `Date` ; ne pas changer silencieusement l’ordre d’une liste orientée échéances.
- Échéances : date croissante, puis montant décroissant à date égale.

Le tri est stable et testé. Ne pas trier les chaînes monétaires formatées ni classer un débit annuel réel avec un équivalent mensuel caché. Réutiliser une fonction métier qui renvoie valeur comparable, date de valorisation, raison d’exclusion et clé secondaire. Tester notamment 120 CHF/an contre 11 CHF/mois, dettes, zéro, taux absent et égalités.

## Critères de fin visuels

- Sur ordinateur, la page Comptes montre au moins cinq lignes usuelles avant défilement à 1 000 px de haut.
- À 390 px, aucun montant, statut ou bouton principal ne déborde ; le nom se tronque avant le montant.
- Les cartes compactes n’affichent pas l’historique complet par défaut.
- Chaque grande section a une icône sémantique cohérente ; les icônes seules ont un nom accessible.
- Une capture fictive est produite pour Accueil, Comptes, Mon mois et Abonnements sur les formats touchés.

## Hors tranche

Ne pas ajouter de connexion bancaire, prix de marché automatiques, notification serveur ou cloud de synchronisation dans ce lot. Ces fonctions exigent une architecture et des accès séparés.
