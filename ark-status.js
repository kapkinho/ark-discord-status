const fs = require("fs");

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

const SERVER = {
  name: "NA-PVE-Astraeos5962",
  id: "958296",
  url: "https://arkstatus.com/server-details/na-pve-astraeos5962/958296?lang=en"
};

const MESSAGE_ID_FILE = ".ark-status-message-id";

if (!WEBHOOK) {
  throw new Error("DISCORD_WEBHOOK_URL não configurado.");
}

const webhookBase = WEBHOOK.split("?")[0].replace(/\/$/, "");

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToText(html) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<(br|\/p|\/div|\/section|\/li|\/h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function oneLine(text) {
  return text.replace(/\s+/g, " ").trim();
}

function firstMatch(text, regex, group = 1) {
  const match = text.match(regex);
  return match ? match[group]?.trim() ?? null : null;
}

function numberValue(value) {
  if (value == null) return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function pingIcon(ping) {
  if (ping == null) return "⚪";
  if (ping <= 200) return "🟢";
  if (ping <= 300) return "🟡";
  return "🔴";
}

function occupancyIcon(percent) {
  if (percent >= 90) return "🔴";
  if (percent >= 70) return "🟠";
  if (percent >= 40) return "🟡";
  return "🟢";
}

function formatNowBR() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
}

async function getExistingMessage(messageId) {
  if (!messageId) return null;

  const response = await fetch(`${webhookBase}/messages/${messageId}`);

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(
      `Falha ao consultar mensagem do Discord: HTTP ${response.status}`
    );
  }

  return response.json();
}

function getField(embed, name) {
  return embed?.fields?.find(field => field.name === name)?.value ?? null;
}

