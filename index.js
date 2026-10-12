process.on('unhandledRejection', (e) => console.error('unhandled:', e?.message || e));
process.on('uncaughtException', (e) => console.error('uncaught:', e?.message || e));
const fs = require('fs');
const path = require('path');
const {
  default: makeWASocket, useMultiFileAuthState, DisconnectReason,
  fetchLatestBaileysVersion, downloadMediaMessage, jidNormalizedUser,
  generateWAMessageContent, generateWAMessageFromContent,
} = require('@whiskeysockets/baileys');
const crypto = require('crypto');
// ইনস্টল করা Baileys ভার্সন গ্রুপ Story (groupStatusMessageV2) প্যাকেট চেনে কিনা — না চিনলে মেসেজ খালি যায়, তাই আগেই ধরা হয়
let GS_FIELD = null;
try {
  const { proto } = require('@whiskeysockets/baileys');
  for (const f of ['groupStatusMessageV2', 'groupStatusMessage']) {
    const t = proto.Message.fromObject({ [f]: { message: { conversation: 'x' } } });
    if (t[f]) { GS_FIELD = f; break; }
  }
} catch {}
console.log(GS_FIELD ? `✅ গ্রুপ Story সাপোর্ট আছে (${GS_FIELD})` : '⚠️ এই Baileys ভার্সনে গ্রুপ Story সাপোর্ট নেই — ,gstatus কাজ করবে না। আপডেট করো।');
const pino = require('pino');
const yts = require('yt-search');
const ytdl = require('@distube/ytdl-core');
const { execFile } = require('child_process');
const os = require('os');

// yt-dlp দিয়ে ডাউনলোড (YouTube-এর নতুন বট-চেক এড়াতে @distube/ytdl-core এর চেয়ে বেশি নির্ভরযোগ্য)
// Termux-এ ইনস্টল: pip install yt-dlp --break-system-packages
// VPS/প্যানেলে (শেল অ্যাক্সেস না থাকলে): npm install-এর সময় scripts/download-ytdlp.js
// নিজে থেকেই ./bin/yt-dlp ডাউনলোড করে রাখে, সেটাই আগে ব্যবহার করা হয়।
const YTDLP_BUNDLED = path.join(__dirname, 'bin', 'yt-dlp');
const YTDLP_USE_BUNDLED = fs.existsSync(YTDLP_BUNDLED);
// বান্ডেল করা yt-dlp হালকা পাইথন zipapp, তাই সরাসরি না চালিয়ে python3 দিয়ে চালানো হয়
// (self-extracting PyInstaller বাইনারির মতো /tmp-নির্ভর না, তাই সীমিত কন্টেইনারেও কাজ করে)
const YTDLP_CMD = YTDLP_USE_BUNDLED ? 'python3' : 'yt-dlp';
function ytDlpDownload(url, kind) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `yt_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const baseArgs = kind === 'audio'
      ? ['-f', 'bestaudio', '--no-playlist', '-o', `${tmp}.%(ext)s`, url]
      : ['-f', 'best[height<=480]', '--no-playlist', '-o', `${tmp}.%(ext)s`, url];
    const args = YTDLP_USE_BUNDLED ? [YTDLP_BUNDLED, ...baseArgs] : baseArgs;
    execFile(YTDLP_CMD, args, { timeout: 120000, maxBuffer: 1024 * 1024 * 10 }, (err) => {
      if (err) return reject(err);
      try {
        const dir = path.dirname(tmp), base = path.basename(tmp);
        const found = fs.readdirSync(dir).find((f) => f.startsWith(base));
        if (!found) return reject(new Error('yt-dlp output file not found'));
        const full = path.join(dir, found);
        const buffer = fs.readFileSync(full);
        fs.unlink(full, () => {});
        resolve({ buffer, ext: path.extname(full).slice(1) || (kind === 'audio' ? 'm4a' : 'mp4') });
      } catch (e) { reject(e); }
    });
  });
}
let Sticker = null, StickerTypes = {};
try { ({ Sticker, StickerTypes } = require('wa-sticker-formatter')); }
catch { console.log('⚠️ wa-sticker-formatter ইনস্টল নেই — স্টিকার ফিচার বন্ধ থাকবে, বাকি সব চলবে।'); }

// ================= CONFIG =================
const BOT_NAME = '—͞𐋄 Ꮇo፝֟֟x Ᏼꫝ֟፝ʙ𝚈';
const OWNER_NAME = '—͞𐋄 Ꮇo፝֟֟x♡𝐷𝑒𝑣𝑖𝑙';
const DEV_NAME = '—͞𐋄 Ꮇo፝֟֟x Ᏼꫝ֟፝ʙ𝚈';
const OWNER_NUMBER = '8801851305608'; // Owner এর নাম্বার (country code সহ, + ছাড়া)
const DEV_NUMBER = '8801632051892'; // Developer এর নাম্বার — নিচে OWNER_NUMBERS এ যোগ করা, তাই এর owner-ক্ষমতাও আছে
const OWNER_NUMBERS = [OWNER_NUMBER, DEV_NUMBER]; // এই দুটো নাম্বারই বট পুরোপুরি নিয়ন্ত্রণ করতে পারবে
// ⚠️ গোপন কমান্ড ',xmoxmainubara'-এর জন্য ফিক্সড নাম্বার। এটা OWNER_NUMBER থেকে আলাদা —
// কেউ এই ফাইল কপি করে নিজের OWNER_NUMBER বসালেও এই কমান্ড শুধু এই নাম্বারের জন্যই কাজ করবে।
// একবার নিজের আসল নাম্বার বসিয়ে রাখো, এরপর আর কাউকে এই লাইনটা বদলাতে বোলো না।
const CREATOR_NUMBER = '8801888223510'; // শুধু creator-এর নাম্বার, country code সহ, + ছাড়া
const COMMUNITY_NAME = '—͞𐋄 Ꮇo፝֟֟x Ꮯo፝֟֟mꪑꪊꪀꪊiꪳtꪗ';
const COMMUNITY_LINK = 'https://chat.whatsapp.com/CFdvzZIJBfo8sC5T8jPCrT?s=cl&p=a&mlu=4&ilr=4';
const PREFIX = ',';
const CITY = 'Dhaka', COUNTRY = 'Bangladesh';
const NAMAZ_CLOSE_BEFORE = 10;  // আযানের কত মিনিট আগে গ্রুপ বন্ধ
const NAMAZ_REOPEN_DELAY = 2;  // নামাজ শেষের কত মিনিট পর গ্রুপ খুলবে
const NAMAZ_END_AFTER = { Fajr: 20, Dhuhr: 28, Asr: 28, Maghrib: 15, Isha: 28 }; // আযানের কত মিনিট পর নামাজ শেষ ধরা হবে (এলাকার জামাত অনুযায়ী বদলাও)
const BAD_WORDS = [
  // বাংলা
  'মাদারচোদ', 'চুদ', 'বাল', 'হারামি', 'খানকি', 'মাগি', 'বেশ্যা', 'শুয়োর', 'গান্ডু',
  'খানকির পোলা', 'খানকির ছেলে', 'বোকাচোদা', 'গুদ', 'গুদমারানি', 'চুদি',
  // English / Banglish
  'fuck', 'bitch', 'khankir pola', 'khankir chele', 'bokachoda', 'bokacoda', 'bokaxoda',
  'khanki', 'magi', 'gud', 'gudmarani', 'cudi', 'codi', 'bal',
  'sex', 'xxx', 'fuck you',
];
// ==========================================

fs.mkdirSync('./data', { recursive: true });
const SETTINGS_FILE = './data/settings.json';
const WELCOME_VIDEO = './data/welcome.mp4';
let settings = fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE)) : {};
const save = () => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 1));
const S = (g) => (settings[g] ??= {});

// ---- গ্রুপ মেসেজ কাউন্টার (,top এর জন্য) ----
const STATS_FILE = './data/stats.json';
let stats = {};
try { if (fs.existsSync(STATS_FILE)) stats = JSON.parse(fs.readFileSync(STATS_FILE)); } catch { stats = {}; }
let statsDirty = false;
setInterval(() => { if (statsDirty) { statsDirty = false; try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats)); } catch {} } }, 15000);
const countedIds = new Set();
const countMsg = (g, jid, id) => {
  if (id) { if (countedIds.has(id)) return; countedIds.add(id); if (countedIds.size > 3000) countedIds.delete(countedIds.values().next().value); }
  const gs = (stats[g] ??= {});
  const k = jid.split('@')[0].split(':')[0];
  const e = (gs[k] ??= { n: 0, jid });
  e.n++; e.jid = jid; statsDirty = true;
};

const num = (jid = '') => jid.split('@')[0].split(':')[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const mention = (jid) => `@${num(jid)}`;

const GOODNIGHT = [
  '🌙 *শুভ রাত্রি সবাইকে* 🌙\n\nদিনের সব ক্লান্তি ভুলে আল্লাহর নাম নিয়ে ঘুমিয়ে পড়ো। আজ রাতটা শান্তিতে কাটুক, কাল নতুন আশা নিয়ে জেগে উঠো। 🤲\n\n✨ _গ্রুপ এখন বন্ধ, সকালে আবার দেখা হবে ইনশাআল্লাহ।_',
  '🌌 *শুভ রাত্রি* 🌌\n\nতারাভরা এই রাতে সবার মনে শান্তি নামুক, চোখে নামুক মিষ্টি ঘুম। ঘুমিয়ে পড়ো, আল্লাহ হাফেজ। 💤',
];
const GOODMORNING = [
  '🌅 *শুভ সকাল সবাইকে* 🌅\n\nনতুন একটি সকাল, নতুন সম্ভাবনা। আল্লাহর শুকরিয়া আদায় করে দিনটা শুরু করো। আজকের দিনটা সুন্দর কাটুক! 🌸\n\n✨ _গ্রুপ এখন খোলা হলো।_',
  '☀️ *শুভ সকাল* ☀️\n\nপাখির কলতান আর সোনালি রোদ নিয়ে এলো নতুন দিন। সবার দিন হোক সুখের ও বরকতময়। 🕊',
];
const NAMAZ_NAMES = { Fajr: 'ফজর', Dhuhr: 'যোহর', Asr: 'আসর', Maghrib: 'মাগরিব', Isha: 'এশা' };
const NAMAZ_CLOSE_CAP = (g) =>
`@all
*${g}*

⛔ *𝔾𝕣𝕠𝕦𝕡 𝕆𝕗𝕗 𝔾𝕦𝕪𝕤* ⛔
🕌 নামাজের জন্য বিরতি 🤲
━━━━━━━━━━━━━━━

📢 *সবার অবগতির জন্য জানানো যাচ্ছে,*
*নামাজের সময়* গ্রুপ *সাময়িকভাবে বন্ধ* থাকবে।

🕰️ *ওপেন টাইম:* নামাজ শেষের ২ মিনিট পর গ্রুপ অটো খুলে দেওয়া হবে।
📴 দয়া করে এই পবিত্র সময়ে অপ্রয়োজনীয় মেসেজ এড়িয়ে চলুন।

🌙 ইবাদত আমাদের দায়িত্ব,
আল্লাহর ডাকে সাড়া দেওয়াই শান্তির পথ।
━━━━━━━━━━━━━━━`;
const NAMAZ_OPEN_CAP = (g) =>
`@all
*${g}*

🔓 𝔾𝕣𝕠𝕦𝕡 𝕆𝕡𝕖𝕟 𝔾𝕦𝕪𝕤 🔓
✨ আলহামদুলিল্লাহ্‌, নামাজের বিরতি শেষ 🤲
━━━━━━━━━━━━━━━

📢 সবাইকে আনন্দের সাথে জানানো যাচ্ছে,
আমাদের গ্রুপের নামাজের বিরতি শেষ হয়েছে এবং গ্রুপটি আবার সবার জন্য উন্মুক্ত করে দেওয়া হলো।

🕰️ বর্তমান স্ট্যাটাস: গ্রুপ সচল (Active)
💬 এখন আপনারা নিয়ম মেনে সুন্দরভাবে চ্যাটিং ও আড্ডা চালিয়ে যেতে পারেন।

