import { 
  Interaction, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ActionRowBuilder, 
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuInteraction,
  MentionableSelectMenuBuilder,
  MentionableSelectMenuInteraction,
  ChannelSelectMenuBuilder,
  ChannelSelectMenuInteraction,
  ChannelType,
  EmbedBuilder
} from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { MinestratorClient, parseRconFromProperties } from '../services/minestrator.js';
import { encrypt, decrypt } from '../services/encryption.js';
import { createServerEmbed, createControlButtons } from '../services/embeds.js';
import { buildTokensListResponse } from '../commands/manageTokens.js';

const prisma = new PrismaClient();

/**
 * Handles select menu component interactions.
 */
export async function handleSelectMenu(interaction: Interaction): Promise<void> {
  if (!interaction.isStringSelectMenu()) return;

  const { customId } = interaction;
  
  if (customId.startsWith('select_minestrator_server:')) {
    await handleServerSelection(interaction);
  } else if (customId.startsWith('select_game_type:')) {
    await handleGameTypeSelection(interaction);
  } else if (customId === 'select_token_to_manage') {
    await handleSelectTokenToManage(interaction);
  }
}

/**
 * Step 2: Handle server selection and show Game Type select menu + Continue button.
 */
async function handleServerSelection(interaction: StringSelectMenuInteraction): Promise<void> {
  const { customId, memberPermissions } = interaction;
  
  if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '❌ Seuls les administrateurs peuvent configurer des serveurs.',
      ephemeral: true
    });
    return;
  }

  const parts = customId.split(':');
  const tokenId = parts[1];
  const autoStopTimeout = parts[2] || '15';
  const minestratorServerId = interaction.values[0];

  try {
    let token = await prisma.token.findUnique({
      where: { id: tokenId }
    });

    if (!token && interaction.guildId) {
      console.warn(`[ComponentHandler] Token ID "${tokenId}" introuvable. Tentative de récupération du token par guildId "${interaction.guildId}"...`);
      token = await prisma.token.findFirst({
        where: { guildId: interaction.guildId }
      });
    }

    if (!token) {
      console.error(`[ComponentHandler] Aucun token trouvé pour le serveur Discord ${interaction.guildId} (ID recherché: ${tokenId})`);
      await interaction.reply({ content: '❌ Token API introuvable en base. Veuillez enregistrer une clé avec `/setup-token`.', ephemeral: true });
      return;
    }

    const decryptedKey = decrypt(token.encryptedKey);
    const tempClient = new MinestratorClient(decryptedKey, minestratorServerId);
    
    const userId = await tempClient.getUserId();
    const serversList = await tempClient.listServers(userId);
    const serverInfo = serversList.find(s => String(s.id) === minestratorServerId);

    const serverName = serverInfo?.name || 'Serveur de Jeu';
    const eggName = serverInfo?.egg_name || '';

    // Auto-detect Game Type from egg_name
    let guessedGameType = 'OTHER';
    const eggLower = eggName.toLowerCase();
    if (eggLower.includes('palworld')) {
      guessedGameType = 'PALWORLD';
    } else if (eggLower.includes('valheim')) {
      guessedGameType = 'VALHEIM';
    } else if (eggLower.includes('ark')) {
      if (eggLower.includes('ascended') || eggLower.includes('sa')) {
        guessedGameType = 'ARKSA';
      } else {
        guessedGameType = 'ARK';
      }
    } else if (eggLower.includes('satisfactory')) {
      guessedGameType = 'SATISFACTORY';
    } else if (eggLower.includes('minecraft')) {
      guessedGameType = 'MINECRAFT';
    }

    // Build the Game Type Select Menu
    const gameTypeSelect = new StringSelectMenuBuilder()
      .setCustomId(`select_game_type:${minestratorServerId}:${tokenId}:${autoStopTimeout}`)
      .setPlaceholder('Choisissez le type de jeu...');

    const gameOptions = [
      { label: 'Palworld', value: 'PALWORLD', description: 'Jeu Palworld (Support RCON et Query)' },
      { label: 'ARK: Survival Evolved', value: 'ARK', description: 'Serveur ARK: SE (Query UDP)' },
      { label: 'ARK: Survival Ascended', value: 'ARKSA', description: 'Serveur ARK: SA (Query UDP)' },
      { label: 'Valheim', value: 'VALHEIM', description: 'Serveur Valheim (Query Steam A2S + Fallback API)' },
      { label: 'Minecraft', value: 'MINECRAFT', description: 'Serveur de jeu Minecraft' },
      { label: 'Satisfactory', value: 'SATISFACTORY', description: 'Serveur de jeu Satisfactory' },
      { label: 'Autre Jeu (API MineStrator)', value: 'OTHER', description: 'Tout autre jeu hébergé (Supervision API)' }
    ];

    for (const opt of gameOptions) {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(opt.label)
        .setValue(opt.value)
        .setDescription(opt.description);

      if (opt.value === guessedGameType) {
        option.setDefault(true);
      }
      gameTypeSelect.addOptions(option);
    }

    // Build the Continue Button (pre-configured with guessedGameType)
    const continueBtn = new ButtonBuilder()
      .setCustomId(`btn_continue_add_server:${minestratorServerId}:${tokenId}:${autoStopTimeout}:${guessedGameType}`)
      .setLabel('Continuer la configuration')
      .setStyle(ButtonStyle.Success)
      .setEmoji('➡️');

    const rowSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(gameTypeSelect);
    const rowButton = new ActionRowBuilder<ButtonBuilder>().addComponents(continueBtn);

    await interaction.update({
      content: `✅ Serveur MineStrator sélectionné : **${serverName}**.\nVeuillez choisir le type de jeu pour ce serveur puis cliquer sur continuer :`,
      components: [rowSelect, rowButton]
    });

  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error during server selection:', error);
    await interaction.reply({
      content: `❌ Une erreur est survenue lors de la sélection du serveur : ${rawMessage.slice(0, 1000)}`,
      ephemeral: true
    });
  }
}

