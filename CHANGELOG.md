# Changelog

Toutes les évolutions notables de Bails sont listées ici.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet
respecte le [versionnage sémantique](https://semver.org/lang/fr/).

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

[0.2.0]: https://github.com/hansipie/Bails/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/hansipie/Bails/releases/tag/v0.1.0
