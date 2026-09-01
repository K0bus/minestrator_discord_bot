import { Interaction } from 'discord.js';
import * as setupCommand from '../commands/setup.js';
import * as addServerCommand from '../commands/addServer.js';
import * as manageTokensCommand from '../commands/manageTokens.js';

/**
 * Routes and handles incoming Slash Command interactions.
 */
export async function handleCommand(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    if (commandName === 'setup-token') {
      await setupCommand.execute(interaction);
    } else if (commandName === 'add-server') {
      await addServerCommand.execute(interaction);
    } else if (commandName === 'manage-tokens') {
      await manageTokensCommand.execute(interaction);
    } else {
      await interaction.reply({ content: '❌ Commande inconnue.', ephemeral: true });
    }
  } catch (error) {
    console.error(`[CommandHandler] Error executing command "${commandName}":`, error);
    const replyMessage = '❌ Une erreur critique est survenue lors de l\'exécution de cette commande.';
    
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: replyMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: replyMessage, ephemeral: true });
      }
    } catch (replyError) {
      console.error('[CommandHandler] Failed to send error response:', replyError);
    }
  }
}
