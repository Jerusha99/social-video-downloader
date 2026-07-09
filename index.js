const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const path = require('path');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });


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

async function fetchYouTube(url) {
    const videoId = extractYouTubeId(url);
    if (!videoId) throw new Error('Could not extract YouTube video ID.');

    // Method 1: Piped API (works from cloud IPs, no PoToken needed)
    const pipedInstances = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.adminforge.de',
        'https://pipedapi-libre.kavin.rocks',
    ];
    for (const pipedUrl of pipedInstances) {
        try {
            const resp = await axios.get(pipedUrl + '/streams/' + encodeURIComponent(videoId), {
                headers: { 'User-Agent': userAgent('desktop'), 'Accept': 'application/json' }, timeout: 6000,
            });
            const data = resp.data;
            if (data && data.error) continue;
            const formats = [];
            const seen = new Set();
            for (const s of (data.videoStreams || [])) {
                const ext = (s.format || 'mp4').toLowerCase();
                if (ext !== 'mp4') continue;
                const key = s.quality + '_' + ext;
                if (seen.has(key)) continue;
                seen.add(key);
                formats.push({ url: s.url, label: s.quality || 'video', format: ext, type: 'video', size: 0 });
            }
            for (const s of (data.audioStreams || [])) {
                const ext = (s.format || 'm4a').toLowerCase().replace('m4a', 'mp3');
                const key = 'audio_' + ext;
                if (seen.has(key)) continue;
                seen.add(key);
                formats.push({ url: s.url, label: (s.bitrate || '128') + 'kbps', format: ext, type: 'audio', size: 0 });
            }
            if (formats.length > 0) {
                const thumb = data.thumbnailUrl || '';
                return { title: data.title || 'Untitled', thumbnail: thumb, duration: formatDuration(data.duration || 0), platform: 'youtube', formats };
            }
        } catch (e) { /* fall through */ }
    }

    // Method 2: InnerTube API with multiple clients (various API keys)
    const innertubeClients = [
        { name: 'ANDROID', version: '20.10.38', key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w', ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip', extra: { androidSdkVersion: 34, osName: 'Android', osVersion: '14' } },
        { name: 'ANDROID_VR', version: '1.71.26', key: '', ua: 'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36', extra: { androidSdkVersion: 32, osName: 'Android', osVersion: '12L', deviceMake: 'Oculus', deviceModel: 'Quest 3' } },
        { name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', version: '2.0', key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', ua: userAgent('desktop'), extra: { clientScreen: 'EMBED' } },
        { name: 'TVHTML5', version: '7.20260114.12.00', key: 'AIzaSyDCU8hByM-4DrUqRUYnGn-3llEO78bcxq8', ua: userAgent('desktop'), extra: {} },
        { name: 'ANDROID_MUSIC', version: '6.33.2', key: 'AIzaSyAOghZGza2MQSZkY_zfZ370N-PUdXEo8AI', ua: 'com.google.android.apps.youtube.music/6.33.2 (Linux; U; Android 14) gzip', extra: { androidSdkVersion: 34, osName: 'Android', osVersion: '14' } },
        { name: 'WEB', version: '2.20240101.00.00', key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', ua: userAgent('desktop'), extra: {} },
    ];
    for (const client of innertubeClients) {
        try {
            const payload = {
                videoId,
                context: { client: { hl: 'en', gl: 'US', clientName: client.name, clientVersion: client.version, ...client.extra } },
                contentCheckOk: true, racyCheckOk: true,
            };
            if (client.name === 'TVHTML5_SIMPLY_EMBEDDED_PLAYER') {
                payload.context.thirdParty = { embedUrl: 'https://www.youtube.com/embed/' + videoId };
            }
            const apiKey = client.key || YT_API_KEY;
            const headers = { 'Content-Type': 'application/json', 'User-Agent': client.ua };
            if (apiKey) headers['X-Youtube-Client-Name'] = client.name;
            const resp = await axios.post('https://youtubei.googleapis.com/youtubei/v1/player?key=' + apiKey, payload, {
                httpsAgent, headers, timeout: 8000,
            });
            const data = resp.data;
            if (!data || data.error || data.playabilityStatus?.status !== 'OK') continue;
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
                    const sp = params.get('sp'); const s = params.get('s');
                    if (sp && s) streamUrl += '&' + sp + '=' + encodeURIComponent(s);
                }
                if (!streamUrl) continue;
                const label = f.qualityLabel || f.quality || 'audio';
                const mime = f.mimeType || '';
                let ext = 'mp4';
                if (mime) { const parts = mime.split('/'); ext = (parts[1] || 'mp4').split(';')[0]; }
                const type = f.qualityLabel ? 'video' : 'audio';
                const displayLabel = type === 'audio' ? (f.bitrate ? Math.round(f.bitrate / 1000) + 'kbps Audio' : 'Audio') : label;
                const key = label + '_' + ext;
                if (seen.has(key)) continue;
                seen.add(key);
                formats.push({ url: streamUrl, label: displayLabel, format: ext, type, size: parseInt(f.contentLength || '0', 10) || 0 });
            }
            if (formats.length > 0) {
                formats.sort((a, b) => b.size - a.size);
                const filtered = formats.filter(f => { const e = (f.format || '').toLowerCase(); return e === 'mp4' || e === 'mp3'; });
                const thumbs = videoDetails.thumbnail?.thumbnails || [];
                const thumb = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : '';
                const ytDesc = videoDetails.shortDescription || '';
                return { title: videoDetails.title || 'Untitled', thumbnail: thumb, duration: formatDuration(parseInt(videoDetails.lengthSeconds || '0', 10)), platform: 'youtube', formats: filtered.length > 0 ? filtered : formats.filter(f => (f.format || '').toLowerCase() === 'mp4'), description: ytDesc.substring(0, 300) };
            }
        } catch (e) { continue; }
    }

    throw new Error('Could not fetch YouTube video. It may be private or unavailable.');
}