/**
 * Step 2b: Handle game type selection dropdown updates.
 */
async function handleGameTypeSelection(interaction: StringSelectMenuInteraction): Promise<void> {
  const { customId, memberPermissions } = interaction;

  if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '❌ Seuls les administrateurs peuvent configurer des serveurs.',
      ephemeral: true
    });
    return;
  }

  const parts = customId.split(':');
  const minestratorServerId = parts[1];
  const tokenId = parts[2];
  const autoStopTimeout = parts[3] || '15';
  const selectedGameType = interaction.values[0];

  try {
    // Re-create the game type select menu with the new default selection
    const gameTypeSelect = new StringSelectMenuBuilder()
      .setCustomId(`select_game_type:${minestratorServerId}:${tokenId}:${autoStopTimeout}`)
      .setPlaceholder('Choisissez le type de jeu...');

    const gameOptions = [
      { label: 'Palworld', value: 'PALWORLD', description: 'Jeu Palworld (Support RCON et Query)' },
      { label: 'ARK: Survival Evolved', value: 'ARK', description: 'Serveur ARK: SE (Query UDP)' },
      { label: 'ARK: Survival Ascended', value: 'ARKSA', description: 'Serveur ARK: SA (Query UDP)' },
      { label: 'Valheim', value: 'VALHEIM', description: 'Serveur Valheim (Query Steam A2S + Fallback API)' },
      { label: 'Minecraft', value: 'MINECRAFT', description: 'Serveur de jeu Minecraft' },
      { label: 'Satisfactory', value: 'SATISFACTORY', description: 'Serveur de jeu Satisfactory' },
      { label: 'Autre Jeu (API MineStrator)', value: 'OTHER', description: 'Tout autre jeu hébergé (Supervision API)' }
    ];

    for (const opt of gameOptions) {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(opt.label)
        .setValue(opt.value)
        .setDescription(opt.description);

      if (opt.value === selectedGameType) {
        option.setDefault(true);
      }
      gameTypeSelect.addOptions(option);
    }

    // Re-create the button with the updated gameType value in its customId
    const continueBtn = new ButtonBuilder()
      .setCustomId(`btn_continue_add_server:${minestratorServerId}:${tokenId}:${autoStopTimeout}:${selectedGameType}`)
      .setLabel('Continuer la configuration')
      .setStyle(ButtonStyle.Success)
      .setEmoji('➡️');

    const rowSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(gameTypeSelect);
    const rowButton = new ActionRowBuilder<ButtonBuilder>().addComponents(continueBtn);

    await interaction.update({
      components: [rowSelect, rowButton]
    });

  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error during game type selection:', error);
    await interaction.reply({
      content: `❌ Une erreur est survenue lors de la sélection du type de jeu : ${rawMessage.slice(0, 1000)}`,
      ephemeral: true
    });
  }
}

/**
 * Step 3: Handle Continue button click and open configuration Modal.
 */
