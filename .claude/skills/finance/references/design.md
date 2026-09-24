# Finance — identité et parcours

## Thème « Midnight Glass »

Thème fixé par l’utilisateur le 23 septembre 2026, à appliquer à la lettre : **noir graphite, verre fumé et lumière bleu glacier.** Interface sombre et élégante, cartes légèrement translucides, profondeur douce. Le côté futuriste vient des matières et de la lumière, pas de néons agressifs ni de couleurs partout. Il remplace l’ancienne direction « bleu-violet / verre + bleu néon ».

**Règle centrale : le noir structure, le verre apporte la profondeur et le bleu guide le regard. Tout le reste reste discret.**

Les images de référence donnent l’ambiance, pas des données : ne pas réutiliser leurs montants, marques ou courbes comme données réelles.

### Couleurs : une base sombre, un seul accent

| Élément                         | Couleur   | Token CSS   |
| ------------------------------- | --------- | ----------- |
| Fond général, presque noir      | `#070A10` | `--bg`      |
| Surface principale, noir bleuté | `#10151E` | `--surface` |
| Cartes, graphite                | `#1B202A` | `--card`    |
| Accent unique, bleu glacier     | `#A8BCE8` | `--accent`  |
| Texte principal, blanc doux     | `#F0F2F7` | `--text`    |
| Texte secondaire, gris bleuté   | `#929BAB` | `--muted`   |

- Le bleu glacier sert aux graphiques, à la progression et aux éléments sélectionnés. Aucun second accent décoratif.
- Un halo bleu diffus, éventuellement légèrement violacé, peut éclairer l’arrière-plan de la page, visible à travers le verre ; jamais comme lueur ciblée derrière un montant ni autour d’une carte.
- Les grandes surfaces restent sombres.
- Couleurs de nature (choix de l’utilisateur, 24 septembre 2026) : entrées en vert adouci `--positive` `#8FD1B5` (précédées de « + »), sorties en rouge adouci `--negative` `#E8A3AE`, virements et épargne en bleu glacier `--accent`. Elles s’appliquent aux montants, aux flèches et aux statuts réglés des lignes (« Reçu », « Payé », « Réglé »), aux indicateurs d’entrées/sorties, aux barres Entrées/Dépenses et aux boutons « Reçu », « Payer », « Régler » (voile léger de la couleur, contour fin, jamais d’aplat vif ni de halo). Ce qui reste à faire (« Pas encore payé/reçu », « Prévu », « À vérifier ») est en ambre doux `--warning` `#D9BE8C`. Les totaux mixtes restent neutres. Jamais la couleur seule : un signe, une flèche ou un libellé porte toujours le sens.
- Contraste WCAG calculé par luminance relative sur la pile réellement composée (`#070A10` + halo au pic → carte verre → reflet → ligne), jamais estimé : 4,5:1 pour le texte, 3:1 pour icônes, contours utiles et marques de graphique. Calcul par formule du 23 septembre 2026, pire cas : halo `rgba(122, 139, 216, .16)` centré hors écran, soit au plus 14,75 % visible (écran 1920 px ; 13,8 % sur iPhone en portrait, 14,97 % en paysage), carte `rgba(27, 32, 42, .7)`, reflet blanc 4 % compté partout, survol de ligne blanc 2,5 %. Le texte secondaire atteint 5,98:1 sur le fond éclairé, 5,26:1 sur la carte et 4,89:1 sur une ligne survolée ; le bleu glacier 7,19:1 sur cette ligne. Le flash de règlement (bleu glacier 7 %) laisse le texte secondaire à 4,55:1 : c’est le plafond. Toute baisse d’opacité des cartes, tout survol plus clair ou tout halo plus fort exige un nouveau calcul.

### Cartes : du verre fumé, pas du plastique brillant

