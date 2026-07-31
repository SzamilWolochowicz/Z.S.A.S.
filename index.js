const crypto = require("crypto");
const axios = require("axios");
const express = require("express");
const {Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, Partials} = require("discord.js");

const { Pool } = require("pg");

const pool = new Pool({
connectionString: process.env.URL_Bazy,
ssl: {
rejectUnauthorized: false
}
});

async function getTwitchToken() {

    const response = await axios.post(
        "https://id.twitch.tv/oauth2/token",
        null,
        {
            params: {
                client_id: process.env.ID_Twitch,
                client_secret: process.env.TWITCH_CLIENT_SECRET,
                grant_type: "client_credentials"
            }
        }
    );

    return response.data.access_token;
}

async function getStreamer(login) {

    const token = await getTwitchToken();

    const response = await axios.get(
        "https://api.twitch.tv/helix/users",
        {
            params: {
                login: login
            },
            headers: {
                "Client-Id": process.env.ID_Twitch,
                "Authorization": `Bearer ${token}`
            }
        }
    );

    return response.data.data[0];
}

async function createEventSubSubscription(twitchUserId) {

    const token = await getTwitchToken();

    try {

        await axios.post(
            "https://api.twitch.tv/helix/eventsub/subscriptions",
            {
                type: "stream.online",
                version: "1",
                condition: {
                    broadcaster_user_id: String(twitchUserId)
                },
                transport: {
                    method: "webhook",
                    callback: "https://z-s-a-s.onrender.com/webhook",
                    secret: process.env.TWITCH_WEBHOOK_SECRET
                }
            },
            {
                headers: {
                    "Client-Id": process.env.ID_Twitch,
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                }
            }
        );

    } catch (error) {

        if (error.response?.status === 409) {

            console.log(
                `EventSub już istnieje dla ${twitchUserId}`
            );

            return;
        }

        throw error;
    }
}


const app = express();
app.use(express.json());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]
});

client.login(process.env.Token_Discord);

app.get("/", (req, res) => {
    res.send("Program działa!");
});

app.post("/webhook", async (req, res) => {

    const messageType =
        req.header("Twitch-Eventsub-Message-Type");

    if (messageType === "webhook_callback_verification") {

        return res.status(200).send(
            req.body.challenge
        );
    }

    console.log("Webhook!");
    console.log(messageType);

    console.log(
        JSON.stringify(req.body, null, 2)
    );

if (
    messageType === "notification" &&
    req.body.subscription.type === "stream.online"
) {

    const twitchId = Number(
        req.body.event.broadcaster_user_id
    );

    console.log(
        "Streamer rozpoczął transmisję:",
        twitchId
    );

const streamerWynik = await pool.query(`
    SELECT id_streamera,
           nazwa_kanalu
    FROM "Streamerzy"
    WHERE id_urz_twitcha = $1
`, [
    twitchId
]);

if (streamerWynik.rows.length === 0) {
    return res.sendStatus(200);
}

const streamer =
    streamerWynik.rows[0];

    const obserwacje = await pool.query(`
    SELECT
        o.wiadomosc,
        s.id_kanalu
    FROM "Obserwowani" o
    JOIN "Serwery" s
    ON s.id_serwera = o.id_serwera
    WHERE o.id_streamera = $1
`, [
    streamer.id_streamera
]);

for (const row of obserwacje.rows) {

    let wiadomosc = row.wiadomosc;

    wiadomosc = wiadomosc
        .replaceAll(
            "{streamer}",
            req.body.event.broadcaster_user_name
        )
        .replaceAll(
            "{url}",
            `https://twitch.tv/${req.body.event.broadcaster_user_login}`
        );

    try {

        const kanal = await client.channels.fetch(
            row.id_kanalu
        );

        await kanal.send(wiadomosc);

        console.log(
            `Wysłano powiadomienie na kanał ${row.id_kanalu}`
        );

    } catch (error) {

        console.error(
            `Błąd wysyłania na kanał ${row.id_kanalu}`
        );

        console.error(error);

    }
}

}

    res.sendStatus(200);

});