async function fetchTikTok(url) {
    try {
        const form = new URLSearchParams({ url, count: 12, cursor: 0, hd: 1 });
        const resp = await axios.post('https://tikwm.com/api/', form.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent('mobile'), 'Accept': 'application/json' }, timeout: 8000,
        });
        const d = resp.data;
        if (d.code === 0 && d.data) {
            const formats = [];
            const playUrl = ensureAbsoluteUrl(d.data.play);
            if (playUrl) formats.push({ url: playUrl, label: 'Standard Quality', format: 'mp4', type: 'video', size: 0 });
            const hdUrl = ensureAbsoluteUrl(d.data.hdplay);
            if (hdUrl && hdUrl !== playUrl) formats.push({ url: hdUrl, label: 'HD Quality', format: 'mp4', type: 'video', size: 0 });
            const musicUrl = ensureAbsoluteUrl(d.data.music || '');
            if (musicUrl) formats.push({ url: musicUrl, label: 'Audio Only (MP3)', format: 'mp3', type: 'audio', size: 0 });
            return { title: d.data.title || 'TikTok Video', thumbnail: ensureAbsoluteUrl(d.data.cover || ''), duration: formatDuration(d.data.duration || 0), platform: 'tiktok', formats };
        }
    } catch (e) { /* fall through */ }

    throw new Error('Could not fetch TikTok video. It may be private or unavailable.');
}