export async function handleContinueButton(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return;

  const { customId, memberPermissions } = interaction;

  if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '❌ Seuls les administrateurs peuvent configurer des serveurs.',
      ephemeral: true
    });
    return;
  }

  // Format: btn_continue_add_server:${minestratorServerId}:${tokenId}:${autoStopTimeout}:${gameType}
  const parts = customId.split(':');
  const minestratorServerId = parts[1];
  const tokenId = parts[2];
  const autoStopTimeout = parts[3];
  const gameType = parts[4] || '';

  if (!gameType) {
    await interaction.reply({
      content: '❌ Veuillez d\'abord sélectionner un type de jeu dans le menu déroulant.',
      ephemeral: true
    });
    return;
  }

  try {
    let token = await prisma.token.findUnique({
      where: { id: tokenId }
    });

    if (!token && interaction.guildId) {
      console.warn(`[ComponentHandler] Token ID "${tokenId}" introuvable dans handleContinueButton. Tentative de récupération du token par guildId "${interaction.guildId}"...`);
      token = await prisma.token.findFirst({
        where: { guildId: interaction.guildId }
      });
    }

    if (!token) {
      console.error(`[ComponentHandler] Aucun token trouvé dans handleContinueButton pour le serveur Discord ${interaction.guildId} (ID recherché: ${tokenId})`);
      await interaction.reply({ content: '❌ Token API introuvable en base. Veuillez enregistrer une clé avec `/setup-token`.', ephemeral: true });
      return;
    }

    const decryptedKey = decrypt(token.encryptedKey);
    const tempClient = new MinestratorClient(decryptedKey, minestratorServerId);
    
    const userId = await tempClient.getUserId();
    const serversList = await tempClient.listServers(userId);
    const serverInfo = serversList.find(s => String(s.id) === minestratorServerId);

    const serverName = serverInfo?.name || 'Serveur de Jeu';
    const serverIp = serverInfo?.ip || '';
    const serverPort = serverInfo?.port || 8211;

    // Attempt to retrieve and parse properties from MineStrator API
    let guessedRconPort = 25575;
    let guessedRconPassword = '';

    try {
      const propertiesData = await tempClient.getServerProperties();
      if (propertiesData?.properties) {
        const parsed = parseRconFromProperties(propertiesData.properties);
        if (parsed.rconPort) guessedRconPort = parsed.rconPort;
        if (parsed.rconPassword) guessedRconPassword = parsed.rconPassword;
        console.log(`[ComponentHandler] Analyse des propriétés pour le serveur ${minestratorServerId}: rconPort=${guessedRconPort}, mot de passe détecté=${guessedRconPassword !== ''}`);
      }
    } catch (propertiesErr) {
      console.warn(`[ComponentHandler] Échec de la récupération des propriétés pour le serveur ${minestratorServerId}:`, propertiesErr);
    }

    // 3. Construct Modal
    // Pass gameType and serverIp in customId to keep it stateless and fit the 5-field limit!
    let guessedQueryPort = serverPort;
    const typeUpper = gameType.toUpperCase();
    if (typeUpper === 'ARK' || typeUpper === 'ARKSE' || typeUpper === 'ARKSA' || typeUpper === 'VALHEIM') {
      guessedQueryPort = serverPort + 1;
    }

    const modal = new ModalBuilder()
      .setCustomId(`modal_add_server:${minestratorServerId}:${gameType}:${tokenId}:${autoStopTimeout}:${serverIp}`)
      .setTitle('Configuration RCON & Ports');

    const nameInput = new TextInputBuilder()
      .setCustomId('input_friendly_name')
      .setLabel('Nom d\'affichage')
      .setStyle(TextInputStyle.Short)
      .setValue(serverName.slice(0, 100))
      .setRequired(true);

    const portInput = new TextInputBuilder()
      .setCustomId('input_port')
      .setLabel('Port de JEU (ex: 7777 / 2456 / 25565)')
      .setStyle(TextInputStyle.Short)
      .setValue(String(serverPort))
      .setRequired(true);

    const queryPortInput = new TextInputBuilder()
      .setCustomId('input_query_port')
      .setLabel('Port Steam Query (ex: 7778 / 2457)')
      .setStyle(TextInputStyle.Short)
      .setValue(String(guessedQueryPort))
      .setRequired(true);

    const rconPortInput = new TextInputBuilder()
      .setCustomId('input_rcon_port')
      .setLabel('Port RCON (ex: 25575)')
      .setStyle(TextInputStyle.Short)
      .setValue(String(guessedRconPort))
      .setRequired(false);

    const passwordInput = new TextInputBuilder()
      .setCustomId('input_password')
      .setLabel('Mot de passe RCON')
      .setStyle(TextInputStyle.Short)
      .setValue(guessedRconPassword)
      .setRequired(false);

    const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput);
    const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(portInput);
    const row3 = new ActionRowBuilder<TextInputBuilder>().addComponents(queryPortInput);
    const row4 = new ActionRowBuilder<TextInputBuilder>().addComponents(rconPortInput);
    const row5 = new ActionRowBuilder<TextInputBuilder>().addComponents(passwordInput);

    modal.addComponents(row1, row2, row3, row4, row5);

    // Open form modal
    await interaction.showModal(modal);

  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error building modal on continue:', error);
    await interaction.reply({
      content: `❌ Une erreur est survenue lors de la préparation du formulaire : ${rawMessage.slice(0, 1000)}`,
      ephemeral: true
    });
  }
}

/**
 * Step 1 (Edit): Open modal to edit existing server configuration.
 */
export async function handleEditButton(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return;

  const { guildId, message, memberPermissions } = interaction;

  if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '❌ Seuls les administrateurs peuvent éditer des serveurs.',
      ephemeral: true
    });
    return;
  }

  if (!guildId) {
    await interaction.reply({
      content: '❌ Cette commande ne peut être exécutée que dans un serveur Discord.',
      ephemeral: true
    });
    return;
  }

  try {
    // Retrieve server configuration matching message ID
    const server = await prisma.server.findFirst({
      where: {
        guildId,
        discordMessageId: message.id
      }
    });

    if (!server) {
      await interaction.reply({
        content: '❌ Configuration du serveur introuvable pour ce panneau de contrôle.',
        ephemeral: true
      });
      return;
    }

    // Construct Edit Modal
    const modal = new ModalBuilder()
      .setCustomId(`modal_edit_server:${server.id}`)
      .setTitle('Éditer le serveur de jeu');

    const nameInput = new TextInputBuilder()
      .setCustomId('input_friendly_name')
      .setLabel('Nom d\'affichage')
      .setStyle(TextInputStyle.Short)
      .setValue(server.name.slice(0, 100))
      .setRequired(true);

    const portInput = new TextInputBuilder()
      .setCustomId('input_port')
      .setLabel('Port de JEU (ex: 7777 / 2456)')
      .setStyle(TextInputStyle.Short)
      .setValue(String(server.port))
      .setRequired(true);

    const currentQueryPort = server.queryPort || (
      server.gameType.toUpperCase() === 'ARK' || server.gameType.toUpperCase() === 'ARKSA' || server.gameType.toUpperCase() === 'VALHEIM'
        ? server.port + 1
        : server.port
    );

    const queryPortInput = new TextInputBuilder()
      .setCustomId('input_query_port')
      .setLabel('Port Steam Query (ex: 7778 / 2457)')
      .setStyle(TextInputStyle.Short)
      .setValue(String(currentQueryPort))
      .setRequired(true);

    const rconPortInput = new TextInputBuilder()
      .setCustomId('input_rcon_port')
      .setLabel('Port RCON (ex: 25575)')
      .setStyle(TextInputStyle.Short)
      .setValue(String(server.rconPort))
      .setRequired(false);

    const passwordInput = new TextInputBuilder()
      .setCustomId('input_password')
      .setLabel('Mot de passe RCON')
      .setStyle(TextInputStyle.Short)
      .setValue(server.password)
      .setRequired(false);

    const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput);
    const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(portInput);
    const row3 = new ActionRowBuilder<TextInputBuilder>().addComponents(queryPortInput);
    const row4 = new ActionRowBuilder<TextInputBuilder>().addComponents(rconPortInput);
    const row5 = new ActionRowBuilder<TextInputBuilder>().addComponents(passwordInput);

    modal.addComponents(row1, row2, row3, row4, row5);

    await interaction.showModal(modal);

  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error opening edit modal:', error);
    await interaction.reply({
      content: `❌ Une erreur est survenue lors de l'ouverture du formulaire d'édition : ${rawMessage.slice(0, 1000)}`,
      ephemeral: true
    });
  }
}

