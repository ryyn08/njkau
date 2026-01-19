const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    generateForwardMessageContent, 
    prepareWAMessageMedia, 
    generateWAMessageFromContent, 
    generateMessageID, 
    downloadContentFromMessage, 
    makeInMemoryStore, 
    jidDecode, 
    proto 
} = require("@whiskeysockets/baileys");
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const chalk = require('chalk');
const FileType = require('file-type');
const path = require('path');
const { Sticker, createSticker, StickerTypes } = require('wa-sticker-formatter');

const phoneNumber = "6283119396819";
const usePairingCode = true;

const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

async function Starts() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");
    const { version } = await fetchLatestBaileysVersion();

    const Cantarella = makeWASocket({
        printQRInTerminal: !usePairingCode,
        syncFullHistory: true,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        generateHighQualityLinkPreview: true, 
        version,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        logger: pino({ level: 'fatal' }), // Diubah ke fatal agar tidak spam error pino
        auth: state
    });

    if (usePairingCode && !Cantarella.authState.creds.registered) {
        setTimeout(async () => {
            let code = await Cantarella.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(chalk.black(chalk.bgCyan(`\n╭────────────────────────────╼`)));
            console.log(chalk.black(chalk.bgCyan(`╎ Your Pairing Code : ${code} `)));
            console.log(chalk.black(chalk.bgCyan(`╰────────────────────────────╼\n`)));
        }, 3000);
    }

    Cantarella.ev.on('messages.upsert', async chatUpdate => {
        try {
            const m = chatUpdate.messages[0];
            if (!m.message) return;
            if (m.key.fromMe) return;
            
            const messageType = Object.keys(m.message)[0];
            const from = m.key.remoteJid;
            const pushname = m.pushName || "No Name";
            const isGroup = from.endsWith('@g.us');
            const budy = (messageType === 'conversation') ? m.message.conversation : (messageType === 'extendedTextMessage') ? m.message.extendedTextMessage.text : (messageType === 'imageMessage') ? m.message.imageMessage.caption : (messageType === 'videoMessage') ? m.message.videoMessage.caption : '';
            
            const prefix = /^[°•π÷×¶∆£¢€¥®™✓_=|~!?@#$%^&.\/\\©^]/.test(budy) ? budy.match(/^[°•π÷×¶∆£¢€¥®™✓_=|~!?@#$%^&.\/\\©^]/)[0] : '';
            const isCmd = budy.startsWith(prefix);
            const command = isCmd ? budy.slice(prefix.length).trim().split(/ +/).shift().toLowerCase() : '';
            const args = budy.trim().split(/ +/).slice(1);
            const text = args.join(" ");
            const quoted = m.message.extendedTextMessage ? m.message.extendedTextMessage.contextInfo : null;

            // --- LOG TERMINAL ---
            if (m.message) {
                if (isGroup) {
                    const groupMetadata = await Cantarella.groupMetadata(from).catch(() => ({ subject: 'Unknown' }));
                    const groupName = groupMetadata.subject;
                    console.log(`\n┌────────── [ GROUP CHAT LOG ] ──────────┐\n│ 🕒 Time      : ${chalk.green(new Date().toLocaleString())}\n│ 📝 Message   : ${chalk.blue(budy || messageType)}\n│ 👤 Sender    : ${chalk.magenta(pushname)} (${chalk.cyan(m.key.participant)})\n│ 🏠 Group     : ${chalk.yellow(groupName)}\n└────────────────────────────────────────┘`);
                } else {
                    console.log(`\n┌───────── [ PRIVATE CHAT LOG ] ─────────┐\n│ 🕒 Time      : ${chalk.green(new Date().toLocaleString())}\n│ 📝 Message   : ${chalk.blue(budy || messageType)}\n│ 👤 Sender    : ${chalk.magenta(pushname)} (${chalk.cyan(from)})\n└────────────────────────────────────────┘`);
                }
            }

            // --- COMMAND HANDLER ---
            switch (command) {
                case 'menu': {
                    let menuText = `*RYYN BOTZ MD*\n\n` +
                        `*User:* ${pushname}\n` +
                        `*Prefix:* [ ${prefix} ]\n\n` +
                        `┌──『 *MAIN MENU* 』\n` +
                        `│ ◦ ${prefix}getsw\n` +
                        `│ ◦ ${prefix}rvo\n` +
                        `│ ◦ ${prefix}sbrat [teks]\n` +
                        `└───────────────`;
                    await Cantarella.sendMessage(from, { text: menuText }, { quoted: m });
                }
                break;

                case 'getsw': {
                    if (!quoted) return Cantarella.sendMessage(from, { text: 'Reply pesan Status yang ingin kamu lihat.' }, { quoted: m });
                    const mime = quoted.quotedMessage?.imageMessage?.mimetype || quoted.quotedMessage?.videoMessage?.mimetype;
                    
                    if (!/image|video/.test(mime)) return Cantarella.sendMessage(from, { text: 'Hanya bisa mengambil Status berupa foto atau video.' }, { quoted: m });

                    try {
                        let stream = await downloadContentFromMessage(quoted.quotedMessage.imageMessage || quoted.quotedMessage.videoMessage, /image/.test(mime) ? 'image' : 'video');
                        let buffer = Buffer.from([]);
                        for await(const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                        if (/image/.test(mime)) {
                            await Cantarella.sendMessage(from, { image: buffer, caption: `📸 *STATUS DILIHAT*` }, { quoted: m });
                        } else {
                            await Cantarella.sendMessage(from, { video: buffer, caption: `🎥 *STATUS DILIHAT*` }, { quoted: m });
                        }
                    } catch (e) {
                        console.error(e);
                        Cantarella.sendMessage(from, { text: 'Gagal mengambil status.' }, { quoted: m });
                    }
                }
                break;

                case 'rvo': case 'readviewonce': {
                    let q = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                    if (!q) return Cantarella.sendMessage(from, { text: "Reply pesan ViewOnce!" });
                    
                    let viewOnceMsg = q.viewOnceMessageV2?.message || q.viewOnceMessage?.message;
                    if (!viewOnceMsg) return Cantarella.sendMessage(from, { text: "Itu bukan pesan ViewOnce!" });

                    let type = Object.keys(viewOnceMsg)[0];
                    let mediaMsg = viewOnceMsg[type];
                    let stream = await downloadContentFromMessage(mediaMsg, type.replace('Message', ''));
                    let buffer = Buffer.from([]);
                    for await(const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    if (/image/.test(type)) {
                        await Cantarella.sendMessage(from, { image: buffer, caption: mediaMsg.caption || "" }, { quoted: m });
                    } else if (/video/.test(type)) {
                        await Cantarella.sendMessage(from, { video: buffer, caption: mediaMsg.caption || "" }, { quoted: m });
                    } else if (/audio/.test(type)) {
                        await Cantarella.sendMessage(from, { audio: buffer, mimetype: "audio/mp4", ptt: true }, { quoted: m });
                    }
                }
                break;

                case 'sbrat': {
                    if (!text) return Cantarella.sendMessage(from, { text: 'Teksnya mana?' }, { quoted: m });
                    const axios = require('axios');
                    const bratUrl = `https://brat.siputzx.my.id/image?text=${encodeURIComponent(text)}&background=%23ffffff&color=%23000000&emojiStyle=apple`;
                    
                    const sticker = new Sticker(bratUrl, {
                        pack: 'Ryyn Botz',
                        author: 'ryyn tamvan',
                        type: StickerTypes.FULL,
                        categories: ['🤩', '🎉'],
                        quality: 70
                    });
                    
                    const buffer = await sticker.toBuffer();
                    await Cantarella.sendMessage(from, { sticker: buffer }, { quoted: m });
                }
                break;
            }

        } catch (err) {
            console.log(chalk.red("Error Handling Message: "), err);
        }
    });

    Cantarella.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            let shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) Starts();
        } else if (connection === 'open') {
            console.log(chalk.green('Bot Terhubung ke WhatsApp!'));
        }
    });

    Cantarella.ev.on('creds.update', saveCreds);
}

Starts();
