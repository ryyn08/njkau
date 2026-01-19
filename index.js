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
const axios = require('axios');
const FileType = require('file-type');
const { Sticker, createSticker, StickerTypes } = require('wa-sticker-formatter');

// Konfigurasi Utama
const phoneNumber = "6283119396819";
const usePairingCode = true;
const ownerNumber = ["6283119396819@s.whatsapp.net"];

const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

async function Starts() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");
    const { version } = await fetchLatestBaileysVersion();

    const Cantarella = makeWASocket({
        version,
        logger: pino({ level: 'fatal' }), // Memperbaiki pino logger agar tidak error
        printQRInTerminal: !usePairingCode,
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
    });

    // Fitur Pairing Code
    if (usePairingCode && !Cantarella.authState.creds.registered) {
        setTimeout(async () => {
            let code = await Cantarella.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(chalk.black(chalk.bgGreen(` RY-MD PAIRING CODE: `)), chalk.black(chalk.white(code)));
        }, 3000);
    }

    Cantarella.ev.on('creds.update', saveCreds);

    Cantarella.ev.on('messages.upsert', async chatUpdate => {
        try {
            const m = chatUpdate.messages[0];
            if (!m.message) return;
            if (m.key.fromMe) return;

            const mtype = Object.keys(m.message)[0];
            const chat = m.key.remoteJid;
            const sender = m.key.participant || m.key.remoteJid;
            const isGroup = chat.endsWith('@g.us');
            const pushname = m.pushName || "No Name";
            const body = (mtype === 'conversation') ? m.message.conversation : (mtype === 'extendedTextMessage') ? m.message.extendedTextMessage.text : (mtype === 'imageMessage') ? m.message.imageMessage.caption : (mtype === 'videoMessage') ? m.message.videoMessage.caption : '';
            const budy = typeof m.text == 'string' ? m.text : ''
            const prefix = /^[./!#]/.test(body) ? body.match(/^[./!#]/)[0] : '';
            const isCmd = body.startsWith(prefix);
            const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '';
            const args = body.trim().split(/ +/).slice(1);
            const text = args.join(" ");
            const isOwner = ownerNumber.includes(sender);
            
            const groupMetadata = isGroup ? await Cantarella.groupMetadata(chat) : '';
            const groupName = isGroup ? groupMetadata.subject : '';

            // LOG TERMINAL
            if (m.message) {
                if (isGroup) {
                    console.log(chalk.black(chalk.bgWhite(' GROUP CHAT ')), chalk.black(chalk.bgGreen(new Date().toLocaleTimeString())), chalk.magenta(budy || mtype), chalk.blue('from'), chalk.yellow(pushname), chalk.blue('in'), chalk.cyan(groupName));
                } else {
                    console.log(chalk.black(chalk.bgCyan(' PRIV CHAT ')), chalk.black(chalk.bgGreen(new Date().toLocaleTimeString())), chalk.magenta(budy || mtype), chalk.blue('from'), chalk.yellow(pushname));
                }
            }

            // Fungsi Pendukung
            const reply = (teks) => {
                Cantarella.sendMessage(chat, { text: teks }, { quoted: m });
            };

            // COMMAND HANDLER
            switch (command) {
                case 'menu':
                case 'help':
                    const menuText = `╭─── [ *RYYN BOTZ* ] ───╼
│ 👋 Halo, *${pushname}*!
│
│ 🛠️ *MAIN MENU*
│ ∘ ${prefix}getsw (Reply status)
│ ∘ ${prefix}rvo (Reply view-once)
│ ∘ ${prefix}sbrat [teks]
│
│ 📊 *STATUS*
│ ∘ Library: Baileys
│ ∘ Type: Multi-Device
╰────────────────╼`;
                    reply(menuText);
                    break;

                case 'getsw': {
                    if (!m.message.extendedTextMessage?.contextInfo?.quotedMessage) return reply('Reply pesan Statusnya!');
                    const quoted = m.message.extendedTextMessage.contextInfo.quotedMessage;
                    const qType = Object.keys(quoted)[0];
                    
                    if (qType === 'imageMessage' || qType === 'videoMessage') {
                        const stream = await downloadContentFromMessage(quoted[qType], qType === 'imageMessage' ? 'image' : 'video');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                        
                        const caption = quoted[qType].caption || '';
                        if (qType === 'imageMessage') {
                            await Cantarella.sendMessage(chat, { image: buffer, caption: `📸 *STATUS DOWNLOAD*\n\n${caption}` }, { quoted: m });
                        } else {
                            await Cantarella.sendMessage(chat, { video: buffer, caption: `🎥 *STATUS DOWNLOAD*\n\n${caption}` }, { quoted: m });
                        }
                    } else {
                        reply('Hanya bisa mengambil status gambar/video.');
                    }
                }
                break;

                case 'rvo': case 'readviewonce': {
                    if (!isOwner) return reply("Khusus Owner!");
                    const q = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                    if (!q) return reply("Reply pesan ViewOnce!");
                    const viewOnce = q.viewOnceMessageV2?.message || q.viewOnceMessage?.message;
                    if (!viewOnce) return reply("Itu bukan pesan ViewOnce!");

                    const type = Object.keys(viewOnce)[0];
                    const stream = await downloadContentFromMessage(viewOnce[type], type.replace('Message', ''));
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    if (/video/.test(type)) {
                        await Cantarella.sendMessage(chat, { video: buffer, caption: viewOnce[type].caption }, { quoted: m });
                    } else if (/image/.test(type)) {
                        await Cantarella.sendMessage(chat, { image: buffer, caption: viewOnce[type].caption }, { quoted: m });
                    }
                }
                break;

                case 'sbrat': {
                    if (!text) return reply(`Contoh: ${prefix + command} ryyntamvan`);
                    try {
                        const bratUrl = `https://brat.siputzx.my.id/image?text=${encodeURIComponent(text)}&background=%23ffffff&color=%23000000&emojiStyle=apple`;
                        const sticker = new Sticker(bratUrl, {
                            pack: 'ryyn botz',
                            author: 'ryyn tamvan',
                            type: StickerTypes.FULL,
                            categories: ['🤩', '🎉'],
                            id: '12345',
                            quality: 50,
                        });
                        const buffer = await sticker.toBuffer();
                        await Cantarella.sendMessage(chat, { sticker: buffer }, { quoted: m });
                    } catch (e) {
                        reply("Gagal membuat sticker brat.");
                    }
                }
                break;
            }

        } catch (err) {
            console.log(chalk.red("Error Upsert: "), err);
        }
    });

    Cantarella.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            let shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) Starts();
        } else if (connection === 'open') {
            console.log(chalk.green('BOT TERHUBUNG...'));
        }
    });

    return Cantarella;
}

Starts();
