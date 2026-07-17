import { Interaction, PermissionFlagsBits } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { MinestratorClient, PowerAction } from '../services/minestrator.js';
import { decrypt } from '../services/encryption.js';
import { handleContinueButton, handleEditButton, handlePermissionsButton, handleAnnouncementsButton, handleDisableAnnouncementsButton } from './componentHandler.js';

const prisma = new PrismaClient();

/**
 * Intercepts and processes button clicks on server control embeds.
 */
export async function handleButton(interaction: Interaction): Promise<unknown> {
  if (!interaction.isButton()) return;

  const { customId, guildId, message } = interaction;
  
  if (customId.startsWith('btn_continue_add_server:')) {
    await handleContinueButton(interaction);
    return;
  }

  if (customId === 'server_edit') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: '❌ Vous n\'avez pas la permission (Administrateur) requise pour éditer ce serveur.',
        ephemeral: true
      });
      return;
    }
    await handleEditButton(interaction);
    return;
  }

  if (customId === 'server_permissions') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: '❌ Vous n\'avez pas la permission (Administrateur) requise pour gérer la whitelist de ce serveur.',
        ephemeral: true
      });
      return;
    }
    await handlePermissionsButton(interaction);
    return;
  }

  if (customId === 'server_announcements') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: '❌ Vous n\'avez pas la permission (Administrateur) requise pour configurer les annonces de ce serveur.',
        ephemeral: true
      });
      return;
    }
    await handleAnnouncementsButton(interaction);
    return;
  }

  if (customId.startsWith('btn_disable_announcements:')) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: '❌ Vous n\'avez pas la permission (Administrateur) requise pour désactiver les annonces de ce serveur.',
        ephemeral: true
      });
      return;
    }
    await handleDisableAnnouncementsButton(interaction);
    return;
  }

  // Verify that it is one of our power buttons
  if (!['power_start', 'power_stop', 'power_restart'].includes(customId)) {
    return;
  }

  if (!guildId) {
    return interaction.reply({
      content: '❌ Cette action est impossible en dehors d\'un serveur Discord.',
      ephemeral: true
    });
  }

  try {
    // 2. Retrieve server configuration by matching message ID
    const server = await prisma.server.findFirst({
      where: {
        guildId,
        discordMessageId: message.id
      },
      include: {
        token: true
      }
    });

    if (!server) {
      return interaction.reply({
        content: '❌ Configuration du serveur introuvable pour ce panneau de contrôle.',
        ephemeral: true
      });
    }

    // Check permissions: Administrators OR whitelisted users OR users with whitelisted roles
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
    const whitelistedUsers = JSON.parse(server.allowedUsers || '[]');
    const whitelistedRoles = JSON.parse(server.allowedRoles || '[]');
    const isUserWhitelisted = whitelistedUsers.includes(interaction.user.id);
    
    let isRoleWhitelisted = false;
    const memberRoles = interaction.member?.roles;
    if (memberRoles && 'cache' in memberRoles) {
      isRoleWhitelisted = whitelistedRoles.some((roleId: string) => memberRoles.cache.has(roleId));
    } else if (Array.isArray(memberRoles)) {
      isRoleWhitelisted = whitelistedRoles.some((roleId: string) => memberRoles.includes(roleId));
    }

    if (!isAdmin && !isUserWhitelisted && !isRoleWhitelisted) {
      return interaction.reply({
        content: '❌ Vous n\'avez pas la permission requise (Administrateur ou Membre Autorisé) pour contrôler ce serveur.',
        ephemeral: true
      });
    }

    // Defer the reply immediately to handle potential API latency ephemerally
    await interaction.deferReply({ ephemeral: true });

    // 3. Map custom ID to API Power Action
    let action: PowerAction;
    let actionLabel = '';

    if (customId === 'power_start') {
      action = 'start';
      actionLabel = 'Démarrage';
    } else if (customId === 'power_stop') {
      action = 'stop';
      actionLabel = 'Arrêt';
    } else {
      action = 'restart';
      actionLabel = 'Redémarrage';
    }

    console.log(`[ButtonHandler] User ${interaction.user.tag} requested "${action}" on server "${server.name}" (${server.id})`);

    // 4. Decrypt token and instantiate MineStrator client
    const decryptedApiKey = decrypt(server.token.encryptedKey);
    const minestrator = new MinestratorClient(decryptedApiKey, server.minestratorServerId);

    // 5. Send command to MineStrator
    const result = await minestrator.executePowerAction(action);

    if (result.success) {
      return interaction.editReply(`✅ Commande de **${actionLabel}** envoyée avec succès à l'API MineStrator !`);
    } else {
      return interaction.editReply(`❌ Échec de la commande de **${actionLabel}** : ${result.error}`);
    }

  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ButtonHandler] Error processing button click:', error);
    if (interaction.deferred) {
      return interaction.editReply(`❌ Une erreur est survenue lors de l'exécution de l'action : ${rawMessage}`);
    } else {
      return interaction.reply({
        content: `❌ Une erreur est survenue lors de l'exécution de l'action : ${rawMessage}`,
        ephemeral: true
      });
    }
  }
}
