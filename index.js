const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const path = require('path');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
let ytdl;
try { ytdl = require('@distube/ytdl'); } catch (e) { /* optional */ }

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

function ensureAbsoluteUrl(url) {
    if (!url || typeof url !== 'string') return '';
    url = url.trim();
    if (url.startsWith('//')) url = 'https:' + url;
    try { new URL(url); return url; } catch { return ''; }
}

function userAgent(platform) {
    const agents = {
        mobile: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125.0.6422.165 Mobile Safari/537.36',
        desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
        facebook: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125.0.6422.165 Mobile Safari/537.36',
        instagram: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125.0.6422.165 Mobile Safari/537.36',
    };
    return agents[platform] || agents.desktop;
}

const YT_API_KEY = 'AIzaSyAOqs_vxje9dJ9Jqdoe1eS8n-j4d5upvlE';

function extractYouTubeId(url) {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes('youtu.be')) return u.pathname.slice(1).split('?')[0] || null;
    if (host.includes('youtube.com')) return u.searchParams.get('v');
    return null;
}

async function fetchYouTube(url) {
    const videoId = extractYouTubeId(url);
    if (!videoId) throw new Error('Could not extract YouTube video ID.');
    const clients = [
        { name: 'ANDROID', version: '20.10.38', ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip' },
        { name: 'WEB', version: '2.20240101.00.00', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
    ];
    for (const client of clients) {
        try {
            const payload = {
                videoId,
                context: {
                    client: {
                        hl: 'en', gl: 'US',
                        clientName: client.name,
                        clientVersion: client.version,
                        ...(client.name === 'ANDROID' ? { androidSdkVersion: 34, osName: 'Android', osVersion: '14' } : {}),
                    },
                },
            };
            const resp = await axios.post(`https://www.youtube.com/youtubei/v1/player?key=${YT_API_KEY}`, payload, {
                httpsAgent,
                headers: { 'Content-Type': 'application/json', 'User-Agent': client.ua },
                timeout: 8000,
            });
            const data = resp.data;
            if (!data || data.error) continue;
            const playability = data.playabilityStatus?.status;
            if (playability && playability !== 'OK') continue;
            const videoDetails = data.videoDetails || {};
            const streamingData = data.streamingData || {};
            const allFormats = [...(streamingData.formats || []), ...(streamingData.adaptiveFormats || [])];
            if (allFormats.length === 0) continue;
            const formats = [];
            const seen = new Set();
            for (const f of allFormats) {
                let streamUrl = f.url || '';
                if (!streamUrl && f.cipher) {
                    const params = new URLSearchParams(f.cipher);
                    streamUrl = params.get('url') || '';
                    const sp = params.get('sp');
                    const s = params.get('s');
                    if (sp && s) streamUrl += '&' + sp + '=' + encodeURIComponent(s);
                }
                if (!streamUrl) continue;
                const label = f.qualityLabel || f.quality || 'audio';
                const mime = f.mimeType || '';
                let ext = 'mp4';
                if (mime) { const parts = mime.split('/'); ext = (parts[1] || 'mp4').split(';')[0]; }
                const type = f.qualityLabel ? 'video' : 'audio';
                const key = label + '_' + ext;
                if (seen.has(key)) continue;
                seen.add(key);
                formats.push({ url: streamUrl, label: type === 'video' ? label : label, format: ext, type, size: parseInt(f.contentLength || '0', 10) || 0 });
            }
            if (formats.length > 0) {
                formats.sort((a, b) => b.size - a.size);
                const filtered = formats.filter(f => { const e = (f.format || '').toLowerCase(); return e === 'mp4' || e === 'mp3'; });
                const thumbs = videoDetails.thumbnail?.thumbnails || [];
                const thumb = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : '';
                return { title: videoDetails.title || 'Untitled', thumbnail: thumb, duration: formatDuration(parseInt(videoDetails.lengthSeconds || '0', 10)), platform: 'youtube', formats: filtered.length > 0 ? filtered : formats.filter(f => (f.format || '').toLowerCase() === 'mp4') };
            }
        } catch (e) { continue; }
    }
    // Fallback: scrape YouTube page directly
    try {
        const resp = await axios.get('https://www.youtube.com/watch?v=' + videoId, {
            headers: { 'User-Agent': userAgent('desktop') },
            timeout: 8000,
        });
        const html = resp.data;
        const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*<\/script>/);
        if (!match) throw new Error('No player response found');
        const data = JSON.parse(match[1]);
        const videoDetails = data.videoDetails || {};
        const streamingData = data.streamingData || {};
        const allFormats = [...(streamingData.formats || []), ...(streamingData.adaptiveFormats || [])];
        if (allFormats.length === 0) throw new Error('No formats found');
        const formats = [];
        const seen = new Set();
        for (const f of allFormats) {
            let streamUrl = f.url || '';
            if (!streamUrl && f.cipher) {
                const params = new URLSearchParams(f.cipher);
                streamUrl = params.get('url') || '';
                const sp = params.get('sp');
                const s = params.get('s');
                if (sp && s) streamUrl += '&' + sp + '=' + encodeURIComponent(s);
            }
            if (!streamUrl) continue;
            const label = f.qualityLabel || f.quality || 'audio';
            const mime = f.mimeType || '';
            let ext = 'mp4';
            if (mime) { const parts = mime.split('/'); ext = (parts[1] || 'mp4').split(';')[0]; }
            const type = f.qualityLabel ? 'video' : 'audio';
            const key = label + '_' + ext;
            if (seen.has(key)) continue;
            seen.add(key);
            formats.push({ url: streamUrl, label: type === 'video' ? label : label, format: ext, type, size: parseInt(f.contentLength || '0', 10) || 0 });
        }
        if (formats.length > 0) {
            formats.sort((a, b) => b.size - a.size);
            const filtered = formats.filter(f => { const e = (f.format || '').toLowerCase(); return e === 'mp4' || e === 'mp3'; });
            const thumbs = videoDetails.thumbnail?.thumbnails || [];
            const thumb = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : '';
            return { title: videoDetails.title || 'Untitled', thumbnail: thumb, duration: formatDuration(parseInt(videoDetails.lengthSeconds || '0', 10)), platform: 'youtube', formats: filtered.length > 0 ? filtered : formats.filter(f => (f.format || '').toLowerCase() === 'mp4') };
        }
    } catch (e) { /* fall through */ }
    // ytdl-core fallback
    if (ytdl) {
        try {
            const info = await ytdl.getInfo('https://www.youtube.com/watch?v=' + videoId);
            if (info && info.formats && info.formats.length > 0) {
                const formats = [];
                const seen = new Set();
                for (const f of info.formats) {
                    const ext = (f.container || 'mp4').toLowerCase();
                    if (ext !== 'mp4' && ext !== 'mp3') continue;
                    const label = f.qualityLabel || f.quality || f.audioBitrate + 'kbps' || 'audio';
                    const type = f.hasVideo ? 'video' : 'audio';
                    const key = label + '_' + ext;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    formats.push({ url: f.url, label, format: ext, type, size: f.contentLength || 0 });
                }
                if (formats.length > 0) {
                    formats.sort((a, b) => b.size - a.size);
                    const filtered = formats.filter(f => f.format === 'mp4' || f.format === 'mp3');
                    const thumb = info.videoDetails?.thumbnails?.[info.videoDetails.thumbnails.length - 1]?.url || '';
                    return { title: info.videoDetails?.title || 'Untitled', thumbnail: thumb, duration: formatDuration(info.videoDetails?.lengthSeconds || 0), platform: 'youtube', formats: filtered.length > 0 ? filtered : formats };
                }
            }
        } catch (e) { /* fall through */ }
    }
    throw new Error('Could not fetch YouTube video.');
}

async function fetchTikTok(url) {
    try {
        const form = new URLSearchParams({ url, count: 12, cursor: 0, hd: 1 });
        const resp = await axios.post('https://tikwm.com/api/', form.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent('mobile'), 'Accept': 'application/json' },
            timeout: 8000,
        });
        const d = resp.data;
        if (d.code === 0 && d.data) {
            const title = d.data.title || 'TikTok Video';
            const thumb = ensureAbsoluteUrl(d.data.cover || '');
            const music = d.data.music || '';
            const duration = d.data.duration || 0;
            const formats = [];
            const playUrl = ensureAbsoluteUrl(d.data.play);
            if (playUrl) formats.push({ url: playUrl, label: 'Standard Quality', format: 'mp4', type: 'video', size: 0 });
            const hdUrl = ensureAbsoluteUrl(d.data.hdplay);
            if (hdUrl && hdUrl !== playUrl) formats.push({ url: hdUrl, label: 'HD Quality', format: 'mp4', type: 'video', size: 0 });
            const musicUrl = ensureAbsoluteUrl(music);
            if (musicUrl) formats.push({ url: musicUrl, label: 'Audio Only (MP3)', format: 'mp3', type: 'audio', size: 0 });
            return { title, thumbnail: thumb, duration: formatDuration(duration), platform: 'tiktok', formats };
        }
    } catch (e) { /* fall through */ }
    throw new Error('Could not fetch TikTok video.');
}