- Verre sombre légèrement givré : graphite translucide à transparence modérée, léger dégradé vertical, contour fin.
- Le flou (`backdrop-filter`) est appliqué là où du contenu passe réellement derrière : barre supérieure collante, barre de navigation mobile, dialogues et leur voile, panneau des mois, menu mobile et messages de confirmation. Les cartes posées dans le flux et le panneau latéral fixe n’ont derrière eux que le halo, déjà flou : ils portent leur matière (transparence, dégradé, reflet, bordure, ombre) sans flou supplémentaire. Même rendu, moins de calques GPU sur iPhone.
- Angles arrondis modérés : 16 px pour les cartes, 12 px pour les lignes et champs imbriqués, 10 px pour les boutons.
- Bordure 1 px gris clair très discrète, ombre douce pour séparer les niveaux, léger reflet sur le bord supérieur.
- Le flou ne touche jamais les textes ni les icônes : pas de `filter: blur`, d’ombre lumineuse ou de lueur sur un glyphe.
- Éviter contours lumineux épais, brillances et reflets excessifs. Pas de carte dans une carte.
- Si l’utilisateur réduit la transparence, les cartes et les panneaux flottants deviennent opaques (`#1B202A`). Les barres et le voile des dialogues perdent leur flou : les barres deviennent opaques et le voile passe à 92 %. Le texte secondaire reste au-dessus de 4,5:1 (calcul par formule du 23 septembre 2026, pire cas 4,84:1 sur une ligne survolée à 2,5 % d’une carte opaque avec reflet 4 %). Si le navigateur ne gère pas le flou, seules les barres changent et deviennent quasi opaques. Les cartes restent identiques, puisqu’elles ne sont pas floutées.

### Composition : compacte, structurée et alignée

- Navigation discrète : barre supérieure fine et panneau latéral sombre (surface `#10151E`, sans flou : aucun contenu ne défile derrière) sur grands écrans ; navigation courte sur téléphone.
- Grille de cartes compactes, une seule échelle d’espacement, alignements réguliers ; densités `hero`, `standard` et `compact` décrites dans [Amélioration V2](amelioration-v2.md).
- Les chiffres importants ressortent immédiatement par leur taille et leur graisse, sans blocs immenses.
- Profondeur par quelques superpositions maîtrisées : seuls les panneaux flottants (dialogue, sélecteur de mois, menu mobile, message de confirmation) portent une ombre plus marquée. Les cartes restent posées ; elles ne flottent pas et n’attirent pas l’attention toutes en même temps.

### Typographie et icônes : sobres et précises

- Police sans empattement, nette et légèrement arrondie : pile système `ui-rounded`, `"SF Pro Rounded"`, `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI Variable Text"`, `"Segoe UI"`, `system-ui`, `sans-serif`. Utiliser les polices présentes sur l’appareil, sans redistribuer une fonte Apple sous licence ni charger de police distante. Chiffres tabulaires.
- Limite assumée : `ui-rounded` et SF Pro Rounded n’existent que sur Safari (iPhone, iPad, Mac). Windows affiche Segoe UI Variable, nette mais non arrondie ; Chrome ou Edge sur Mac affichent SF Pro, non arrondie. La CSP (`font-src 'self'`) bloque toute police distante et la règle « police système » écarte l’embarquement d’une fonte : ne pas promettre l’arrondi hors Safari.
- Titres courts, chiffres bien visibles, informations secondaires plus discrètes mais lisibles : aucun texte porteur d’information sous 12 px ni plus gris que `#929BAB`.
- Icônes fines, simples et cohérentes : une seule famille, grille 24 × 24, couleur héritée et **la même épaisseur de trait apparente partout**, quelle que soit la taille. Les icônes seules ont un nom accessible.
- Seul l’actionnable est encadré : les tuiles d’icônes décoratives (repère de carte, de ligne ou d’indicateur) n’ont ni contour ni ombre, tout au plus un fond très discret. Un contour fin signale toujours un élément cliquable.
- Boutons petits, sombres et légèrement encadrés : fond sombre ou translucide, contour fin. L’action principale se distingue par le bleu glacier (texte, contour ou voile léger), pas par un aplat vif. Hauteur visible 36 px au plus (32 px pour les boutons compacts et les onglets) ; sur écran tactile (`pointer: coarse`), une zone de toucher invisible porte la cible à 44 × 44 px sans agrandir le bouton. Les sélecteurs de valeur (mois, devise, tri) et les champs gardent 44 px visibles au doigt, un `<select>` ne pouvant pas porter de zone invisible.

### Graphiques et interactions : lumineux, mais retenus

- Courbes fines en bleu glacier, remplissage en dégradé de l’accent qui disparaît progressivement dans le fond.
- Histogrammes, anneaux et jauges dans la même famille : nuances et opacités du bleu glacier, pas de palette multicolore. Les séries se distinguent aussi par libellé, motif ou position.
- Grilles et axes presque invisibles.
- Au survol ou à la sélection, l’élément devient légèrement plus clair ; pas de changement de teinte ni d’animation spectaculaire. Transition courte, supprimée si l’utilisateur réduit les animations. Le focus clavier reste visible, en bleu glacier.

