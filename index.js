const axios = require("axios");
const express = require("express");
const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } = require("discord.js");

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

const app = express();

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.login(process.env.Token_Discord);

app.get("/", (req, res) => {
    res.send("Program działa!");
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Serwer uruchomiony");
});

const commands = [
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
    .setDescription("Dodaj streamera do obserwacji")
    .addStringOption(option =>
        option
            .setName("kanal")
            .setDescription("Link do kanału Twitch")
            .setRequired(true)
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

    const login = extractLogin(input);

    try {

        const streamer = await getStreamer(login);

        if (!streamer) {

            await interaction.reply({
                content: "Nie znaleziono takiego streamera.",
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
            (id_serwera, id_streamera)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
        `, [
            interaction.guild.id,
            idStreamera
        ]);

        await interaction.reply({
            content: `Dodano streamera ${streamer.display_name}`,
            ephemeral: true
        });

    } catch (error) {

        console.error(error);

        await interaction.reply({
            content: "Wystąpił błąd podczas dodawania streamera.",
            ephemeral: true
        });
    }
    }
});