async function fetchFacebook(url) {
    try {
        let mobileUrl = url.replace('www.facebook.com', 'mbasic.facebook.com').replace('m.facebook.com', 'mbasic.facebook.com').replace('fb.watch', 'mbasic.facebook.com/watch');
        if (!mobileUrl.includes('mbasic.facebook.com')) { const u = new URL(url); mobileUrl = 'https://mbasic.facebook.com' + u.pathname + u.search; }
        const resp = await axios.get(mobileUrl, {
            headers: { 'User-Agent': userAgent('facebook'), 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9', 'Cookie': 'locale=en_US;' },
            timeout: 8000, maxRedirects: 5,
        });
        const $ = cheerio.load(resp.data);
        let videoUrl = '';
        $('a[href*="video_redirect"]').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('video_redirect')) { const params = new URLSearchParams(href.split('?')[1] || ''); const src = params.get('src'); if (src) videoUrl = decodeURIComponent(src); }
        });
        if (!videoUrl) { $('source').each((i, el) => { const src = $(el).attr('src'); if (src && src.includes('.mp4')) videoUrl = src; }); }
        const title = $('title').text().trim() || 'Facebook Video';
        const thumb = $('meta[property="og:image"]').attr('content') || '';
        if (videoUrl) return { title, thumbnail: thumb, duration: '', platform: 'facebook', formats: [{ url: videoUrl, label: 'HD Video', format: 'mp4', type: 'video', size: 0 }] };
    } catch (e) { /* fall through */ }
    throw new Error('Could not fetch Facebook video.');
}

