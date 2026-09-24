# Calculs et vérité financière

Cette référence fixe les invariants à implémenter et à vérifier. Elle ne certifie pas que toutes les fonctions sont déjà disponibles : lire le code et `docs/STATUS.md`.

## Montants, dates et inconnus

- Représenter les monnaies en unités mineures entières avec devise ISO explicite. Rejeter NaN, Infinity, nombres hors plage sûre et ambiguïtés de séparateurs. Pour quantités fractionnaires, taux et options, utiliser une représentation décimale documentée ; arrondir une seule fois à la frontière monétaire prévue.
- Distinguer zéro vérifié, valeur absente et valeur exclue du périmètre. Ne pas convertir `null`, chaîne vide ou échec d’import en zéro.
- Conserver `observedAt` (date de la valeur), `importedAt` (lecture) et, lorsqu’elle existe, la date de modification de la source. Une modification Notion ne date pas un solde bancaire.
- Traiter les échéances comme dates civiles, sans décalage implicite UTC. Le mois est un intervalle civil clairement affiché ; les horodatages techniques conservent leur fuseau.
- Afficher devise, date et périmètre d’un total. Une somme partielle porte « partiel » avec les éléments exclus. Ne pas afficher « à jour » sur la seule base d’une date d’import récente.

## Revenus et dépenses

Une opération possède un type (revenu, dépense, transfert), un statut explicite, un montant, une devise et les dates pertinentes. Un montant prévu, une mention « annuel », une coche sans sémantique vérifiée ou un document joint ne prouvent pas le règlement.

| Indicateur | Règle |
| --- | --- |
| Revenus reçus du mois | Revenus confirmés encaissés, datés dans le mois sélectionné |
| Dépenses payées du mois | Dépenses confirmées réglées, datées dans le mois sélectionné |
| Revenus à recevoir | Prévisions non réglées du mois ; ne pas les ajouter à l’argent disponible |
| Dépenses à venir | Occurrences non réglées, distinctes des paiements rapprochés |
| Solde budgétaire réalisé | Revenus reçus moins dépenses payées, transferts exclus |
| Reste après échéances | Liquidités connues disponibles à la date de référence moins dépenses encore dues dans l’horizon ; si la couverture manque, résultat partiel ou inconnu |
| Projection de fin de mois | Solde de référence + entrées prévues restantes − sorties prévues restantes ; libellé « projection », hypothèses visibles |

Le solde budgétaire n’est pas un solde bancaire. Un snapshot récent peut déjà inclure des opérations du mois : ne pas les déduire à nouveau. N’appliquer au snapshot que les opérations postérieures à son point de rapprochement, dont le statut et le compte sont connus ; sinon présenter les vues séparément.

## Récurrences

Conserver une règle récurrente et ses occurrences datées ; les paiements sont des faits distincts liés à ces occurrences. Créer une clé stable de type `(regleId, dateEcheance)` afin que recalcul et nouvel import ne doublonnent pas les charges.

- Supporter fréquence, date de départ, fin éventuelle et exceptions. Un 31 mensuel est ramené au dernier jour du mois sans dériver les mois suivants. Vérifier février et années bissextiles.
- Une modification s’applique aux occurrences futures non réglées, à partir d’une date explicite. Elle ne réécrit pas les paiements historiques.
- Une charge annuelle divisée par douze est une provision mensuelle, pas douze paiements réels.
- Un paiement partiel laisse un reste dû. Si cette fonction n’est pas développée, refuser la conversion silencieuse vers « payé ». État actuel (septembre 2026) : pas de règlement partiel ; « Payer » règle toujours le montant dû complet, et une opération réglée liée à une échéance clôt cette échéance à son propre montant, l’écart avec la règle restant affiché.
- Rapprocher une occurrence prévue et son paiement confirmé par un lien ; ne pas additionner les deux dans les dépenses à venir.

## Transferts et devises

Un transfert interne lie source et destination par un identifiant commun. Le montant débité et le montant crédité peuvent avoir des devises différentes. Les frais éventuels constituent une dépense distincte. Ne jamais masquer une différence dans un revenu fictif.

Exemple fictif : 100 CHF passent du compte A au compte B en CHF. Le patrimoine total ne change pas ; les revenus et dépenses restent inchangés. Pour 100 CHF débités et 104 EUR crédités, conserver les deux montants, la date et le taux réellement utilisé lorsqu’il est connu. Sans taux de valorisation EUR/CHF à la date du total, afficher les sous-totaux par devise ou une couverture partielle.

Ne pas utiliser un taux courant pour prétendre connaître un historique. Conserver source, date et sens de chaque taux. Le taux implicite d’un virement peut servir à documenter ce virement ; il ne remplace pas automatiquement une source générale de change.

## Patrimoine et investissements

Chaque compte d’investissement a un mode de valorisation exclusif : **total du compte** ou **détail des positions et du cash**. S’il existe les deux, le total du compte est l’autorité choisie et le détail est une ventilation à rapprocher ; l’écart est affiché. Ne jamais les additionner.

Patrimoine net = actifs inclus − dettes incluses, à une date et dans un périmètre définis. Une dette négative ne doit pas être soustraite deux fois. L’argent disponible exclut les actifs bloqués et tient compte des réserves affectées suivant une règle explicite ; il ne peut pas être remplacé par le patrimoine.

Les enveloppes d’épargne et objectifs sont des affectations de sommes déjà présentes dans les comptes. Une réserve impôts n’ajoute pas un nouvel actif. Éviter plusieurs affectations incompatibles de la même somme. Une cible d’objectif n’est pas une dette avérée sans source distincte.

Actions, ETF, options et crypto restent séparés si présents dans les sources. Une position d’option exige sens, quantité, multiplicateur, échéance et valeur documentés ; ne jamais déduire le multiplicateur du nom seul. Une quantité n’est pas une valeur de marché. Un achat d’actif est une transformation de patrimoine, pas une consommation courante ; dividendes, frais et plus-values sont des faits distincts.

Un graphe d’évolution nécessite des observations datées et comparables. Ne pas fabriquer des points entre deux soldes. Une variation de valeur n’est pas une performance d’investissement si les apports/retraits ne sont pas neutralisés.

## Cas de vérification minimaux

Tester les règles réellement modifiées avec données fictives et résultat attendu indépendant : inconnu versus zéro, solde sans date, transfert interne et avec change, compte plus positions, objectif affecté, prévu versus payé, nouvel import identique, occurrence fin de mois, taux absent, montant négatif et frais. Le relecteur calcule lui-même au moins les cas qui changent les totaux ; il ne recopie pas la fonction comme oracle.
