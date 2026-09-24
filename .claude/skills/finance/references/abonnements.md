# Abonnements et règlements mensuels

**Mon mois** montre les services et charges récurrentes réellement enregistrés, avec les revenus et les mises de côté, sur un seul moteur d’occurrences ; il ne duplique pas les opérations.

## Modèle

Étendre `Recurrence` avec une classification versionnée, par exemple :

- `subscription` : service auquel l’utilisateur est abonné ;
- `bill` : loyer, assurance, télécom ou autre charge récurrente ;
- `income` : revenu récurrent ;
- `saving` : mise de côté ou transfert planifié, avec deux comptes si c’est un transfert ;
- `other` : valeur migrée à vérifier.

Ne pas classer automatiquement toutes les dépenses récurrentes comme abonnements. Une migration peut reconnaître une catégorie explicite `Abonnements` ; les autres valeurs gardent leur nature ou vont en revue. Conserver identifiant, source, compte, devise, cadence, date de début, fin éventuelle, activité et historique de montant.

## Migration des coffres et exports existants

Séparer la version du contenu métier de la version de l’enveloppe cryptographique. Pour un coffre ou export ancien : déchiffrer avec son format d’origine, valider l’ancien contenu, appliquer une migration pure et idempotente, valider le nouveau contenu, puis seulement persister une nouvelle enveloppe. Une évolution du modèle ne change pas les paramètres cryptographiques sans lot de sécurité distinct.

Avant la première écriture V2, conserver une sauvegarde chiffrée antérieure et vérifier sa restauration. Sur déchiffrement, validation, migration ou écriture en échec, laisser le coffre initial intact. « Réversible » signifie ici qu’une restauration vérifiée revient exactement aux entités antérieures ; ne pas prétendre fournir une rétro-migration si elle n’existe pas.

Une date de pause, de fin ou de règlement absente reste inconnue. Une ancienne dépense ne devient ni abonnement certain ni transfert sans classification explicite et, pour un transfert, sans comptes source et destination vérifiés. Tester coffre V1, export V1, nouvelle ouverture, deuxième migration sans changement, fichier corrompu et restauration de la sauvegarde antérieure.

Une occurrence est identifiée de façon stable par `recurrenceId + occurrenceDate`. Le montant applicable vient de l’historique daté de la récurrence. Le moteur peut projeter une occurrence prévue à partir de la règle sans la persister d’avance. Un changement d’état persiste un lien ou un remplacement explicite ; toutes les vues utilisent alors le même rapprochement entre projection et opération, sans doublon.

## Statuts et boutons

Pour une dépense prévue du mois sélectionné :

- action principale `Marquer payé` ;
- état persistant `Payé` après confirmation ;
- correction secondaire `Remettre à payer`, avec libellé qui indique qu’il s’agit d’une correction.

Pour un revenu : utiliser `Marquer reçu`, `Reçu` et `Pas encore reçu`. Pour une dépense, utiliser `Pas encore payé`. Éviter le terme générique `Confirmé` lorsque la nature permet un mot clair.

Le passage à payé/reçu crée ou met à jour l’opération explicite de cette occurrence avec une date réelle choisie. La valeur par défaut peut être aujourd’hui, visible et modifiable avant validation. Ne pas attribuer le règlement au mois sélectionné sans date de règlement. Revenir à prévu garde `occurrenceDate` et l’identifiant stables, replace l’élément dans sa cohorte d’échéance et conserve l’ancienne date de règlement dans la trace de correction. Ne pas effacer silencieusement un reçu joint ni une provenance importée : demander une confirmation de correction et conserver les documents liés.

Un règlement partiel ne peut pas devenir `Payé` si le modèle ne supporte pas le reliquat. Dans ce cas, refuser l’action ou demander une opération partielle séparée clairement nommée.

## Dans Mon mois

Factures, abonnements, revenus et mises de côté se suivent dans **Mon mois**, pour le mois choisi, sur le même moteur d'occurrences (il n'y a plus de page Abonnements ni Factures séparée) :