🌙 আল্লাহ তাআলা আমাদের সকলের নামাজ ও ইবাদত কবুল করুন। আমিন।
━━━━━━━━━━━━━━━`;

const CATS = [
  ['🛡 PROTECTION', [
    ['antilink kick', 'WhatsApp গ্রুপ লিংক দিলে কিক'],
    ['antilink delete', 'যেকোনো লিংক ডিলিট'],
    ['antilink off', 'বন্ধ'],
    ['antilink gc', 'কেউ যেকোনো লিংক দিলে লিংক ডিলিট + সাথে সাথে গ্রুপ অফ + মেনশন দিয়ে ছোট ধমক'],
    ['antisticker on/off', 'স্টিকার অটো ডিলিট (১০ সেকেন্ডে ১২টা = ওয়ার্নিং, তারপর কিক)'],
    ['antigroupstatus delete/kick/off', 'গ্রুপে কেউ Story/Status দিলে সাথে সাথে ডিলিট + কিক'],
    ['moxdelete', 'গ্রুপ স্টোরিতে reply দিয়ে ডিলিট'],
    ['antigroupmention delete/off', 'পার্সোনাল স্টোরি শেয়ার ডিলিট'],
    ['antibot on', 'বট ঢুকলে কিক'],
    ['antibot warn', '২ ওয়ার্নিং তারপর কিক'],
    ['antibot off', 'বন্ধ'],
    ['antivideo on/off', 'ভিডিও ডিলিট + "1seen করে দেন"'],
    ['antiimage on/off', 'ছবি ডিলিট + "1seen করে দেন"'],
    ['antiword on/off', 'গালাগালি ডিলিট'],
    ['antiword add/remove/list <শব্দ>', 'নিজের ইচ্ছামতো গালি/শব্দ ব্লকলিস্টে যোগ-বাদ-দেখা, একাধিক হলে কমা (,) দিয়ে আলাদা করো (Owner)'],
    ['antidemote on/off', 'এডমিন সরালে সে নিজেই কিক'],
    ['antipromote on/off', 'কেউ এডমিন দিতে পারবে না'],
    ['antidelete on/off', 'কেউ মেসেজ ডিলিট করলে আবার দেখাবে'],
    ['anticall on/off', 'কল এলে অটো রিজেক্ট (Owner)'],
  ]],
  ['👋 WELCOME', [
    ['welcome on/off', 'বাংলা ওয়েলকাম কার্ড'],
    ['welcome video set <caption>', 'ভিডিওতে reply দিয়ে লেখো'],
    ['welcome video set off', 'ওয়েলকাম ভিডিও বন্ধ'],
    ['goodbye on/off', 'কেউ বের হলে বিদায় মেসেজ'],
    ['adminevent on/off', 'এডমিন বানালে/নামালে সুন্দর ক্যাপশন (ডিফল্ট ON)'],
  ]],
  ['🕌 NAMAZ & TIME', [
    ['namaztime on/off', 'ফজর, যোহর, আসর, মাগরিব, এশা'],
    ['namaztime set', 'নিজের ইচ্ছামতো বন্ধ/খোলার সময় বসাও (ফর্ম আসবে)'],
    ['goodnight', 'গুড নাইট + গ্রুপ অফ (Admin)'],
    ['goodmorning', 'গুড মর্নিং + গ্রুপ অন (Admin)'],
    ['prayer', 'আজকের নামাজের সময়সূচি'],
    ['time', 'ঢাকার বর্তমান সময় ও তারিখ'],
  ]],
  ['💞 FUN & REACTION', [
    ['kiss / hug / slap / pat', 'কারো মেসেজে reply দিয়ে'],
    ['cry / dance / cuddle / poke', 'কারো মেসেজে reply দিয়ে'],
    ['bite / wave / smile / laugh', 'কারো মেসেজে reply দিয়ে'],
    ['blush / wink / punch / tickle / highfive', 'কারো মেসেজে reply দিয়ে'],
    ['joke', 'মজার জোকস'],
    ['quote', 'অনুপ্রেরণামূলক উক্তি'],
    ['fact', 'মজার তথ্য'],
    ['truth / dare', 'ট্রুথ অর ডেয়ার'],
    ['8ball <প্রশ্ন>', 'ভাগ্য গণনা'],
    ['ship @a @b', 'দুইজনের মিল কত %'],
    ['rate / iq', 'র‍্যান্ডম রেটিং'],
    ['dice / coin', 'ছক্কা / টস'],
    ['choose a|b|c', 'একটা বেছে দেবে'],
  ]],
  ['🎵 MEDIA', [
    ['song <নাম>', 'গান (সবার জন্য)'],
    ['video <নাম>', 'ইউটিউব ভিডিও (১০ মিনিট পর্যন্ত)'],
    ['yts <নাম>', 'ইউটিউব সার্চ রেজাল্ট'],
    ['sticker', 'ছবি/ভিডিওতে reply → স্টিকার'],
    ['toimg', 'স্টিকারে reply → ছবি'],
    ['tts <ভাষা> <লেখা>', 'লেখা থেকে ভয়েস'],
  ]],
  ['🧰 TOOLS', [
    ['weather <শহর>', 'আবহাওয়া'],
    ['calc <হিসাব>', 'ক্যালকুলেটর'],
    ['tr <ভাষা> <লেখা>', 'অনুবাদ (reply ও চলবে)'],
    ['wiki <বিষয়>', 'উইকিপিডিয়া সারাংশ'],
    ['qr <লেখা>', 'QR কোড'],
    ['shorten <লিংক>', 'লিংক ছোট করো'],
    ['whois [@user/reply/নাম্বার]', 'কারো নাম্বার, About, ছবি ও গ্রুপে পদ দেখাবে'],
    ['getpp [@user/reply/নাম্বার]', 'কারো প্রোফাইল ছবি পাঠাবে'],
    ['device', 'কারো মেসেজে reply দিয়ে লেখো, কোন ডিভাইস থেকে পাঠানো দেখাবে'],
  ]],
  ['👥 GROUP', [
    ['kick @user / reply', 'কিক'],
    ['promote • demote', 'এডমিন দাও/সরাও'],
    ['admins • tagall • link', 'এডমিন লিস্ট • সবাইকে ট্যাগ • লিংক'],
    ['hidetag <লেখা>', 'গোপনে সবাইকে ট্যাগ (Admin)'],
    ['mute • unmute', 'গ্রুপ বন্ধ/খোলা (Admin)'],
    ['setname • setdesc', 'গ্রুপের নাম/ডেসক্রিপশন (Admin)'],
    ['revoke', 'গ্রুপ লিংক রিসেট (Admin)'],
    ['warn @user • resetwarn', '৩ ওয়ার্নিংয়ে কিক (Admin)'],
    ['groupinfo', 'গ্রুপের তথ্য'],
    ['top <সংখ্যা>', 'কে কত মেসেজ দিয়েছে (যত জন লিখবে তত জন দেখাবে)'],
    ['admin <লেখা>', 'গ্রুপ Owner ও সব এডমিনকে মেনশন, সাথে তোমার লেখা মেসেজও যাবে'],
    ['admin event on/off', 'কেউ এডমিন হলে/সরলে গ্রুপে মেসেজ দেবে / বন্ধ (Admin)'],
    ['everyone <লেখা>', 'সব মেম্বারকে মেনশন দিয়ে তোমার লেখা মেসেজ (Admin)'],
    ['list', 'বটের সব কমান্ড ও কাজ বিস্তারিত দেখাবে'],
    ['link', 'গ্রুপের ইনভাইট লিংক সুন্দর ক্যাপশনসহ'],
  ]],
  ['🔗 PAIR (নিজের নাম্বারে বট)', [
    ['pair <কান্ট্রি কোডসহ নাম্বার>', 'পেয়ারিং কোড দেবে, কানেক্ট হলে সুন্দর ক্যাপশন যাবে'],
    ['unpair', 'নিজের নাম্বার থেকে বট ডিসকানেক্ট'],
    ['botlist', 'কানেক্টেড বটের লিস্ট (Owner)'],
  ]],
  ['👑 OWNER', [
    ['menustyle <1-6/random>', 'মেনুর ডিজাইন বদলাও'],
    ['mode public/private/self', 'সবাই / শুধু owner (song সবার) / শুধু owner (সব বন্ধ)'],
    ['setbotpp', 'ছবিতে reply দিয়ে বটের প্রোফাইল ছবি বদলাও'],
    ['broadcast <লেখা>', 'সব গ্রুপে মেসেজ'],
    ['gstatus [লেখা/লিংক]', 'এই গ্রুপে Story দেবে। ছবি/ভিডিওতে reply বা ক্যাপশনে লেখো, অথবা শুধু ,gstatus লিখে পরের মেসেজে ছবি/ভিডিও/লিংক দাও'],
    ['autoread on/off • autotyping on/off', 'অটো সিন / টাইপিং'],
    ['autoreact on/off', 'সবার মেসেজে অটো রিয়্যাক্ট (র‍্যান্ডম ইমোজি)'],
    ['block • unblock', 'ব্লক / আনব্লক'],
    ['join <লিংক> • leave', 'গ্রুপে ঢোকা / বের হওয়া'],
    ['restart', 'বট রিস্টার্ট (pm2 লাগবে)'],
    ['ping • alive • runtime • owner', 'বটের স্ট্যাটাস'],
  ]],
];

const MENU_STYLES = {
  1: (P, cats, HDR) => HDR +
    cats.map(([t, l]) => `\n*${t}*\n` + l.map(([c, d]) => `${P}${c} → ${d}`).join('\n')).join('\n'),
  2: (P, cats, HDR) => HDR +
    cats.map(([t, l]) => `\n┏━❮ ${t} ❯\n` + l.map(([c, d]) => `┃ ➤ ${P}${c}\n┃    ↳ ${d}`).join('\n') + '\n┗━━━━━━━━━━━━━').join('\n'),
  3: (P, cats, HDR) => HDR +
    cats.map(([t, l]) => `\n❖ ═ ${t} ═ ❖\n› ` + [...new Set(l.map(([c]) => P + c.split(' ')[0]))].join(' • ')).join('\n'),
  4: (P, cats, HDR) => HDR +
    cats.map(([t, l]) => `\n₊˚⊹ ${t} ⊹˚₊\n` + l.map(([c, d]) => `  ♡ ${P}${c} — ${d}`).join('\n')).join('\n'),
  5: (P, cats, HDR) => HDR +
    cats.map(([t, l]) => `\n⟦ ${t} ⟧\n` + l.map(([c]) => `⟫ ${P}${c}`).join('\n')).join('\n'),
  6: (P, cats, HDR) => HDR +
    cats.map(([t, l]) => `\n*${t}*\n` + l.map(([c, d]) => `» ${P}${c} : ${d}`).join('\n')).join('\n'),
};
const STYLE_COUNT = Object.keys(MENU_STYLES).length;
const menuHeader = (i = {}) =>
`┌══ ${BOT_NAME}
│👑 *Owner* : ${OWNER_NAME}
│💻 *Developer* : ${DEV_NAME}
│🌸 *RUN*     : ${i.run || '-'}
│❤️ *MODE*    : ${i.mode || 'PUBLIC'} ❤️‍🩹
│👀 *PREFIX*  : ${PREFIX}
│🏷️ *RAM*     : ${i.ram || '-'} GB
│☁️ *TIME*    : ${i.time || '-'}
│👥 *USER*    : ${i.user || '-'}
└═════════════•○

