---
name: finance
description: Concevoir, développer et vérifier Finance dans Mendestrading21/Finances, l’application personnelle de budget et patrimoine d’Elio. Utiliser pour ses comptes, mois, abonnements, épargne, investissements, données Notion, calculs, coffre privé, design noir et livraison sur iPhone, iPad et Windows. Ne pas appliquer à Budget, Vertex ni à un autre dépôt Finances.
---

# Finance

Faire progresser **Finance** depuis l’état réel du dépôt `Mendestrading21/Finances`. L’application est une PWA React/TypeScript/Vite publiée par GitHub Pages ; elle conserve les données personnelles dans un coffre chiffré local. Elle suit le budget et le patrimoine, sans passer d’ordre ni lire automatiquement un compte bancaire.

## Reprendre depuis les preuves

1. Lire `AGENTS.md`, `CLAUDE.md`, `docs/STATUS.md`, `docs/PLAN.md` et le plan de la tranche demandée. Vérifier le HEAD, le diff, les workflows et le site publié avant d’annoncer un état.
2. Reproduire la demande sur la démonstration fictive. Mesurer le défaut utile : ordre, hauteur, nombre d’étapes, libellé, état mensuel, format d’écran ou calcul concerné.
3. Définir un lot livrable avec fichiers attribués, dépendances, critères observables et relecteur. Continuer jusqu’au code, aux vérifications, aux captures et à la publication lorsque le périmètre l’autorise.
4. Utiliser le modèle et les calculs partagés. Une information saisie une fois alimente toutes les pages ; ne pas créer une seconde vérité dans un composant.
5. Faire relire calcul, migration, import, coffre et publication par un agent distinct. Corriger la cause des défauts avant d’ajouter une finition visuelle.

## Charger seulement les règles utiles

| Travail                                              | Référence                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Montants, mois, récurrences, devises, patrimoine     | [Calculs](references/calculs.md)                                         |
| Notion, import, rapprochement, provenance, documents | [Données](references/donnees.md)                                         |
| Thème Midnight Glass, direction visuelle, responsive | [Design](references/design.md)                                           |
| Refonte compacte V2, tri, sélecteur de mois et lots  | [Amélioration V2](references/amelioration-v2.md)                         |
| Mon mois : factures, abonnements et états mensuels   | [Abonnements](references/abonnements.md)                                 |
| Cartes, icônes, établissements et logo               | [Identité et interface](references/identite-ui.md)                       |
| Coffre, accès, sauvegarde, secrets, publication      | [Sécurité](references/securite.md)                                       |
| Tests, captures, revue, GitHub et reprise autonome   | [Livraison](references/livraison.md)                                     |
| Nouvelle dépendance ou inspiration                   | `docs/RECHERCHE_UI_V2.md`, puis dépôt et documentation officiels actuels |

## Appliquer la tranche d’amélioration V2

Quand la demande concerne l’amélioration générale actuelle, lire `docs/AUDIT_UI_V2.md` et `docs/PLAN_AMELIORATION_V2.md`. Les résultats attendus sont :

- six pages reliées ; **Mon mois** réunit revenus, factures (abonnements compris), dépenses du mois et mises de côté, sans page Factures ni Abonnements séparée ;
- sélection du mois par noms français `Janvier` à `Décembre`, avec année séparée et mois courant évident ;
- comptes, abonnements et répartitions présentés en listes compactes, classées par valeur comparable décroissante ;
- cartes moins hautes, avec une icône sémantique, une hiérarchie courte et des détails à la demande ;
- identité d’établissement locale et sobre, sans chargement distant ni faux logo officiel ;
- actions explicites `Marquer payé`, `Marquer reçu`, `Pas encore payé` ou `Pas encore reçu` pour l’occurrence du mois sélectionné ;
- totaux du mois issus du calcul partagé des occurrences dues et de leurs règlements persistés, sans exiger de matérialiser toutes les échéances futures ni modifier l’historique d’une récurrence ;
- logo Finance original, lisible à 16 px et décliné pour PWA, écran d’accueil et favicon.

Les dates complètes restent dans le modèle et les détails : masquer le jour dans le sélecteur ne doit pas supprimer une date prouvée. « Du plus gros au plus petit » s’applique aux listes de valeur ; une liste d’échéances conserve la priorité chronologique, puis trie par montant décroissant à date égale. Les valeurs inconnues ne deviennent jamais zéro pour être classées.

