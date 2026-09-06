const fs = require("fs");

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const ARKSTATUS_API_KEY = process.env.ARKSTATUS_API_KEY;

const SERVER = {
  name: "NA-PVE-Astraeos5962",
  id: "958296",
  details: "https://arkstatus.com/server-details/na-pve-astraeos5962/958296",
  api: "https://arkstatus.com/api/v1"
};

const MESSAGE_ID_FILE = ".ark-status-message-id";

if (!WEBHOOK) {
  throw new Error("DISCORD_WEBHOOK_URL não configurado.");
}

if (!ARKSTATUS_API_KEY) {
  throw new Error("ARKSTATUS_API_KEY não configurado.");
}

const webhookBase = WEBHOOK.split("?")[0].replace(/\/$/, "");

function fmtNumber(value, digits = 1) {
  if (value == null || value === "") return null;

  const n = Number(value);

  if (!Number.isFinite(n)) return null;

  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: digits
  }).format(n);
}

function pingIcon(ping) {
  if (ping == null) return "⚪";
  if (ping <= 200) return "🟢";
  if (ping <= 300) return "🟡";
  return "🔴";
}

function occupancyIcon(percent) {
  if (percent == null) return "⚪";
  if (percent >= 90) return "🔴";
  if (percent >= 70) return "🟠";
  if (percent >= 40) return "🟡";
  return "🟢";
}

function discordTimestamp(dateString) {
  if (!dateString) return "Indisponível";

  const ms = Date.parse(dateString);

  if (!Number.isFinite(ms)) {
    return String(dateString);
  }

  const unix = Math.floor(ms / 1000);

  return `<t:${unix}:R>`;
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
  const value = getField(
    existingMessage?.embeds?.[0],
    "👥 Jogadores"
  );

  if (!value) return null;

  const match = value.match(/(\d+)\s*\/\s*(\d+)/);

  return match ? Number(match[1]) : null;
}

async function fetchServerData() {
  const response = await fetch(
    `${SERVER.api}/servers/${SERVER.id}`,
    {
      headers: {
        "X-API-Key": ARKSTATUS_API_KEY,
        "Accept": "application/json"
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `ARKStatus API respondeu HTTP ${response.status}: ${body.slice(0, 500)}`
    );
  }

  const json = await response.json();

  /*
   * Algumas APIs retornam o servidor diretamente;
   * outras embrulham em "data".
   * Aceitamos ambos.
   */
  const s = json.data ?? json;

  const stats7 =
    s.statistics?.["7_days"] ??
    s.statistics?.seven_days ??
    s.statistics?.days_7 ??
    {};

  const stats30 =
    s.statistics?.["30_days"] ??
    s.statistics?.thirty_days ??
    s.statistics?.days_30 ??
    {};

  const statusRaw =
    s.status ??
    s.server_status ??
    "unknown";

  const status =
    String(statusRaw).toLowerCase() === "online"
      ? "ONLINE"
      : String(statusRaw).toLowerCase() === "offline"
      ? "OFFLINE"
      : "DESCONHECIDO";

  const players =
    s.players ??
    s.current_players ??
    null;

  const maxPlayers =
    s.max_players ??
    s.maxPlayers ??
    null;

  let playerPercentage =
    s.player_percentage ??
    s.playerPercentage ??
    null;

  if (
    playerPercentage == null &&
    players != null &&
    maxPlayers
  ) {
    playerPercentage =
      (Number(players) / Number(maxPlayers)) * 100;
  }

  return {
    raw: s,

    name:
      s.name ??
      SERVER.name,

    status,

    players:
      players == null ? null : Number(players),

    maxPlayers:
      maxPlayers == null ? null : Number(maxPlayers),

    playerPercentage:
      playerPercentage == null
        ? null
        : Number(playerPercentage),

    map:
      s.map ??
      s.map_name ??
      null,

    ping:
      s.ping == null
        ? null
        : Number(s.ping),

    version:
      s.version ??
      null,

    day:
      s.day_number ??
      s.day ??
      null,

    gameMode:
      s.game_mode ??
      s.mode ??
      null,

    platform:
      s.platform ??
      s.platforms ??
      null,

    isOfficial:
      s.is_official ??
      null,

    hasPassword:
      s.has_password ??
      null,

    lastUpdated:
      s.last_updated ??
      s.last_snapshot ??
      null,

    uptime7:
      stats7.uptime_percentage ??
      stats7.uptime ??
      null,

    average7:
      stats7.average_players ??
      stats7.avg_players ??
      null,

    peak7:
      stats7.peak_players ??
      stats7.max_players ??
      null,

    uptime30:
      stats30.uptime_percentage ??
      stats30.uptime ??
      null,

    average30:
      stats30.average_players ??
      stats30.avg_players ??
      null,

    peak30:
      stats30.peak_players ??
      stats30.max_players ??
      null
  };
}

function normalizePlatform(platform) {
  if (!platform) return "Indisponível";

  if (Array.isArray(platform)) {
    return platform.join(" / ");
  }

  if (typeof platform === "object") {
    return Object.values(platform)
      .filter(Boolean)
      .join(" / ");
  }

  return String(platform)
    .replace(/\bWin\b/gi, "Windows")
    .replace(/\bPS\b/gi, "PlayStation")
    .replace(/\bXB\b/gi, "Xbox");
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

  const prevPlayers = previousPlayers(existingMessage);

  let deltaText = "";

  if (
    prevPlayers != null &&
    data.players != null &&
    prevPlayers !== data.players
  ) {
    const delta = data.players - prevPlayers;

    deltaText =
      delta > 0
        ? ` · ▲ +${delta}`
        : ` · ▼ ${delta}`;
  }

  const occupancy =
    data.playerPercentage != null
      ? Math.round(data.playerPercentage)
      : null;

  const playerText =
    data.players != null && data.maxPlayers != null
      ? `${occupancyIcon(occupancy)} **${data.players} / ${data.maxPlayers}**` +
        (occupancy != null ? ` · ${occupancy}%` : "") +
        deltaText
      : "⚪ Indisponível";

  const pingText =
    data.ping != null
      ? `${pingIcon(data.ping)} **${data.ping} ms**`
      : "⚪ Indisponível";

  const mapLine = [
    data.map ? `🗺️ **${data.map}**` : null,
    data.gameMode ? `🛡️ **${data.gameMode}**` : null,
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
      value: playerText,
      inline: true
    },
    {
      name: "📶 Ping",
      value: pingText,
      inline: true
    },
    {
      name: "🌍 Dia do mundo",
      value:
        data.day != null
          ? `**${data.day}**`
          : "Indisponível",
      inline: true
    },
    {
      name: "📈 Uptime 7 dias",
      value:
        data.uptime7 != null
          ? `**${fmtNumber(data.uptime7)}%**`
          : "Indisponível",
      inline: true
    },
    {
      name: "📊 Média / Pico 7d",
      value:
        data.average7 != null || data.peak7 != null
          ? `Média: **${fmtNumber(data.average7)}**\nPico: **${fmtNumber(data.peak7, 0)}**`
          : "Indisponível",
      inline: true
    },
    {
      name: "📈 Uptime 30 dias",
      value:
        data.uptime30 != null
          ? `**${fmtNumber(data.uptime30)}%**`
          : "Indisponível",
      inline: true
    },
    {
      name: "📊 Média / Pico 30d",
      value:
        data.average30 != null || data.peak30 != null
          ? `Média: **${fmtNumber(data.average30)}**\nPico: **${fmtNumber(data.peak30, 0)}**`
          : "Indisponível",
      inline: true
    },
    {
      name: "🖥️ Plataformas",
      value: normalizePlatform(data.platform),
      inline: true
    },
    {
      name: "🏛️ Servidor",
      value:
        data.isOfficial === true
          ? "✅ **Oficial**"
          : data.isOfficial === false
          ? "🔧 **Não oficial**"
          : "Indisponível",
      inline: true
    },
    {
      name: "🔐 Senha",
      value:
        data.hasPassword === true
          ? "🔒 Sim"
          : data.hasPassword === false
          ? "🔓 Não"
          : "Indisponível",
      inline: true
    },
    {
      name: "🔄 Último dado do ARKStatus",
      value: discordTimestamp(data.lastUpdated),
      inline: false
    }
  ];

  return {
    username: "ARK Server Status",
    embeds: [
      {
        title: `${statusEmoji} ${data.name}`,
        url: SERVER.details,
        description:
          `${mapLine || "ARK: Survival Ascended"}\n\n` +
          `[🔗 Abrir servidor no ARKStatus](${SERVER.details})`,
        color,
        fields,
        footer: {
          text: "ARKStatus API • atualização automática a cada 5 minutos"
        },
        timestamp: new Date().toISOString()
      }
    ]
  };
}

