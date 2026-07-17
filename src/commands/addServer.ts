import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { MinestratorClient } from '../services/minestrator.js';
import { decrypt } from '../services/encryption.js';

const prisma = new PrismaClient();

export const data = new SlashCommandBuilder()
  .setName('add-server')
  .setDescription('Ajoute un serveur de jeu MineStrator de manière interactive')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addIntegerOption(option =>
    option.setName('auto-stop')
      .setDescription('Délai d\'auto-stop en minutes (0 pour désactiver, par défaut : 15)')
      .setRequired(false)
  )
  .addStringOption(option => 
    option.setName('token-alias')
      .setDescription('Alias de la clé API MineStrator à utiliser (par défaut la première trouvée)')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<unknown> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: '❌ Seuls les administrateurs peuvent ajouter des serveurs.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId;
  if (!guildId) {
    return interaction.editReply('❌ Cette commande ne peut être exécutée que dans un serveur Discord.');
  }

  const tokenAlias = interaction.options.getString('token-alias');
  const autoStopTimeout = interaction.options.getInteger('auto-stop') ?? 15;

  try {
    let token;
    if (tokenAlias) {
      token = await prisma.token.findUnique({
        where: {
          guildId_alias: {
            guildId,
            alias: tokenAlias.trim()
          }
        }
      });
    } else {
      token = await prisma.token.findFirst({
        where: { guildId }
      });
    }

    if (!token) {
      return interaction.editReply('❌ Aucun token API configuré pour ce serveur. Veuillez d\'abord enregistrer un token avec la commande `/setup-token`.');
    }

    const decryptedKey = decrypt(token.encryptedKey);
    const tempClient = new MinestratorClient(decryptedKey, '0');
    
    const userId = await tempClient.getUserId();
    const rawServers = await tempClient.listServers(userId);

    // Filtrer les serveurs désactivés, suspendus ou expirés
    const serversList = rawServers.filter(s => {
      const isDisabled = s.is_disabled === 1 || s.is_disabled === true;
      const isSuspended = s.is_suspended === 1 || s.is_suspended === true;
      const isExpired = s.is_expired === 1 || s.is_expired === true;
      return !isDisabled && !isSuspended && !isExpired;
    });

    if (serversList.length === 0) {
      return interaction.editReply('❌ Aucun serveur actif (non suspendu / non expiré) trouvé sur votre compte MineStrator.');
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`select_minestrator_server:${token.id}:${autoStopTimeout}`)
      .setPlaceholder('Sélectionnez un serveur à ajouter...');

    for (const s of serversList) {
      if (selectMenu.options.length >= 25) break;

      selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(s.name.slice(0, 100))
          .setValue(String(s.id))
          .setDescription(`Jeu : ${s.egg_name || 'Inconnu'} | IP : ${s.ip}:${s.port}`.slice(0, 100))
      );
    }

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    return interaction.editReply({
      content: '✅ Liste des serveurs récupérée. Veuillez sélectionner celui que vous souhaitez configurer :',
      components: [row]
    });

  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[AddServerCommand] Error during listing:', error);
    const truncatedMessage = rawMessage.slice(0, 1500);
    return interaction.editReply(`❌ Une erreur est survenue lors de la récupération des serveurs : ${truncatedMessage}`);
  }
}