function previousPlayers(existingMessage) {
  const embed = existingMessage?.embeds?.[0];
  const value = getField(embed, "👥 Jogadores");

  if (!value) return null;

  const match = value.match(/(\d+)\s*\/\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

function previousStatus(existingMessage) {
  const embed = existingMessage?.embeds?.[0];
  const value = getField(embed, "📡 Status");

  if (!value) return null;

  if (/ONLINE/i.test(value)) return "ONLINE";
  if (/OFFLINE/i.test(value)) return "OFFLINE";

  return null;
}

function previousStatusSince(existingMessage) {
  const embed = existingMessage?.embeds?.[0];
  return getField(embed, "⏱️ Status desde");
}

async function fetchServerData() {
  const response = await fetch(`${SERVER.url}&t=${Date.now()}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 ARKDiscordStatus/1.0 (+GitHub Actions)"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`ARKStatus respondeu HTTP ${response.status}`);
  }

  const html = await response.text();
  const text = htmlToText(html);
  const flat = oneLine(text);

  /*
   * O resumo principal atualmente aparece no ARKStatus como:
   *
   * NA-PVE-Astraeos5962 - Online, Players 6/70,
   * 188ms, Map Astraeos, Rank #3,050, 7d uptime 87.4%.
   */
  const summary = flat.match(
    /NA-PVE-Astraeos5962\s*-\s*(Online|Offline).*?Players\s*(\d+)\s*\/\s*(\d+).*?(\d+)\s*ms.*?Map\s+(.+?)\s*,\s*Rank\s+#([\d,]+).*?7d uptime\s*([\d.]+)%/i
  );

  let status = null;
  let players = null;
  let maxPlayers = null;
  let ping = null;
  let map = null;
  let rank = null;
  let uptime7d = null;

  if (summary) {
    status = summary[1].toUpperCase();
    players = Number(summary[2]);
    maxPlayers = Number(summary[3]);
    ping = Number(summary[4]);
    map = summary[5].trim();
    rank = `#${summary[6]}`;
    uptime7d = numberValue(summary[7]);
  }

  // Fallbacks, caso o resumo da página mude levemente.
  if (!status) {
    status =
      /\bOnline\b/i.test(flat)
        ? "ONLINE"
        : /\bOffline\b/i.test(flat)
        ? "OFFLINE"
        : "DESCONHECIDO";
  }

  if (players == null || maxPlayers == null) {
    const p = flat.match(
      /Survivors online\s*(\d+)\s*\/\s*(\d+)/i
    );

    if (p) {
      players = Number(p[1]);
      maxPlayers = Number(p[2]);
    }
  }

  if (ping == null) {
    const p = flat.match(/Latency\s*(\d+)\s*ms/i);
    if (p) ping = Number(p[1]);
  }

  if (uptime7d == null) {
    uptime7d = numberValue(
      firstMatch(flat, /7-day uptime\s*([\d.]+)%/i)
    );
  }

  const avgPlayers = numberValue(
    firstMatch(flat, /Avg players \(7d\)\s*([\d.]+)/i)
  );

  const peakPlayers = numberValue(
    firstMatch(flat, /Peak players \(7d\)\s*(\d+)/i)
  );

  const currentUptime =
    firstMatch(
      flat,
      /Current uptime\s*(.+?)\s*Average session/i
    )?.replace(/\*/g, "") ?? null;

  const day = firstMatch(
    flat,
    /(?:Online|Offline)\s+Last updated.+?\s+Day\s+(\d+)/i
  );

  const version = firstMatch(
    flat,
    /Day\s+\d+\s+v([\d.]+)/i
  );

  const lastUpdated = firstMatch(
    flat,
    /(?:Online|Offline)\s+Last updated\s+(.+?)\s+Day\s+\d+/i
  );

  const mode =
    firstMatch(flat, /Game Mode\s+(PvE|PvP)\s+server/i) ?? null;

  let platform =
    firstMatch(
      flat,
      /Platform\s+(.+?)\s+Transfers/i
    ) ?? null;

  if (platform) {
    platform = platform
      .replace(/\bWin\b/g, "Windows")
      .replace(/\bPS\b/g, "PlayStation")
      .replace(/\bXB\b/g, "Xbox")
      .replace(/\s+/g, " / ");
  }

  return {
    status,
    players,
    maxPlayers,
    ping,
    map,
    rank,
    uptime7d,
    avgPlayers,
    peakPlayers,
    currentUptime,
    day,
    version,
    lastUpdated,
    mode,
    platform
  };
}

function buildPayload(data, existingMessage) {
  const isOnline = data.status === "ONLINE";
  const isOffline = data.status === "OFFLINE";

  let statusEmoji = "🟡";
  let color = 0xf1c40f;

  if (isOnline) {
    statusEmoji = "🟢";
    color = 0x2ecc71;
  } else if (isOffline) {
    statusEmoji = "🔴";
    color = 0xe74c3c;
  }

  const occupancy =
    data.players != null && data.maxPlayers
      ? Math.round((data.players / data.maxPlayers) * 100)
      : null;

  const prevPlayers = previousPlayers(existingMessage);

  let playerDelta = "";

  if (
    prevPlayers != null &&
    data.players != null &&
    prevPlayers !== data.players
  ) {
    const delta = data.players - prevPlayers;

    playerDelta =
      delta > 0
        ? ` · ▲ +${delta}`
        : ` · ▼ ${delta}`;
  }

  const oldStatus = previousStatus(existingMessage);
  const oldSince = previousStatusSince(existingMessage);

  const statusSince =
    oldStatus === data.status && oldSince
      ? oldSince
      : formatNowBR();

  const playersText =
    data.players != null && data.maxPlayers != null
      ? `${occupancyIcon(occupancy)} **${data.players} / ${data.maxPlayers}** · ${occupancy}%${playerDelta}`
      : "⚪ Indisponível";

  const pingText =
    data.ping != null
      ? `${pingIcon(data.ping)} **${data.ping} ms**`
      : "⚪ Indisponível";

  const infoLine = [
    data.map ? `🗺️ **${data.map}**` : null,
    data.mode ? `🛡️ **${data.mode}**` : null,
    data.version ? `🎮 **v${data.version}**` : null
  ]
    .filter(Boolean)
    .join("  •  ");

  const fields = [
    {
      name: "📡 Status",
      value: `${statusEmoji} **${data.status}**`,
      inline: true
    },
    {
      name: "👥 Jogadores",
      value: playersText,
      inline: true
    },
    {
      name: "📶 Ping",
      value: pingText,
      inline: true
    },
    {
      name: "⏱️ Status desde",
      value: statusSince,
      inline: true
    },
    {
      name: "🕒 Uptime atual",
      value: data.currentUptime
        ? `**${data.currentUptime}**`
        : "Indisponível",
      inline: true
    },
    {
      name: "📈 Uptime 7 dias",
      value:
        data.uptime7d != null
          ? `**${data.uptime7d}%**`
          : "Indisponível",
      inline: true
    },
    {
      name: "📊 Média / Pico (7d)",
      value:
        data.avgPlayers != null || data.peakPlayers != null
          ? `Média: **${data.avgPlayers ?? "?"}**\nPico: **${data.peakPlayers ?? "?"}**`
          : "Indisponível",
      inline: true
    },
    {
      name: "🌍 Dia do mundo",
      value: data.day ? `**${data.day}**` : "Indisponível",
      inline: true
    },
    {
      name: "🏆 Ranking global",
      value: data.rank ? `**${data.rank}**` : "Indisponível",
      inline: true
    }
  ];

  if (data.platform) {
    fields.push({
      name: "🖥️ Plataformas",
      value: data.platform,
      inline: false
    });
  }

  fields.push({
    name: "🔄 Fonte",
    value: data.lastUpdated
      ? `ARKStatus atualizado **${data.lastUpdated}**`
      : "ARKStatus consultado com sucesso",
    inline: false
  });

  return {
    username: "ARK Server Status",
    embeds: [
      {
        title: `${statusEmoji} ${SERVER.name}`,
        url: SERVER.url,
        description:
          `${infoLine}\n\n` +
          `[🔗 Abrir página completa no ARKStatus](${SERVER.url})`,
        color,
        fields,
        footer: {
          text: `Consulta automática • ${formatNowBR()} • America/Sao_Paulo`
        }
      }
    ]
  };
}

function buildErrorPayload(error, existingMessage) {
  const previousEmbed = existingMessage?.embeds?.[0];

  return {
    username: "ARK Server Status",
    embeds: [
      {
        title: `🟡 ${SERVER.name}`,
        url: SERVER.url,
        description:
          "⚠️ **Não foi possível atualizar os dados agora.**\n\n" +
          "Isso **não significa que o servidor ARK esteja offline**. " +
          "A consulta ao ARKStatus falhou ou retornou um formato inesperado.",
        color: 0xf1c40f,
        fields: [
          {
            name: "Último status conhecido",
            value:
              getField(previousEmbed, "📡 Status") ??
              "Ainda não há status anterior."
          },
          {
            name: "Erro da consulta",
            value: `\`${String(error.message).slice(0, 900)}\``
          }
        ],
        footer: {
          text: `Nova tentativa automática • ${formatNowBR()}`
        }
      }
    ]
  };
}

async function sendNewMessage(payload) {
  const url = new URL(WEBHOOK);
  url.searchParams.set("wait", "true");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(
      `Discord respondeu HTTP ${response.status}: ${await response.text()}`
    );
  }

  return response.json();
}

async function editMessage(messageId, payload) {
  const response = await fetch(
    `${webhookBase}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Discord respondeu HTTP ${response.status}: ${await response.text()}`
    );
  }

  return response.json();
}

async function main() {
  let messageId = null;

  if (fs.existsSync(MESSAGE_ID_FILE)) {
    messageId = fs.readFileSync(MESSAGE_ID_FILE, "utf8").trim();
  }

  let existingMessage = null;

  if (messageId) {
    existingMessage = await getExistingMessage(messageId);
  }

  let payload;

  try {
    const data = await fetchServerData();

    console.log("Dados ARKStatus:", data);

    payload = buildPayload(data, existingMessage);
  } catch (error) {
    console.error("Falha ARKStatus:", error);

    payload = buildErrorPayload(error, existingMessage);
  }

  if (messageId && existingMessage) {
    const updated = await editMessage(messageId, payload);

    if (updated) {
      console.log(`Mensagem atualizada: ${messageId}`);
      return;
    }
  }

  const created = await sendNewMessage(payload);

  fs.writeFileSync(
    MESSAGE_ID_FILE,
    `${created.id}\n`,
    "utf8"
  );

  console.log(`Nova mensagem criada: ${created.id}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