function buildErrorPayload(error, existingMessage) {
  const oldEmbed = existingMessage?.embeds?.[0];

  return {
    username: "ARK Server Status",
    embeds: [
      {
        title: `🟡 ${SERVER.name}`,
        url: SERVER.details,
        description:
          "⚠️ **Não foi possível consultar o ARKStatus agora.**\n\n" +
          "Isso não significa que o servidor ARK esteja offline.",
        color: 0xf1c40f,
        fields: [
          {
            name: "Último status conhecido",
            value:
              getField(oldEmbed, "📡 Status") ??
              "Ainda não há status anterior."
          },
          {
            name: "Erro da API",
            value:
              `\`${String(error.message).slice(0, 900)}\``
          }
        ],
        footer: {
          text: "Nova tentativa automática em até 5 minutos"
        },
        timestamp: new Date().toISOString()
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
    messageId = fs
      .readFileSync(MESSAGE_ID_FILE, "utf8")
      .trim();
  }

  let existingMessage = null;

  if (messageId) {
    existingMessage =
      await getExistingMessage(messageId);
  }

  let payload;

  try {
    const data = await fetchServerData();

    console.log("ARKStatus API OK");
    console.log(
      JSON.stringify(
        {
          status: data.status,
          players: data.players,
          maxPlayers: data.maxPlayers,
          map: data.map,
          ping: data.ping,
          day: data.day,
          version: data.version,
          uptime7: data.uptime7,
          average7: data.average7,
          peak7: data.peak7,
          uptime30: data.uptime30,
          average30: data.average30,
          peak30: data.peak30
        },
        null,
        2
      )
    );

    payload = buildPayload(data, existingMessage);
  } catch (error) {
    console.error("Falha ARKStatus API:", error);

    payload =
      buildErrorPayload(error, existingMessage);
  }

  if (messageId && existingMessage) {
    const updated =
      await editMessage(messageId, payload);

    if (updated) {
      console.log(
        `Mensagem atualizada: ${messageId}`
      );
      return;
    }
  }

  const created =
    await sendNewMessage(payload);

  fs.writeFileSync(
    MESSAGE_ID_FILE,
    `${created.id}\n`,
    "utf8"
  );

  console.log(
    `Nova mensagem criada: ${created.id}`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
