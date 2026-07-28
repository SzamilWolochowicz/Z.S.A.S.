const express = require("express");
const { Client, GatewayIntentBits } = require("discord.js");

const app = express();

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
    console.log(`Zalogowano jako ${client.user.tag}`);
});

client.login(process.env.Token_Discord);

app.get("/", (req, res) => {
    res.send("Program działa!");
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Serwer uruchomiony");
});

client.once("ready", () => {
console.log(`Zalogowano jako ${client.user.tag}`);
console.log(`Serwery: ${client.guilds.cache.size}`);
});