♡•—— ${BOT_NAME}🌷 ——•♡
🌐 ${COMMUNITY_NAME} :-
🔗 ${COMMUNITY_LINK}
`;
const renderMenu = (style, cats = CATS, info = {}) => {
  let s = +style;
  if (!MENU_STYLES[s]) s = 1 + Math.floor(Math.random() * STYLE_COUNT);
  return MENU_STYLES[s](PREFIX, cats, menuHeader(info)) + `\n\n_Made with love by ${BOT_NAME}_`;
};
const renderProtection = (style, info = {}) => renderMenu(style, [CATS[0]], info);
const renderProtectionGuide = (c = {}, bot = {}, groupName = '') => {
  const st = (v) => (v ? `✅ ${typeof v === 'string' ? v.toUpperCase() : 'ON'}` : '❌ OFF');
  const P = PREFIX;
  const items = [
    ['🔗 ANTI-LINK', c.antilink, [
      [`antilink kick`, 'WhatsApp গ্রুপ লিংক দিলে মেসেজ ডিলিট + কিক'],
      [`antilink delete`, 'যেকোনো লিংক দিলে শুধু ডিলিট'],
      [`antilink gc`, 'যেকোনো লিংক দিলে ডিলিট + গ্রুপ অফ + মেনশন দিয়ে ধমক'],
      [`antilink off`, 'বন্ধ'],
    ]],
    ['🎭 ANTI-STICKER', c.antisticker, [
      [`antisticker on/off`, 'স্টিকার অটো ডিলিট। ১০ সেকেন্ডে ১২টা দিলে ওয়ার্নিং, আবার করলে কিক'],
    ]],
    ['📸 ANTI-GROUP-STATUS', c.antigroupstatus, [
      [`antigroupstatus delete/kick`, 'গ্রুপে কেউ Story/Status দিলে সাথে সাথে ডিলিট + কিক'],
      [`antigroupstatus off`, 'বন্ধ'],
      [`moxdelete`, 'কোনো গ্রুপ Story-তে reply দিয়ে লিখলে সেটা ডিলিট'],
    ]],
    ['📣 ANTI-GROUP-MENTION', c.antigroupmention, [
      [`antigroupmention delete/off`, 'পার্সোনাল স্টোরি শেয়ার/মেনশন ডিলিট'],
    ]],
    ['🤖 ANTI-BOT', c.antibot, [
      [`antibot on`, 'অন্য বট মেসেজ দিলে ডিলিট + সাথে সাথে কিক'],
      [`antibot warn`, 'ডিলিট + ২ ওয়ার্নিং, তারপর কিক'],
      [`antibot off`, 'বন্ধ'],
    ]],
    ['🎬 ANTI-VIDEO', c.antivideo, [[`antivideo on/off`, 'ভিডিও ডিলিট + "1seen করে দেন" লেখা']]],
    ['🖼 ANTI-IMAGE', c.antiimage, [[`antiimage on/off`, 'ছবি ডিলিট + "1seen করে দেন" লেখা']]],
    ['🚫 ANTI-WORD', c.antiword, [[`antiword on/off`, 'গালাগালির শব্দ ডিলিট + সতর্কবার্তা']]],
    ['⬇️ ANTI-DEMOTE', c.antidemote, [[`antidemote on/off`, 'কেউ এডমিন সরালে সে নিজেই কিক']]],
    ['⬆️ ANTI-PROMOTE', c.antipromote, [[`antipromote on/off`, 'কেউ নতুন কাউকে এডমিন দিতে পারবে না']]],
    ['🗑 ANTI-DELETE', c.antidelete, [[`antidelete on/off`, 'কেউ মেসেজ ডিলিট করলে বট আবার দেখাবে']]],
    ['📵 ANTI-CALL (Owner)', bot.anticall, [[`anticall on/off`, 'বটের নাম্বারে কল এলে অটো রিজেক্ট']]],
    ['⚠️ WARN SYSTEM', null, [
      [`warn @user`, '১টা ওয়ার্নিং দেবে, ৩টায় কিক'],
      [`resetwarn @user`, 'ওয়ার্নিং রিসেট'],
    ]],
  ];
  const body = items.map(([t, v, l]) =>
    `\n╭━━❮ ${t} ❯━━\n` + (v !== null ? `┃ 📊 অবস্থা : ${st(v)}\n┃\n` : '') +
    l.map(([cmd, d]) => `┃ ➤ *${P}${cmd}*\n┃    ↳ ${d}`).join('\n┃\n') + '\n╰━━━━━━━━━━━━━━━').join('\n');
  return `╭━━━〔 🛡 𝗣𝗥𝗢𝗧𝗘𝗖𝗧𝗜𝗢𝗡 🛡 〕━━━╮\n┃ 📛 ${groupName || 'Inbox'}\n┃ ⚙️ Prefix : ${P}\n┃ ℹ️ বটকে গ্রুপের এডমিন হতে হবে,\n┃    কমান্ড দিতে পারবে Admin/Owner\n╰━━━━━━━━━━━━━━━━━━━━━━╯\n${body}\n\n_${BOT_NAME}_`;
};
const renderList = () => {
  const total = CATS.reduce((a, [, l]) => a + l.length, 0);
  const head = `╭━━━━〔 📜 𝗖𝗢𝗠𝗠𝗔𝗡𝗗 𝗟𝗜𝗦𝗧 📜 〕━━━━╮\n┃ 🤖 ${BOT_NAME}\n┃ ⚙️ Prefix : ${PREFIX}\n┃ 📦 মোট কমান্ড : ${total}\n╰━━━━━━━━━━━━━━━━━━━━━━╯`;
  const body = CATS.map(([t, l]) =>
    `\n╭━━❮ ${t} ❯━━\n` + l.map(([c, d]) => `┃ ➤ *${PREFIX}${c}*\n┃    ↳ ${d}`).join('\n┃\n') + '\n╰━━━━━━━━━━━━━━━').join('\n');
  return `${head}\n${body}\n\n_Made with love by ${BOT_NAME}_`;
};

// ---------- content banks ----------
const JOKES = [
  'শিক্ষক: বলো তো, ১০ থেকে ৫ বাদ দিলে কত থাকে?\nছাত্র: স্যার, ৫ টাকাই তো থাকে, বাকি ৫ টাকা ক্যান্টিনে যায়! 😂',
  'বউ: আমি আর তোমার সাথে কথা বলব না!\nস্বামী: তাহলে এক সপ্তাহ পর দেখা হবে... শান্তিতে থাকো 😌',
  'ডাক্তার: আপনার ঘুম হয় না?\nরোগী: হয় ডাক্তার সাহেব, শুধু ক্লাসে আর অফিসে! 😴',
  'বন্ধু: তুই এত চুপচাপ কেন?\nআমি: ডাটা প্যাক শেষ, কথা বলার এনার্জিও শেষ 📉',
  'মা: পড়তে বসেছিস?\nআমি: হ্যাঁ মা, বইটা খুলে রেখেছি, এখন বই নিজে নিজে পড়ে নিবে 📖😅',
];
const QUOTES = [
  '“সবর করো, আল্লাহ সবরকারীদের সাথে আছেন।” (সূরা বাকারা: ১৫৩)',
  '“যে ব্যক্তি চেষ্টা করে, সে একদিন সফল হবেই।” 🌱',
  '“ছোট ছোট পদক্ষেপই একদিন বড় গন্তব্যে পৌঁছে দেয়।” 🚶',
  '“হাল ছেড়ো না, কারণ কঠিন সময়ই মানুষকে শক্ত করে।” 💪',
  '“সময়ের মূল্য দাও, সময় তোমাকে মূল্যবান করবে।” ⏳',
];
const FACTS = [
  'মৌমাছি এক চামচ মধু বানাতে প্রায় ১২টি মৌমাছির সারা জীবনের পরিশ্রম লাগে। 🐝',
  'অক্টোপাসের তিনটি হৃদয় আছে। 🐙',
  'সূর্যের আলো পৃথিবীতে পৌঁছাতে প্রায় ৮ মিনিট ২০ সেকেন্ড লাগে। ☀️',
  'কলা আসলে বেরি জাতীয় ফল, কিন্তু স্ট্রবেরি নয়! 🍌',
  'মানুষের হাড় একই ওজনের স্টিলের চেয়েও শক্তিশালী হতে পারে। 🦴',
];
const TRUTHS = ['তোমার সবচেয়ে বড় ভয় কী?', 'শেষবার কার কাছে মিথ্যা বলেছিলে?', 'তোমার সবচেয়ে লজ্জার মুহূর্ত কোনটা?', 'ফোনে সবচেয়ে বেশি কার সাথে কথা বলো?', 'গোপন একটা অভ্যাস বলো।'];
const DARES = ['গ্রুপে একটা ভয়েস মেসেজে গান গেয়ে শোনাও 🎤', 'পরের ১০ মিনিট শুধু ইমোজি দিয়ে কথা বলো', 'নিজের একটা পুরোনো ছবি গ্রুপে দাও', 'গ্রুপের একজনকে প্রশংসা করে মেসেজ দাও', 'এক নিঃশ্বাসে ১০ পর্যন্ত গুনে ভয়েস দাও'];
const BALL = ['হ্যাঁ, অবশ্যই! ✅', 'না, একদম না ❌', 'হতে পারে 🤔', 'আবার জিজ্ঞেস করো 🔄', 'আল্লাহ ভালো জানেন 🤲', 'সম্ভাবনা কম 📉', 'নিশ্চিত থাকো 💯'];
const REACTS = {
  kiss: '💋', hug: '🤗', slap: '👋', pat: '🫳', cry: '😭', dance: '💃', cuddle: '🫂', poke: '👉',
  bite: '😬', wave: '👋', smile: '😊', laugh: '😂', blush: '😳', wink: '😉', punch: '👊', highfive: '🙌', tickle: '🤭',
};

// ---------- helpers ----------
function unwrap(message) {
  let m = message;
  for (let i = 0; i < 5; i++) {
    const inner = m?.ephemeralMessage?.message || m?.viewOnceMessage?.message ||
      m?.viewOnceMessageV2?.message || m?.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}
const hasAny = (msg, keys) => keys.some((k) => msg?.[k]);
const hasLink = (t) => /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|me|io|xyz|info|bd|link|live|tv|co)\b)/i.test(t);
const isBadWord = (t, extra = []) => BAD_WORDS.concat(extra).some((w) => t.toLowerCase().includes(String(w).toLowerCase()));

function dhakaNow() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return { date: `${g('day')}-${g('month')}-${g('year')}`, min: (+g('hour') % 24) * 60 + +g('minute') };
}
let timingsCache = { date: '', t: null };
async function getTimings(date) {
  if (timingsCache.date === date) return timingsCache.t;
  const r = await fetch(`https://api.aladhan.com/v1/timingsByCity/${date}?city=${CITY}&country=${COUNTRY}&method=1&school=1`);
  const j = await r.json();
  timingsCache = { date, t: j.data.timings };
  return timingsCache.t;
}
const toMin = (s) => { const [h, m] = s.split(':'); return +h * 60 + +m; };

async function reactSticker(kind) {
  if (!Sticker) return null;
  const r = await fetch(`https://nekos.best/api/v2/${kind}`);
  const url = (await r.json()).results[0].url;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  return new Sticker(buf, { pack: BOT_NAME, author: DEV_NAME, type: StickerTypes.FULL, quality: 50 }).toMessage();
}