app.listen(process.env.PORT || 3000, () => {
    console.log("Serwer uruchomiony");
});

const commands = [
    //Role za reakcje
    new SlashCommandBuilder()
    .setName("panel-rol")
    .setDescription("Utwórz panel reaction roles")

    .addStringOption(option =>
        option
            .setName("tytul")
            .setDescription("Tytuł panelu")
            .setRequired(true)
    )

    .addBooleanOption(option =>
        option
            .setName("jedna_rola")
            .setDescription("Tylko jedna rola z tego panelu")
            .setRequired(true)
    )

    .addBooleanOption(option =>
        option
            .setName("usun_po_usunieciu")
            .setDescription("Usuń rolę po usunięciu reakcji")
            .setRequired(true)
    )

    .addRoleOption(option =>
        option
            .setName("rola1")
            .setDescription("Pierwsza rola")
            .setRequired(true)
    )

    .addStringOption(option =>
        option
            .setName("emoji1")
            .setDescription("Emoji dla pierwszej roli")
            .setRequired(true)
    )

    .addStringOption(option =>
        option
            .setName("opis1")
            .setDescription("Opis pierwszej roli")
            .setRequired(true)
    )
    .toJSON(),
    //Powiadomienia o streamach z Twitcha
    new SlashCommandBuilder()
        .setName("ustaw-kanal")
        .setDescription("Ustaw kanał powiadomień")
        .addChannelOption(option =>
            option
                .setName("kanal")
                .setDescription("Kanał do wysyłania powiadomień")
                .setRequired(true)
        )
        .toJSON(),
    new SlashCommandBuilder()
        .setName("dodaj-streamera")
        .setDescription("Dodaj streamera do powiadomień")
        .addStringOption(option =>
            option
                .setName("kanal")
                .setDescription("Link do kanału")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("wiadomosc")
                .setDescription("Wiadomość {url}")
                .setRequired(true)
        )
        .toJSON(),
        new SlashCommandBuilder()
        .setName("lista")
        .setDescription("Pokaż listę obserwowanych streamerów")
        .toJSON(),
        new SlashCommandBuilder()
        .setName("podglad-wiadomosci")
        .setDescription("Pokaż podgląd wiadomości")
        .addStringOption(option =>
        option
            .setName("kanal")
            .setDescription("Kanał Twitch")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .toJSON(),
        new SlashCommandBuilder()
    .setName("edytuj-wiadomosc")
    .setDescription("Edytuj wiadomość dla streamera")
    .addStringOption(option =>
        option
            .setName("kanal")
            .setDescription("Kanał Twitch")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
        option
            .setName("wiadomosc")
            .setDescription("Nowa wiadomość")
            .setRequired(true)
        )
        .toJSON(),
        new SlashCommandBuilder()
        .setName("usun-streamera")
        .setDescription("Usuń streamera z obserwowanych")
        .addStringOption(option =>
            option
            .setName("kanal")
            .setDescription("Kanał Twitch")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .toJSON()
];

function extractLogin(input) {

    let login = input.trim().toLowerCase();

    login = login.replace("https://www.twitch.tv/", "");
    login = login.replace("https://twitch.tv/", "");
    login = login.replace("http://twitch.tv/", "");
    login = login.replace("www.twitch.tv/", "");
    login = login.replace("twitch.tv/", "");

    return login;
}

client.once("ready", async () => {

    console.log(`Zalogowano jako ${client.user.tag}`);
    console.log(`Serwery: ${client.guilds.cache.size}`);

    const rest = new REST({ version: "10" })
        .setToken(process.env.Token_Discord);

    try {

        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );

        console.log("Komendy zarejestrowane");

    } catch (error) {

        console.error(error);

    }
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isAutocomplete()) {

    const focusedValue =
        interaction.options.getFocused();

    try {

        const wynik = await pool.query(`
            SELECT s.nazwa_kanalu
            FROM "Obserwowani" o
            JOIN "Streamerzy" s
            ON o.id_streamera = s.id_streamera
            WHERE o.id_serwera = $1
            ORDER BY s.nazwa_kanalu
        `, [
            interaction.guild.id
        ]);

        const filtered = wynik.rows
            .filter(row =>
                row.nazwa_kanalu
                    .toLowerCase()
                    .includes(
                        focusedValue.toLowerCase()
                    )
            )
            .slice(0, 25);

        await interaction.respond(
            filtered.map(row => ({
                name: row.nazwa_kanalu,
                value: row.nazwa_kanalu
            }))
        );

    } catch (error) {

        console.error(error);

    }

    return;
}
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "ustaw-kanal") {
        const kanal = interaction.options.getChannel("kanal");
        try {
            await pool.query(`
                INSERT INTO "Serwery"
                (id_serwera, id_kanalu)
                VALUES ($1, $2)
                ON CONFLICT (id_serwera)
                DO UPDATE SET
                id_kanalu = EXCLUDED.id_kanalu
            `, [
                interaction.guild.id,
                kanal.id
            ]);

            await interaction.reply({
                content: `Powiadomienia o streamach będą przychodzić na kanał ${kanal}`,
                ephemeral: true
            });

        } catch (error) {

            console.error(error);

            await interaction.reply({
                content: "Błąd zapisu do bazy",
                ephemeral: true
            });
        }
    }
    if (interaction.commandName === "dodaj-streamera") {

    const input = interaction.options.getString("kanal");
    const wiadomosc = interaction.options.getString("wiadomosc");

    const login = extractLogin(input);

    try {

        const streamer = await getStreamer(login);

        if (!streamer) {

            await interaction.reply({
                content: "Nie znaleziono takiego streamera",
                ephemeral: true
            });

            return;
        }

        let wynik = await pool.query(`
            SELECT id_streamera
            FROM "Streamerzy"
            WHERE id_urz_twitcha = $1
        `, [Number(streamer.id)]);

        let idStreamera;

        if (wynik.rows.length === 0) {

            const nowyStreamer = await pool.query(`
                INSERT INTO "Streamerzy"
                (id_urz_twitcha, nazwa_kanalu)
                VALUES ($1, $2)
                RETURNING id_streamera
            `, [
                Number(streamer.id),
                streamer.login
            ]);

            idStreamera = nowyStreamer.rows[0].id_streamera;

        } else {

            idStreamera = wynik.rows[0].id_streamera;

        }

        await pool.query(`
          INSERT INTO "Obserwowani"
         (id_serwera, id_streamera, wiadomosc)
          VALUES ($1, $2, $3)
          ON CONFLICT (id_serwera, id_streamera)
          DO UPDATE SET
          wiadomosc = EXCLUDED.wiadomosc
        `, [
         interaction.guild.id,
        idStreamera,
       wiadomosc
    ]);
    await createEventSubSubscription(
    Number(streamer.id)
);
    await interaction.reply({
        content: `Dodano streamera ${streamer.display_name} do bazy`,
        ephemeral: true
    });
    } catch (error) {

        console.error(error);

        await interaction.reply({
            content: "Wystąpił błąd podczas dodawania streamera",
            ephemeral: true
        });
    }
    }
    if (interaction.commandName === "lista") {

    try {

        const wynik = await pool.query(`
            SELECT s.nazwa_kanalu
            FROM "Obserwowani" o
            JOIN "Streamerzy" s
            ON o.id_streamera = s.id_streamera
            WHERE o.id_serwera = $1
            ORDER BY s.nazwa_kanalu
        `, [
            interaction.guild.id
        ]);

        if (wynik.rows.length === 0) {

            await interaction.reply({
                content: "Brak obserwowanych streamerów",
                ephemeral: true
            });

            return;
        }

        const lista = wynik.rows
        .map((row) =>
        `• ${row.nazwa_kanalu}\n  https://twitch.tv/${row.nazwa_kanalu}`
        )
        .join("\n\n");

        await interaction.reply({
        content: `Lista obserwowanych streamerów: \n\n${lista}`,
        ephemeral: true
    });

    } catch (error) {

        console.error(error);

        await interaction.reply({
            content: "Błąd przy pobieraniu listy",
            ephemeral: true
        });

    }
}
if (interaction.commandName === "podglad-wiadomosci") {

    const input = interaction.options.getString("kanal");

    const login = extractLogin(input);

    try {

        const wynik = await pool.query(`
            SELECT o.wiadomosc,
                   s.nazwa_kanalu
            FROM "Obserwowani" o
            JOIN "Streamerzy" s
            ON o.id_streamera = s.id_streamera
            WHERE o.id_serwera = $1
            AND LOWER(s.nazwa_kanalu) = LOWER($2)
        `, [
            interaction.guild.id,
            login
        ]);

        if (wynik.rows.length === 0) {

            await interaction.reply({
                content: "Ten streamer nie jest obserwowany",
                ephemeral: true
            });

            return;
        }

        let wiadomosc = wynik.rows[0].wiadomosc;

        wiadomosc = wiadomosc
            .replaceAll(
                "{url}",
                `https://twitch.tv/${wynik.rows[0].nazwa_kanalu}`
            )
            .replaceAll(
                "{streamer}",
                wynik.rows[0].nazwa_kanalu.toUpperCase()
            );

        await interaction.reply({
            content: wiadomosc,
            ephemeral: true
        });

    } catch (error) {

        console.error(error);

        await interaction.reply({
            content: "Nie udało się pobrać podglądu",
            ephemeral: true
        });
    }
}
if (interaction.commandName === "edytuj-wiadomosc") {

    const input = interaction.options.getString("kanal");
    const nowaWiadomosc = interaction.options.getString("wiadomosc");

    const login = extractLogin(input);

    try {

        const wynik = await pool.query(`
            SELECT s.id_streamera
            FROM "Obserwowani" o
            JOIN "Streamerzy" s
            ON o.id_streamera = s.id_streamera
            WHERE o.id_serwera = $1
            AND LOWER(s.nazwa_kanalu) = LOWER($2)
        `, [
            interaction.guild.id,
            login
        ]);

        if (wynik.rows.length === 0) {

            await interaction.reply({
                content: "Ten streamer nie jest obserwowany",
                ephemeral: true
            });

            return;
        }

        await pool.query(`
            UPDATE "Obserwowani"
            SET wiadomosc = $1
            WHERE id_serwera = $2
            AND id_streamera = $3
        `, [
            nowaWiadomosc,
            interaction.guild.id,
            wynik.rows[0].id_streamera
        ]);

        await interaction.reply({
            content: `Zaktualizowano wiadomość dla ${login}`,
            ephemeral: true
        });

    } catch (error) {

        console.error(error);

        await interaction.reply({
            content: "Nie udało się zaktualizować wiadomości",
            ephemeral: true
        });

    }
}
if (interaction.commandName === "usun-streamera") {

    const input = interaction.options.getString("kanal");

    const login = extractLogin(input);

    try {

        const wynik = await pool.query(`
            SELECT s.id_streamera
            FROM "Obserwowani" o
            JOIN "Streamerzy" s
            ON o.id_streamera = s.id_streamera
            WHERE o.id_serwera = $1
            AND LOWER(s.nazwa_kanalu) = LOWER($2)
        `, [
            interaction.guild.id,
            login
        ]);

        if (wynik.rows.length === 0) {

            await interaction.reply({
                content: "Ten streamer nie jest obserwowany",
                ephemeral: true
            });

            return;
        }

        await pool.query(`
            DELETE FROM "Obserwowani"
            WHERE id_serwera = $1
            AND id_streamera = $2
        `, [
            interaction.guild.id,
            wynik.rows[0].id_streamera
        ]);

        await interaction.reply({
            content: `Usunięto streamera ${login} z listy obserwowanych`,
            ephemeral: true
        });

    } catch (error) {

        console.error(error);

        await interaction.reply({
            content: "Nie udało się usunąć streamera",
            ephemeral: true
        });

    }
}
if (interaction.commandName === "panel-rol") {

    const tytul =
        interaction.options.getString("tytul");

    const jednaRola =
        interaction.options.getBoolean(
            "jedna_rola"
        );

    const usunPoUsunieciu =
        interaction.options.getBoolean(
            "usun_po_usunieciu"
        );

    const rola =
        interaction.options.getRole("rola1");

    const emoji =
        interaction.options.getString("emoji1");

    const opis =
        interaction.options.getString("opis1");

    const tresc =
`${tytul}

${emoji} - ${opis}`;

    const msg =
        await interaction.channel.send(tresc);

    await msg.react(emoji);

    await pool.query(`
        INSERT INTO "RoleReakcje"
        (
            id_serwera,
            id_wiadomosci,
            emoji,
            id_roli,
            jedna_rola,
            usun_po_usunieciu
        )
        VALUES ($1,$2,$3,$4,$5,$6)
    `, [
        interaction.guild.id,
        msg.id,
        emoji,
        rola.id,
        jednaRola,
        usunPoUsunieciu
    ]);

    await interaction.reply({
        content: "Panel utworzony",
        ephemeral: true
    });
}
});
client.on(
    Events.MessageReactionAdd,
    async (reaction, user) => {

        if (user.bot) return;

        try {

            if (reaction.partial) {
                await reaction.fetch();
            }

            const wynik = await pool.query(`
                SELECT *
                FROM "RoleReakcje"
                WHERE id_wiadomosci = $1
                AND emoji = $2
            `, [
                reaction.message.id,
                reaction.emoji.name
            ]);

            if (wynik.rows.length === 0)
                return;

            const dane = wynik.rows[0];

            const member =
                await reaction.message.guild.members.fetch(
                    user.id
                );

            await member.roles.add(
                dane.id_roli
            );

            console.log(
                `Dodano rolę ${dane.id_roli} użytkownikowi ${user.tag}`
            );

        } catch (error) {

            console.error(error);

        }
    }
    
);
client.on(
    Events.MessageReactionRemove,
    async (reaction, user) => {

        if (user.bot) return;

        try {

            if (reaction.partial) {
                await reaction.fetch();
            }

            const wynik = await pool.query(`
                SELECT *
                FROM "RoleReakcje"
                WHERE id_wiadomosci = $1
                AND emoji = $2
            `, [
                reaction.message.id,
                reaction.emoji.name
            ]);

            if (wynik.rows.length === 0)
                return;

            const dane = wynik.rows[0];

            if (!dane.usun_po_usunieciu)
                return;

            const member =
                await reaction.message.guild.members.fetch(
                    user.id
                );

            await member.roles.remove(
                dane.id_roli
            );

            console.log(
                `Usunięto rolę ${dane.id_roli} użytkownikowi ${user.tag}`
            );

        } catch (error) {

            console.error(error);

        }
    }
);
client.on(
    Events.GuildDelete,
    async guild => {

        try {

            await pool.query(`
                DELETE FROM "Obserwowani"
                WHERE id_serwera = $1
            `, [
                guild.id
            ]);

            await pool.query(`
                DELETE FROM "Serwery"
                WHERE id_serwera = $1
            `, [
                guild.id
            ]);

            await pool.query(`
                DELETE FROM "RoleReakcje"
                WHERE id_serwera = $1
            `, [
                guild.id
            ]);

            console.log(
                `Usunięto dane serwera ${guild.id}`
            );

        } catch (error) {

            console.error(error);

        }
    }
);