async function fetchFacebook(url) {
    const invalidTitles = ['log in', 'error facebook'];
    const formats = [];
    let title = 'Facebook Video';
    let thumb = '';

    // Method 0: For share URLs, intercept redirect to get real post URL
    async function resolveShareUrl(inputUrl) {
        try {
            const resp = await axios.get(inputUrl, {
                headers: { 'User-Agent': userAgent('desktop'), 'Accept': 'text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9', 'DNT': '1', 'Upgrade-Insecure-Requests': '1' },
                maxRedirects: 0, timeout: 8000, validateStatus: s => true,
            });
            if (resp.status >= 300 && resp.status < 400) {
                const location = resp.headers.location;
                if (location) return location.startsWith('http') ? location : new URL(location, inputUrl).href;
            }
            // Try mbasic watch.php
            const watchUrl = 'https://mbasic.facebook.com/watch.php?v=' + encodeURIComponent(inputUrl);
            const watchResp = await axios.get(watchUrl, {
                headers: { 'User-Agent': userAgent('facebook') }, timeout: 8000, validateStatus: s => s < 500,
            });
            if (watchResp.status === 200 && !/error facebook/i.test(watchResp.data.substring(0, 500))) {
                const html = watchResp.data;
                const $ = cheerio.load(html);
                let videoUrl = '';
                $('a[href*="video_redirect"]').each((i, el) => {
                    const href = $(el).attr('href');
                    if (href && href.includes('video_redirect')) {
                        const params = new URLSearchParams(href.split('?')[1] || '');
                        const src = params.get('src');
                        if (src) videoUrl = decodeURIComponent(src);
                    }
                });
                if (!videoUrl) {
                    $('source').each((i, el) => { const src = $(el).attr('src'); if (src && src.includes('.mp4')) videoUrl = src; });
                }
                if (videoUrl) {
                    const t = $('title').text().trim() || title;
                    const tmb = $('meta[property="og:image"]').attr('content') || thumb;
                    return { title: t, thumbnail: tmb, duration: '', platform: 'facebook', formats: [{ url: videoUrl, label: 'HD Video', format: 'mp4', type: 'video', size: 0 }] };
                }
            }
        } catch {}
        return null;
    }
    if (url.includes('/share/')) {
        const result = await resolveShareUrl(url);
        if (result) return result;
    }

    // Method 1: Fetch the original URL directly (follow redirects), extract browser_native URLs
    try {
        const resp = await axios.get(url, {
            headers: { 'User-Agent': userAgent('desktop'), 'Accept': 'text/html,application/xhtml+xml' },
            timeout: 10000, maxRedirects: 5, validateStatus: s => s < 500,
        });
        const html = resp.data;
        const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        if (ogTitleMatch) title = ogTitleMatch[1].replace(/&amp;/g, '&').replace(/&#\d+;/g, '');
        const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        if (ogImageMatch) thumb = ogImageMatch[1].replace(/&amp;/g, '&');
        const ogDescMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
        const description = ogDescMatch ? ogDescMatch[1].replace(/&amp;/g, '&').replace(/&#\d+;/g, '') : '';

        const hdMatch = html.match(/"browser_native_hd_url"\s*:\s*"([^"]+)"/i);
        const sdMatch = html.match(/"browser_native_sd_url"\s*:\s*"([^"]+)"/i);

        if (hdMatch) {
            const videoUrl = hdMatch[1].replace(/\\\//g, '/');
            if (videoUrl && videoUrl.length > 10) formats.push({ url: videoUrl, label: 'HD Video', format: 'mp4', type: 'video', size: 0 });
        }
        if (sdMatch) {
            const videoUrl = sdMatch[1].replace(/\\\//g, '/');
            if (videoUrl && videoUrl.length > 10 && (!hdMatch || videoUrl !== hdMatch[1].replace(/\\\//g, '/'))) {
                formats.push({ url: videoUrl, label: 'SD Video', format: 'mp4', type: 'video', size: 0 });
            }
        }
        if (formats.length > 0) return { title: title.substring(0, 200), thumbnail: thumb, duration: '', platform: 'facebook', formats, description: description.substring(0, 300) };
    } catch (e) { /* fall through */ }

    // Method 2: Scrape mbasic.facebook.com
    try {
        let mobileUrl = url.replace('www.facebook.com', 'mbasic.facebook.com').replace('m.facebook.com', 'mbasic.facebook.com').replace('fb.watch', 'mbasic.facebook.com/watch');
        if (!mobileUrl.includes('mbasic.facebook.com')) { const u = new URL(url); mobileUrl = 'https://mbasic.facebook.com' + u.pathname + u.search; }
        const resp = await axios.get(mobileUrl, {
            headers: { 'User-Agent': userAgent('facebook'), 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9', 'Cookie': 'locale=en_US;' },
            timeout: 8000, maxRedirects: 5, validateStatus: s => s < 500,
        });
        const html = resp.data;
        if (/error facebook/i.test(html.substring(0, 500))) throw new Error('Blocked');
        const $ = cheerio.load(html);
        let videoUrl = '';
        $('a[href*="video_redirect"]').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('video_redirect')) { const params = new URLSearchParams(href.split('?')[1] || ''); const src = params.get('src'); if (src) videoUrl = decodeURIComponent(src); }
        });
        if (!videoUrl) { $('source').each((i, el) => { const src = $(el).attr('src'); if (src && src.includes('.mp4')) videoUrl = src; }); }
        let t = $('title').text().trim() || title;
        const lower = t.toLowerCase();
        if (invalidTitles.some(x => lower.includes(x))) t = title;
        const tmb = $('meta[property="og:image"]').attr('content') || thumb;
        if (videoUrl) return { title: t, thumbnail: tmb, duration: '', platform: 'facebook', formats: [{ url: videoUrl, label: 'HD Video', format: 'mp4', type: 'video', size: 0 }] };
    } catch (e) { /* fall through */ }

    // Method 3: Graph API
    try {
        const resp = await axios.get('https://graph.facebook.com/v19.0/?id=' + encodeURIComponent(url) + '&fields=og_object{title,image,video}', {
            headers: { 'User-Agent': userAgent('desktop') }, timeout: 8000,
        });
        const d = resp.data;
        const og = d.og_object || {};
        title = og.title || title;
        thumb = (og.image && og.image[0] && og.image[0].url) || thumb;
        const videoSrc = (og.video && og.video.url) || '';
        if (videoSrc) formats.push({ url: videoSrc, label: 'Video', format: 'mp4', type: 'video', size: 0 });
        if (formats.length > 0) return { title, thumbnail: thumb, duration: '', platform: 'facebook', formats };
    } catch (e) { /* fall through */ }

    if (formats.length > 0) return { title: title.substring(0, 200), thumbnail: thumb, duration: '', platform: 'facebook', formats };
    throw new Error('Facebook is blocking video extraction. Try a direct Facebook video link (not share URLs) or use a non-share link.');
}

async function fetchTwitter(url) {
    // Method 1: Syndication API
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

    // Method 2: fxtwitter.com
    try {
        const fxUrl = url.replace('twitter.com', 'fxtwitter.com').replace('x.com', 'fxtwitter.com');
        const resp = await axios.get(fxUrl, {
            headers: { 'User-Agent': userAgent('desktop'), 'Accept': 'application/json' }, timeout: 8000,
        });
        const d = resp.data;
        if (d && d.video && d.video.url) return { title: d.text || 'Tweet', thumbnail: d.avatar || '', duration: '', platform: 'twitter', formats: [{ url: d.video.url, label: 'Video', format: 'mp4', type: 'video', size: 0 }] };
    } catch (e) { /* fall through */ }

    throw new Error('Could not fetch tweet media. It may be deleted or protected.');
}

async function fetchInstagram(url) {
    // Method 1: oEmbed API (returns FB page now, but try anyway)
    try {
        const resp = await axios.get('https://api.instagram.com/oembed?url=' + encodeURIComponent(url), {
            headers: { 'User-Agent': userAgent('instagram'), 'Accept': 'application/json' }, timeout: 8000, responseType: 'text',
        });
        const ct = resp.headers['content-type'] || '';
        if (ct.includes('json')) {
            try {
                const d = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
                return { title: d.title || 'Instagram Post', thumbnail: d.thumbnail_url || '', duration: '', platform: 'instagram', formats: [] };
            } catch {}
        }
    } catch (e) { /* fall through */ }

    // Method 2: Scrape the page
    try {
        const resp = await axios.get(url, {
            headers: { 'User-Agent': userAgent('instagram'), 'Accept': 'text/html,application/xhtml+xml' }, timeout: 8000,
        });
        const $ = cheerio.load(resp.data);
        const thumb = $('meta[property="og:image"]').attr('content') || '';
        let title = $('meta[property="og:title"]').attr('content') || 'Instagram Post';
        title = title.replace(/&#\d+;/g, '').trim();
        return { title: title.substring(0, 200), thumbnail: thumb, duration: '', platform: 'instagram', formats: [] };
    } catch (e) { /* fall through */ }

    throw new Error('Could not fetch Instagram content. It may be private or unavailable.');
}

const { execSync } = require('child_process');

function findYtDlp() {
    const candidates = [
        'yt-dlp', 'yt-dlp.exe', path.join(__dirname, 'bin', 'yt-dlp.exe'), path.join(__dirname, 'bin', 'yt-dlp'),
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
        const stdout = execSync('"' + ytdlp + '" --dump-json --no-download --no-warnings --quiet "' + url + '" 2>NUL', {
            encoding: 'utf-8', timeout: 30000, maxBuffer: 10 * 1024 * 1024,
        });
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

const CF_WORKER_URL = process.env.CF_WORKER_URL || process.env.YT_WORKER_URL || 'https://youtubedown.jerushasharon1999.workers.dev/';
let baseUrl = process.env.YTDLP_SERVER_URL || '';

async function fetchViaWorker(url, platform) {
    try {
        const resp = await axios.post(CF_WORKER_URL, { url }, { timeout: 15000 });
        if (resp.data.success) return resp.data.data;
        throw new Error(resp.data.error || 'Worker failed');
    } catch (e) {
        if (e.response?.data?.error) throw new Error(e.response.data.error);
        throw e;
    }
}

async function fetchViaYtDlp(url, platform) {
    if (!baseUrl) {
        const vercelUrl = process.env.VERCEL_URL || process.env.VERCEL_BRANCH_URL || '';
        if (vercelUrl) baseUrl = 'https://' + vercelUrl;
    }
    if (!baseUrl) throw new Error('yt-dlp not available');
    const resp = await axios.post(baseUrl + '/api/ytdlp', { url }, { timeout: 30000 });
    if (resp.data.success) return resp.data.data;
    throw new Error(resp.data.error || 'yt-dlp failed');
}

app.post('/api/fetch', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    if (!baseUrl && req.headers.host) baseUrl = 'https://' + req.headers.host;
    const platform = detectPlatform(url);
    if (!platform) return res.status(400).json({ error: 'Unsupported platform' });
    try {
        let result;
        switch (platform) {
            case 'youtube':
                try { result = await fetchViaWorker(url, 'youtube'); } catch (e) { result = await fetchYouTube(url); }
                break;
            case 'tiktok': result = await fetchTikTok(url); break;
            case 'facebook':
                try { result = await fetchViaYtDlp(url, 'facebook'); } catch (e) {
                    try { result = await fetchViaWorker(url, 'facebook'); } catch (e2) { result = await fetchFacebook(url); }
                }
                break;
            case 'twitter': result = await fetchTwitter(url); break;
            case 'instagram':
                try { result = await fetchViaWorker(url, 'instagram'); } catch (e) {
                    try { result = await fetchViaYtDlp(url, 'instagram'); } catch (e2) { result = await fetchInstagram(url); }
                }
                break;
            default: throw new Error('Unsupported platform');
        }
        if (!result.formats || result.formats.length === 0) { try { result = await fetchWithYtDlp(url, platform); } catch (e2) { /* ignore */ } }
        res.json({ success: true, data: result });
    } catch (e) {
        try { const result = await fetchWithYtDlp(url, platform); return res.json({ success: true, data: result }); } catch (e2) { res.status(422).json({ error: e.message }); }
    }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '1.2' }));

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

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log('Server running on http://localhost:' + PORT);
    });
}

module.exports = app;