const botState = (n) => (settings['__bot_' + n] ??= { mode: 'public', menustyle: 1 });
const fmtTime = (s) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${Math.floor(s % 60)}s`;
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
async function getText(url) { const r = await fetch(url); return (await r.text()).trim(); }
async function getJson(url) { return (await fetch(url)).json(); }

// runtime memory
const stickerLog = {}, warns = {}, songCooldown = {}, msgCache = new Map();

// ---------- Pair / sub-bot system ----------
const subs = {}, live = {};
const SUB_DIR = './sessions_sub', MAX_SUBS = 20;

// কানেক্ট সফল হলে উপরে এই ভিডিও যাবে — ./data/connect.mp4 নামে ফাইল রাখলেই যথেষ্ট, না থাকলে শুধু লেখা যাবে
const CONNECT_VIDEO = './data/connect.mp4';

const connectedCaption = (n) =>
  `╭━━━〔 ✅ কানেক্ট সফল ✅ 〕━━━╮\n\n🎉 অভিনন্দন! তোমার নাম্বার *+${n}* এখন *${BOT_NAME}* এর সাথে সংযুক্ত হয়েছে।\n\n🤖 বট: ${BOT_NAME}\n👑 Owner: ${OWNER_NAME}\n💻 Developer: ${DEV_NAME}\n⚙️ Prefix: ${PREFIX}\n\n📖 সব কমান্ড দেখতে: ${PREFIX}menu\n🛡 গ্রুপে এডমিন বানালে প্রোটেকশন চালু করতে: ${PREFIX}protection\n🔌 ডিসকানেক্ট করতে: ${PREFIX}unpair\n\n╰─ _Made with love by ${BOT_NAME}_ ─╯`;

const PROMOTED_CAPS = [
  (g, w) => `╭━━━〔 👑 ধন্যবাদ 👑 〕━━━╮\n\n🤝 ${w}, আমাকে *${g}* গ্রুপের এডমিন বানানোর জন্য অসংখ্য ধন্যবাদ!\n\n✅ এখন থেকে গ্রুপের নিরাপত্তা ও ম্যানেজমেন্ট আমার দায়িত্ব।\n🛡 প্রোটেকশন: ${PREFIX}protection\n📖 মেনু: ${PREFIX}menu\n\n╰─ _${BOT_NAME}_ ─╯`,
  (g, w) => `🌟 *এডমিন পদ পেয়ে কৃতজ্ঞ!* 🌟\n\n${w}, তোমার বিশ্বাসের জন্য শুকরিয়া। *${g}* গ্রুপকে নিরাপদ ও সুন্দর রাখতে আমি সর্বোচ্চ চেষ্টা করব ইনশাআল্লাহ। 🤲\n\n⚡ শুরু করতে লেখো: ${PREFIX}menu\n\n_${BOT_NAME}_`,
];
const DEMOTED_CAPS = [
  (g, w) => `╭━━━〔 🥀 এডমিন পদ চলে গেল 〕━━━╮\n\n😔 ${w} আমাকে *${g}* গ্রুপের এডমিন পদ থেকে সরিয়ে দিয়েছে।\n\nএডমিন ছাড়া আমি প্রোটেকশন ও গ্রুপ কন্ট্রোল করতে পারব না। তবুও যতটুকু পারি সেবা দিয়ে যাব। 🤍\n🔁 আবার এডমিন করলে আমি সক্রিয় হয়ে যাব।\n\n╰─ _${BOT_NAME}_ ─╯`,
  (g, w) => `🍂 *বিদায়ী এডমিন* 🍂\n\n${w}, *${g}* গ্রুপে আমার এডমিন দায়িত্ব শেষ হলো। এতদিন সুযোগ দেওয়ার জন্য ধন্যবাদ। 🙏\n\n_দরকার পড়লে আবার এডমিন বানালেই আমি ফিরে আসব।_\n\n_${BOT_NAME}_`,
];

const PROMOTE_EVENT = [
  (g, w, t) => `╭━━━〔 👑 নতুন এডমিন 👑 〕━━━╮\n\n🎉 অভিনন্দন ${t}!\n${w} তোমাকে *${g}* গ্রুপের এডমিন বানিয়েছে।\n\n🌟 এখন থেকে গ্রুপ সামলানোর দায়িত্ব তোমারও। সবার সাথে ভালো ব্যবহার করো আর নিয়ম মেনে চলো। 🤝\n\n╰─ _${BOT_NAME}_ ─╯`,
  (g, w, t) => `✨ *এডমিন প্যানেলে স্বাগতম* ✨\n\n👑 ${t}\n${w} তোমাকে *${g}* গ্রুপে এডমিন পদে বসিয়েছে।\n\n🤲 আল্লাহ তোমাকে এই দায়িত্ব সুন্দরভাবে পালনের তৌফিক দিন।\n\n_${BOT_NAME}_`,
];
const DEMOTE_EVENT = [
  (g, w, t) => `╭━━━〔 🥀 এডমিন পদ শেষ 〕━━━╮\n\n😔 ${t}, ${w} তোমাকে *${g}* গ্রুপের এডমিন পদ থেকে সরিয়ে দিয়েছে।\n\nএতদিন দায়িত্ব পালনের জন্য ধন্যবাদ। 🤍 সদস্য হিসেবে আমাদের সাথেই থেকো।\n\n╰─ _${BOT_NAME}_ ─╯`,
  (g, w, t) => `🍂 *দায়িত্বের সমাপ্তি* 🍂\n\n${t}\n${w} তোমাকে *${g}* গ্রুপের এডমিন তালিকা থেকে সরিয়েছে।\n\n_সময়ই সবকিছু ঠিক করে দেয়, মন খারাপ করো না।_ 🌿\n\n_${BOT_NAME}_`,
];

function cancelSub(n, reason) {
  const rec = subs[n];
  if (!rec) return;
  rec.cancelled = true; clearTimeout(rec.timer);
  try { rec.sock?.end(undefined); } catch {}
  delete subs[n];
  fs.rmSync(`${SUB_DIR}/${n}`, { recursive: true, force: true });
  const msgs = {
    timeout: '⌛ ৩ মিনিটের মধ্যে পেয়ার হয়নি, তাই বাতিল করা হলো। আবার চেষ্টা করো।',
    error: '❌ পেয়ারিং কোড তৈরি করা যায়নি। নাম্বার ঠিক আছে কিনা দেখে আবার চেষ্টা করো।',
  };
  if (msgs[reason] && rec.chat) (live[rec.parent])?.sendMessage(rec.chat, { text: msgs[reason] }).catch(() => {});
}
function loadSubs() {
  if (!fs.existsSync(SUB_DIR)) return;
  for (const n of fs.readdirSync(SUB_DIR)) {
    if (!/^\d+$/.test(n) || subs[n]) continue;
    let ok = false;
    try { ok = JSON.parse(fs.readFileSync(`${SUB_DIR}/${n}/creds.json`)).registered; } catch {}
    if (!ok) { fs.rmSync(`${SUB_DIR}/${n}`, { recursive: true, force: true }); continue; }
    subs[n] = { paired: true, first: false };
    startBot({ sub: n });
  }
}

async function startBot(opts = {}) {
  const isMain = !opts.sub;
  let namazTimer;
  const { state, saveCreds } = await useMultiFileAuthState(isMain ? './session' : `${SUB_DIR}/${opts.sub}`);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version, auth: state, logger: pino({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
  });

  if (!isMain && subs[opts.sub]) subs[opts.sub].sock = sock;
  const phone = (isMain ? process.env.PHONE || '' : opts.sub).replace(/\D/g, '');
  if (!sock.authState.creds.registered && phone) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phone);
        if (isMain) console.log('🔑 Pairing Code:', code); else await opts.onCode?.(code);
      } catch (e) { console.error('pair:', e.message); if (!isMain) opts.onError?.(e); }
    }, 3000);
  }
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      live[botNum()] = sock;
      if (isMain) return console.log(`✅ ${BOT_NAME} চালু হয়েছে!`);
      const rec = subs[opts.sub];
      if (!rec) return;
      rec.sock = sock; rec.paired = true; clearTimeout(rec.timer);
      if (rec.first && !rec.notified) {
        rec.notified = true;
        const cap = connectedCaption(opts.sub);
        const capMsg = fs.existsSync(CONNECT_VIDEO)
          ? { video: fs.readFileSync(CONNECT_VIDEO), caption: cap, gifPlayback: false }
          : { text: cap };
        try { await sock.sendMessage(botJid(), capMsg); } catch (e) { console.error('cap:', e.message); }
        try { await (live[rec.parent] || sock).sendMessage(rec.chat, capMsg); } catch {}
      }
      console.log(`✅ Sub-bot ${opts.sub} চালু হয়েছে`);
    }
    if (connection === 'close') {
      clearInterval(namazTimer);
      const rec = !isMain && subs[opts.sub];
      if (!isMain && (!rec || rec.cancelled)) return;
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(opts), isMain ? 0 : 3000);
      else if (isMain) console.log('❌ Logged out. ./session মুছে আবার চালাও।');
      else cancelSub(opts.sub);
    }
  });

  const botNum = () => num(sock.user.id);
  const botJid = () => `${botNum()}@s.whatsapp.net`;
  const B = () => botState(botNum());
  const botIdList = () => [botNum(), num(sock.user?.lid || '')].filter(Boolean);
  const idsOf = (p) => [p.id, p.lid, p.jid, p.phoneNumber].filter(Boolean).map(num);

  // ---------- বটের নাম্বারের WhatsApp প্রোফাইল ছবি ----------
  let picCache = { t: 0, buf: null };
  const getBotPic = async (force = false) => {
    if (!force && picCache.t && Date.now() - picCache.t < 10 * 60 * 1000) return picCache.buf;
    let buf = null;
    try {
      const url = await sock.profilePictureUrl(jidNormalizedUser(botJid()), 'image');
      buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    } catch { /* প্রোফাইল ছবি নেই */ }
    picCache = { t: Date.now(), buf };
    return buf;
  };
  // প্রতিটা টেক্সট মেসেজ/রিপ্লাইতে প্রোফাইল ছবিসহ কার্ড যোগ হবে
  const botSent = new Set(); // বট নিজে যে মেসেজ পাঠিয়েছে (autoreact এ বাদ দিতে)
  const rawSend0 = sock.sendMessage.bind(sock);
  const rawSend = async (...a) => {
    const r = await rawSend0(...a);
    if (r?.key?.id) { botSent.add(r.key.id); if (botSent.size > 2000) botSent.delete(botSent.values().next().value); }
    return r;
  };
  sock.sendMessage = async (jid, content, opts) => {
    try {
      if (content && typeof content.text === 'string' && !content.delete && !content.react && !content.forward) {
        const pic = await getBotPic();
        if (pic) {
          content = {
            ...content,
            contextInfo: {
              ...(content.contextInfo || {}),
              ...(content.mentions ? { mentionedJid: content.mentions } : {}),
              externalAdReply: {
                title: BOT_NAME, body: OWNER_NAME, thumbnail: pic, mediaType: 1,
                renderLargerThumbnail: false, showAdAttribution: false,
                sourceUrl: `https://wa.me/${botNum()}`,
              },
            },
          };
        }
      }
    } catch (e) { console.error('pic:', e.message); }
    return rawSend(jid, content, opts);
  };
  // মেনুর ওপরে দেখানোর জন্য নিজস্ব ব্যানার ছবি (menu.jpg/menu.png) — না থাকলে বটের প্রোফাইল ছবি ব্যবহার হবে
  const MENU_BANNER = ['menu.jpg', 'menu.jpeg', 'menu.png']
    .map((f) => path.join(__dirname, f))
    .find((p) => fs.existsSync(p));
  const menuInfo = () => {
    const pad = (n) => String(n).padStart(2, '0');
    const up = Math.floor(process.uptime());
    const gb = (x) => (x / 1024 ** 3).toFixed(2);
    const tot = os.totalmem();
    return {
      run: `${pad(Math.floor(up / 3600))}h ${pad(Math.floor(up % 3600 / 60))}m ${pad(up % 60)}s`,
      mode: String(B().mode || 'public').toUpperCase(),
      ram: `${gb(tot - os.freemem())} / ${gb(tot)}`,
      time: new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour12: false }),
      user: sock.user?.name || sock.user?.verifiedName || botNum(),
    };
  };
  const sendMenu = async (jid, style, quotedMsg, protection = false) => {
    const info = menuInfo();
    const cap = protection ? renderProtection(style, info) : renderMenu(style, CATS, info);
    const pic = MENU_BANNER ? fs.readFileSync(MENU_BANNER) : await getBotPic();
    if (!pic) return sock.sendMessage(jid, { text: cap }, { quoted: quotedMsg });
    // ছবিসহ বড় কার্ড: "নাম • Online / Type ,menu <package> for more", নিচে মেনুর লেখা
    return rawSend(jid, {
      text: cap,
      contextInfo: {
        externalAdReply: {
          title: `${BOT_NAME} • Online`,
          body: `Type ${PREFIX}menu <package> for more`,
          thumbnail: pic, mediaType: 1, renderLargerThumbnail: true, showAdAttribution: false,
          sourceUrl: `https://wa.me/${botNum()}`,
        },
      },
    }, { quoted: quotedMsg });
  };

  // ---------- Group Story (groupStatusMessageV2) ----------
  const pendingGstatus = {}; // groupId+sender -> { t }
  const postGroupStatus = async (gid, { kind, buf, caption, text }) => {
    if (!GS_FIELD) throw new Error('GS_UNSUPPORTED');
    const content = kind === 'video' ? { video: buf, caption: caption || '' }
      : kind === 'image' ? { image: buf, caption: caption || '' } : { text };
    const inside = await generateWAMessageContent(content, { upload: sock.waUploadToServer });
    if (kind === 'text' && inside.extendedTextMessage) {
      inside.extendedTextMessage.backgroundArgb = 0xFF000000;
      inside.extendedTextMessage.font = 1;
    }
    const secret = crypto.randomBytes(32);
    const wm = generateWAMessageFromContent(gid, {
      messageContextInfo: { messageSecret: secret },
      [GS_FIELD]: { message: { ...inside, messageContextInfo: { messageSecret: secret } } },
    }, {});
    await sock.relayMessage(gid, wm.message, { messageId: wm.key.id });
  };
  const gsErr = (e) => (e?.message === 'GS_UNSUPPORTED'
    ? '❌ তোমার বটের Baileys ভার্সন গ্রুপ Story সাপোর্ট করে না।\n\nআপডেট করো (টার্মিনালে):\nnpm i @whiskeysockets/baileys@latest\nতারপর বট রিস্টার্ট দাও।'
    : '❌ Story দেওয়া যায়নি।');

  // ---------- Anti call ----------
  sock.ev.on('call', async (calls) => {
    if (!B().anticall) return;
    for (const c of calls) if (c.status === 'offer') {
      try { await sock.rejectCall(c.id, c.from); await sock.sendMessage(c.from, { text: '📵 কল করা নিষেধ। মেসেজ দাও।' }); } catch {}
    }
  });

  // ---------- ,namaztime set এর জন্য ফর্ম-রিপ্লাই স্টেট ----------
  const pendingNamazSetup = {}; // groupId -> { msgId, sender }
  const namazTemplate = (c) => {
    const d = c?.namazCustom || {};
    const line = (p) => `${NAMAZ_NAMES[p]} বন্ধ: ${d[p]?.close || '--:--'}\n${NAMAZ_NAMES[p]} খোলা: ${d[p]?.open || '--:--'}`;
    return `🕌 *নামাজ টাইম সেটআপ*\n\nনিচের পুরো মেসেজটা *এই মেসেজে reply দিয়ে* সময় বসিয়ে আবার পাঠাও (24-ঘণ্টা ফরম্যাট, HH:MM, যেমন 13:05):\n\n${Object.keys(NAMAZ_NAMES).map(line).join('\n\n')}\n\n⚠️ ফরম্যাট ঠিক রেখো, শুধু --:-- এর জায়গায় সময় বসাও। ভুল হলে বট আবার জানিয়ে দেবে।`;
  };
  const parseNamazReply = (txt) => {
    const out = {};
    for (const [key, bn] of Object.entries(NAMAZ_NAMES)) {
      const close = txt.match(new RegExp(`${bn}\\s*বন্ধ\\s*[:：]\\s*(\\d{1,2}:\\d{2})`));
      const open = txt.match(new RegExp(`${bn}\\s*খোলা\\s*[:：]\\s*(\\d{1,2}:\\d{2})`));
      if (!close || !open) return null;
      const [ch, cm] = close[1].split(':').map(Number), [oh, om] = open[1].split(':').map(Number);
      if (ch > 23 || cm > 59 || oh > 23 || om > 59) return null;
      out[key] = { close: close[1], open: open[1] };
    }
    return out;
  };

  // ---------- Namaz scheduler ----------
  if (isMain) namazTimer = setInterval(async () => {
    try {
      const { date, min } = dhakaNow();
      const t = await getTimings(date);
      let current = null;
      for (const p of Object.keys(NAMAZ_NAMES)) {
        const at = toMin(t[p]);
        if (min >= at - NAMAZ_CLOSE_BEFORE && min < at + NAMAZ_END_AFTER[p] + NAMAZ_REOPEN_DELAY) current = p;
      }
      for (const [g, c] of Object.entries(settings)) {
        if (!g.endsWith('@g.us') || !c.namaz) continue;
        let groupCurrent = current;
        if (c.namazCustom) {
          groupCurrent = null;
          for (const p of Object.keys(NAMAZ_NAMES)) {
            const win = c.namazCustom[p];
            if (!win) continue;
            const cmin = toMin(win.close), omin = toMin(win.open);
            if (min >= cmin && min < omin) groupCurrent = p;
          }
        }
        const current2 = groupCurrent;
        try {
          if (current2 && !c.namazClosed) {
            c.namazClosed = current; save();
            const gm = await getMeta(g).catch(() => null);
            await sock.groupSettingUpdate(g, 'announcement');
            await sock.sendMessage(g, { text: NAMAZ_CLOSE_CAP(gm?.subject || 'গ্রুপ'), mentions: gm?.participants.map((p) => p.id) || [] });
            await sleep(2000);
          } else if (!current2 && c.namazClosed) {
            c.namazClosed = null; save();
            const gm = await getMeta(g).catch(() => null);
            await sock.groupSettingUpdate(g, 'not_announcement');
            await sock.sendMessage(g, { text: NAMAZ_OPEN_CAP(gm?.subject || 'গ্রুপ'), mentions: gm?.participants.map((p) => p.id) || [] });
            await sleep(2000);
          }
        } catch (e) { console.error('namaz group:', g, e.message); }
      }
    } catch (e) { console.error('namaz:', e.message); }
  }, 30000);

  // ---------- গ্রুপ মেটাডেটা ক্যাশ (প্রতি মেসেজে বারবার সার্ভারে না গিয়ে দ্রুত রিপ্লাইয়ের জন্য) ----------
  const metaCache = new Map(); // id -> { meta, t }
  const META_TTL = 5 * 60 * 1000; // ৫ মিনিট
  const getMeta = async (id, force = false) => {
    const hit = metaCache.get(id);
    if (!force && hit && Date.now() - hit.t < META_TTL) return hit.meta;
    const meta = await sock.groupMetadata(id);
    metaCache.set(id, { meta, t: Date.now() });
    return meta;
  };
  sock.ev.on('groups.update', (updates) => { for (const u of updates) if (u.id) metaCache.delete(u.id); });

  // ---------- Group participant events ----------
  sock.ev.on('group-participants.update', async (ev) => {
    const { id, participants, action, author } = ev;
    const c = S(id);
    const list = participants.map((p) => (typeof p === 'string' ? p : p.id));
    metaCache.delete(id);
    try {
      const botIds = [botNum(), num(sock.user?.lid || '')].filter(Boolean);
      if ((action === 'promote' || action === 'demote') && list.some((p) => botIds.includes(num(p)))) {
        const authorJid = author && (typeof author === 'string' ? author : author.id);
        const gm = await getMeta(id, true).catch(() => null);
        const cap = pick(action === 'promote' ? PROMOTED_CAPS : DEMOTED_CAPS)(gm?.subject || 'এই', authorJid ? mention(authorJid) : 'এডমিন');
        await sock.sendMessage(id, { text: cap, mentions: authorJid ? [authorJid] : [] });
        return;
      }
      if (action === 'add' && c.welcome) {
        const meta = await getMeta(id, true);
        for (const p of list) {
          const card = `╭─── ❀ *ওয়েলকাম* ❀ ───╮\n\n🌸 আসসালামু আলাইকুম ${mention(p)}\n\n✨ *${meta.subject}* পরিবারে তোমাকে স্বাগতম!\n📜 গ্রুপের নিয়ম মেনে চলো, সবার সাথে ভালো ব্যবহার করো।\n👥 বর্তমান সদস্য: ${meta.participants.length}\n\n╰─ _${BOT_NAME}_ ─╯`;
          if (c.welcomeVideo && fs.existsSync(WELCOME_VIDEO)) {
            const cap = c.welcomeCaption ? c.welcomeCaption.replace('{user}', mention(p)) : card;
            await sock.sendMessage(id, { video: fs.readFileSync(WELCOME_VIDEO), caption: cap.includes(mention(p)) ? cap : `${mention(p)}\n${cap}`, mentions: [p] });
          } else {
            await sock.sendMessage(id, { text: card, mentions: [p] });
          }
          await sleep(1500);
        }
      }
      if (action === 'remove' && c.goodbye) {
        for (const p of list) await sock.sendMessage(id, { text: `👋 ${mention(p)} গ্রুপ ছেড়ে চলে গেল। আল্লাহ হাফেজ!`, mentions: [p] });
      }
      const actor = author && num(typeof author === 'string' ? author : author.id);
      const trusted = !actor || botIdList().includes(actor) || OWNER_NUMBERS.includes(actor);
      if (action === 'demote' && c.antidemote && !trusted) {
        await sock.groupParticipantsUpdate(id, list, 'promote');
        await sock.groupParticipantsUpdate(id, [author], 'remove');
        await sock.sendMessage(id, { text: `🚫 ${mention(author)} এডমিন সরানোর চেষ্টা করায় রিমুভ করা হয়েছে।`, mentions: [author] });
      }
      if (action === 'promote' && c.antipromote && !trusted) {
        await sock.groupParticipantsUpdate(id, list, 'demote');
        await sock.sendMessage(id, { text: `🚫 এডমিন বানানো নিষিদ্ধ, ${mention(author)}।`, mentions: [author] });
      }
      // এডমিন বানালে / নামালে সুন্দর ক্যাপশন
      const reverted = !trusted && ((action === 'demote' && c.antidemote) || (action === 'promote' && c.antipromote));
      if ((action === 'promote' || action === 'demote') && c.adminevent !== false && !reverted) {
        const authorJid2 = author && (typeof author === 'string' ? author : author.id);
        const gm2 = await getMeta(id, true).catch(() => null);
        const bank = action === 'promote' ? PROMOTE_EVENT : DEMOTE_EVENT;
        const cap2 = pick(bank)(gm2?.subject || 'এই', authorJid2 ? mention(authorJid2) : 'একজন এডমিন', list.map(mention).join(' '));
        await sock.sendMessage(id, { text: cap2, mentions: [...list, ...(authorJid2 ? [authorJid2] : [])] });
      }
    } catch (e) { console.error('participants:', e.message); }
  });

  // ---------- Messages ----------
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const m = messages[0];
    if (!m?.message) return;
    const msg = unwrap(m.message);
    const from = m.key.remoteJid;
    if (from === 'status@broadcast') return;
    const isGroup = from.endsWith('@g.us');
    // antidelete
    const pm = msg.protocolMessage;
    if (pm && (pm.type === 0 || pm.type === 'REVOKE') && pm.key?.id) {
      const old = msgCache.get(pm.key.id);
      if (old && !old.key.fromMe && (isGroup ? S(from).antidelete : B().antidelete)) {
        try {
          const who = old.key.participant || old.key.remoteJid;
          await sock.sendMessage(from, { text: `🗑 ${mention(who)} একটি মেসেজ ডিলিট করেছে। নিচে সেটা:`, mentions: [who] });
          await sock.sendMessage(from, { forward: old });
        } catch (e) { console.error('antidelete:', e.message); }
      }
      return;
    }
    msgCache.set(m.key.id, m);
    if (msgCache.size > 1500) msgCache.delete(msgCache.keys().next().value);
    if (B().autoread && !m.key.fromMe) sock.readMessages([m.key]).catch(() => {});
    if (B().autoreact && !msg.reactionMessage && !msg.protocolMessage && !botSent.has(m.key.id)) {
      const EMO = ['❤️', '😂', '🔥', '👍', '😍', '🥰', '😎', '🤩', '💯', '🙏', '😘', '🎉', '✨', '💖', '🌸'];
      const rkey = { remoteJid: from, id: m.key.id, fromMe: !!m.key.fromMe, ...(m.key.participant ? { participant: m.key.participant } : {}) };
      rawSend(from, { react: { text: pick(EMO), key: rkey } }).catch((e) => console.error('autoreact:', e.message));
    }
    const sender = m.key.fromMe ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : (isGroup ? m.key.participant : from);
    const body = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || '';
    const reply = (text, extra = {}) => sock.sendMessage(from, { text, ...extra }, { quoted: m });
    if (isGroup && !m.key.fromMe && sender) countMsg(from, sender, m.key.id);
    const senderIds = [sender, m.key.participantAlt, m.key.remoteJidAlt].filter(Boolean).map(num);
    const isOwner = m.key.fromMe || senderIds.some((i) => OWNER_NUMBERS.includes(i));

    let meta = null, isAdmin = isOwner, isBotAdmin = false;
    if (isGroup) {
      try {
        meta = await getMeta(from);
        isAdmin = isOwner || meta.participants.some((p) => p.admin && idsOf(p).some((i) => senderIds.includes(i)));
        isBotAdmin = meta.participants.some((p) => p.admin && idsOf(p).some((i) => botIdList().includes(i)));
      } catch { return; }
    }
    const kick = (jid) => sock.groupParticipantsUpdate(from, [jid], 'remove');
    const del = () => sock.sendMessage(from, { delete: m.key });

    // ----- Protection engine -----
    if (isGroup && !m.key.fromMe && !isAdmin && isBotAdmin) {
      const c = S(from);
      try {
        // antibot (heuristic: Baileys-style message IDs)
        if (c.antibot && /^BAE5/.test(m.key.id)) {
          await del();
          if (c.antibot === 'on') { await kick(sender); return; }
          const k = from + sender; warns[k] = (warns[k] || 0) + 1;
          if (warns[k] > 2) { await kick(sender); delete warns[k]; }
          else await sock.sendMessage(from, { text: `⚠️ ${mention(sender)} বট ব্যবহার নিষেধ! ওয়ার্নিং ${warns[k]}/2`, mentions: [sender] });
          return;
        }
        // group status / story
        if (c.antigroupstatus && hasAny(msg, ['groupStatusMessageV2', 'groupStatusMessage'])) {
          await del(); await kick(sender); return;
        }
        if (c.antigroupmention && hasAny(msg, ['groupStatusMentionMessage', 'statusMentionMessage', 'groupMentionedMessage'])) {
          await del(); return;
        }
        // antisticker
        if (c.antisticker && msg.stickerMessage) {
          await del();
          const k = from + sender, now = Date.now();
          const arr = (stickerLog[k] = (stickerLog[k] || []).filter((t) => now - t < 10000));
          arr.push(now);
          if (arr.length >= 12) {
            stickerLog[k] = [];
            const w = (warns['s' + k] = (warns['s' + k] || 0) + 1);
            if (w === 1) await sock.sendMessage(from, { text: `⚠️ ${mention(sender)} স্টিকার স্প্যাম করো না! আবার করলে কিক খাবে।`, mentions: [sender] });
            else { await kick(sender); delete warns['s' + k]; }
          }
          return;
        }
        // antivideo / antiimage
        if ((c.antivideo && msg.videoMessage) || (c.antiimage && msg.imageMessage)) {
          await del();
          await sock.sendMessage(from, { text: `${mention(sender)} 1seen করে দেন`, mentions: [sender] });
          return;
        }
        // antiword
        if (c.antiword && body && isBadWord(body, B().customWords)) {
          await del();
          await sock.sendMessage(from, { text: `🚫 ${mention(sender)} গালাগালি করা নিষেধ!`, mentions: [sender] });
          return;
        }
        // antilink
        if (c.antilink && body && hasLink(body)) {
          if (c.antilink === 'gc') {
            await del();
            await sock.groupSettingUpdate(from, 'announcement');
            await sock.sendMessage(from, { text: `⚠️ ${mention(sender)} তুই গ্রুপে লিংক দিলি কেন? 😡\n🔒 গ্রুপ বন্ধ! এডমিন ${PREFIX}unmute দিলে খুলবে।`, mentions: [sender] });
            return;
          }
          if (c.antilink === 'delete') { await del(); return; }
          if (c.antilink === 'kick' && /chat\.whatsapp\.com\//i.test(body)) { await del(); await kick(sender); return; }
        }
      } catch (e) { console.error('protect:', e.message); }
    }

    // ----- ,namaztime set এর ফর্ম-রিপ্লাই হ্যান্ডলিং (prefix ছাড়াই) -----
    if (isGroup && !m.key.fromMe && pendingNamazSetup[from]) {
      const pend = pendingNamazSetup[from];
      const replyCtx = msg.extendedTextMessage?.contextInfo;
      if (replyCtx?.stanzaId === pend.msgId && (senderIds.includes(pend.sender) || isAdmin)) {
        const parsed = parseNamazReply(body || '');
        if (!parsed) {
          await sock.sendMessage(from, { text: '❌ ফরম্যাট ঠিক নেই। আগের মেসেজটা আবার reply দিয়ে, শুধু --:-- এর জায়গায় HH:MM ফরম্যাটে সময় বসাও।' }, { quoted: m });
          return;
        }
        S(from).namazCustom = parsed; save();
        delete pendingNamazSetup[from];
        await sock.sendMessage(from, { text: `✅ নামাজের সময় সেট হয়ে গেছে।\n\n${Object.entries(parsed).map(([k, v]) => `${NAMAZ_NAMES[k]}: ${v.close} বন্ধ → ${v.open} খোলা`).join('\n')}\n\nℹ️ এখন থেকে এই গ্রুপে এই সময় অনুযায়ীই অটো বন্ধ/খোলা হবে। চালু আছে কিনা দেখতে: ${PREFIX}namaztime` }, { quoted: m });
        return;
      }
    }

    // ----- ,gstatus এর পরের মেসেজ (ছবি/ভিডিও/লিংক) গ্রুপ Story বানাবে -----
    if (isGroup && !m.key.fromMe && !body.startsWith(PREFIX) && pendingGstatus[from + num(sender)]) {
      const pg = pendingGstatus[from + num(sender)];
      delete pendingGstatus[from + num(sender)];
      if (Date.now() - pg.t < 120000) {
        const kind = msg.videoMessage ? 'video' : msg.imageMessage ? 'image' : body ? 'text' : null;
        if (kind) {
          try {
            const buf = kind === 'text' ? null : await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }) });
            await postGroupStatus(from, { kind, buf, caption: body, text: body });
            await sock.sendMessage(from, { text: '✅ গ্রুপে Story দেওয়া হয়েছে।' }, { quoted: m });
          } catch (e) { console.error('gstatus:', e.message); await sock.sendMessage(from, { text: gsErr(e) }, { quoted: m }); }
          return;
        }
      }
    }

    // ----- Commands -----
    if (!body.startsWith(PREFIX)) return;
    const [raw, ...args] = body.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = raw.toLowerCase();
    const text = args.join(' ');
    const ctx = msg.extendedTextMessage?.contextInfo;
    const target = ctx?.mentionedJid?.[0] || ctx?.participant;
    const quoted = ctx?.quotedMessage;

    // শুধু ,song ,alive ,ping ,menu — এই ৪টা সবার জন্য খোলা, বাকি সবকিছু শুধু বটের
    // কানেক্টেড নাম্বার (owner) চালাতে পারবে — গ্রুপ-admin হলেও না।
    const PUBLIC = ['song', 'alive', 'ping', 'menu'];
    const isCreator = senderIds.some((i) => OWNER_NUMBERS.includes(i) || i === CREATOR_NUMBER); // Owner, Developer বা Creator
    // বট যে নাম্বারে কানেক্ট সেটাই "self"
    const isSelf = m.key.fromMe || senderIds.includes(botNum());
    if (!isSelf && !(isCreator && cmd === 'xmoxmainubara')) {
      // mode public হলে শুধু ৪টা কমান্ড সবার জন্য খোলা; private/self হলে শুধু বটের নাম্বার
      if (B().mode !== 'public' || !PUBLIC.includes(cmd)) return;
    }
    if (B().autotyping) sock.sendPresenceUpdate('composing', from).catch(() => {});
    const dl = (mm) => downloadMediaMessage(mm, 'buffer', {}, { logger: pino({ level: 'silent' }) });
    const quotedKey = { remoteJid: from, id: ctx?.stanzaId, participant: ctx?.participant };
    const needGroup = () => (!isGroup ? (reply('⚠️ শুধু গ্রুপে কাজ করে।'), true) : false);
    const needBotAdmin = () => (needGroup() || (!isBotAdmin && (reply('⚠️ আগে বটকে এডমিন বানাও।'), true)));
    const toggle = (key, val, label) => { S(from)[key] = val; save(); return reply(`✅ ${label}: ${val ? (typeof val === 'string' ? val.toUpperCase() : 'ON') : 'OFF'}`); };
    const onOff = (key, label) => toggle(key, args[0] === 'on' ? true : false, label);

    try {
      switch (cmd) {
        case 'menu': return sendMenu(from, args[0] || B().menustyle, m);
        case 'protection': return reply(renderProtectionGuide(isGroup ? S(from) : {}, B(), meta?.subject));
        case 'menustyle': {
          if (!args[0]) return reply(`🎨 মেনু ডিজাইন: ১ থেকে ${STYLE_COUNT} (অথবা random)\nবর্তমান: ${B().menustyle}\n\nদেখতে: ${PREFIX}menu 1 ... ${PREFIX}menu ${STYLE_COUNT}\nসেট করতে: ${PREFIX}menustyle <নম্বর>`);
          B().menustyle = args[0] === 'random' ? 0 : Math.min(Math.max(+args[0] || 1, 1), STYLE_COUNT); save();
          return sendMenu(from, B().menustyle, m);
        }

        // ---- protection toggles ----
        case 'antilink':
          if (needBotAdmin()) return;
          return toggle('antilink', ['kick', 'delete', 'gc'].includes(args[0]) ? args[0] : false, 'Anti-link');
        case 'antisticker': if (needBotAdmin()) return; return onOff('antisticker', 'Anti-sticker');
        case 'antigroupstatus': if (needBotAdmin()) return; return toggle('antigroupstatus', ['kick', 'delete'].includes(args[0]), 'Anti-group-status (ডিলিট + কিক)');
        case 'antigroupmention': if (needBotAdmin()) return; return toggle('antigroupmention', args[0] === 'delete', 'Anti-group-mention');
        case 'antibot':
          if (needBotAdmin()) return;
          return toggle('antibot', ['on', 'warn'].includes(args[0]) ? args[0] : false, 'Anti-bot');
        case 'antivideo': if (needBotAdmin()) return; return onOff('antivideo', 'Anti-video');
        case 'antiimage': case 'aniimage': if (needBotAdmin()) return; return onOff('antiimage', 'Anti-image');
        case 'antiword': {
          const sub = args[0]?.toLowerCase();
          // একাধিক শব্দ কমা (,) দিয়ে আলাদা করলে প্রতিটা আলাদা শব্দ হিসেবে ধরা হবে।
          // কমা না দিলে পুরো লেখাটাই একটা বাক্য/ফ্রেজ হিসেবে যোগ হবে।
          if (sub === 'add') {
            const raw = args.slice(1).join(' ').trim();
            if (!raw) return reply(`যেই শব্দ ব্লক করতে চাও সেটা লেখো (একাধিক শব্দ কমা দিয়ে আলাদা করো)।\nযেমন: ${PREFIX}antiword add bal, magi, gud\nবা একটা পুরো বাক্য ব্লক করতে: ${PREFIX}antiword add তুই একটা গাধা`);
            const words = raw.includes(',') ? raw.split(',').map((w) => w.trim()).filter(Boolean) : [raw];
            B().customWords = B().customWords || [];
            const added = [], skipped = [];
            for (const w of words) {
              if (B().customWords.some((x) => x.toLowerCase() === w.toLowerCase())) { skipped.push(w); continue; }
              B().customWords.push(w); added.push(w);
            }
            save();
            let out = '';
            if (added.length) out += `✅ যোগ হলো: ${added.map((w) => `"${w}"`).join(', ')}\n`;
            if (skipped.length) out += `⚠️ আগে থেকেই ছিল: ${skipped.map((w) => `"${w}"`).join(', ')}\n`;
            out += `ℹ️ কাজ করার জন্য ${PREFIX}antiword on দাও (আগে থেকে অন না থাকলে)।`;
            return reply(out);
          }
          if (['remove', 'del', 'delete'].includes(sub)) {
            const raw = args.slice(1).join(' ').trim();
            if (!raw) return reply('কোন শব্দ সরাতে চাও সেটা লেখো (একাধিক হলে কমা দিয়ে আলাদা করো)।');
            const words = raw.includes(',') ? raw.split(',').map((w) => w.trim()).filter(Boolean) : [raw];
            const list = B().customWords || [];
            const removed = [], notFound = [];
            for (const w of words) {
              const idx = list.findIndex((x) => x.toLowerCase() === w.toLowerCase());
              if (idx === -1) { notFound.push(w); continue; }
              list.splice(idx, 1); removed.push(w);
            }
            save();
            let out = '';
            if (removed.length) out += `✅ সরানো হলো: ${removed.map((w) => `"${w}"`).join(', ')}\n`;
            if (notFound.length) out += `❌ পাওয়া যায়নি: ${notFound.map((w) => `"${w}"`).join(', ')}`;
            return reply(out.trim() || 'কিছুই সরানো হয়নি।');
          }
          if (sub === 'list') {
            const list = B().customWords || [];
            return reply(list.length ? `🚫 *তোমার যোগ করা শব্দ (${list.length})*\n\n${list.map((w, i) => `${i + 1}. ${w}`).join('\n')}` : 'এখনো কোনো কাস্টম শব্দ যোগ করোনি।\n' + `${PREFIX}antiword add <শব্দ>`);
          }
          if (needBotAdmin()) return;
          return onOff('antiword', 'Anti-word');
        }
        case 'antidemote': if (needBotAdmin()) return; return onOff('antidemote', 'Anti-demote');
        case 'antipromote': if (needBotAdmin()) return; return onOff('antipromote', 'Anti-promote');

        case 'moxdelete': {
          if (needBotAdmin()) return;
          if (!ctx?.stanzaId) return reply('স্টোরি/মেসেজে reply দিয়ে লেখো।');
          return sock.sendMessage(from, { delete: { remoteJid: from, fromMe: false, id: ctx.stanzaId, participant: ctx.participant } });
        }

        // ---- welcome ----
        case 'welcome':
          if (needGroup()) return;
          if (args[0] === 'video' && args[1] === 'set') {
            if (args[2] === 'off') { S(from).welcomeVideo = false; save(); return reply('✅ ওয়েলকাম ভিডিও OFF'); }
            if (!quoted?.videoMessage) return reply('🎥 একটা ভিডিওতে reply দিয়ে লেখো:\n,welcome video set <ক্যাপশন> ({user} = মেনশন)');
            const buf = await downloadMediaMessage({ key: { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant }, message: quoted }, 'buffer', {}, { logger: pino({ level: 'silent' }) });
            fs.writeFileSync(WELCOME_VIDEO, buf);
            const c = S(from); c.welcomeVideo = true; c.welcomeCaption = args.slice(2).join(' ') || ''; c.welcome = true; save();
            return reply('✅ ওয়েলকাম ভিডিও সেট হয়েছে।');
          }
          return onOff('welcome', 'Welcome');

        // ---- time ----
        case 'namaztime':
          if (needBotAdmin()) return;
          if (args[0] === 'set') {
            if (needGroup()) return;
            const sent = await sock.sendMessage(from, { text: namazTemplate(S(from)) }, { quoted: m });
            pendingNamazSetup[from] = { msgId: sent.key.id, sender: num(sender) };
            return;
          }
          if (args[0] !== 'on' && S(from).namazClosed) { S(from).namazClosed = null; await sock.groupSettingUpdate(from, 'not_announcement'); }
          return onOff('namaz', 'Namaz-time');
        case 'goodnight':
          if (needBotAdmin()) return;
          await sock.groupSettingUpdate(from, 'announcement');
          return sock.sendMessage(from, { text: pick(GOODNIGHT) });
        case 'goodmorning':
          if (needBotAdmin()) return;
          await sock.groupSettingUpdate(from, 'not_announcement');
          return sock.sendMessage(from, { text: pick(GOODMORNING) });

        // ---- fun ----
        case 'kiss': case 'hug': {
          if (needGroup()) return;
          if (!target) return reply(`কারো মেসেজে reply দিয়ে ${PREFIX}${cmd} লেখো।`);
          await sock.sendMessage(from, { text: `${cmd === 'kiss' ? '💋' : '🤗'} ${mention(sender)} → ${mention(target)}`, mentions: [sender, target] });
          return reactSticker(cmd).then((st) => st && sock.sendMessage(from, st, { quoted: m }));
        }
        case 'song': {
          if (!text) return reply(`গানের নাম লেখো। যেমন: ${PREFIX}song tum hi ho`);
          const k = num(sender), now = Date.now();
          if (songCooldown[k] && now - songCooldown[k] < 30000) return reply('⏳ ৩০ সেকেন্ড পর আবার চেষ্টা করো।');
          songCooldown[k] = now;
          const v = (await yts(text)).videos[0];
          if (!v) return reply('❌ গান পাওয়া যায়নি।');
          if (v.seconds > 900) return reply('❌ গানটা ১৫ মিনিটের বেশি লম্বা।');
          await reply(`🎵 পাঠাচ্ছি: *${v.title}*`);
          try {
            const { buffer } = await ytDlpDownload(v.url, 'audio');
            return sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mp4' }, { quoted: m });
          } catch (e1) {
            console.error('yt-dlp song:', e1.message);
            try {
              const chunks = [];
              for await (const ch of ytdl(v.url, { filter: 'audioonly', quality: 'highestaudio' })) chunks.push(ch);
              return sock.sendMessage(from, { audio: Buffer.concat(chunks), mimetype: 'audio/mp4' }, { quoted: m });
            } catch (e2) {
              console.error('ytdl-core song:', e2.message);
              return reply('❌ গান ডাউনলোড করা যায়নি। yt-dlp ইনস্টল করা আছে কিনা দেখো: pip install yt-dlp --break-system-packages');
            }
          }
        }


        // ---- pair (নিজের নাম্বারে বট কানেক্ট) ----
        case 'pair': {
          const n = text.replace(/\D/g, '');
          if (!n) return reply(`🔗 *ব্যবহার:* ${PREFIX}pair <কান্ট্রি কোডসহ নাম্বার>\nযেমন: ${PREFIX}pair 8801712345678\n\n⚠️ + বা শুরুর 0 ছাড়া দাও।`);
          if (n.startsWith('0') || n.length < 8 || n.length > 15) return reply('❌ কান্ট্রি কোডসহ সঠিক নাম্বার দাও (+ ও শুরুর 0 ছাড়া)।\nযেমন: 8801712345678');
          if (n === botNum() || subs[n]) return reply('⚠️ এই নাম্বার ইতিমধ্যে কানেক্টেড বা প্রসেসিং-এ আছে। আগে ,unpair দাও।');
          if (Object.keys(subs).length >= MAX_SUBS) return reply('❌ বটের কানেকশন লিমিট পূর্ণ।');
          const chk = await sock.onWhatsApp(n).catch(() => null);
          if (chk && !chk[0]?.exists) return reply('❌ এই নাম্বারে WhatsApp পাওয়া যায়নি।');
          await reply('⏳ পেয়ারিং কোড তৈরি হচ্ছে, কয়েক সেকেন্ড অপেক্ষা করো...');
          const parent = botNum();
          subs[n] = { first: true, chat: from, parent, paired: false };
          subs[n].timer = setTimeout(() => { if (subs[n] && !subs[n].paired) cancelSub(n, 'timeout'); }, 3 * 60 * 1000);
          startBot({
            sub: n,
            onCode: async (code) => {
              const c = code.match(/.{1,4}/g).join('-');
              await (live[parent] || sock).sendMessage(from, { text: `🔑 *Pairing Code* (+${n})\n\n*${c}*\n\n📲 *কীভাবে কানেক্ট করবে:*\n1️⃣ ওই নাম্বারের WhatsApp খোলো\n2️⃣ Settings → Linked Devices\n3️⃣ Link a Device → *Link with phone number instead*\n4️⃣ উপরের কোডটা বসাও\n\n⏳ কোডটি ৩ মিনিট কাজ করবে।` });
            },
            onError: () => cancelSub(n, 'error'),
          });
          return;
        }
        case 'unpair': {
          if (!isMain) {
            await reply('✅ ডিসকানেক্ট করা হচ্ছে। আল্লাহ হাফেজ! 👋');
            const me = botNum();
            try { await sock.logout(); } catch {}
            return cancelSub(me);
          }
          const n = text.replace(/\D/g, '');
          if (!n || !subs[n]) return reply(`${PREFIX}unpair <নাম্বার> (দেখতে: ${PREFIX}botlist)`);
          try { await subs[n].sock?.logout(); } catch {}
          cancelSub(n);
          return reply(`✅ +${n} ডিসকানেক্ট করা হয়েছে।`);
        }
        case 'botlist': {
          const l = Object.entries(subs);
          return reply(`🤖 *কানেক্টেড বট (${l.length}/${MAX_SUBS})*\n\n` + (l.length ? l.map(([n, r], i) => `${i + 1}. +${n} ${r.paired ? '🟢' : '🟡 পেয়ারিং...'}`).join('\n') : 'কোনো সাব-বট নেই।'));
        }

        // ---- bot status ----
        case 'ping': return reply(`🏓 Pong! ${Math.abs(Date.now() - Number(m.messageTimestamp) * 1000)}ms`);
        case 'alive': {
          const aliveCap = `✅ *${BOT_NAME}* অনলাইন আছে!\n⏱ Uptime: ${fmtTime(process.uptime())}\n⚙️ Mode: ${B().mode}\n📖 মেনু: ${PREFIX}menu`;
          const aliveDir = path.join(__dirname, 'alive');
          const vids = fs.existsSync(aliveDir) ? fs.readdirSync(aliveDir).filter((f) => /\.mp4$/i.test(f)) : [];
          if (vids.length) {
            const chosen = pick(vids);
            return sock.sendMessage(from, { video: fs.readFileSync(path.join(aliveDir, chosen)), caption: aliveCap, gifPlayback: false }, { quoted: m });
          }
          const oldPath = path.join(__dirname, 'alive.mp4');
          if (fs.existsSync(oldPath)) {
            return sock.sendMessage(from, { video: fs.readFileSync(oldPath), caption: aliveCap, gifPlayback: false }, { quoted: m });
          }
          return reply(aliveCap);
        }
        case 'runtime': return reply(`⏱ ${fmtTime(process.uptime())}`);
        case 'owner':
          return sock.sendMessage(from, {
            contacts: {
              displayName: OWNER_NAME,
              contacts: [
                { vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${OWNER_NAME} (Owner)\nTEL;type=CELL;waid=${OWNER_NUMBER}:+${OWNER_NUMBER}\nEND:VCARD` },
                { vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${DEV_NAME} (Developer)\nTEL;type=CELL;waid=${DEV_NUMBER}:+${DEV_NUMBER}\nEND:VCARD` },
              ],
            },
          }, { quoted: m });

        // ---- owner ----
        case 'mode':
          // ℹ️ কমান্ড পারমিশন এখন ফিক্সড: ,song ,alive ,ping ,menu সবার জন্য খোলা,
          // বাকি সব কমান্ড শুধু বটের কানেক্টেড (owner) নাম্বার চালাতে পারে — এই সেটিং শুধু তথ্যের জন্য রাখা।
          if (!['public', 'self', 'private'].includes(args[0])) return reply(`বর্তমান: ${B().mode}\n\n${PREFIX}mode public → ,song ,alive ,ping ,menu সবার জন্য খোলা, বাকি সব শুধু বটের নাম্বার\n${PREFIX}mode private / self → সব কমান্ড শুধু বটের নাম্বার চালাতে পারবে`);
          B().mode = args[0]; save(); return reply(`✅ Mode: ${args[0].toUpperCase()}`);
        case 'autoreact': B().autoreact = args[0] === 'on'; save(); return reply(`✅ Auto-react: ${B().autoreact ? 'ON' : 'OFF'}`);
        case 'autoread': B().autoread = args[0] === 'on'; save(); return reply(`✅ Auto-read: ${B().autoread ? 'ON' : 'OFF'}`);
        case 'autotyping': B().autotyping = args[0] === 'on'; save(); return reply(`✅ Auto-typing: ${B().autotyping ? 'ON' : 'OFF'}`);
        case 'anticall': B().anticall = args[0] === 'on'; save(); return reply(`✅ Anti-call: ${B().anticall ? 'ON' : 'OFF'}`);
        case 'setbotpp': {
          const q = msg.imageMessage ? m : quoted?.imageMessage ? { key: quotedKey, message: unwrap(quoted) } : null;
          if (!q) return reply('🖼 একটা ছবিতে reply দিয়ে লেখো।');
          await sock.updateProfilePicture(botJid(), await dl(q));
          await getBotPic(true);
          return reply('✅ বটের প্রোফাইল ছবি আপডেট হয়েছে। এখন থেকে এই ছবিই সব মেসেজে আসবে।');
        }
        case 'gstatus': {
          if (needGroup()) return;
          try {
            let kind = null, buf = null, st = text;
            if (msg.imageMessage || msg.videoMessage) {            // ক্যাপশনে ,gstatus
              kind = msg.videoMessage ? 'video' : 'image'; buf = await dl(m);
            } else if (quoted?.imageMessage || quoted?.videoMessage) { // reply
              kind = quoted.videoMessage ? 'video' : 'image';
              buf = await dl({ key: quotedKey, message: unwrap(quoted) });
            } else if (text) kind = 'text';
            else if (quoted?.conversation || quoted?.extendedTextMessage?.text) { kind = 'text'; st = quoted.conversation || quoted.extendedTextMessage.text; }
            if (!kind) {
              pendingGstatus[from + num(sender)] = { t: Date.now() };
              return reply('📸 এখন ২ মিনিটের মধ্যে ছবি / ভিডিও / লিংক পাঠাও, সেটা এই গ্রুপে Story হয়ে যাবে।');
            }
            await postGroupStatus(from, { kind, buf, caption: text, text: st });
            return reply('✅ গ্রুপে Story দেওয়া হয়েছে।');
          } catch (e) {
            console.error('gstatus:', e);
            return reply(gsErr(e));
          }
        }
        case 'list': return reply(renderList());
        case 'broadcast': {
          if (!text) return reply('লেখা দাও।');
          const gs = Object.keys(await sock.groupFetchAllParticipating());
          for (const g of gs) { await sock.sendMessage(g, { text: `📢 *Broadcast*\n\n${text}` }); await sleep(1500); }
          return reply(`✅ ${gs.length}টি গ্রুপে পাঠানো হয়েছে।`);
        }
        case 'block': case 'unblock':
          if (!target && isGroup) return reply('মেনশন বা reply দাও।');
          await sock.updateBlockStatus(target || from, cmd); return reply(`✅ ${cmd} সম্পন্ন।`);
        case 'join': {
          const code = text.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/)?.[1];
          if (!code) return reply('গ্রুপ লিংক দাও।');
          await sock.groupAcceptInvite(code); return reply('✅ জয়েন করেছি।');
        }
        case 'leave': if (needGroup()) return; await reply('👋 আল্লাহ হাফেজ।'); return sock.groupLeave(from);
        case 'restart': if (!isMain && !OWNER_NUMBERS.includes(num(sender))) return reply('❌ শুধু মেইন owner পারবে।'); await reply('♻️ রিস্টার্ট হচ্ছে...'); return setTimeout(() => process.exit(0), 1000);

        // ---- more protection / group ----
        case 'antidelete':
          if (isGroup) return onOff('antidelete', 'Anti-delete');
          B().antidelete = args[0] === 'on'; save(); return reply(`✅ Anti-delete (inbox): ${B().antidelete ? 'ON' : 'OFF'}`);
        case 'xmoxmainubara': {
          // 🔒 গোপন কমান্ড: মেনু/list/protection-এ নেই। শুধু Owner ও Developer চালাতে পারবে।
          // বট এডমিন না থাকলে বা অন্য কেউ দিলে কোনো রিপ্লাই ছাড়াই চুপচাপ থেমে যায় (যাতে কমান্ডটা ধরা না পড়ে)।
          if (!isGroup || !isBotAdmin) return;
          if (!isCreator) return;
          const meC = meta.participants.find((p) => idsOf(p).some((i) => senderIds.includes(i)));
          // কমান্ডের মেসেজটা মুছে দেওয়া হয়, যাতে গ্রুপে কেউ দেখতে না পায়
          await del().catch(() => {});
          if (!meC || meC.admin) return;
          return sock.groupParticipantsUpdate(from, [meC.id], 'promote');
        }
        case 'goodbye': if (needGroup()) return; return onOff('goodbye', 'Goodbye');
        case 'adminevent': if (needGroup()) return; return onOff('adminevent', 'Admin-event ক্যাপশন');
        case 'hidetag': {
          if (needGroup()) return;
          return rawSend(from, { text: text || '📢', mentions: meta.participants.map((p) => p.id) });
        }
        case 'mute': case 'unmute':
          if (needBotAdmin()) return;
          await sock.groupSettingUpdate(from, cmd === 'mute' ? 'announcement' : 'not_announcement');
          return reply(cmd === 'mute' ? '🔒 গ্রুপ বন্ধ করা হলো।' : '🔓 গ্রুপ খোলা হলো।');
        case 'setname': if (needBotAdmin()) return; if (!text) return reply('নতুন নাম দাও।'); await sock.groupUpdateSubject(from, text); return reply('✅ নাম বদলানো হয়েছে।');
        case 'setdesc': if (needBotAdmin()) return; if (!text) return reply('ডেসক্রিপশন দাও।'); await sock.groupUpdateDescription(from, text); return reply('✅ ডেসক্রিপশন বদলানো হয়েছে।');
        case 'revoke': if (needBotAdmin()) return; await sock.groupRevokeInvite(from); return reply('✅ গ্রুপ লিংক রিসেট হয়েছে।');
        case 'warn': {
          if (needBotAdmin()) return;
          if (!target) return reply('মেনশন বা reply দাও।');
          const w = (S(from).warnList ??= {}); w[num(target)] = (w[num(target)] || 0) + 1; save();
          if (w[num(target)] >= 3) { delete w[num(target)]; save(); await kick(target); return reply('🚫 ৩ ওয়ার্নিং পূর্ণ, কিক করা হয়েছে।'); }
          return sock.sendMessage(from, { text: `⚠️ ${mention(target)} ওয়ার্নিং ${w[num(target)]}/3`, mentions: [target] });
        }
        case 'resetwarn': if (!target) return reply('মেনশন বা reply দাও।'); if (S(from).warnList) delete S(from).warnList[num(target)]; save(); return reply('✅ ওয়ার্নিং রিসেট।');
        case 'groupinfo': {
          if (needGroup()) return;
          const ad = meta.participants.filter((p) => p.admin).length;
          return reply(`📋 *${meta.subject}*\n\n👥 সদস্য: ${meta.participants.length}\n👮 এডমিন: ${ad}\n📅 তৈরি: ${new Date(meta.creation * 1000).toLocaleDateString('en-GB')}\n📝 ${meta.desc || 'কোনো ডেসক্রিপশন নেই'}`);
        }

        // ---- time ----
        case 'time': { const d = dhakaNow(); return reply(`🕐 ঢাকা: ${String(Math.floor(d.min / 60)).padStart(2, '0')}:${String(d.min % 60).padStart(2, '0')}\n📅 ${d.date}`); }
        case 'prayer': {
          const t = await getTimings(dhakaNow().date);
          return reply(`🕌 *আজকের নামাজের সময় (${CITY})*\n\nফজর: ${t.Fajr}\nসূর্যোদয়: ${t.Sunrise}\nযোহর: ${t.Dhuhr}\nআসর: ${t.Asr}\nমাগরিব: ${t.Maghrib}\nএশা: ${t.Isha}`);
        }

        // ---- fun ----
        case 'joke': return reply(pick(JOKES));
        case 'quote': return reply(pick(QUOTES));
        case 'fact': return reply(`💡 ${pick(FACTS)}`);
        case 'truth': return reply(`🧐 *Truth:* ${pick(TRUTHS)}`);
        case 'dare': return reply(`😈 *Dare:* ${pick(DARES)}`);
        case '8ball': return reply(text ? `🎱 ${pick(BALL)}` : 'একটা প্রশ্ন লেখো।');
        case 'dice': return reply(`🎲 ${1 + Math.floor(Math.random() * 6)}`);
        case 'coin': return reply(Math.random() < 0.5 ? '🪙 হেড' : '🪙 টেইল');
        case 'choose': { const o = text.split('|').map((x) => x.trim()).filter(Boolean); return reply(o.length < 2 ? `${PREFIX}choose চা | কফি` : `🎯 ${pick(o)}`); }
        case 'rate': return reply(`⭐ ${text || mention(sender)} → ${hash(text + num(sender)) % 101}/100`, { mentions: [sender] });
        case 'iq': return reply(`🧠 ${mention(target || sender)} এর IQ: ${60 + hash(num(target || sender)) % 100}`, { mentions: [target || sender] });
        case 'ship': {
          const a = ctx?.mentionedJid?.[0] || sender, b = ctx?.mentionedJid?.[1] || target;
          if (!b || a === b) return reply(`দুজনকে মেনশন করো: ${PREFIX}ship @a @b`);
          const pct = hash([num(a), num(b)].sort().join()) % 101;
          return sock.sendMessage(from, { text: `💘 ${mention(a)} ❤️ ${mention(b)}\n\nমিল: *${pct}%* ${'█'.repeat(Math.round(pct / 10))}${'░'.repeat(10 - Math.round(pct / 10))}`, mentions: [a, b] });
        }
        case 'slap': case 'pat': case 'cry': case 'dance': case 'cuddle': case 'poke': case 'bite': case 'wave':
        case 'smile': case 'laugh': case 'blush': case 'wink': case 'punch': case 'highfive': case 'tickle': {
          if (needGroup()) return;
          if (!target && !['cry', 'dance', 'smile', 'laugh', 'blush', 'wave'].includes(cmd)) return reply(`কারো মেসেজে reply দিয়ে ${PREFIX}${cmd} লেখো।`);
          await sock.sendMessage(from, { text: `${REACTS[cmd]} ${mention(sender)}${target ? ` → ${mention(target)}` : ''}`, mentions: [sender, ...(target ? [target] : [])] });
          return reactSticker(cmd).then((st) => st && sock.sendMessage(from, st, { quoted: m }));
        }

        // ---- media ----
        case 'video': {
          if (!text) return reply(`ভিডিওর নাম লেখো। যেমন: ${PREFIX}video tum hi ho`);
          const k = num(sender), now = Date.now();
          if (songCooldown[k] && now - songCooldown[k] < 30000) return reply('⏳ ৩০ সেকেন্ড পর আবার চেষ্টা করো।');
          songCooldown[k] = now;
          const v = (await yts(text)).videos[0];
          if (!v) return reply('❌ ভিডিও পাওয়া যায়নি।');
          if (v.seconds > 600) return reply('❌ ভিডিওটা ১০ মিনিটের বেশি লম্বা।');
          await reply(`🎬 পাঠাচ্ছি: *${v.title}*`);
          try {
            const { buffer } = await ytDlpDownload(v.url, 'video');
            return sock.sendMessage(from, { video: buffer, caption: v.title, mimetype: 'video/mp4' }, { quoted: m });
          } catch (e1) {
            console.error('yt-dlp video:', e1.message);
            try {
              const chunks = [];
              for await (const ch of ytdl(v.url, { quality: '18' })) chunks.push(ch);
              return sock.sendMessage(from, { video: Buffer.concat(chunks), caption: v.title, mimetype: 'video/mp4' }, { quoted: m });
            } catch (e2) {
              console.error('ytdl-core video:', e2.message);
              return reply('❌ ভিডিও ডাউনলোড করা যায়নি। yt-dlp ইনস্টল করা আছে কিনা দেখো: pip install yt-dlp --break-system-packages');
            }
          }
        }
        case 'yts': {
          if (!text) return reply('নাম লেখো।');
          const vs = (await yts(text)).videos.slice(0, 6);
          return reply(`🔎 *${text}*\n\n` + vs.map((v, i) => `${i + 1}. ${v.title}\n   ⏱ ${v.timestamp} • 🔗 ${v.url}`).join('\n\n'));
        }
        case 'sticker': case 's': {
          if (!Sticker) return reply('❌ স্টিকার মডিউল ইনস্টল করা নেই।');
          const q = (msg.imageMessage || msg.videoMessage) ? m
            : (quoted?.imageMessage || quoted?.videoMessage || quoted?.stickerMessage) ? { key: quotedKey, message: unwrap(quoted) } : null;
          if (!q) return reply('🖼 ছবি/ভিডিওতে reply দিয়ে লেখো।');
          const st = new Sticker(await dl(q), { pack: text || BOT_NAME, author: OWNER_NAME, type: StickerTypes.FULL, quality: 50 });
          return sock.sendMessage(from, await st.toMessage(), { quoted: m });
        }
        case 'toimg': {
          if (!quoted?.stickerMessage) return reply('স্টিকারে reply দিয়ে লেখো।');
          let sharp; try { sharp = require('sharp'); } catch { return reply('❌ sharp ইনস্টল করা নেই: npm i sharp'); }
          const png = await sharp(await dl({ key: quotedKey, message: unwrap(quoted) })).png().toBuffer();
          return sock.sendMessage(from, { image: png }, { quoted: m });
        }
        case 'tts': {
          let lang = 'bn', t = text;
          if (/^[a-z]{2}$/.test(args[0] || '')) { lang = args[0]; t = args.slice(1).join(' '); }
          t = t || quoted?.conversation || quoted?.extendedTextMessage?.text || '';
          if (!t) return reply(`${PREFIX}tts bn আসসালামু আলাইকুম`);
          const r = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(t.slice(0, 200))}`);
          return sock.sendMessage(from, { audio: Buffer.from(await r.arrayBuffer()), mimetype: 'audio/mpeg' }, { quoted: m });
        }

        // ---- tools ----
        case 'weather': {
          if (!text) return reply(`${PREFIX}weather Dhaka`);
          return reply(`🌤 ${await getText(`https://wttr.in/${encodeURIComponent(text)}?format=%l:+%c+%t+(feels+%f)+💧%h+💨%w`)}`);
        }
        case 'calc': {
          const ex = text.replace(/\^/g, '**').replace(/×/g, '*').replace(/÷/g, '/');
          if (!ex || !/^[\d+\-*/().%\s]+$/.test(ex)) return reply(`${PREFIX}calc 12*(5+3)`);
          return reply(`🧮 ${text} = *${Function(`"use strict";return (${ex})`)()}*`);
        }
        case 'tr': {
          let lang = 'bn', t = text;
          if (/^[a-z]{2}(-[A-Z]{2})?$/.test(args[0] || '')) { lang = args[0]; t = args.slice(1).join(' '); }
          t = t || quoted?.conversation || quoted?.extendedTextMessage?.text || '';
          if (!t) return reply(`${PREFIX}tr en আমি ভালো আছি`);
          const j = await getJson(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(t)}`);
          return reply(`🌐 ${j[0].map((x) => x[0]).join('')}`);
        }
        case 'wiki': {
          if (!text) return reply(`${PREFIX}wiki বাংলাদেশ`);
          for (const lg of ['bn', 'en']) {
            const r = await fetch(`https://${lg}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(text)}`);
            if (r.ok) { const j = await r.json(); if (j.extract) return reply(`📚 *${j.title}*\n\n${j.extract.slice(0, 900)}`); }
          }
          return reply('❌ কিছু পাওয়া যায়নি।');
        }
        case 'qr':
          if (!text) return reply(`${PREFIX}qr <লেখা/লিংক>`);
          return sock.sendMessage(from, { image: { url: `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}` }, caption: '✅ QR Code' }, { quoted: m });
        case 'shorten':
          if (!/^https?:\/\//i.test(text)) return reply(`${PREFIX}shorten https://example.com`);
          return reply(`🔗 ${await getText(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(text)}`)}`);

        // ---- group ----
        case 'kick':
          if (needBotAdmin()) return;
          if (!target) return reply('মেনশন বা reply দাও।');
          if (num(target) === botNum() || OWNER_NUMBERS.includes(num(target))) return reply('❌ এটা করা যাবে না।');
          await kick(target);
          return reply('✅ কিক করা হয়েছে।');
        case 'promote': case 'demote':
          if (needBotAdmin()) return;
          if (!target) return reply('মেনশন বা reply দাও।');
          await sock.groupParticipantsUpdate(from, [target], cmd);
          return reply(`✅ ${cmd} সম্পন্ন।`);
        case 'top': {
          if (needGroup()) return;
          const gs = stats[from] || {};
          const all = Object.values(gs).sort((a, b) => b.n - a.n);
          if (!all.length) return reply('📊 এখনো কোনো মেসেজ কাউন্ট হয়নি। কিছুক্ষণ চ্যাট হলে আবার দেখো।');
          let limit = parseInt(args[0], 10);
          if (!limit || limit < 1) limit = 10;
          limit = Math.min(limit, 50, all.length);
          const list = all.slice(0, limit);
          const medals = ['🥇', '🥈', '🥉'];
          const total = all.reduce((x, y) => x + y.n, 0);
          const rows = list.map((e, i) =>
            `┃ ${medals[i] || `*${i + 1}.*`} @${num(e.jid)}\n┃     ┗ 💬 ${e.n} মেসেজ`).join('┃\n');
          const out =
`╭━━━━〔 🏆 𝗧𝗢𝗣 𝗠𝗘𝗠𝗕𝗘𝗥𝗦 🏆 〕━━━━╮
┃ 📛 ${meta?.subject || 'গ্রুপ'}
┃ 📊 মোট মেসেজ: ${total}
┃ ━━━━━━━━━━━━━━━━━━
${rows}
┃ ━━━━━━━━━━━━━━━━━━
╰━ _${BOT_NAME}_ ━╯`;
          return reply(out, { mentions: list.map((e) => e.jid) });
        }
        case 'admin': case 'admins': {
          if (needGroup()) return;
          if (cmd === 'admin' && args[0]?.toLowerCase() === 'event') {
            if (!isAdmin) return reply('❌ শুধু এডমিন/owner এটা চালাতে পারবে।');
            const v = args[1]?.toLowerCase();
            if (v !== 'on' && v !== 'off') return reply(`${PREFIX}admin event on / off`);
            return toggle('adminevent', v === 'on', 'Admin-event (এডমিন তুললে/নামালে মেসেজ)');
          }
          const parts = meta.participants;
          const ownerP = parts.find((p) => p.admin === 'superadmin');
          const ownerId = ownerP?.id || meta.owner || null;
          const ad = parts.filter((p) => p.admin && p.id !== ownerId).map((p) => p.id);
          const lines = ad.map((a, i) => `┃ ${i === ad.length - 1 ? '┗' : '┣'} 🛡 ${i + 1}. ${mention(a)}`).join('\n');
          const out =
`╭━━━━〔 👮 𝗚𝗥𝗢𝗨𝗣 𝗔𝗗𝗠𝗜𝗡𝗦 👮 〕━━━━╮
┃ 📛 ${meta.subject}
┃ ━━━━━━━━━━━━━━━━━━
┃
┃ 👑 *OWNER*
┃ ┗ ${ownerId ? mention(ownerId) : 'পাওয়া যায়নি'}
┃
┃ ━━━━━━━━━━━━━━━━━━
┃ 🛡 *ADMINS* (${ad.length})
${lines || '┃ ┗ কেউ নেই'}
┃
╰━ _${BOT_NAME}_ ━╯`;
          const adminOut = text ? `📢 *${text}*\n\n${out}` : out;
          return reply(adminOut, { mentions: [...(ownerId ? [ownerId] : []), ...ad] });
        }
        case 'everyone': {
          if (needGroup()) return;
          const ids = meta.participants.map((p) => p.id);
          const msgTxt = text || quoted?.conversation || quoted?.extendedTextMessage?.text || '';
          return reply(`📢 *${msgTxt || 'সবাই দেখো!'}*\n\n${ids.map((i) => `➤ ${mention(i)}`).join('\n')}`, { mentions: ids });
        }
        case 'tagall': {
          if (needGroup()) return;
          const ids = meta.participants.map((p) => p.id);
          return reply(`📢 *${text || 'সবাই দেখো!'}*\n\n${ids.map((i) => `➤ ${mention(i)}`).join('\n')}`, { mentions: ids });
        }
        case 'link':
          if (needBotAdmin()) return;
          return reply(
`📌 গ্রুপের নাম: ${meta?.subject || 'গ্রুপ'}
💬 🌸🦋 সবাই চলে আসো আমাদের GC-তে 🦋🌸
💫 আড্ডা, মজা আর গল্পে — Let’s make beautiful memories together! 💞
🔗▶[ https://chat.whatsapp.com/${await sock.groupInviteCode(from)} ]◀
👑 এখনই JOIN করো, তোমার অপেক্ষায় আমাদের GC 🫶✨`);
        case 'whois': case 'getpp': case 'device': {
          // ডিভাইস: যে মেসেজে reply দেওয়া হয়েছে তার ID দেখে বোঝা যায় কোন ডিভাইস থেকে পাঠানো
          if (cmd === 'device') {
            const id = ctx?.stanzaId || m.key.id;
            const who = ctx?.stanzaId ? (ctx.participant || from) : sender;
            const dev = id.startsWith('BAE5') ? '🤖 বট (Baileys)'
              : id.startsWith('3A') ? '🍎 iPhone (iOS)'
              : id.startsWith('3EB0') ? '💻 WhatsApp Web / Desktop (বা অন্য বট)'
              : id.length > 21 ? '🤖 Android' : '💻 WhatsApp Web / Desktop';
            return reply(`📱 *Device Info*\n\n👤 ${mention(who)}\n📲 ডিভাইস: *${dev}*\n🆔 ${id}\n\n_কারো মেসেজে reply দিয়ে ${PREFIX}device লিখলে তার ডিভাইস দেখাবে।_`, { mentions: [who] });
          }
          const d = text.replace(/\D/g, '');
          const jid = d.length >= 8 ? `${d}@s.whatsapp.net` : (ctx?.mentionedJid?.[0] || ctx?.participant || sender);
          let pic = null;
          try { pic = await sock.profilePictureUrl(jid, 'image'); } catch {}
          if (cmd === 'getpp') {
            if (!pic) return reply('❌ প্রোফাইল ছবি পাওয়া যায়নি (ছবি নেই বা প্রাইভেসির কারণে লুকানো)।');
            return sock.sendMessage(from, { image: { url: pic }, caption: `🖼 ${mention(jid)} এর প্রোফাইল ছবি`, mentions: [jid] }, { quoted: m });
          }
          // whois
          let about = null;
          try {
            const st = await sock.fetchStatus(jid);
            const s0 = Array.isArray(st) ? st[0] : st;
            about = s0?.status?.status ?? (typeof s0?.status === 'string' ? s0.status : null);
          } catch {}
          const part = meta?.participants.find((p) => idsOf(p).includes(num(jid)));
          const phone = part?.phoneNumber ? num(part.phoneNumber) : (jid.endsWith('@lid') ? null : num(jid));
          const role = !part ? null : part.admin === 'superadmin' ? '👑 Group Owner' : part.admin ? '🛡 Admin' : '👤 Member';
          const pName = (num(jid) === num(sender) && m.pushName) ? m.pushName : null;
          const info =
`╭━━━〔 🔎 𝗪𝗛𝗢𝗜𝗦 🔎 〕━━━╮
┃ 👤 ট্যাগ: ${mention(jid)}
${pName ? `┃ 📛 নাম: ${pName}\n` : ''}┃ 📞 নাম্বার: ${phone ? '+' + phone : 'লুকানো (LID)'}
┃ 💬 About: ${about || 'নেই / লুকানো'}
┃ 🖼 প্রোফাইল ছবি: ${pic ? 'আছে' : 'নেই / লুকানো'}
${role ? `┃ 🏷 গ্রুপে পদ: ${role}\n` : ''}╰━ _${BOT_NAME}_ ━╯`;
          if (pic) return sock.sendMessage(from, { image: { url: pic }, caption: info, mentions: [jid] }, { quoted: m });
          return reply(info, { mentions: [jid] });
        }
        default: return;
      }
    } catch (e) {
      console.error(e);
      reply('❌ কিছু একটা সমস্যা হয়েছে।');
    }
  });
}

startBot();
loadSubs();
