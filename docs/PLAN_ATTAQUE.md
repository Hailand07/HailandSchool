# Plan d'attaque du MVP — Hailand School

Version 1 du 26 novembre 2026. Ce plan exécute la partie 3.5 de l'[étude de conception](https://claude.ai/artifact/5RgYo7JimHdFufzWMARepT). Il sera ajusté à chaque retour de terrain : toute modification passe par le registre des hypothèses (section 5) et le journal des changements (section 8).

## 1. Ce que le MVP contient, et rien d'autre

Le MVP couvre six modules :

1. Structure de l'école
2. Élèves (inscriptions et dossiers)
3. Frais et caisse, avec reçus, impayés, relances et mobile money niveau 1 (saisie manuelle de la référence)
4. Notes et bulletins
5. Messages aux parents (SMS et partage WhatsApp)
6. Tableau de bord du fondateur

S'y ajoute le socle : utilisateurs, rôles, journal d'audit, hors connexion et synchronisation.

**Refusé jusqu'à la V2, quelle que soit la demande :** absences et discipline, paie, dépenses, paiement mobile money automatique, emplois du temps, espace parent, WhatsApp automatisé, exports officiels au format DCE, bulletins bilingues franco-arabes, cartes d'élève, application Google Play.
**Refusé jusqu'à la V3 :** multi-établissements, examens, bibliothèque, transport, cantine, messages vocaux, comptabilité, analyse.

Une demande d'école pilote hors périmètre est notée dans `docs/backlog-v2.md`, jamais développée pendant le MVP.

## 2. Règles intangibles (issues de l'étude)

| Règle | Traduction technique |
| --- | --- |
| Hors connexion par défaut | Tout écran lit et écrit dans la base locale ; le réseau ne sert qu'à synchroniser |
| Rien ne s'efface | Suppression logique (`deleted_at`) ; journal d'audit serveur sur toute écriture sensible |
| Un paiement ne se modifie jamais | Tables financières en ajout seul ; correction par annulation tracée, validée par le fondateur |
| Numéros de reçu sans collision | Préfixe unique par appareil (`A-000123`), attribué par le serveur à l'enregistrement de l'appareil |
| Le solde est calculé | Somme des échéances moins somme des affectations de paiements non annulés ; jamais stocké |
| Période verrouillée = notes figées | Le serveur refuse toute écriture de note sur une période verrouillée |
| Chaque école est étanche | Sécurité par ligne PostgreSQL sur `school_id` pour toutes les tables, testée automatiquement |
| Trois touches pour encaisser | Chercher, saisir le montant, valider : objectif mesuré en test utilisateur, moins de 30 secondes |
| Paramétrable, pas sur mesure | Barèmes, périodes, coefficients, grilles de frais et modèles réglés par l'école, sans code |

## 3. Définition de « terminé » pour chaque lot

Un lot est terminé quand :

- les tests automatisés du lot passent (`npm test`), y compris les tests de synchronisation et d'étanchéité ;
- l'écran fonctionne en mode avion, sur un profil « Android d'entrée de gamme » (Chrome, processeur ralenti 4×, écran 360 × 640) ;
- les textes sont en français et les montants en GNF avec séparateurs de milliers ;
- toute modification de base passe par une migration versionnée dans `supabase/migrations/` ;
- la case du lot est cochée dans la section 7 et le journal des changements est à jour.

## 4. Calendrier

Le calendrier suit l'année scolaire guinéenne : une école ne change d'outil qu'à la rentrée d'octobre.