/**
 * Step 1 (Permissions): Open Mentionable Select Menu to manage Whitelist.
 */
export async function handlePermissionsButton(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return;

  const { guildId, message, memberPermissions } = interaction;

  if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '❌ Seuls les administrateurs peuvent gérer les permissions.',
      ephemeral: true
    });
    return;
  }

  if (!guildId) {
    await interaction.reply({
      content: '❌ Cette commande ne peut être exécutée que dans un serveur Discord.',
      ephemeral: true
    });
    return;
  }

  try {
    // Retrieve server configuration matching message ID
    const server = await prisma.server.findFirst({
      where: {
        guildId,
        discordMessageId: message.id
      }
    });

    if (!server) {
      await interaction.reply({
        content: '❌ Configuration du serveur introuvable pour ce panneau de contrôle.',
        ephemeral: true
      });
      return;
    }

    // Build the Mentionable Select Menu
    const selectMenu = new MentionableSelectMenuBuilder()
      .setCustomId(`select_permissions_whitelist:${server.id}`)
      .setPlaceholder('Sélectionnez les membres ou rôles autorisés...')
      .setMinValues(0)
      .setMaxValues(25);

    const row = new ActionRowBuilder<MentionableSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.reply({
      content: `🛡️ **Gestion des accès - ${server.name}**\n\nSélectionnez ci-dessous les membres ou les rôles Discord qui auront le droit d'utiliser les boutons d'alimentation (Démarrer/Arrêter/Redémarrer) du serveur, en plus des administrateurs.\n\n*Note : Pour vider la whitelist, n'en sélectionnez aucun et validez.*`,
      components: [row],
      ephemeral: true
    });

  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error opening permissions menu:', error);
    await interaction.reply({
      content: `❌ Une erreur est survenue lors de l'ouverture du menu des permissions : ${rawMessage.slice(0, 1000)}`,
      ephemeral: true
    });
  }
}

/**
 * Handles all modal submit interactions.
 */
export async function handleModalSubmit(interaction: Interaction): Promise<void> {
  if (!interaction.isModalSubmit()) return;

  const { customId } = interaction;

  if (customId.startsWith('modal_add_server:')) {
    await handleAddServerModalSubmit(interaction);
  } else if (customId.startsWith('modal_edit_server:')) {
    await handleEditModalSubmit(interaction);
  } else if (customId.startsWith('modal_edit_token:')) {
    await handleEditTokenModalSubmit(interaction);
  }
}

/**
 * Step 4: Handles add server modal submit interactions (saving configurations and deploying embed).
 */