## Système visuel

- Une grille d’espacement cohérente et peu de niveaux imbriqués. Un montant principal, un libellé clair et une date lisible par carte.
- États survol, focus, actif, désactivé, attente et erreur explicites. Ne pas utiliser la couleur seule pour distinguer reçu/prévu, gain/perte ou erreur.
- Un logo Finance original, lisible en monochrome et en petit format, se décline pour l’application et son manifeste.
- Logos d’établissements seulement si provenance et droit d’usage vérifiés. À défaut, monogramme neutre avec nom écrit ; ne pas le présenter comme logo officiel. Aucun chargement distant qui révèle la liste des établissements consultés.
- Respecter contraste, réduction des animations, préférence de transparence lorsque disponible et agrandissement du texte. Des cibles tactiles d’environ 44 px et un focus visible sont le minimum visé pour les commandes quotidiennes.

## Sept pages reliées

| Page | Question principale | Actions prioritaires |
| --- | --- | --- |
| Vue d’ensemble | Où en sont mes finances et que dois-je regarder ? | Ajouter une opération, actualiser une donnée, ouvrir une échéance |
| Mon mois | Qu’est-ce qui est reçu, payé et encore prévu ? | Revenu, dépense, paiement, récurrence |
| Mes comptes | Où est l’argent, dans quelle devise et à quelle date ? | Ajouter un compte, actualiser un solde, transférer |
| Abonnements | Qu’est-ce qui est dû, réglé ou reste à régler ce mois-ci ? | Marquer payé ou reçu, ajouter une récurrence, filtrer par statut |
| Épargne et projets | Que reste-t-il à mettre de côté ? | Créer un objectif, affecter une somme existante |
| Investissements | Quelles sont mes positions et leurs comptes ? | Ajouter ou actualiser une position, consulter la répartition |
| Documents et réglages | Où sont mes pièces et comment récupérer mes données ? | Joindre, importer, sauvegarder, restaurer, verrouiller |

Sur mobile, garder la navigation courte : quelques entrées principales et un accès explicite aux autres pages. Sur iPad et Windows, exploiter la largeur par colonnes utiles et navigation latérale. Ne pas étirer un tableau d’ordinateur jusqu’à le rendre illisible sur iPhone. Les filtres de mois/devise restent visibles et appliqués de manière cohérente.

## Saisie quotidienne

Préremplir seulement les informations déductibles du contexte choisi : le compte ouvert, la devise de ce compte ou le mois sélectionné. Prévoir libellé, montant, date et statut avec champs avancés progressifs. Ne pas demander plusieurs fois la même information. Une fermeture accidentelle doit protéger une saisie non enregistrée importante.

La confirmation « enregistré » suit la réussite de persistance. Une erreur conserve le formulaire et explique comment reprendre. Une action n’apparaît active que si elle fonctionne ; sinon expliquer la capacité manquante dans le contexte utile. Les écrans vides guident vers une première saisie ; ils ne montrent pas un patrimoine zéro.

## Graphiques exacts et lisibles

| Graphique | Exigence |
| --- | --- |
| Évolution du patrimoine | Observations datées réelles, points manquants visibles, période et devise, distinction d’une projection |
| Répartition des actifs | Même périmètre que le total, catégories nommées, sous-total inconnu ou non converti indiqué |
| Revenus / dépenses | Reçu/payé distinct de prévu ; mêmes dates et devises que Mon mois |
| Progression de l’épargne | Affecté versus cible, sans additionner l’objectif au patrimoine |

Chaque graphique dispose d’un résumé ou tableau accessible et d’une lecture sans couleur. Ne pas tracer de fausse série pour remplir une zone vide. Les barres partent d’un zéro approprié ; les courbes affichent leur échelle. Les filtres réellement disponibles modifient les données, pas seulement l’état d’un bouton.

## Vérification visuelle

Capturer l’application réellement rendue à chaque étape importante sur formats téléphone, tablette et ordinateur. Les captures versionnées utilisent exclusivement une démonstration fictive identifiée. Indiquer viewport, navigateur, route, données et date de capture ; ne pas présenter une émulation comme un iPhone réel. Examiner débordements, clavier/focus, safe areas, longues valeurs, états vides et erreurs. Une image générée ou une référence de design n’est jamais une preuve d’interface livrée.
