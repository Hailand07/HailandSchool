# Hailand School

Gestion des écoles privées guinéennes sur téléphone Android, même sans réseau : caisse, reçus, impayés, notes et bulletins.

- Étude et conception : [document de conception](https://claude.ai/artifact/5RgYo7JimHdFufzWMARepT)
- Plan d'attaque du MVP et avancement : [docs/PLAN_ATTAQUE.md](docs/PLAN_ATTAQUE.md)
- Kit d'entretiens de terrain : [docs/terrain/](docs/terrain/)

## Démarrer

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run dev
```

## Vérifier

```bash
npm test
```

Les tests exécutent les migrations SQL sur un vrai PostgreSQL embarqué (PGlite) : isolation entre écoles, synchronisation, et le jalon de l'étape 1 (deux téléphones hors ligne convergent sans perte ni doublon).

## Structure

| Dossier | Contenu |
| --- | --- |
| `supabase/migrations/` | Schéma, sécurité par ligne, protocole de synchronisation (`apply_operations`, `pull_changes`) |
| `supabase/functions/members/` | Création et retrait des membres par le fondateur |
| `src/sync/` | Base locale, file d'opérations, moteur de synchronisation |
| `src/auth/` | Connexion, code local à 4 chiffres |
| `src/app/` | Coquille de l'application et écrans |
| `scripts/bootstrap-school.ts` | Création d'une école et de son fondateur par l'équipe Hailand |
| `tests/` | Tests SQL, tests de synchronisation, tests unitaires |

## Créer une école

```bash
SUPABASE_URL=https://VOTRE-PROJET.supabase.co SUPABASE_SERVICE_ROLE_KEY=... npm run bootstrap-school -- --organisation "Groupe scolaire Exemple" --ecole "GS Exemple Matoto" --fondateur "Prénom Nom" --telephone "620 00 00 00"
```