async function fetchTwitter(url) {
    try {
        const tweetId = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i)?.[1];
        if (tweetId) {
            const resp = await axios.get('https://cdn.syndication.twimg.com/tweet-result?id=' + tweetId + '&lang=en&token=', {
                headers: { 'User-Agent': userAgent('desktop') }, timeout: 8000,
            });
            const d = resp.data;
            const title = (d.text || 'Tweet').substring(0, 200);
            const media = d.mediaDetails || [];
            const formats = [];
            for (const m of media) {
                if (m.type === 'video') {
                    const variants = (m.videoInfo && m.videoInfo.variants) || [];
                    variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                    if (variants.length > 0) formats.push({ url: variants[0].url, label: 'Best Quality', format: 'mp4', type: 'video', size: 0 });
                } else if (m.type === 'photo') {
                    formats.push({ url: m.media_url_https || m.media_url, label: 'Photo', format: 'jpg', type: 'video', size: 0 });
                }
            }
            const thumb = (media[0] && (media[0].media_url_https || media[0].media_url)) || '';
            if (formats.length > 0) return { title, thumbnail: thumb, duration: '', platform: 'twitter', formats };
        }
    } catch (e) { /* fall through */ }
    throw new Error('Could not fetch tweet media.');
}

async function fetchInstagram(url) {
    try {
        const resp = await axios.get('https://api.instagram.com/oembed?url=' + encodeURIComponent(url), {
            headers: { 'User-Agent': userAgent('instagram') }, timeout: 8000,
        });
        const d = resp.data;
        return { title: d.title || 'Instagram Post', thumbnail: d.thumbnail_url || '', duration: '', platform: 'instagram', formats: [] };
    } catch (e) { /* fall through */ }
    throw new Error('Could not fetch Instagram content.');
}

const { execSync } = require('child_process');

function findYtDlp() {
    const candidates = [
        'yt-dlp', 'yt-dlp.exe', path.join(__dirname, 'bin', 'yt-dlp.exe'),
        path.join(__dirname, 'bin', 'yt-dlp'),
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe'),
        path.join(process.env.TEMP || '', 'opencode', 'yt-dlp.exe'),
        path.join(process.env.TMP || '', 'opencode', 'yt-dlp.exe'),
        'C:\\Users\\jerus\\AppData\\Local\\Temp\\opencode\\yt-dlp.exe',
    ];
    for (const c of candidates) { try { execSync('"' + c + '" --version 2>&1', { stdio: 'pipe', timeout: 5000 }); return c; } catch (e) { /* not found */ } }
    return null;
}