async function handleAddServerModalSubmit(interaction: Interaction): Promise<void> {
  if (!interaction.isModalSubmit()) return;

  const { customId, memberPermissions, guildId, channel } = interaction;

  // 1. Check permissions
  if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '❌ Seuls les administrateurs peuvent enregistrer des serveurs.',
      ephemeral: true
    });
    return;
  }

  if (!guildId) {
    await interaction.reply({
      content: '❌ Cette commande ne peut être exécutée que dans un serveur Discord.',
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // Extract variables from customId
  // Format: modal_add_server:${minestratorServerId}:${gameType}:${tokenId}:${autoStopTimeout}:${serverIp}
  const parts = customId.split(':');
  const minestratorServerId = parts[1];
  const gameType = parts[2];
  const tokenId = parts[3];
  const autoStopTimeout = parseInt(parts[4], 10) || 0;
  const autoStopEnabled = autoStopTimeout > 0;
  const host = parts[5] || '';

  // Retrieve input values
  const name = interaction.fields.getTextInputValue('input_friendly_name').trim();
  const portStr = interaction.fields.getTextInputValue('input_port').trim();
  const queryPortStr = interaction.fields.getTextInputValue('input_query_port')?.trim();
  const rconPortStr = interaction.fields.getTextInputValue('input_rcon_port')?.trim() || '25575';
  const password = interaction.fields.getTextInputValue('input_password')?.trim() || '';

  // Validate inputs
  const port = parseInt(portStr, 10);
  const queryPort = queryPortStr ? parseInt(queryPortStr, 10) : null;
  const rconPort = parseInt(rconPortStr, 10) || 25575;
  if (isNaN(port)) {
    await interaction.editReply('❌ Le port de Jeu doit être un nombre valide.');
    return;
  }

  try {
    let token = await prisma.token.findUnique({
      where: { id: tokenId }
    });

    if (!token && guildId) {
      console.warn(`[ComponentHandler] Token ID "${tokenId}" introuvable dans handleAddServerModalSubmit. Tentative de récupération du token par guildId "${guildId}"...`);
      token = await prisma.token.findFirst({
        where: { guildId }
      });
    }

    if (!token) {
      console.error(`[ComponentHandler] Aucun token trouvé dans handleAddServerModalSubmit pour le serveur Discord ${guildId} (ID recherché: ${tokenId})`);
      await interaction.editReply('❌ Token API introuvable en base. Veuillez enregistrer une clé avec `/setup-token`.');
      return;
    }

    const decryptedKey = decrypt(token.encryptedKey);
    const tempClient = new MinestratorClient(decryptedKey, minestratorServerId);

    const userId = await tempClient.getUserId();
    const serversList = await tempClient.listServers(userId);
    const serverInfo = serversList.find(s => String(s.id) === minestratorServerId);

    const apiHost = serverInfo?.ip || host;
    const eggIcon = serverInfo?.egg_icon || null;

    // 2. Save or update server in database
    const existingServer = await prisma.server.findFirst({
      where: {
        guildId,
        minestratorServerId
      }
    });

    const serverData = {
      guildId,
      tokenId,
      minestratorServerId,
      name,
      gameType,
      host: apiHost,
      port,      // Game port
      queryPort, // Steam query port
      rconPort,  // RCON port
      password,
      autoStopEnabled,
      autoStopTimeout,
      eggIcon
    };

    let server;
    if (existingServer) {
      server = await prisma.server.update({
        where: { id: existingServer.id },
        data: serverData
      });
    } else {
      server = await prisma.server.create({
        data: serverData
      });
    }

    // 3. Deploy Interactive Control Panel
    const initialTelemetry = {
      status: 'offline' as const,
      playerCount: 0,
      players: []
    };

    const embed = createServerEmbed(
      server.name,
      server.gameType,
      server.host,
      server.port,
      initialTelemetry,
      {
        enabled: server.autoStopEnabled,
        timeout: server.autoStopTimeout,
        lastActiveAt: server.lastActiveAt
      },
      server.eggIcon
    );

    const buttons = createControlButtons(initialTelemetry.status);

    if (!channel || !channel.isTextBased()) {
      await interaction.editReply('❌ Impossible d\'envoyer le panel dans ce salon.');
      return;
    }

    const sendableChannel = channel as unknown as { send: (options: unknown) => Promise<{ id: string }> };
    const message = await sendableChannel.send({
      embeds: [embed],
      components: buttons
    });

    // 4. Update message identifiers in database
    await prisma.server.update({
      where: { id: server.id },
      data: {
        discordChannelId: channel.id,
        discordMessageId: message.id
      }
    });

    await interaction.editReply(`✅ Le serveur **${server.name}** a été configuré et le panel a été déployé dans ce salon !`);
    return;

  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error during modal processing:', error);
    await interaction.editReply(`❌ Une erreur est survenue lors de l'enregistrement du serveur : ${rawMessage}`);
    return;
  }
}

/**
 * Step 2 (Edit): Save updated configurations and update existing embed.
 */
async function handleEditModalSubmit(interaction: Interaction): Promise<void> {
  if (!interaction.isModalSubmit()) return;

  const { customId, memberPermissions, guildId } = interaction;

  // 1. Check permissions
  if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '❌ Seuls les administrateurs peuvent modifier les serveurs.',
      ephemeral: true
    });
    return;
  }

  if (!guildId) {
    await interaction.reply({
      content: '❌ Cette commande ne peut être exécutée que dans un serveur Discord.',
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const serverId = customId.split(':')[1];

  // Retrieve input values
  const name = interaction.fields.getTextInputValue('input_friendly_name').trim();
  const portStr = interaction.fields.getTextInputValue('input_port').trim();
  const queryPortStr = interaction.fields.getTextInputValue('input_query_port')?.trim();
  const rconPortStr = interaction.fields.getTextInputValue('input_rcon_port')?.trim() || '25575';
  const password = interaction.fields.getTextInputValue('input_password')?.trim() || '';

  // Validate inputs
  const port = parseInt(portStr, 10);
  const queryPort = queryPortStr ? parseInt(queryPortStr, 10) : null;
  const rconPort = parseInt(rconPortStr, 10) || 25575;
  if (isNaN(port)) {
    await interaction.editReply('❌ Le port de Jeu doit être un nombre valide.');
    return;
  }

  try {
    // 2. Update server configuration in database
    const server = await prisma.server.update({
      where: { id: serverId },
      data: {
        name,
        port,
        queryPort,
        rconPort,
        password
      }
    });

    // 3. Re-render control panel message immediately
    const initialTelemetry = {
      status: 'offline' as const, // will be refreshed by next monitor loop scan
      playerCount: 0,
      players: []
    };

    const embed = createServerEmbed(
      server.name,
      server.gameType,
      server.host,
      server.port,
      initialTelemetry,
      {
        enabled: server.autoStopEnabled,
        timeout: server.autoStopTimeout,
        lastActiveAt: server.lastActiveAt
      },
      server.eggIcon
    );

    const buttons = createControlButtons(initialTelemetry.status);

    if (interaction.message) {
      await interaction.message.edit({
        embeds: [embed],
        components: buttons
      });
    }

    await interaction.editReply(`✅ Configuration du serveur **${server.name}** mise à jour avec succès !`);

  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error during edit modal processing:', error);
    await interaction.editReply(`❌ Une erreur est survenue lors de la mise à jour du serveur : ${rawMessage}`);
  }
}

/**
 * Step 2 (Permissions): Save whitelist choices to database.
 */
export async function handleMentionableSelectMenu(interaction: MentionableSelectMenuInteraction): Promise<void> {
  const { customId, memberPermissions, guildId } = interaction;

  if (!customId.startsWith('select_permissions_whitelist:')) return;

  // 1. Check permissions
  if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '❌ Seuls les administrateurs peuvent modifier les permissions.',
      ephemeral: true
    });
    return;
  }

  if (!guildId) {
    await interaction.reply({
      content: '❌ Cette commande ne peut être exécutée que dans un serveur Discord.',
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const serverId = customId.split(':')[1];

  try {
    // Separate selected mentionables into users and roles
    const userIds = Array.from(interaction.users.keys());
    const roleIds = Array.from(interaction.roles.keys());

    // Update database
    const server = await prisma.server.update({
      where: { id: serverId },
      data: {
        allowedUsers: JSON.stringify(userIds),
        allowedRoles: JSON.stringify(roleIds)
      }
    });

    const userListText = userIds.map(id => `<@${id}>`).join(', ') || 'aucun';
    const roleListText = roleIds.map(id => `<@&${id}>`).join(', ') || 'aucun';

    await interaction.editReply(
      `✅ Whitelist pour le serveur **${server.name}** mise à jour avec succès !\n\n` +
      `👥 **Membres autorisés :** ${userListText}\n` +
      `🛡️ **Rôles autorisés :** ${roleListText}`
    );

  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error during permissions whitelist processing:', error);
    await interaction.editReply(`❌ Une erreur est survenue lors de l'enregistrement des permissions : ${rawMessage}`);
  }
}

/**
 * Handles channel select menu component interactions.
 */
export async function handleChannelSelectMenu(interaction: Interaction): Promise<void> {
  if (!interaction.isChannelSelectMenu()) return;

  const { customId } = interaction;
  
  if (customId.startsWith('select_announcements_channel:')) {
    await handleAnnouncementsChannelSelection(interaction);
  }
}

/**
 * Step 1 (Announcements): Open Text Channel select menu to configure logs.
 */
export async function handleAnnouncementsButton(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return;

  const { guildId, message, memberPermissions } = interaction;

  if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '❌ Seuls les administrateurs peuvent configurer les annonces.',
      ephemeral: true
    });
    return;
  }

  if (!guildId) {
    await interaction.reply({
      content: '❌ Cette commande ne peut être exécutée que dans un serveur Discord.',
      ephemeral: true
    });
    return;
  }

  try {
    const server = await prisma.server.findFirst({
      where: {
        guildId,
        discordMessageId: message.id
      }
    });

    if (!server) {
      await interaction.reply({
        content: '❌ Configuration du serveur introuvable pour ce panneau de contrôle.',
        ephemeral: true
      });
      return;
    }

    const selectMenu = new ChannelSelectMenuBuilder()
      .setCustomId(`select_announcements_channel:${server.id}`)
      .setPlaceholder('Sélectionnez un salon pour les annonces...')
      .setChannelTypes([ChannelType.GuildText]);

    const disableBtn = new ButtonBuilder()
      .setCustomId(`btn_disable_announcements:${server.id}`)
      .setLabel('Désactiver les annonces')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔕');

    const rowSelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(selectMenu);
    const rowButton = new ActionRowBuilder<ButtonBuilder>().addComponents(disableBtn);

    const currentChannelText = server.logChannelId 
      ? `Actuellement configuré sur : <#${server.logChannelId}>` 
      : 'Actuellement désactivées.';

    await interaction.reply({
      content: `📢 **Configuration des Annonces & Logs - ${server.name}**\n\n` +
        'Choisissez un salon textuel pour annoncer les événements du serveur de jeu :\n' +
        '• Changements de statut (En ligne / Hors ligne)\n' +
        '• Commandes d\'alimentation lancées par des utilisateurs (Démarrage, Arrêt, Redémarrage)\n' +
        '• Connexions et déconnexions des joueurs\n\n' +
        `Statut actuel : **${currentChannelText}**`,
      components: [rowSelect, rowButton],
      ephemeral: true
    });

  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error opening announcements menu:', error);
    await interaction.reply({
      content: `❌ Une erreur est survenue lors de l'ouverture du menu des annonces : ${rawMessage.slice(0, 1000)}`,
      ephemeral: true
    });
  }
}