| Étape | Durée à plein temps | Période | Jalon de sortie |
| --- | --- | --- | --- |
| 0. Terrain | 3 semaines | Décembre 2026, en parallèle de l'étape 1 | Modèles réels en main, règles de notation validées, 3 pilotes choisis |
| 1. Socle | 5 semaines | 26 novembre 2026 → fin janvier 2027 | Deux téléphones hors ligne se synchronisent sans perte ni doublon |
| 2. École et élèves | 3 semaines | Février 2027 | Une école réelle de 400 élèves chargée en moins d'une journée |
| 3. Frais et caisse | 5 semaines | Mars → mi-avril 2027 | Un comptable encaisse en moins de 30 secondes sans réseau |
| Pilote caisse | Continu | Mi-avril 2027 (3e trimestre) | La caisse tourne chez 1 à 3 pilotes |
| 4. Notes et bulletins | 5 semaines | Mai → juin 2027 | Bulletins identiques au calcul manuel sur une classe témoin |
| Gel fonctionnel | — | 31 juillet 2027 | Caisse et bulletins ne reçoivent plus que des corrections |
| 5. Messages et tableau de bord | 2 semaines | Août 2027 | Le fondateur lit sa recette du jour sur son téléphone |
| 6. Pilote et durcissement | 4 semaines | Août → septembre 2027 | Un trimestre complet sans perte de données |
| Lancement commercial | — | Octobre 2027 | Rentrée 2027-2028 |

L'étude place le gel « fin juillet » et l'étape 5 en août. Ce plan les réconcilie : le gel porte sur la caisse et les bulletins, déjà en usage chez les pilotes ; l'étape 5 n'ajoute que les SMS et le tableau de bord, qui ne modifient pas ces deux modules.

## 5. Registre des hypothèses provisoires

Chaque règle non sourcée est codée comme un paramètre, avec un identifiant `HYP-xx` en commentaire dans le code. Quand le terrain tranche, on met à jour la ligne, puis le paramètre par défaut.

| Id | Hypothèse provisoire | Où elle vit dans le code | Validée par | Statut |
| --- | --- | --- | --- | --- |
| HYP-01 | Primaire noté sur 10, secondaire sur 20 | `levels.grading_scale`, référentiel guinéen | Étape 0 : DCE et 3 écoles | À valider |
| HYP-02 | Moyenne de passage 5/10 au primaire, 10/20 au secondaire | `schools.grading_config.pass_mark` | Étape 0 : DCE | À valider |
| HYP-03 | Trois trimestres par an ; certaines écoles en semestres | `terms`, modèle d'année scolaire | Étape 0 | À valider |
| HYP-04 | Moyenne de période = moyenne pondérée des notes de cours et des compositions, paramétrable | `grading_config.formula`, moteur de calcul | Étape 0 : bulletins réels collectés | À valider |
| HYP-05 | Rang avec ex aequo (« 3e ex ») | Moteur de calcul | Étape 0 | À valider |
| HYP-06 | Frais : inscription ou réinscription, scolarité mensuelle ou par tranches, tenue, examen | `fee_types`, modèles de grille | Étape 0 : grilles de 3 écoles | À valider |
| HYP-07 | Plafonds d'inscription 150 000 GNF et de réinscription 100 000 GNF (presse 2022-2023) | Avertissement non bloquant à la saisie de la grille | Étape 0 : DCE | Sourcé presse, à confirmer |
| HYP-08 | Remise de fratrie fréquente | `discounts` | Étape 0 | À valider |
| HYP-09 | Reçu : en-tête de l'école, montant en chiffres et en lettres, reste à payer, caissier, QR de vérification | Modèle de reçu | Étape 0 : reçus réels | À valider |
| HYP-10 | Imprimante thermique 58 mm Bluetooth ; à défaut, PDF partagé | Module d'impression | Étape 3 : test d'un modèle acheté à Conakry | À valider |
| HYP-11 | Connexion par numéro et mot de passe, puis code à 4 chiffres sur l'appareil. Techniquement, le numéro est converti en adresse `224…@telephone.hailand.invalid` : la connexion « téléphone » de Supabase exige un fournisseur SMS payant. Code SMS à usage unique reporté à l'étape 5 | `src/lib/phone.ts`, écrans de connexion, fonction `members` | Étape 5 | Adaptation assumée |
| HYP-12 | Matricule national : texte libre, unique par école si renseigné | `students.national_id` | Étape 0 : format auprès de la DCE | À valider |
| HYP-13 | Taille moyenne d'école cliente : 300 élèves ; performance testée jusqu'à 2 000 | Tests de performance | Étape 0 | Estimation |
| HYP-14 | Le parent paie l'école sur son compte marchand Orange Money ; le comptable saisit la référence | Mode de paiement « Orange Money » | Étape 0 : pratique des écoles | À valider |
| HYP-15 | Fournisseur SMS en masse avec nom d'expéditeur, crédits prépayés par l'école | Fonction serveur d'envoi | Étape 0 : deux devis | À valider |
| HYP-16 | Modèle de bulletin A4 propre à chaque école, à partir d'un modèle guinéen de base | Gabarits PDF | Étape 0 : bulletins réels | À valider |
| HYP-17 | Hébergement en Europe : projet Supabase en Irlande (eu-west-1) | Infrastructure | Juriste | À valider |

