import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  PermissionFlagsBits
} from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { encrypt } from '../services/encryption.js';

const prisma = new PrismaClient();

export const data = new SlashCommandBuilder()
  .setName('setup-token')
  .setDescription('Enregistre ou met à jour une clé API MineStrator pour ce serveur')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(option => 
    option.setName('alias')
      .setDescription('Nom/alias de la clé API (ex: principal, secondaire)')
      .setRequired(true)
  )
  .addStringOption(option => 
    option.setName('api-key')
      .setDescription('Votre clé API MineStrator (récupérée dans votre panel)')
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<unknown> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: '❌ Seuls les administrateurs peuvent enregistrer des clés API.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId;
  if (!guildId) {
    return interaction.editReply('❌ Cette commande ne peut être exécutée que dans un serveur Discord.');
  }

  const alias = interaction.options.getString('alias', true).trim();
  const apiKey = interaction.options.getString('api-key', true).trim();

  try {
    // Ensure guild exists in database
    await prisma.guild.upsert({
      where: { id: guildId },
      create: { id: guildId },
      update: {}
    });

    // Encrypt key
    const encryptedKey = encrypt(apiKey);

    // Save token
    await prisma.token.upsert({
      where: {
        guildId_alias: {
          guildId,
          alias
        }
      },
      create: {
        guildId,
        alias,
        encryptedKey
      },
      update: {
        encryptedKey
      }
    });

    return interaction.editReply(`✅ Clé API MineStrator enregistrée avec succès sous l'alias \`${alias}\` ! Vous pouvez maintenant utiliser la commande \`/add-server\` pour lier vos serveurs.`);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[SetupTokenCommand] Error during setup:', error);
    return interaction.editReply(`❌ Une erreur est survenue lors de l'enregistrement de la clé API : ${rawMessage}`);
  }
}
