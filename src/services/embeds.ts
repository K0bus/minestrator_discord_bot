import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { UnifiedTelemetry, ServerStatus } from '../drivers/base.js';

export function createServerEmbed(
  serverName: string,
  gameType: string,
  host: string,
  port: number,
  telemetry: {
    status: 'online' | 'offline' | 'error' | 'restarting' | ServerStatus;
    playerCount: number;
    players: string[];
    unified?: UnifiedTelemetry;
  },
  autoStop: { enabled: boolean; timeout: number; lastActiveAt: Date },
  eggIcon?: string | null
): EmbedBuilder {
  const unified = telemetry.unified;
  const statusUpper = (unified?.status || String(telemetry.status)).toUpperCase();

  let statusEmoji = '⚪';
  let color = 0x95a5a6;
  let statusText = 'Inconnu';

  if (statusUpper === 'ONLINE') {
    statusEmoji = '🟢';
    color = 0x10b981;
    statusText = 'En Ligne';
  } else if (statusUpper === 'OFFLINE') {
    statusEmoji = '🔴';
    color = 0xef4444;
    statusText = 'Hors Ligne / Éteint';
  } else if (statusUpper === 'RESTARTING') {
    statusEmoji = '🔄';
    color = 0x3b82f6;
    statusText = 'En Redémarrage / Chargement';
  } else if (statusUpper === 'ERROR') {
    statusEmoji = '⚠️';
    color = 0xf59e0b;
    statusText = 'Erreur de Communication';
  }

  const embedTitle = unified?.name ? `🎮 Administration - ${unified.name}` : `🎮 Administration - ${serverName}`;

  const embed = new EmbedBuilder()
    .setTitle(embedTitle)
    .setDescription('Configuration de supervision et de contrôle à distance pour votre instance de jeu.')
    .setColor(color);

  if (eggIcon) {
    embed.setThumbnail(`https://cdn.minestrator.com/eggs/${eggIcon}`);
  }

  const connectAddr = unified?.connect || `${host}:${port}`;
  embed.addFields(
    { name: '📍 Adresse du serveur', value: `\`${connectAddr}\``, inline: true },
    { name: '👾 Jeu', value: `\`${gameType}\``, inline: true },
    { name: '📡 Statut', value: `${statusEmoji} **${statusText}**`, inline: true }
  );

  // Add Map & Ping fields if available from unified telemetry
  if (unified?.map && unified.map !== 'N/A') {
    embed.addFields({ name: '🗺️ Carte / Map', value: `\`${unified.map}\``, inline: true });
  }

  if (unified?.ping !== undefined && unified.ping >= 0) {
    embed.addFields({ name: '📶 Latence (Ping)', value: `\`${unified.ping} ms\``, inline: true });
  }

  // Add CPU and RAM metrics if available from API / raw_metrics
  const rawMetrics = unified?.raw_metrics as Record<string, unknown> | undefined;
  if (rawMetrics && (rawMetrics.apiDriven || rawMetrics.fallback)) {
    if (rawMetrics.cpu !== undefined && rawMetrics.ram !== undefined) {
      const cpuVal = typeof rawMetrics.cpu === 'number' ? `${rawMetrics.cpu.toFixed(1)}%` : `${rawMetrics.cpu}%`;
      const ramVal = typeof rawMetrics.ram === 'number' ? `${rawMetrics.ram.toFixed(0)} MB` : `${rawMetrics.ram} MB`;
      embed.addFields(
        { name: '⚡ CPU', value: `\`${cpuVal}\``, inline: true },
        { name: '💾 RAM', value: `\`${ramVal}\``, inline: true }
      );
    }
  }

  const onlineCount = unified?.players.online ?? telemetry.playerCount;
  const maxCount = unified?.players.max ?? 0;
  const playerList = unified?.players.list ?? telemetry.players;
  const countLabel = maxCount > 0 ? `${onlineCount}/${maxCount}` : `${onlineCount}`;

  if (statusUpper === 'ONLINE' || statusUpper === 'RESTARTING') {
    let playersVal: string;
    if (playerList.length > 0) {
      playersVal = playerList.map(p => `• \`${p}\``).join('\n');
    } else if (onlineCount > 0) {
      playersVal = `• \`${onlineCount} joueur(s) en ligne\``;
    } else if (rawMetrics?.apiDriven || rawMetrics?.fallback) {
      playersVal = '*Aucun joueur détecté (Supervision API)*';
    } else {
      playersVal = '*Aucun joueur connecté*';
    }

    embed.addFields(
      { name: `👥 Joueurs en ligne (${countLabel})`, value: playersVal, inline: false }
    );

    if (autoStop.enabled) {
      if (onlineCount === 0) {
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
      { name: '👥 Joueurs en ligne', value: statusUpper === 'OFFLINE' ? '*Serveur éteint*' : '*Erreur de communication*', inline: false }
    );
  }

  embed.addFields(
    { name: '🔄 Dernière mise à jour', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: false }
  );

  embed.setFooter({ text: 'MineStrator Discord Bot • Supervision en temps réel' });

  return embed;
}

export function createControlButtons(status: string): ActionRowBuilder<ButtonBuilder>[] {
  const statusUpper = status.toUpperCase();
  const isOnline = statusUpper === 'ONLINE';
  const isOffline = statusUpper === 'OFFLINE';

  const powerRow = new ActionRowBuilder<ButtonBuilder>();
  const adminRow = new ActionRowBuilder<ButtonBuilder>();

  const startBtn = new ButtonBuilder()
    .setCustomId('power_start')
    .setLabel('Démarrer')
    .setStyle(ButtonStyle.Success)
    .setEmoji('▶️')
    .setDisabled(isOnline);

  const stopBtn = new ButtonBuilder()
    .setCustomId('power_stop')
    .setLabel('Arrêter')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('⏹️')
    .setDisabled(isOffline);

  const restartBtn = new ButtonBuilder()
    .setCustomId('power_restart')
    .setLabel('Redémarrer')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('🔄')
    .setDisabled(isOffline);

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
