const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

const SERVER = {
  name: "NA-PVE-Astraeos5962",
  id: "958296",
  details: "https://arkstatus.com/server-details/na-pve-astraeos5962/958296",
  badge: "https://arkstatus.com/badge/958296.svg"
};

async function main() {
  if (!WEBHOOK) {
    throw new Error("DISCORD_WEBHOOK_URL não configurado.");
  }

  // Evita cache para obter a versão atual da badge.
  const badgeUrl = `${SERVER.badge}?t=${Date.now()}`;

  const response = await fetch(badgeUrl);

  if (!response.ok) {
    throw new Error(`ARKStatus respondeu HTTP ${response.status}`);
  }

  const svg = await response.text();

  // Extrai o texto apresentado pelo próprio badge do ARKStatus.
  const text = [...svg.matchAll(/<text[^>]*>(.*?)<\/text>/gs)]
    .map(m =>
      m[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim()
    )
    .filter(Boolean);

  const combined = text.join(" ");

  let status = "DESCONHECIDO";
  let emoji = "🟡";
  let color = 0xF1C40F;

  if (/\bonline\b/i.test(combined)) {
    status = "ONLINE";
    emoji = "🟢";
    color = 0x2ECC71;
  } else if (/\boffline\b/i.test(combined)) {
    status = "OFFLINE";
    emoji = "🔴";
    color = 0xE74C3C;
  }

  const description =
    text.length > 0
      ? text.join("\n")
      : "Não foi possível interpretar os detalhes da badge.";

  const payload = {
    username: "ARK Server Status",
    embeds: [
      {
        title: `${emoji} ${SERVER.name}`,
        url: SERVER.details,
        description,
        color,
        fields: [
          {
            name: "Status",
            value: `${emoji} **${status}**`,
            inline: true
          }
        ],
        footer: {
          text: "ARKStatus • atualização automática"
        },
        timestamp: new Date().toISOString()
      }
    ]
  };

  const discord = await fetch(`${WEBHOOK}?wait=true`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!discord.ok) {
    throw new Error(
      `Discord respondeu HTTP ${discord.status}: ${await discord.text()}`
    );
  }

  console.log(`Status enviado: ${status}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
