# Changelog

Toutes les évolutions notables de Bails sont listées ici.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet
respecte le [versionnage sémantique](https://semver.org/lang/fr/).

## [Unreleased]

### Ajouté

- **Provider Antigravity** (Google, CLI `agy`) : quota des modèles Gemini (enregistré dans
  l'historique comme session) et limites 5 h / hebdomadaires du groupe Claude/GPT, avec le plan
  du compte. Le token est lu dans le trousseau système (Linux, macOS).
- **Renouvellement du token Antigravity** : quand il a expiré, Bails lance `agy models`, qui
  renouvelle lui-même son token. Si ça échoue, la carte garde les dernières jauges connues, avec
  leur heure, au lieu de passer en erreur.
- **Masquer une carte provider** : bouton `Hide` sur chaque carte, `Show` dans la barre « Hidden »
  pour la ramener. Un provider masqué n'est plus interrogé ; le choix est mémorisé dans
  `settings.json` (userData).

### Changé

- **Fenêtre principale ajustée au contenu** : la hauteur suit les cartes affichées (1 à 3
  providers, carte masquée, bloc de connexion, chargement), dans la limite de l'écran.

### Supprimé

- **Bouton `History`** des cartes provider : l'historique s'ouvre toujours d'un clic sur la carte.

## [0.2.1] - 2026-11-20

### Changé

- Les graphiques d'historique affichent le **% restant** (comme les cartes) au lieu du % utilisé.

## [0.2.0] - 2026-11-20

### Ajouté

- **Fenêtre d'historique** : un clic sur la carte Claude Code ou Codex (ou sur son bouton
  `History`) ouvre une fenêtre avec les courbes du quota session et hebdomadaire, en % utilisé.
  - Périodes 24 h, 3 j et 7 j (7 j par défaut), tooltip au survol, mise à jour chaque minute.
  - Une seule fenêtre par provider : un nouveau clic la ramène au premier plan.
  - Les courbes sont coupées quand deux mesures sont espacées de plus de 20 min (app fermée, hors ligne).
- **Enregistrement de l'historique** dans `usage-history.json` (dossier de données de l'app) :
  seuls les relevés réussis sont gardés, au plus un par minute, et les mesures de plus de 30 jours
  sont supprimées.
- Rafraîchissement en arrière-plan toutes les 5 min dans le process main, pour que l'historique
  continue de se remplir.
- Captures de la fenêtre d'historique dans le README.

### Changé

- CI : actions GitHub épinglées sur des SHA de commit, ajout de Dependabot.

## [0.1.0] - 2026-11-05

### Ajouté

- Première version : cartes Claude Code et Codex avec session 5 h, quota hebdomadaire et
  dépense on-demand, jauges pixel, compte à rebours avant reset, auto-refresh, email masqué,
  commande de connexion à copier.
- Fenêtre « À propos » affichant la version.
- Packaging electron-builder (macOS signé et notarisé, Windows, Linux) et workflow de release GitHub.
- Licence MIT.

[Unreleased]: https://github.com/hansipie/Bails/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/hansipie/Bails/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/hansipie/Bails/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/hansipie/Bails/releases/tag/v0.1.0
