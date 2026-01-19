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
const { Sticker, createSticker, StickerTypes } = require('wa-sticker-formatter');

const phoneNumber = "6283119396819";
const usePairingCode = true;
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");
    const { version } = await fetchLatestBaileysVersion();

    const ryyn = makeWASocket({
        version,
        logger: pino({ level: 'fatal' }), // Memperbaiki logger agar tidak eror/flood
        printQRInTerminal: !usePairingCode,
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
    });

    if (usePairingCode && !ryyn.authState.creds.registered) {
        setTimeout(async () => {
            let code = await ryyn.requestPairingCode(phoneNumber);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(chalk.black(chalk.bgGreen(` RYNN BOT PAIRING CODE: `)), chalk.black(chalk.bgWhite(` ${code} `)));
        }, 3000);
    }

    ryyn.ev.on('creds.update', saveCreds);

    ryyn.ev.on('messages.upsert', async chatUpdate => {
        try {
            const m = chatUpdate.messages[0];
            if (!m.message) return;
            if (m.key && m.key.remoteJid === 'status@broadcast') return;

            const type = Object.keys(m.message)[0];
            const from = m.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const pushname = m.pushName || "No Name";
            const botNumber = ryyn.decodeJid(ryyn.user.id);
            const isOwner = [botNumber, "6283119396819@s.whatsapp.net"].includes(m.key.participant || m.key.remoteJid);
            
            // Parsing Pesan
            const body = (type === 'conversation') ? m.message.conversation : (type === 'extendedTextMessage') ? m.message.extendedTextMessage.text : (type === 'imageMessage') ? m.message.imageMessage.caption : (type === 'videoMessage') ? m.message.videoMessage.caption : '';
            const budy = (typeof body == 'string' ? body : '');
            const prefix = /^[./!#]/.test(body) ? body.match(/^[./!#]/)[0] : '';
            const command = body.replace(prefix, '').trim().split(/ +/).shift().toLowerCase();
            const args = body.trim().split(/ +/).slice(1);
            const text = args.join(" ");
            const groupMetadata = isGroup ? await ryyn.groupMetadata(from) : '';
            const groupName = isGroup ? groupMetadata.subject : '';

            // LOG KE TERMINAL
            if (m.message) {
                if (isGroup) {
                    console.log(chalk.black(chalk.bgWhite(' GROUP CHAT ')), chalk.black(chalk.bgGreen(new Date().toLocaleTimeString())), chalk.magenta(pushname), chalk.blue(budy || type), 'in', chalk.yellow(groupName));
                } else {
                    console.log(chalk.black(chalk.bgCyan(' PRIV CHAT ')), chalk.black(chalk.bgGreen(new Date().toLocaleTimeString())), chalk.magenta(pushname), chalk.blue(budy || type));
                }
            }

            // FITUR CASE
            switch (command) {
                case 'menu': {
                    let menuText = `*RYYN BOTZ - MULTI DEVICE*\n\n`
                    menuText += `Hi ${pushname}!\n\n`
                    menuText += `*───[ DOWNLOADER ]───*\n`
                    menuText += `> .getsw (Reply status)\n`
                    menuText += `> .rvo (Read View Once)\n\n`
                    menuText += `*───[ TOOLS ]───*\n`
                    menuText += `> .sbrat (Text)\n\n`
                    menuText += `_Bot by Ryyn Tamvan_`
                    await ryyn.sendMessage(from, { text: menuText }, { quoted: m });
                }
                break;

                case 'sbrat': case 'brat': {
                    if (!text) return ryyn.sendMessage(from, { text: 'Masukkan teksnya, contoh: .sbrat Halo' }, { quoted: m });
                    const bratUrl = `https://brat.siputzx.my.id/image?text=${encodeURIComponent(text)}&background=%23ffffff&color=%23000000&emojiStyle=apple`;
                    
                    let sticker = new Sticker(bratUrl, {
                        pack: 'Ryyn Botz',
                        author: 'Ryyn Tamvan',
                        type: StickerTypes.FULL,
                        categories: ['🤩', '🎉'],
                        id: '12345',
                        quality: 70,
                    });
                    const buffer = await sticker.toBuffer();
                    await ryyn.sendMessage(from, { sticker: buffer }, { quoted: m });
                }
                break;

                case 'getsw': {
                    if (!m.message.extendedTextMessage?.contextInfo?.quotedMessage) return ryyn.sendMessage(from, { text: 'Reply status orang lain!' });
                    let quoted = m.message.extendedTextMessage.contextInfo.quotedMessage;
                    let mime = quoted.imageMessage?.mimetype || quoted.videoMessage?.mimetype;
                    
                    if (/image|video/.test(mime)) {
                        let download = await downloadContentFromMessage(quoted.imageMessage || quoted.videoMessage, mime.split('/')[0]);
                        let buffer = Buffer.from([]);
                        for await (const chunk of download) { buffer = Buffer.concat([buffer, chunk]); }
                        
                        if (/image/.test(mime)) {
                            await ryyn.sendMessage(from, { image: buffer, caption: '📸 *Status Dilihat*' }, { quoted: m });
                        } else {
                            await ryyn.sendMessage(from, { video: buffer, caption: '🎥 *Status Dilihat*' }, { quoted: m });
                        }
                    }
                }
                break;

                case 'rvo': case 'readviewonce': {
                    let q = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                    if (!q) return ryyn.sendMessage(from, { text: 'Reply pesan View Once!' });
                    let viewOnce = q.viewOnceMessageV2?.message || q.viewOnceMessage?.message;
                    if (!viewOnce) return ryyn.sendMessage(from, { text: 'Itu bukan pesan View Once!' });

                    let msgType = Object.keys(viewOnce)[0];
                    let media = await downloadContentFromMessage(viewOnce[msgType], msgType.replace('Message', ''));
                    let buffer = Buffer.from([]);
                    for await (const chunk of media) { buffer = Buffer.concat([buffer, chunk]); }

                    if (/video/.test(msgType)) {
                        await ryyn.sendMessage(from, { video: buffer, caption: viewOnce[msgType].caption }, { quoted: m });
                    } else if (/image/.test(msgType)) {
                        await ryyn.sendMessage(from, { image: buffer, caption: viewOnce[msgType].caption }, { quoted: m });
                    }
                }
                break;
            }
        } catch (err) {
            console.log(chalk.red("Error detect: "), err);
        }
    });

    ryyn.decodeJid = (jid) => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {};
            return decode.user && decode.server && decode.user + '@' + decode.server || jid;
        } else return jid;
    };

    ryyn.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            let shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log(chalk.green('Bot Berhasil Tersambung! ✅'));
        }
    });
}

startBot();