/**
 * Step 2 (Announcements): Save selected text channel for logging.
 */
export async function handleAnnouncementsChannelSelection(interaction: ChannelSelectMenuInteraction): Promise<void> {
  const { customId, memberPermissions, guildId } = interaction;

  if (!customId.startsWith('select_announcements_channel:')) return;

  if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '❌ Seuls les administrateurs peuvent modifier cette configuration.',
      ephemeral: true
    });
    return;
  }

  if (!guildId) {
    await interaction.reply({
      content: '❌ Cette commande ne peut être exécutée que dans un serveur Discord.',
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const serverId = customId.split(':')[1];
  const channelId = interaction.values[0];

  try {
    const server = await prisma.server.update({
      where: { id: serverId },
      data: { logChannelId: channelId }
    });

    await interaction.editReply(`✅ Les annonces et logs du serveur **${server.name}** seront postés dans le salon <#${channelId}> !`);

  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error saving announcements channel:', error);
    await interaction.editReply(`❌ Une erreur est survenue lors de l'enregistrement du salon d'annonces : ${rawMessage}`);
  }
}

/**
 * Step 2b (Announcements): Disable logs/announcements.
 */
export async function handleDisableAnnouncementsButton(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return;

  const { customId, memberPermissions, guildId } = interaction;

  if (!customId.startsWith('btn_disable_announcements:')) return;

  if (!memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '❌ Seuls les administrateurs peuvent désactiver les annonces.',
      ephemeral: true
    });
    return;
  }

  if (!guildId) {
    await interaction.reply({
      content: '❌ Cette commande ne peut être exécutée que dans un serveur Discord.',
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const serverId = customId.split(':')[1];

  try {
    const server = await prisma.server.update({
      where: { id: serverId },
      data: { logChannelId: null }
    });

    await interaction.editReply(`✅ Les annonces et logs pour le serveur **${server.name}** ont été désactivés.`);

  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error disabling announcements:', error);
    await interaction.editReply(`❌ Une erreur est survenue lors de la désactivation des annonces : ${rawMessage}`);
  }
}

/**
 * Handles selection of a token from the manage-tokens select menu.
 */
export async function handleSelectTokenToManage(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '❌ Seuls les administrateurs peuvent gérer les clés API.', ephemeral: true });
    return;
  }

  const tokenId = interaction.values[0];
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    include: {
      servers: { select: { id: true, name: true, gameType: true } }
    }
  });

  if (!token) {
    await interaction.reply({ content: '❌ Clé API introuvable en base de données.', ephemeral: true });
    return;
  }

  const decryptedKey = decrypt(token.encryptedKey);
  const maskedKey = decryptedKey.length > 8 
    ? `${decryptedKey.slice(0, 4)}••••••••${decryptedKey.slice(-4)}`
    : '••••••••';

  const embed = new EmbedBuilder()
    .setTitle(`🔑 Gestion du Token : ${token.alias}`)
    .setColor(0x3b82f6)
    .addFields(
      { name: '🏷️ Alias', value: `\`${token.alias}\``, inline: true },
      { name: '🔒 Clé API (masquée)', value: `\`${maskedKey}\``, inline: true },
      { name: '📅 Date d\'enregistrement', value: `<t:${Math.floor(token.createdAt.getTime() / 1000)}:f>`, inline: false },
      { 
        name: `🎮 Serveurs associés (${token.servers.length})`, 
        value: token.servers.length > 0 
          ? token.servers.map(s => `• \`${s.name}\` (${s.gameType})`).join('\n') 
          : '*Aucun serveur associé*', 
        inline: false 
      }
    )
    .setFooter({ text: `ID: ${token.id}` });

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`btn_edit_token:${token.id}`)
      .setLabel('Modifier')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✏️'),
    new ButtonBuilder()
      .setCustomId(`btn_test_token:${token.id}`)
      .setLabel('Tester la connexion API')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🔄'),
    new ButtonBuilder()
      .setCustomId(`btn_delete_token:${token.id}`)
      .setLabel('Supprimer')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️')
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_list_tokens')
      .setLabel('Retour à la liste des tokens')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⬅️')
  );

  await interaction.update({
    embeds: [embed],
    components: [row1, row2]
  });
}

