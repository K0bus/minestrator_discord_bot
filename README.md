# 🎮 Bot Discord MineStrator — Supervision & RCON

Un bot Discord performant conçu pour superviser et administrer des serveurs de jeu hébergés chez **MineStrator** (Palworld, Minecraft, Ark, Satisfactory, etc.). Il combine l'utilisation des endpoints API MineStrator et des requêtes RCON directes.

---

## ✨ Fonctionnalités

*   📊 **Panel de Supervision en Temps Réel :** Affichage dynamique du statut (En ligne, Hors ligne, Erreur), de l'adresse de jeu, du nombre de joueurs connectés, de la liste des joueurs et du délai d'auto-stop.
*   ⚡ **Rafraîchissement ultra-rapide :** Balayage toutes les **5 secondes** du statut du serveur de jeu via RCON.
*   🔌 **Contrôles d'Alimentation :** Boutons interactifs pour **Démarrer** (`▶️`), **Arrêter** (`⏹️`) et **Redémarrer** (`🔄`) le serveur directement depuis Discord.
*   🛡️ **Système de Whitelist d'Accès :** Possibilité d'accorder à des membres ou des rôles spécifiques le droit d'utiliser les boutons d'alimentation (sans pour autant être administrateur du serveur Discord).
*   ⚙️ **Édition Intuitive :** Modification à la volée des ports de jeu/RCON, du mot de passe RCON, et du nom d'affichage via un formulaire modal de 5 champs.
*   📢 **Salon d'Annonces & Logs :** Envoi automatique de logs configurés dans un salon textuel pour :
    *   Les changements de statut du serveur (En ligne / Hors ligne).
    *   Les actions d'alimentation demandées par les utilisateurs (Démarrage / Arrêt / Redémarrage).
    *   Les connexions et déconnexions en direct des joueurs.
*   💾 **Auto-Stop Intelligent :** Arrêt planifié automatique du serveur de jeu en cas d'inactivité (serveur vide) avec compte à rebours sous forme de timestamp Discord dynamique (`<t:timestamp:R>`).
*   🎯 **Auto-détection RCON :** Lors de l'ajout d'un serveur, le bot analyse les fichiers de configuration du jeu (`server.properties` ou `PalWorldSettings.ini`) via l'API MineStrator pour récupérer automatiquement le port et le mot de passe RCON.
*   🧹 **Nettoyage Automatique :** Si un salon ou un panel de contrôle est supprimé manuellement de Discord, le serveur associé est automatiquement désenregistré de la base de données.

---

## 🛠️ Commandes Slash

*   `/setup-token` : Enregistre de manière sécurisée (chiffrée) une clé API MineStrator sous un alias donné.
*   `/add-server` : Démarre le flux interactif d'ajout de serveur :
    1.  Sélection du serveur actif via un menu déroulant.
    2.  Choix du type de jeu (avec pré-détection automatique).
    3.  Ouverture du modal de configuration (ports, mot de passe RCON).

---

## 🚀 Configuration & Lancement Local

### Prérequis
*   Node.js v20 ou supérieur.
*   Une base SQLite (gérée automatiquement via Prisma).
*   Un bot Discord configuré avec les **Intents** suivants activés sur le portail développeur Discord :
    *   `Guilds`
    *   `GuildMessages`
    *   `GuildMembers` (facultatif mais recommandé)

### 1. Variables d'Environnement
Créez un fichier `.env` à la racine en copiant `.env.example` :
```env
DISCORD_TOKEN=votre_token_bot_discord
CLIENT_ID=id_de_votre_application_discord
DATABASE_ENCRYPTION_KEY=votre_cle_de_chiffrement_aes_32_caracteres
DATABASE_URL="file:./data/dev.db"
```

### 2. Installation & Lancement
```bash
# Installation des dépendances
npm install

# Création du dossier de stockage et initialisation de la base de données SQLite
mkdir -p data
npm run prisma:push

# Lancement en mode développement
npm run dev

# Construction et lancement en production
npm run build
npm run start
```

---

## 🐳 Déploiement avec Docker (Recommandé)

L'application est entièrement Dockerisée et peut être déployée en une seule commande en persistant les données locales.

### Déploiement rapide avec Docker Compose
1.  Assurez-vous que le fichier `.env` est correctement configuré.
2.  Démarrez le conteneur en arrière-plan :
    ```bash
    docker compose up -d
    ```
3.  Les logs peuvent être visionnés avec :
    ```bash
    docker compose logs -f
    ```

### Spécificités Docker
*   Le dossier contenant la base de données SQLite est monté dans le répertoire local `./data` afin que vos configurations de serveurs restent persistées lors des mises à jour du conteneur.
*   La commande de démarrage du conteneur applique automatiquement les modifications de schéma de base de données (`npx prisma db push`) avant de lancer le bot.
