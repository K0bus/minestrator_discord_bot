import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export function createServerEmbed(
  serverName: string,
  gameType: string,
  host: string,
  port: number,
  telemetry: { status: 'online' | 'offline' | 'error'; playerCount: number; players: string[] },
  autoStop: { enabled: boolean; timeout: number; lastActiveAt: Date },
  eggIcon?: string | null
): EmbedBuilder {
  let statusEmoji = '⚪';
  let color = 0x95a5a6;
  let statusText = 'Inconnu';

  if (telemetry.status === 'online') {
    statusEmoji = '🟢';
    color = 0x10b981;
    statusText = 'En Ligne';
  } else if (telemetry.status === 'offline') {
    statusEmoji = '🔴';
    color = 0xef4444;
    statusText = 'Hors Ligne / Éteint';
  } else if (telemetry.status === 'error') {
    statusEmoji = '⚠️';
    color = 0xf59e0b;
    statusText = 'Erreur Connexion RCON';
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎮 Administration - ${serverName}`)
    .setDescription('Configuration de supervision et de contrôle à distance pour votre instance de jeu.')
    .setColor(color);

  if (eggIcon) {
    embed.setThumbnail(`https://cdn.minestrator.com/eggs/${eggIcon}`);
  }

  embed.addFields(
    { name: '📍 Adresse du serveur', value: `\`${host}:${port}\``, inline: true },
    { name: '👾 Jeu', value: `\`${gameType}\``, inline: true },
    { name: '📡 Statut', value: `${statusEmoji} **${statusText}**`, inline: true }
  );

  if (telemetry.status === 'online') {
    const playersVal = telemetry.playerCount > 0
      ? telemetry.players.map(p => `• \`${p}\``).join('\n')
      : '*Aucun joueur connecté*';

    embed.addFields(
      { name: `👥 Joueurs en ligne (${telemetry.playerCount})`, value: playersVal, inline: false }
    );

    if (autoStop.enabled) {
      if (telemetry.playerCount === 0) {
        const shutdownTime = new Date(autoStop.lastActiveAt.getTime() + autoStop.timeout * 60 * 1000);
        const shutdownTimestamp = Math.floor(shutdownTime.getTime() / 1000);

        embed.addFields({
          name: '⏳ Extinction Automatique',
          value: `⚠️ Aucun joueur détecté. Extinction planifiée <t:${shutdownTimestamp}:R> (seuil : ${autoStop.timeout} min).`,
          inline: false
        });
      } else {
        embed.addFields({
          name: '⏳ Extinction Automatique',
          value: '✅ Serveur actif. Le minuteur d\'extinction est réinitialisé.',
          inline: false
        });
      }
    }
  } else {
    embed.addFields(
      { name: '👥 Joueurs en ligne', value: telemetry.status === 'offline' ? '*Serveur éteint*' : '*Erreur de communication RCON*', inline: false }
    );
  }

  embed.addFields(
    { name: '🔄 Dernière mise à jour', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: false }
  );

  embed.setFooter({ text: 'MineStrator Discord Bot • Supervision en temps réel' });

  return embed;
}

export function createControlButtons(status: 'online' | 'offline' | 'error'): ActionRowBuilder<ButtonBuilder>[] {
  const powerRow = new ActionRowBuilder<ButtonBuilder>();
  const adminRow = new ActionRowBuilder<ButtonBuilder>();

  const startBtn = new ButtonBuilder()
    .setCustomId('power_start')
    .setLabel('Démarrer')
    .setStyle(ButtonStyle.Success)
    .setEmoji('▶️')
    .setDisabled(status === 'online');

  const stopBtn = new ButtonBuilder()
    .setCustomId('power_stop')
    .setLabel('Arrêter')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('⏹️')
    .setDisabled(status === 'offline');

  const restartBtn = new ButtonBuilder()
    .setCustomId('power_restart')
    .setLabel('Redémarrer')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('🔄')
    .setDisabled(status === 'offline');

  powerRow.addComponents(startBtn, stopBtn, restartBtn);

  const editBtn = new ButtonBuilder()
    .setCustomId('server_edit')
    .setLabel('Éditer')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⚙️');

  const permissionsBtn = new ButtonBuilder()
    .setCustomId('server_permissions')
    .setLabel('Permissions')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('🛡️');

  const announcementsBtn = new ButtonBuilder()
    .setCustomId('server_announcements')
    .setLabel('Annonces')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('📢');

  adminRow.addComponents(editBtn, permissionsBtn, announcementsBtn);

  return [powerRow, adminRow];
}
