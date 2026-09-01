import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createDiscordClient, commands } from './client.js';
import { handleCommand } from './handlers/commandHandler.js';
import { handleButton } from './handlers/buttonHandler.js';
import { handleSelectMenu, handleModalSubmit, handleMentionableSelectMenu, handleChannelSelectMenu } from './handlers/componentHandler.js';
import { MonitorService } from './services/monitor.js';

const prisma = new PrismaClient();
const client = createDiscordClient();
let monitorService: MonitorService | null = null;

client.once('ready', async () => {
  console.log(`[Bot] Connecté en tant que ${client.user?.tag}`);

  try {
    console.log('[Bot] Déploiement des commandes Slash...');
    await client.application?.commands.set(commands);
    console.log('[Bot] Commandes Slash enregistrées globalement avec succès.');
  } catch (error) {
    console.error('[Bot] Erreur lors du déploiement des commandes Slash :', error);
  }

  // Initialize and run the monitoring loop (default: every 15 seconds)
  const monitorInterval = process.env.MONITOR_INTERVAL_MS ? parseInt(process.env.MONITOR_INTERVAL_MS, 10) : 15000;
  monitorService = new MonitorService(client, prisma);
  monitorService.start(monitorInterval);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
    } else if (interaction.isMentionableSelectMenu()) {
      await handleMentionableSelectMenu(interaction);
    } else if (interaction.isChannelSelectMenu()) {
      await handleChannelSelectMenu(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    }
  } catch (error) {
    console.error('[Bot] Error handling interaction:', error);
  }
});

// Guard processes against unhandled failures
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Bot] Rejet de promesse non géré à :', promise, 'raison :', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Bot] Exception non capturée jetée :', error);
});

/**
 * Handles graceful cleanups during process shutdowns.
 */
const shutdown = async () => {
  console.log('\n[Bot] Signal d\'extinction reçu. Nettoyage des ressources...');
  
  if (monitorService) {
    monitorService.stop();
  }

  try {
    await prisma.$disconnect();
    console.log('[Prisma] Déconnexion de la base de données SQLite réussie.');
  } catch (dbErr) {
    console.error('[Prisma] Erreur lors de la déconnexion de la base de données :', dbErr);
  }

  client.destroy();
  console.log('[Bot] Connexion Discord fermée.');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Connect client to Discord Gateway
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ Erreur : DISCORD_TOKEN absent du fichier d\'environnement (.env).');
  process.exit(1);
}

client.login(token).catch(error => {
  console.error('❌ Échec de la connexion à la passerelle Discord :', error);
  process.exit(1);
});