async function fetchWithYtDlp(url, platform) {
    const ytdlp = findYtDlp();
    if (!ytdlp) throw new Error('yt-dlp not found');
    try {
        const stdout = execSync('"' + ytdlp + '" --dump-json --no-download --no-warnings --quiet "' + url + '" 2>NUL', { encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
        const data = JSON.parse(stdout.trim().split('\n')[0]);
        if (!data) throw new Error('No data');
        const formats = [];
        const seen = new Set();
        for (const f of (data.formats || [])) {
            const ext = (f.ext || 'mp4').toLowerCase();
            if (ext !== 'mp4' && ext !== 'mp3') continue;
            const label = f.format_note || (f.height ? f.height + 'p' : 'audio');
            const type = (f.vcodec && f.vcodec !== 'none') ? 'video' : 'audio';
            const key = label + '_' + ext;
            if (seen.has(key)) continue;
            seen.add(key);
            formats.push({ url: f.url, label: type === 'video' ? label + 'p' : label, format: ext, type, size: f.filesize || f.filesize_approx || 0 });
        }
        formats.sort((a, b) => b.size - a.size);
        return { title: data.title || 'Untitled', thumbnail: data.thumbnail || '', duration: formatDuration(data.duration || 0), platform: platform || 'unknown', formats };
    } catch (e) { throw new Error('yt-dlp failed: ' + e.message); }
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ':' + s.toString().padStart(2, '0');
}

function detectPlatform(url) {
    const u = url.toLowerCase();
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
    if (u.includes('tiktok.com')) return 'tiktok';
    if (u.includes('facebook.com') || u.includes('fb.watch') || u.includes('fb.com')) return 'facebook';
    if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
    if (u.includes('instagram.com') || u.includes('instagr.am')) return 'instagram';
    return null;
}

app.use(express.static(path.join(__dirname), {
    index: 'index.html',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
        if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    },
}));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/fetch', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    const platform = detectPlatform(url);
    if (!platform) return res.status(400).json({ error: 'Unsupported platform' });
    try {
        let result;
        switch (platform) {
            case 'youtube': result = await fetchYouTube(url); break;
            case 'tiktok': result = await fetchTikTok(url); break;
            case 'facebook': result = await fetchFacebook(url); break;
            case 'twitter': result = await fetchTwitter(url); break;
            case 'instagram': result = await fetchInstagram(url); break;
            default: throw new Error('Unsupported platform');
        }
        if (!result.formats || result.formats.length === 0) { try { result = await fetchWithYtDlp(url, platform); } catch (e2) { /* ignore */ } }
        res.json({ success: true, data: result });
    } catch (e) {
        try { const result = await fetchWithYtDlp(url, platform); return res.json({ success: true, data: result }); } catch (e2) { res.status(422).json({ error: e.message }); }
    }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

async function streamVideo(videoUrl, platform, req, res) {
    const referers = { youtube: 'https://www.youtube.com/', tiktok: 'https://www.tiktok.com/', facebook: 'https://www.facebook.com/', instagram: 'https://www.instagram.com/', twitter: 'https://twitter.com/' };
    const referer = referers[platform] || 'https://www.tiktok.com/';
    try { new URL(videoUrl); } catch { res.status(400).json({ error: 'Invalid video URL provided.' }); return; }
    try {
        const response = await axios({ method: 'GET', url: videoUrl, responseType: 'stream', timeout: 120000, headers: { 'User-Agent': userAgent('desktop'), 'Referer': referer, 'Origin': referer.replace(/\/$/, '') }, maxRedirects: 5 });
        if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
        if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
        res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
        res.setHeader('Accept-Ranges', 'bytes');
        response.data.pipe(res);
    } catch (e) { res.status(502).json({ error: 'Download failed: ' + e.message }); }
}

app.get('/api/download', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'url parameter required' });
    streamVideo(url, req.query.platform || 'tiktok', req, res);
});

app.post('/api/download', (req, res) => {
    const { url, platform } = req.body;
    if (!url) return res.status(400).json({ error: 'url parameter required' });
    streamVideo(url, platform || 'tiktok', req, res);
});

module.exports = app;