/**
 * Handles the click on "Modifier" button for a token to open the Edit Modal.
 */
export async function handleEditTokenButton(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '❌ Seuls les administrateurs peuvent modifier les clés API.', ephemeral: true });
    return;
  }

  const tokenId = interaction.customId.split(':')[1];
  const token = await prisma.token.findUnique({ where: { id: tokenId } });

  if (!token) {
    await interaction.reply({ content: '❌ Clé API introuvable en base de données.', ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`modal_edit_token:${token.id}`)
    .setTitle(`Modifier le Token (${token.alias})`.slice(0, 45));

  const aliasInput = new TextInputBuilder()
    .setCustomId('input_token_alias')
    .setLabel('Nom / Alias de la clé API')
    .setStyle(TextInputStyle.Short)
    .setValue(token.alias.slice(0, 100))
    .setRequired(true);

  const keyInput = new TextInputBuilder()
    .setCustomId('input_token_key')
    .setLabel('Nouvelle clé API MineStrator (optionnel)')
    .setPlaceholder('Laissez vide pour conserver la clé actuelle')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(aliasInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(keyInput)
  );

  await interaction.showModal(modal);
}

/**
 * Handles modal submit for editing a token.
 */
export async function handleEditTokenModalSubmit(interaction: Interaction): Promise<void> {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '❌ Seuls les administrateurs peuvent modifier les clés API.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const tokenId = interaction.customId.split(':')[1];
  const newAlias = interaction.fields.getTextInputValue('input_token_alias').trim();
  const newKey = interaction.fields.getTextInputValue('input_token_key')?.trim();

  try {
    const existing = await prisma.token.findUnique({ where: { id: tokenId } });
    if (!existing) {
      await interaction.editReply('❌ Clé API introuvable en base de données.');
      return;
    }

    // Check unique alias constraint if alias is changing
    if (newAlias.toLowerCase() !== existing.alias.toLowerCase()) {
      const aliasConflict = await prisma.token.findUnique({
        where: {
          guildId_alias: {
            guildId: existing.guildId,
            alias: newAlias
          }
        }
      });
      if (aliasConflict) {
        await interaction.editReply(`❌ Une clé API avec l'alias \`${newAlias}\` existe déjà sur ce serveur.`);
        return;
      }
    }

    let encryptedKey = existing.encryptedKey;
    if (newKey && newKey.length > 0) {
      // Validate key with Minestrator API
      try {
        const testClient = new MinestratorClient(newKey, '0');
        await testClient.getUserId();
      } catch (apiErr) {
        const errMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
        console.warn(`[ComponentHandler] Warning when validating key for token ${tokenId}: ${errMsg}`);
      }
      encryptedKey = encrypt(newKey);
    }

    const updated = await prisma.token.update({
      where: { id: tokenId },
      data: {
        alias: newAlias,
        encryptedKey
      }
    });

    await interaction.editReply(`✅ Le token a été mis à jour avec succès sous l'alias **\`${updated.alias}\`** !`);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error updating token:', error);
    await interaction.editReply(`❌ Une erreur est survenue lors de la mise à jour du token : ${rawMessage}`);
  }
}

/**
 * Handles testing API connection for a token.
 */
export async function handleTestTokenButton(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '❌ Seuls les administrateurs peuvent tester les clés API.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const tokenId = interaction.customId.split(':')[1];
  const token = await prisma.token.findUnique({ where: { id: tokenId } });

  if (!token) {
    await interaction.editReply('❌ Clé API introuvable en base de données.');
    return;
  }

  try {
    const decryptedKey = decrypt(token.encryptedKey);
    const client = new MinestratorClient(decryptedKey, '0');
    const userId = await client.getUserId();
    const servers = await client.listServers(userId);

    await interaction.editReply(`✅ **Connexion réussie à l'API MineStrator !**\n• Compte MineStrator ID : \`${userId}\`\n• Serveurs MineStrator détectés : **${servers.length}**`);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error testing token:', error);
    await interaction.editReply(`❌ **Échec de la connexion à l'API MineStrator** : ${rawMessage}`);
  }
}

/**
 * Handles showing the delete token confirmation prompt.
 */
export async function handleDeleteTokenButton(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '❌ Seuls les administrateurs peuvent supprimer les clés API.', ephemeral: true });
    return;
  }

  const tokenId = interaction.customId.split(':')[1];
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    include: { servers: true }
  });

  if (!token) {
    await interaction.reply({ content: '❌ Clé API introuvable en base de données.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`⚠️ Confirmation de suppression du Token : ${token.alias}`)
    .setColor(0xef4444);

  if (token.servers.length > 0) {
    embed.setDescription(`Êtes-vous sûr de vouloir supprimer la clé API **\`${token.alias}\`** ?\n\n🚨 **ATTENTION : ${token.servers.length} serveur(s) Discord configuré(s) sont liés à cette clé API.** Supprimer cette clé supprimera également ces serveurs de la base de données : \n${token.servers.map(s => `• \`${s.name}\` (${s.gameType})`).join('\n')}`);
  } else {
    embed.setDescription(`Êtes-vous sûr de vouloir supprimer la clé API **\`${token.alias}\`** ?`);
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`btn_confirm_delete_token:${token.id}`)
      .setLabel('Confirmer la suppression définitive')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️'),
    new ButtonBuilder()
      .setCustomId(`btn_cancel_delete_token:${token.id}`)
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('❌')
  );

  await interaction.update({
    embeds: [embed],
    components: [row]
  });
}

