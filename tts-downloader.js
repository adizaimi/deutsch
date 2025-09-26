/* 
 * tts-downloader.js
 *
 * This script will run a listener to a fd passed in the env variable,
 * or, if that is absent, to the PORT defined, and fetch the word passed in
 * via the 'download_tts' request, ex: 
 *
 *   http://uriqi.mooo.com/local_tts?word=abcd
 *
 * and download it in the the tts_cache directory to serve upon subsequent requests.
 * Subsequent audio load will occur by javascript doing:
 *   
 *   const audio = new Audio('/tts_cache/word.mp3');
 *   audio.play();
 *
 * To make this work I used lighttpd in proxy mode to forward regular requests
 * to port :80/local_tts to the port 3000 (set up by this script or by systemd).
 *
 * content of /etc/lighttpd/conf-available/10-proxy.conf
 * 
 * server.modules   += ( "mod_proxy" )
 * $HTTP["url"] =~ "^/local_tts" {
 *   proxy.server = ( "" => ( ( "host" => "127.0.0.1", "port" => 3000 ) ) )
 *   proxy.header = ( "map-urlpath" => ( "/local_tts" => "/download_tts" ) )
 *}
 *
 */

const express = require('express');
const fetch = require('node-fetch'); // npm install node-fetch@2
const fs = require('fs');
const path = require('path');

const AUDIO_DIR = '/var/www/html/tts_cache';
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

// Initialize Express
const app = express();
const PORT = 3000;

// Optional CORS headers so browser can call Node from Lighttpd page
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});


async function downloadTTS(word, lang = 'de') {
    const fileName = `${encodeURIComponent(word)}.mp3`;
    const filePath = path.join(AUDIO_DIR, word.replace(/\s*/gi, '') + '.mp3' );

    // Skip if already exists
    if (fs.existsSync(filePath)) return fileName;

    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&q=${encodeURIComponent(word)}&client=tw-ob`;

    const res = await fetch(ttsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!res.ok) throw new Error(`Failed to download TTS: ${res.status}`);

    // Create write stream with proper permissions
    const fileStream = fs.createWriteStream(filePath, { mode: 0o644 });

    await new Promise((resolve, reject) => {
        res.body.pipe(fileStream);
        res.body.on('error', reject);
        fileStream.on('finish', resolve);
    });

    fs.chmodSync(filePath, 0o644);

    // Schedule deletion after few seconds so we don't accumulate large content.
    setTimeout(() => {
        fs.unlink(filePath, err => {
            if (err) {
                console.error(`Failed to delete ${filePath}:`, err);
            } else {
                console.log(`Deleted ${filePath}`);
            }
        });
    }, 20000);

    return fileName;
}

// Node.js server snippet (express)
app.get('/download_tts', async (req, res) => {
  const word = req.query.word;
  console.log(`Request for `+ word);
  if (!word) return res.status(400).send('Missing word');

  try {
    const fileName = await downloadTTS(word, 'de');
    res.json({ file: `/tts_cache/${fileName}` });
  } catch(err) {
    res.status(500).send(err.message);
  }
});

// --- SOCKET ACTIVATION ---
const LISTEN_FD = process.env.LISTEN_FDS ? 3 : null;

const server = LISTEN_FD
    ? app.listen({ fd: LISTEN_FD }, () => console.log('TTS proxy listening on systemd socket'))
    : app.listen(3000, () => console.log('TTS proxy listening on port 3000'));

