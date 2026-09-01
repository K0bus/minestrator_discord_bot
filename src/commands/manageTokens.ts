import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder
} from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const data = new SlashCommandBuilder()
  .setName('manage-tokens')
  .setDescription('Gère les clés API MineStrator enregistrées (lister, modifier, tester ou supprimer)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/**
 * Builds the tokens management embed and action components for a guild.
 */
export async function buildTokensListResponse(guildId: string): Promise<{
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[];
}> {
  const tokens = await prisma.token.findMany({
    where: { guildId },
    include: {
      servers: {
        select: { id: true, name: true, gameType: true }
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  const embed = new EmbedBuilder()
    .setTitle('🔑 Gestion des clés API MineStrator')
    .setColor(0x3b82f6)
    .setTimestamp();

  if (tokens.length === 0) {
    embed.setDescription('❌ **Aucune clé API enregistrée sur ce serveur Discord.**\n\nUtilisez la commande `/setup-token` pour enregistrer votre première clé API MineStrator.');
    return {
      embeds: [embed],
      components: []
    };
  }

  let description = `Voici les clés API actuellement configurées pour ce serveur Discord (${tokens.length}) :\n\n`;

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_token_to_manage')
    .setPlaceholder('Sélectionnez un token à modifier ou supprimer...');

  for (const token of tokens) {
    const serverNames = token.servers.length > 0 
      ? token.servers.map(s => `\`${s.name}\` (${s.gameType})`).join(', ')
      : '*Aucun serveur associé*';

    description += `• **Alias : \`${token.alias}\`**\n`;
    description += `  └ Date : <t:${Math.floor(token.createdAt.getTime() / 1000)}:d>\n`;
    description += `  └ Serveurs liés (${token.servers.length}) : ${serverNames}\n\n`;

    selectMenu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(token.alias.slice(0, 100))
        .setValue(token.id)
        .setDescription(`${token.servers.length} serveur(s) associé(s)`.slice(0, 100))
        .setEmoji('🔑')
    );
  }

  embed.setDescription(description);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  return {
    embeds: [embed],
    components: [row]
  };
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<unknown> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: '❌ Seuls les administrateurs peuvent gérer les clés API.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId;
  if (!guildId) {
    return interaction.editReply('❌ Cette commande ne peut être exécutée que dans un serveur Discord.');
  }

  try {
    const { embeds, components } = await buildTokensListResponse(guildId);
    return interaction.editReply({
      embeds,
      components
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ManageTokensCommand] Error:', error);
    return interaction.editReply(`❌ Une erreur est survenue lors de la récupération des tokens : ${rawMessage}`);
  }
}