1. « Il me reste », puis « Reste à payer » et « Reste à recevoir » (`monthSummary`) ;
2. **Mes revenus** : revenus récurrents puis ponctuels ;
3. **Mes factures** : toutes les dépenses récurrentes ; un abonnement porte l'étiquette « Abonnement » ;
4. **Dépenses du mois** : dépenses ponctuelles ;
5. **Mis de côté** : mises de côté récurrentes et virements, seulement s'il y en a ;
6. volets repliés : récurrences d'autres mois, arrêtées, puis les autres mois.

Chaque opération apparaît une seule fois : l'échéance due d'une récurrence est la ligne de cette récurrence ; une échéance d'un autre mois réglée ce mois-ci (paiement en retard) reste visible dans la carte de sa nature avec « pour {mois} ».

Le crayon d'une échéance propose « Ce mois seulement » (`withOccurrenceAmount` : l'opération liée à l'échéance porte le montant de ce mois) ou « Ce mois et les suivants » (`withRecurrenceAmount` daté du 1er du mois). Une opération liée à une échéance remplace la projection partout, cohorte comprise.

Pour une cadence trimestrielle ou annuelle, afficher le débit réel du mois où il tombe ; ne pas le remplacer par une moyenne. Le total du mois n'inclut que les occurrences effectivement prévues dans ce mois.

## Calculs

Séparer deux axes et les nommer dans l’interface :

- **cohorte d’échéances** : occurrences dont la date d’échéance appartient au mois sélectionné ;
- **flux réalisé** : opérations `settled` dont la date réelle de règlement appartient au mois sélectionné.

Dans Mon mois, une échéance du mois affiche son statut sur la ligne de sa récurrence : « Payé » ou « Reçu » quand le règlement compte dans ce mois, « Payé en <mois> » ou « Reçu en <mois> » quand il a été fait plus tard, le montant étant alors montré en retrait puisqu’il compte dans le mois du paiement ; le mois du paiement le montre, lui, avec « pour <mois de l’échéance> ». `Reste dû` ne tombe à zéro que si le règlement rapproché couvre l’occurrence. Tant que le modèle n’a pas de règlement partiel, une opération réglée liée à l’échéance la clôt : son montant devient le montant dû de cette échéance (Mon mois et l’Accueil affichent alors le même chiffre), et l’écart avec la règle reste visible (`projectedAmountMinor`, mention « habituel … »). Pour le flux, conserver les libellés `Payé en <mois>` et `Reçu en <mois>` et classer selon la date réelle.

Exemple obligatoire : une charge de 100 CHF due le 28 février et payée le 2 mars donne, pour la cohorte de février, 100 CHF dus, 100 CHF réglés et 0 CHF restant, avec la mention « Payé en mars ». Le flux réalisé de février vaut 0 CHF pour cette charge ; celui de mars inclut 100 CHF. L’échéance propre à mars reste une occurrence distincte.

- les totaux d’échéance combinent les projections déterministes et leurs règlements persistés ; ils ne demandent pas de persister toutes les occurrences futures ;
- les transferts et mises de côté ne gonflent pas dépenses et revenus ;
- un taux manquant rend le total multidevise partiel et liste les éléments exclus ;
- une récurrence inactive ne crée plus de nouvelles occurrences après sa fin, sans effacer son historique ;
- un changement de montant n’altère pas les mois antérieurs.

## Vérifications obligatoires

Tester au minimum : mois sans occurrence, mensuel, trimestriel, annuel, 31 ramené à février, année bissextile, changement de montant futur, pause, fin, paiement daté dans un autre mois avec cohorte et flux attendus, retour à prévu, pièce jointe, devise sans taux, import ancien sans classification et réimport idempotent.

Le parcours navigateur doit vérifier qu’un statut changé dans Mon mois met à jour l’Accueil après rechargement et déverrouillage, sans doublon.
