# Finance — plan de valeur et option commerciale

**Version : 10 novembre 2026 · Statut : proposition stratégique à valider par l'usage.**

Dépôt : [Mendestrading21/Finances](https://github.com/Mendestrading21/Finances) · Visibilité observée : publique.

Base documentaire : branche `main`, commit [5368a66dcccb](https://github.com/Mendestrading21/Finances/commit/5368a66dcccb28a447d1f824e5d8eda83cbe907e), daté du 2026-09-24. Cette date est celle du code audité ; le plan est daté du 10 novembre 2026.

**Mode de lecture :** les constats sont reliés aux sources ; les tarifs, seuils, budgets et développements futurs sont des propositions. Aucune métrique de clients ou de revenus n'est inventée. Aucun engagement de dépense, lancement commercial ou déploiement applicatif n'est pris par ce document.

Document de travail du 10 novembre 2026. Base examinée : `Mendestrading21/Finances`, branche `main`, commit `5368a66dcccb28a447d1f824e5d8eda83cbe907e`. Analyse documentaire et inspection du code ; aucun test applicatif ni essai sur appareil physique exécuté dans cette mission. Tous les budgets, prix et objectifs ci-dessous sont des hypothèses de planification, pas des résultats commerciaux.

## 1. Décision proposée

Conserver Finance comme cockpit patrimonial personnel et banc d'essai pour des parcours financiers simples. Sa valeur immédiate vient du temps gagné, des échéances suivies et de la diminution des doubles saisies. La création d'un abonnement grand public reste une option à valider : aucune traction, clientèle payante ou recette n'a été établie par cette analyse.

Finance ne doit pas devenir une copie concurrente de Budget. La séparation proposée est claire : **Finance organise la gestion personnelle détaillée du fondateur ; Budget porte l'expérience destinée à un public plus large.** Les enseignements peuvent circuler, mais pas les données personnelles, les coffres, les secrets ou des migrations implicites entre applications.

## 2. Problème et utilisateur

Un utilisateur qui répartit son suivi entre banques, tableurs et notes doit comprendre ce qui est dû, effectivement payé, disponible et simplement estimé. 
Le premier utilisateur est une personne qui accepte de saisir et vérifier ses informations, possède plusieurs appareils et préfère maîtriser ses données. Son besoin central : « Je veux savoir où j'en suis et ce que je dois encore traiter ce mois-ci. »

Les trois tâches prioritaires sont :

1. Consulter le mois, repérer les échéances et confirmer un règlement.
2. Lire des comptes et un patrimoine avec dates, devises et inconnues explicites.
3. Retrouver le même coffre sur ses appareils et pouvoir le restaurer.

## 3. État réellement constaté

| Domaine | Preuve consultée | Conclusion utilisable |
|---|---|---|
| Application | README, package.json, App.tsx | PWA React/TypeScript/Vite ; six destinations dans le code consulté |
| Données | vault.ts | Coffre local chiffré, validation d'enveloppe et contrôle de remplacement |
| Synchronisation | sync.ts et App.tsx | Code de synchronisation GitHub présent et appelé ; configuration utilisateur requise |
| Nouvel appareil | deviceLink.ts et App.tsx | Code d'association chiffré et ouverture depuis GitHub présents |
| Déverrouillage rapide | quickUnlock.ts et App.tsx | Intégration WebAuthn/PRF présente, avec refus explicite si non supportée |
| Situation commerciale | Aucun registre commercial vérifié | Utilisateurs, revenus, rétention et volonté de payer inconnus |
| Appareils et production | STATUS contient des preuves historiques | Disponibilité et compatibilité actuelles non retestées ici |

**Contradiction documentaire à corriger :** le README indique encore qu'aucune synchronisation cloud n'existe. Le code contient `configureSync`, `syncNow`, `resolveConflict` et une récupération au retour au premier plan, au retour du réseau et toutes les minutes lorsque l'application est ouverte. STATUS décrit cette fonctionnalité comme développée et testée sur un faux GitHub. La formulation exacte est donc : **synchronisation chiffrée optionnelle développée, activation et fonctionnement réels sur les appareils de l'utilisateur non vérifiés dans cette mission.**

## 4. Proposition de valeur et différenciation

La promesse proposée : **« Ton mois, tes comptes et ton patrimoine dans un espace privé que tu comprends. »**

Quatre différences méritent d'être conservées : français simple, distinction rigoureuse entre prévu et réalisé, coffre détenu par l'utilisateur, continuité entre téléphone, tablette et ordinateur. Le thème Midnight Glass sert la lisibilité.

Les alternatives sont un tableur, les vues de chaque banque et une application de budget générique. Le tableur reste flexible et familier ; les banques disposent des mouvements réels ; une application commerciale peut faciliter la synchronisation. Finance doit gagner sur la cohérence et la maîtrise des informations, sans prétendre remplacer ces sources.

## 5. Modèle économique interne

Le modèle prioritaire est celui d'un outil personnel. Mesurer une situation initiale pendant deux semaines, puis comparer quatre semaines d'usage. Compter le temps de rapprochement, les corrections, les doubles saisies et la fréquence des revues mensuelles ; ne pas valoriser des erreurs financières « évitées » sans preuve.

Exemple purement hypothétique :

| Variable | Hypothèse de travail |
|---|---:|
| Temps économisé | 30 minutes par semaine |
| Valeur conventionnelle d'une heure | 40 CHF |
| Valeur annuelle brute | 0,5 × 52 × 40 = 1 040 CHF |
| Budget externe récurrent alloué | 240 CHF par an |
| Valeur annuelle avant maintenance et développement | 800 CHF |

Ce n'est ni un revenu, ni une économie bancaire constatée. À 12 heures de maintenance annuelle valorisées 40 CHF, le bénéfice théorique devient 320 CHF. Une refonte de 80 heures coûterait conventionnellement 3 200 CHF : le seul gain de temps ne la justifie pas. Le développement doit donc rester proportionné à des problèmes réels.

Proposition de plafond initial pour 90 jours : **1 500 CHF de dépenses externes maximum**, répartis entre 200 CHF d'exploitation et sauvegarde, 800 CHF de revue spécialisée ou accompagnement, et 500 CHF de réserve. Ce plafond n'est pas un engagement de dépense ni un devis fournisseur. Prévoir séparément 30 à 45 heures de travail, sans les compter une seconde fois si elles sont facturées dans les dépenses externes.

## 6. Option commerciale, conditionnelle

Avant de créer une société ou une offre, interroger dix personnes indépendantes du cercle de développement. Leur faire accomplir les trois tâches prioritaires sur des données fictives et comparer à leur méthode actuelle. Une déclaration d'intérêt vaut moins qu'un second usage spontané.

Une hypothèse testable serait un pack autonome à **49 CHF par an**, avec sauvegarde locale, documentation et mises à jour ; aucune synchronisation gérée ni support illimité ne serait promis. Une formule accompagnée distincte pourrait être explorée après mesure du coût d'installation.

À 49 CHF et avec une retenue de planification de 10 % pour frais, remboursements et aléas, la contribution avant support serait 44,10 CHF par client et par an. Un budget annuel de fonctionnement de 3 000 CHF demanderait **69 clients** avant rémunération du développement et fiscalité. Trente minutes de support à 40 CHF par client réduiraient cette contribution à 24,10 CHF : il faudrait alors **125 clients**. Ce calcul illustre la fragilité du prix ; il ne prévoit pas des ventes.

Ne retenir cette piste que si elle couvre un besoin distinct de Budget. Si les mêmes clients, fonctions et canaux sont visés, investir dans Budget et maintenir Finance comme outil personnel évite deux coûts d'acquisition et deux services de support.

## 7. Produit et architecture à préserver

Le prochain travail porte sur la fiabilité et la compréhension :

- Réconcilier README, STATUS et parcours réellement servis.
- Montrer le dernier succès de synchronisation et distinguer hors ligne, erreur, conflit et coffre étranger.
- Tester la restauration sur une installation vierge avec données fictives.
- Expliquer qu'un solde déclaré reste une observation datée, même après un paiement enregistré.
- Conserver l'import prévisualisé, les récurrences historisées et les transferts neutres.

La synchronisation envoie l'enveloppe chiffrée vers un dépôt privé distinct, tel `finance-coffre`, composant de stockage sans revenus propres ; son contenu n'a pas été lu. Le jeton est chiffré localement. Le code impose un préfixe de jeton finement limité, mais ce préfixe ne prouve pas à lui seul les permissions effectivement accordées. L'utilisateur doit limiter ce jeton au seul dépôt nécessaire.

## 8. Feuille de route des 90 premiers jours

| Période | Livrable proposé | Critère de sortie |
|---|---|---|
| J1–J14 | Inventaire documentaire, mesure du temps actuel, parcours de restauration | Contradictions répertoriées ; restauration fictive observée |
| J15–J30 | Recette iPhone, iPad et Windows ; synchronisation réelle de test | Création, récupération, conflit et jeton révoqué testés sans données réelles |
| J31–J45 | Simplification d'une seule friction prioritaire | Tâche réussie sans aide par quatre testeurs sur cinq |
| J46–J60 | Quatre revues hebdomadaires et bilan des erreurs | Temps comparé à la situation initiale ; aucun incident de perte |
| J61–J75 | Dix entretiens si une offre distincte de Budget se dessine | Problème récurrent documenté, refus et alternatives inclus |
| J76–J90 | Décision maintien personnel ou expérimentation commerciale | Coût, usage et différenciation réunis dans une décision écrite |

## 9. Trajectoire sur douze mois

Premier trimestre : rendre la gestion personnelle fiable et mesurer sa valeur. Deuxième trimestre : stabiliser sauvegardes, migrations et accessibilité ; décider si le besoin est commercial. Troisième trimestre : seulement si validé, tester une offre avec un petit groupe volontaire et un support borné. Quatrième trimestre : poursuivre si réutilisation et marge après support sont démontrées ; sinon conserver l'outil personnel.

## 10. Indicateurs et règles de décision

| Indicateur | Cible proposée | Mesure |
|---|---|---|
| Revue mensuelle terminée | 3 mois consécutifs | Checklist locale datée |
| Temps de revue | Baisse de 25 % après stabilisation | Chronométrage comparable |
| Restauration fictive | Réussite trimestrielle | Compte rendu sans données privées |
| Conflits de synchronisation | Aucun écrasement silencieux | Scénarios reproductibles |
| Compréhension | 4 personnes sur 5 réussissent les tâches | Observation, pas sondage de satisfaction seul |
| Maintenance | Au plus 2 heures mensuelles après stabilisation | Temps enregistré |
| Option commerciale | Au moins 5 engagements payants sur un pilote défini | Paiements réels, après offre et cadre validés |

## 11. Risques et conditions d'arrêt

Perdre la phrase secrète peut rendre les données irrécupérables ; le support ne doit pas promettre le contraire. Un appareil déverrouillé ou compromis reste une menace malgré le chiffrement au repos. Le déverrouillage rapide dépend de capacités navigateur/authentificateur : la présence du module n'est pas une preuve de compatibilité universelle.

Git conserve les versions chiffrées successives. Désactiver le partage ne supprime pas cet historique et ne révoque pas le jeton. Prévoir une procédure documentée de révocation, changement d'appareil et conservation, sans lancer de purge destructive.

Suspendre toute commercialisation si une restauration échoue, si un conflit écrase silencieusement des informations, si une vulnérabilité expose le clair ou si la charge de support dépasse durablement la contribution des clients. L'absence de connexion bancaire limite le périmètre ; elle ne supprime pas les obligations de confidentialité et de sécurité.

## 12. Sources et prochain lot

Sources primaires consultées au 10 novembre 2026 :

- [README](https://github.com/Mendestrading21/Finances/blob/5368a66dcccb28a447d1f824e5d8eda83cbe907e/README.md) — promesse, installation, limites et contradiction sur la synchronisation.
- [État de reprise](https://github.com/Mendestrading21/Finances/blob/5368a66dcccb28a447d1f824e5d8eda83cbe907e/docs/STATUS.md) — preuves historiques, limites de recette et partage GitHub.
- [Synchronisation](https://github.com/Mendestrading21/Finances/blob/5368a66dcccb28a447d1f824e5d8eda83cbe907e/src/sync.ts) — coffre chiffré, dépôt privé, jeton et conflits.
- [Coffre](https://github.com/Mendestrading21/Finances/blob/5368a66dcccb28a447d1f824e5d8eda83cbe907e/src/vault.ts) — enveloppe, validation, chiffrement et remplacement.
- [Application](https://github.com/Mendestrading21/Finances/blob/5368a66dcccb28a447d1f824e5d8eda83cbe907e/src/App.tsx) — intégration et déclenchement des fonctions.
- [Association d'appareil](https://github.com/Mendestrading21/Finances/blob/5368a66dcccb28a447d1f824e5d8eda83cbe907e/src/deviceLink.ts) et [déverrouillage rapide](https://github.com/Mendestrading21/Finances/blob/5368a66dcccb28a447d1f824e5d8eda83cbe907e/src/quickUnlock.ts).

Prochain lot utile : **réconcilier la documentation de synchronisation puis observer une restauration et un conflit sur deux appareils avec un coffre fictif**. Cette mission a préparé le plan ; elle n'a exécuté ni ces corrections, ni cette recette.
