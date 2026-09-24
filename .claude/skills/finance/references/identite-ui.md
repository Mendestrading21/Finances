# Identité, icônes, établissements et logo

## Famille d’icônes

Utiliser une seule famille de tracés dans l’interface. Le candidat retenu pour élargir le composant actuel est `lucide-react` : imports statiques nommés, taille courante 18–20 px, tracé fin de même épaisseur apparente à toutes les tailles et couleur héritée. Mesurer le bundle avant/après et conserver les notices de licence. Si le composant SVG interne suffit, l’étendre avec la même grille 24 × 24 au lieu d’ajouter une dépendance.

Éviter d’installer Lucide, Tabler, Fluent et une collection de logos ensemble. Une icône décorative est masquée aux technologies d’assistance ; un bouton composé uniquement d’une icône garde un nom accessible et une infobulle utile.

Associer des métaphores stables :

| Objet          | Icône suggérée                     |
| -------------- | ---------------------------------- |
| Compte courant | portefeuille ou carte              |
| Épargne        | coffre ou tirelire                 |
| Investissement | courbe ou portefeuille titres      |
| Dette          | reçu ou balance                    |
| Abonnement     | répétition ou calendrier récurrent |
| Payé           | cercle coché                       |
| À payer        | horloge                            |
| Reçu           | flèche entrante cochée             |
| Impôt          | bâtiment officiel neutre           |
| Projet         | cible                              |

L’icône complète le libellé ; elle ne remplace pas une information financière.

## Établissements

Le nom du compte est primaire. L’établissement devient une information secondaire, accompagnée d’une identité locale :

1. logo officiel fourni par l’établissement et dont l’usage est vérifié ;
2. pictogramme de marque provenant d’une source recensée, avec source, version et droits conservés ;
3. monogramme généré localement ou icône de type de compte.

Ne jamais télécharger un logo au rendu : cela révèle les établissements et rend l’interface dépendante d’un tiers. Sanitiser tout SVG, retirer scripts, références externes, événements et CSS distant. Un fichier sous CC0 ne libère pas nécessairement les droits de marque ; ne pas appeler un monogramme « logo officiel ».

Créer un registre local limité aux établissements réellement utiles, avec `id`, `displayName`, `aliases`, `asset`, `source`, `retrievedAt` et `trademarkNote`. Un établissement inconnu garde un fallback propre. Les données privées ne doivent pas être envoyées à un service de recherche de logo.

Le registre versionné ne contient que des métadonnées et actifs génériques. L’association entre un compte personnel et un établissement reste dans le coffre privé, jamais dans le code, une fixture publique ou un journal.

## Cartes

- Ajouter une icône dans l’en-tête des cartes principales et des lignes de comptes/abonnements.
- Garder le titre court, le montant immédiatement lisible et une seule ligne secondaire par défaut.
- Déplacer source, historique, méthode de valorisation et aide longue dans un volet de détails.
- Utiliser l’accent unique bleu glacier `#A8BCE8` pour la sélection, la progression et les graphiques, pas comme bordure lumineuse permanente.
- Conserver des rayons cohérents (thème « Midnight Glass ») : 16 px pour les cartes, 12 px pour les lignes compactes et champs, 10 px pour les boutons.
- Les cartes sont en verre fumé : graphite `#1B202A` translucide à transparence modérée, léger dégradé, bordure fine très discrète et léger reflet supérieur. Elles sont translucides mais pas floutées, car seul le halo fixe se trouve derrière elles. Le flou (`backdrop-filter`) est réservé aux barres et aux panneaux flottants, et ne s’applique jamais aux textes ni aux icônes. Les lignes internes s’éclaircissent à peine, sans flou. Contraste calculé sur la pile réellement composée ; repli opaque si la transparence est réduite.

## Nouveau logo Finance

Logo retenu (choix de l’utilisateur, septembre 2026) : une tirelire de profil tournée vers la droite, en trait fin arrondi, avec une pièce « $ » qui entre dans la fente. Son dessin d’origine était doré ; il est décliné en bleu glacier (dégradé `#DCE4F6` → `#A8BCE8` → `#7486B8`) sur le carreau graphite, sans autre couleur d’accent, sans halo et sans texte.

- `public/finance.svg` : logo complet (icônes 192/512 et manifeste) ;
- `public/favicon.svg` : coupe simplifiée à trait épais (sans queue, œil ni « $ »), utilisée pour l’onglet et pour `.brand-mark` dans l’app, car le logo complet n’est plus qu’une tache sous 32 px ;
- `public/finance-maskable.svg` : fond bord à bord, dessin dans la zone sûre (Android, `apple-touch-icon.png` sans transparence).

Livrables :

- SVG source nettoyé et lisible en monochrome ;
- favicon SVG ;
- icônes 192 et 512 px ;
- variante maskable avec contenu essentiel dans la zone sûre centrale ;
- icône Apple touch ;
- contrôle visuel à 16, 24, 48 et 512 px sur fond noir et clair.

Ne pas agrandir un raster pour fabriquer les déclinaisons. Vérifier le manifeste, le cache hors ligne et l’affichage installé après remplacement.