/**
 * Handles confirming token deletion.
 */
export async function handleConfirmDeleteTokenButton(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '❌ Seuls les administrateurs peuvent supprimer les clés API.', ephemeral: true });
    return;
  }

  const { customId, guildId } = interaction;
  if (!guildId) return;

  const tokenId = customId.split(':')[1];

  try {
    // Delete any associated servers first
    await prisma.server.deleteMany({ where: { tokenId } });
    // Delete the token
    await prisma.token.delete({ where: { id: tokenId } });

    const { embeds, components } = await buildTokensListResponse(guildId);
    if (embeds[0]) {
      embeds[0].setFooter({ text: '✅ Clé API et serveurs associés supprimés avec succès.' });
    }

    await interaction.update({
      embeds,
      components
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error deleting token:', error);
    await interaction.reply({
      content: `❌ Une erreur est survenue lors de la suppression du token : ${rawMessage}`,
      ephemeral: true
    });
  }
}

/**
 * Handles returning to the tokens list.
 */
export async function handleListTokensButton(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '❌ Seuls les administrateurs peuvent gérer les clés API.', ephemeral: true });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) return;

  try {
    const { embeds, components } = await buildTokensListResponse(guildId);
    await interaction.update({
      embeds,
      components
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('[ComponentHandler] Error listing tokens:', error);
    await interaction.reply({
      content: `❌ Une erreur est survenue : ${rawMessage}`,
      ephemeral: true
    });
  }
}