## 6. Détail des étapes

### Étape 0 — Terrain (à mener par l'équipe, pas par le code)

Objectif : remplacer les hypothèses par des faits avant de figer les modules 3 et 4. Le kit est dans `docs/terrain/`.

- 0.1 Dix entretiens : 4 fondateurs, 3 comptables, 3 directions des études (guide : `docs/terrain/guide-entretien.md`).
- 0.2 Collecte de documents réels dans au moins 3 écoles : bulletins de chaque cycle, reçus, grille de frais, cahier de caisse, liste de classe, fiche d'inscription (grille : `docs/terrain/grille-collecte.md`).
- 0.3 Rendez-vous avec une DCE de Conakry : règles de notation et de passage, format des statistiques demandées, format du matricule.
- 0.4 Demandes écrites : conditions de compte marchand Orange Money Guinée ; deux devis de SMS en masse.
- 0.5 Sélection de 3 à 5 écoles pilotes (critères : `docs/terrain/grille-collecte.md`).
- 0.6 Mesure de départ chez les pilotes : taux de recouvrement, temps de production des bulletins, nombre de contestations de paiement.
- 0.7 Mise à jour du registre des hypothèses.

**Sortie :** registre mis à jour, documents numérisés dans `docs/terrain/collecte/` (sans données personnelles d'élèves), 3 pilotes engagés par écrit.

### Étape 1 — Socle (5 semaines)

| Lot | Contenu | Livrable |
| --- | --- | --- |
| 1.1 | Initialisation : React, TypeScript strict, Vite, Tailwind, application installable (PWA), Vitest, intégration continue | Dépôt qui se construit et se teste |
| 1.2 | Schéma serveur du socle : organisations, écoles, profils, adhésions et rôles, appareils, journal d'audit, journal des opérations | Migration SQL |
| 1.3 | Isolation par école : sécurité par ligne, fonctions d'appartenance et de rôle | Migration SQL et tests d'étanchéité |
| 1.4 | Protocole de synchronisation serveur : enregistrement d'appareil et préfixe de reçu, application idempotente des opérations, dernière écriture gagnante champ par champ, tables en ajout seul, curseur de lecture monotone | Fonctions SQL `register_device`, `apply_operations`, `pull_changes` |
| 1.5 | Base locale et file d'opérations : chaque écriture modifie la base locale et ajoute une opération, dans la même transaction | Module `src/sync/` |
| 1.6 | Moteur de synchronisation : envoi par lots, réception des changements, reprise après erreur, détection du réseau | Module `src/sync/engine.ts` |
| 1.7 | Authentification : connexion par téléphone et mot de passe, code local à 4 chiffres, ouverture hors connexion, révocation d'appareil | Écrans de connexion et de code |
| 1.8 | Comptes et rôles : création des membres par le fondateur, script d'amorçage d'une école par l'équipe Hailand | Fonction serveur `create-member`, script `scripts/bootstrap-school.ts` |
| 1.9 | Coquille de l'application : navigation selon le rôle, indicateur permanent de synchronisation | Application navigable |
| 1.10 | Preuve du jalon : test automatisé où deux appareils travaillent hors ligne puis se synchronisent | Test d'intégration sur un vrai moteur PostgreSQL |

**Sortie :** deux téléphones hors ligne se synchronisent sans perte ni doublon ; une école ne lit ni n'écrit les données d'une autre.

### Étape 2 — École et élèves (3 semaines)

| Lot | Contenu |
| --- | --- |
| 2.1 | Référentiel guinéen préchargé : niveaux CP1 à Terminale, cycles, profils SS, SE, SM, matières types (HYP-01) |
| 2.2 | Paramétrage : année scolaire, périodes (HYP-03), classes, matières, coefficients, enseignant par matière, en-tête et logo |
| 2.3 | Fiches élèves, tuteurs, fratries, inscriptions annuelles, documents du dossier, photo compressée |
| 2.4 | Recherche locale instantanée par nom ou matricule, moins de 100 ms sur 2 000 élèves |
| 2.5 | Import Excel : modèle fourni, contrôle des erreurs ligne par ligne, aperçu avant import |
| 2.6 | Réinscription en masse d'une année sur l'autre |
| 2.7 | Listes de classe et certificat de scolarité en PDF |

**Sortie :** une école réelle de 400 élèves chargée en moins d'une journée.

### Étape 3 — Frais et caisse (5 semaines)

| Lot | Contenu |
| --- | --- |
| 3.1 | Types de frais et grille par niveau (HYP-06, HYP-07) |
| 3.2 | Génération des échéanciers par élève ; remises et fratries tracées (HYP-08) |
| 3.3 | Encaissement : parcours 1, paiement partiel, affectation automatique aux échéances les plus anciennes |
| 3.4 | Reçu numéroté : PDF, ticket 58 mm, montant en lettres, QR de vérification (HYP-09, HYP-10) |
| 3.5 | Annulation : demandée par le comptable, validée par le fondateur, tracée |
| 3.6 | Sessions de caisse : ouverture, clôture, écart entre attendu et compté |
| 3.7 | Impayés : liste par classe et par ancienneté, liste « en règle ou non » pour le surveillant, lettres de rappel imprimables |
| 3.8 | Mobile money niveau 1 : mode Orange Money ou MoMo avec référence de transaction obligatoire et unique (HYP-14) |
| 3.9 | Fiche de solde : échéancier coloré, historique des reçus |
| 3.10 | Page de vérification d'un reçu par son QR, sans donnée personnelle affichée |

**Sortie :** un comptable encaisse en moins de 30 secondes sans réseau ; deux caisses hors ligne n'émettent jamais le même numéro.

### Étape 4 — Notes et bulletins (5 semaines)

| Lot | Contenu |
| --- | --- |
| 4.1 | Évaluations : devoirs, mensuelles, compositions, barème et poids (HYP-04) |
| 4.2 | Grille de saisie enseignant hors connexion, clavier numérique, contrôle du barème |
| 4.3 | Moteur de calcul : moyennes par matière, moyenne générale coefficientée, rangs avec ex aequo, moyenne de classe (HYP-01 à HYP-05) ; testé contre des bulletins réels calculés à la main |
| 4.4 | Suivi d'avancement : matières complètes ou manquantes par classe |
| 4.5 | Verrouillage de période, refusé côté serveur après verrouillage |
| 4.6 | Appréciations et décisions du conseil |
| 4.7 | Bulletins PDF par classe (HYP-16), procès-verbal de conseil, relevé annuel et décision de passage |

**Sortie :** bulletins identiques au calcul manuel sur une classe témoin.

### Étape 5 — Messages et tableau de bord (2 semaines)

| Lot | Contenu |
| --- | --- |
| 5.1 | Fournisseur SMS : fonction serveur d'envoi, file d'attente, crédits prépayés par école, coût affiché avant envoi (HYP-15) |
| 5.2 | Modèles de messages : reçu, relance, annonce |
| 5.3 | SMS de reçu automatique ; relance groupée des impayés |
| 5.4 | Partage WhatsApp des reçus et bulletins en PDF |
| 5.5 | Tableau de bord du fondateur : 4 cartes, recouvrement par classe, dernière synchronisation de chaque caisse, journal des annulations |
| 5.6 | Code SMS à usage unique à la première connexion d'un appareil (HYP-11) |

**Sortie :** le fondateur lit sa recette du jour sur son téléphone.

### Étape 6 — Pilote et durcissement (4 semaines)

| Lot | Contenu |
| --- | --- |
| 6.1 | Performances sur Android d'entrée de gamme : démarrage < 3 s, recherche < 100 ms, synchronisation en kilo-octets |
| 6.2 | Chiffrement des données locales, révocation à distance testée |
| 6.3 | Sauvegardes : quotidienne, copie hebdomadaire chiffrée chez un second fournisseur, test de restauration ; export Excel par l'école |
| 6.4 | Support : groupe WhatsApp par école, alerte interne après 7 jours de classe sans paiement |
| 6.5 | Contrat de sous-traitance, mention d'information et consentement SMS sur la fiche d'inscription, avis du juriste (HYP-17) |
| 6.6 | Mesure après un trimestre chez les pilotes, comparée à la mesure de départ (0.6) |
| 6.7 | Corrections issues des pilotes |

**Sortie :** un trimestre complet sans perte de données.

## 7. Suivi d'avancement

| Lot | État | Preuve |
| --- | --- | --- |
| Étape 0 | Kit rédigé ; entretiens à mener par l'équipe | `docs/terrain/` |
| 1.1 Initialisation | Fait | `npm run build`, intégration continue `.github/workflows/ci.yml` |
| 1.2 Schéma serveur du socle | Fait | `supabase/migrations/20261126000001_socle.sql` |
| 1.3 Isolation par école | Fait | `tests/sql/socle.test.ts`, bloc « isolation par école » |
| 1.4 Protocole de synchronisation serveur | Fait | `tests/sql/socle.test.ts`, blocs « appareils », « opérations », « lecture » |
| 1.5 Base locale et file d'opérations | Fait | `src/sync/db.ts`, `src/sync/store.ts` |
| 1.6 Moteur de synchronisation | Fait | `src/sync/engine.ts` |
| 1.7 Authentification | Fait | `src/auth/`, `tests/unit.test.ts` ; parcours vérifié dans le navigateur avec un serveur simulé, réouverture hors connexion comprise |
| 1.8 Comptes et rôles | Fait, vérifié sur le serveur | `supabase/functions/members/` déployée ; création et retrait d'un membre vérifiés par `npm run smoke:remote` |
| 1.9 Coquille de l'application | Fait | `src/app/` |
| 1.10 Preuve du jalon | Fait en test automatisé | `tests/sync/deux-appareils.test.ts` |
| Déploiement sur Supabase | Fait | Projet de l'organisation HailandSchool (UE, Irlande), 2 migrations, contrôle de bout en bout `scripts/smoke-remote.ts` : 18 contrôles conformes |
| Jalon de l'étape 1 sur matériel réel | À faire | Deux téléphones Android en mode avion, avec l'école de test |
| Étapes 2 à 6 | À venir | |

## 8. Journal des changements du plan

| Date | Changement | Raison |
| --- | --- | --- |
| 26/11/2026 | Version 1 | Démarrage du MVP |
| 26/11/2026 | Lot 1.7 : le code SMS à usage unique passe à l'étape 5 (HYP-11) ; le mot de passe provisoire donné par le fondateur doit être changé à la première connexion | Aucun fournisseur SMS choisi avant l'étape 0 |
| 26/11/2026 | Lot 1.8 : création des membres limitée au personnel ; parents et élèves en V2 avec l'espace parent | Périmètre MVP |
| 26/11/2026 | Le chiffrement des données locales reste au lot 6.2, comme prévu | Rappel : le code à 4 chiffres protège l'accès, pas encore le stockage |
| 26/11/2026 | Projet Supabase installé en Irlande et non à Paris | Création du projet de Paris impossible (limite de projets gratuits) ; projet créé par l'équipe dans l'organisation HailandSchool |
| 26/11/2026 | Migration 2 : registre de synchronisation lisible malgré l'activation automatique de la sécurité par ligne ; droits par défaut de Supabase retirés | Contrôle de sécurité du projet ; sans correction, toute synchronisation aurait échoué et les fonctions d'administration auraient été appelables |
| 26/11/2026 | Connexion par adresse technique dérivée du numéro (HYP-11) | Fournisseur « téléphone » désactivé sur le projet, il exige un service SMS |