## Faire travailler les agents ensemble

Les missions sont dans `.claude/agents/finance-*.md`. Le coordinateur délègue les lots indépendants et attribue les fichiers avant édition. Il ne lance pas tous les rôles pour une petite correction.

| Responsable                | Livrable                                          | Relecture                        |
| -------------------------- | ------------------------------------------------- | -------------------------------- |
| Coordinateur               | Lots, intégration, état et passage de relais      | Vérification                     |
| Notion                     | Correspondance sourcée et ambiguïtés              | Calculs + sécurité               |
| Calculs                    | Fonctions exactes et cas chiffrés                 | Patrimoine + vérification        |
| Patrimoine                 | Comptes, actifs et absence de double compte       | Calculs                          |
| Abonnements                | Occurrences, statuts, affichage dans Mon mois     | Calculs + données + vérification |
| Identité visuelle          | Logo, icônes, établissements et densité           | Designer + sécurité              |
| Designer                   | Parcours, composants, responsive et accessibilité | Frontend + vérification          |
| Frontend                   | Pages, formulaires et interactions                | Designer + vérification          |
| Données et synchronisation | Persistance, migrations, import/export            | Sécurité + vérification          |
| Sécurité                   | Données, accès, SVG, coffre et sauvegardes        | Vérification                     |
| Vérification indépendante  | Résultats reproductibles et défauts classés       | Coordinateur                     |

Chaque mission rend les fichiers touchés, décisions, commandes réellement exécutées, résultats, limites et prochaine action. L’auteur ne signe pas sa propre revue.

## Préserver la vérité financière

- Inconnu reste distinct de zéro ; ancien reste daté ; prévu reste distinct de payé ou reçu.
- Un mois budgétaire n’est pas une date de règlement. Un bouton de statut agit sur l’occurrence du mois choisi, pas sur toute la récurrence.
- Distinguer la cohorte d’échéances du mois et les flux réglés pendant le mois : une charge due en février et payée le 2 mars reste soldée dans la cohorte de février, tandis que son débit réalisé appartient aux flux de mars.
- Les transferts internes ne créent ni revenu ni dépense. Un compte et ses positions ne sont jamais additionnés deux fois.
- Le tri par valeur utilise la valeur principale affichée, une devise d’affichage et une date de valorisation communes à la liste. Une valeur non comparable va dans un groupe `À valoriser`, sans conversion implicite.
- Une modification de montant récurrent s’applique à partir d’une date et conserve les occurrences antérieures.
- Les informations Notion privées, reçus, exports, sauvegardes et secrets restent hors Git, des captures et des journaux publics.

## Garder l’interface simple

Appliquer le thème « Midnight Glass » décrit dans [Design](references/design.md) : fond noir graphite, cartes en verre fumé, accent unique bleu glacier `#A8BCE8`, police système légèrement arrondie et chiffres tabulaires. Le noir structure, le verre apporte la profondeur et le bleu guide le regard. Une carte répond à une question ; son icône aide à la reconnaître. Ne pas ajouter une icône à chaque ligne décorative, un halo derrière un montant ou une carte dans une carte.

Réutiliser l’architecture CSS et SVG actuelle. Lucide React est le candidat principal pour élargir le vocabulaire sémantique ; l’intégrer seulement après vérification du lockfile, de la licence, du poids construit et de l’accessibilité. Ne pas mélanger plusieurs familles d’icônes. Radix, Recharts, shadcn/ui ou Tremor exigent chacun un besoin concret ; une refonte visuelle seule ne justifie pas une migration vers Tailwind ou un nouveau design system.

## Respecter le périmètre et livrer

Développer, tester, documenter et publier Finance dans `Mendestrading21/Finances` sont autorisés par la demande du projet, avec les protections et accès effectifs. Le dépôt est public : faire un contrôle explicite des données privées avant chaque publication. Ne pas activer de service payant, connexion bancaire ou permission supplémentaire.

Exécuter les contrôles pertinents du `package.json`, les parcours navigateur modifiés et les formats 390 px, 834 px et ordinateur. Produire des captures fictives après chaque étape visuelle. Vérifier la CI, le commit distant et le site Pages après publication. Actualiser `docs/STATUS.md` en distinguant **prévu**, **développé**, **testé**, **livré** et **bloqué**. Une émulation n’est pas un essai sur appareil physique.
