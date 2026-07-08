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

// ====== HELPER ======
function ensureAbsoluteUrl(url) {
    if (!url || typeof url !== 'string') return '';
    url = url.trim();
    if (url.startsWith('//')) url = 'https:' + url;
    try {
        new URL(url);
        return url;
    } catch {
        return '';
    }
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

// ====== YOUTUBE (InnerTube API) ======
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

    // Try Android client first
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
                        hl: 'en',
                        gl: 'US',
                        clientName: client.name,
                        clientVersion: client.version,
                        ...(client.name === 'ANDROID' ? { androidSdkVersion: 34, osName: 'Android', osVersion: '14' } : {}),
                    },
                },
            };

            const resp = await axios.post(`https://www.youtube.com/youtubei/v1/player?key=${YT_API_KEY}`, payload, {
                httpsAgent,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': client.ua,
                },
                timeout: 20000,
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
                    if (sp && s) streamUrl += `&${sp}=${encodeURIComponent(s)}`;
                }
                if (!streamUrl) continue;

                const label = f.qualityLabel || f.quality || 'audio';
                const mime = f.mimeType || '';
                let ext = 'mp4';
                if (mime) {
                    const parts = mime.split('/');
                    ext = (parts[1] || 'mp4').split(';')[0];
                }
                const type = f.qualityLabel ? 'video' : 'audio';
                const key = `${label}_${ext}`;
                if (seen.has(key)) continue;
                seen.add(key);

                formats.push({
                    url: streamUrl,
                    label: type === 'video' ? label : label,
                    format: ext,
                    type,
                    size: parseInt(f.contentLength || '0', 10) || 0,
                });
            }

            if (formats.length > 0) {
                formats.sort((a, b) => b.size - a.size);
                // Keep only MP4 (video) and MP3/audio (audio)
                const filtered = formats.filter(f => {
                    const ext = (f.format || '').toLowerCase();
                    return ext === 'mp4' || ext === 'mp3';
                });

                const thumbs = videoDetails.thumbnail?.thumbnails || [];
                const thumb = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : '';

                return {
                    title: videoDetails.title || 'Untitled',
                    thumbnail: thumb,
                    duration: formatDuration(parseInt(videoDetails.lengthSeconds || '0', 10)),
                    platform: 'youtube',
                    formats: filtered.length > 0 ? filtered : formats.filter(f => (f.format || '').toLowerCase() === 'mp4'),
                };
            }
        } catch (e) {
            continue;
        }
    }

    throw new Error('Could not fetch YouTube video. It may be private or unavailable.');
}

// ====== TIKTOK ======
async function fetchTikTok(url) {
    // Method 1: Use tikwm.com API
    try {
        const form = new URLSearchParams({ url, count: 12, cursor: 0, hd: 1 });
        const resp = await axios.post('https://tikwm.com/api/', form.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': userAgent('mobile'),
                'Accept': 'application/json',
            },
            timeout: 15000,
        });
        const d = resp.data;
        if (d.code === 0 && d.data) {
            const title = d.data.title || 'TikTok Video';
            const thumb = ensureAbsoluteUrl(d.data.cover || '');
            const music = d.data.music || '';
            const duration = d.data.duration || 0;
            const formats = [];
            // Standard quality
            const playUrl = ensureAbsoluteUrl(d.data.play);
            if (playUrl) {
                formats.push({
                    url: playUrl,
                    label: 'Standard Quality',
                    format: 'mp4',
                    type: 'video',
                    size: 0,
                });
            }
            // HD quality
            const hdUrl = ensureAbsoluteUrl(d.data.hdplay);
            if (hdUrl && hdUrl !== playUrl) {
                formats.push({
                    url: hdUrl,
                    label: 'HD Quality',
                    format: 'mp4',
                    type: 'video',
                    size: 0,
                });
            }
            // Audio only (mp3)
            const musicUrl = ensureAbsoluteUrl(music);
            if (musicUrl) {
                formats.push({
                    url: musicUrl,
                    label: 'Audio Only (MP3)',
                    format: 'mp3',
                    type: 'audio',
                    size: 0,
                });
            }
            return { title, thumbnail: thumb, duration: formatDuration(duration), platform: 'tiktok', formats };
        }
    } catch (e) { console.error('tikwm error:', e.message); }

    // Method 2: Use snaptik API
    try {
        const resp = await axios.post('https://snaptik.app/action.php', new URLSearchParams({ url }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': userAgent('desktop'),
                'Origin': 'https://snaptik.app',
                'Referer': 'https://snaptik.app/en2',
            },
            timeout: 15000,
        });
        const html = resp.data;
        const $ = cheerio.load(html);
        const videoUrl = $('a[href*="dl"]').attr('href') || $('a[download]').attr('href') || '';
        const title = $('h1').text().trim() || 'TikTok Video';
        const thumb = $('img').first().attr('src') || '';
        if (videoUrl) {
            return {
                title,
                thumbnail: thumb,
                duration: '',
                platform: 'tiktok',
                formats: [{ url: videoUrl, label: 'Video', format: 'mp4', type: 'video', size: 0 }],
            };
        }
    } catch (e) { console.error('snaptik error:', e.message); }

    // Method 3: Use ssstik.io
    try {
        const resp = await axios.post('https://ssstik.io/abc', new URLSearchParams({ id: url, locale: 'en' }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': userAgent('desktop'),
                'Origin': 'https://ssstik.io',
                'Referer': 'https://ssstik.io/en',
                'HX-Request': 'true',
                'HX-Trigger': 'form',
                'HX-Target': 'target',
                'HX-Current-URL': 'https://ssstik.io/en',
            },
            timeout: 15000,
        });
        const $ = cheerio.load(resp.data);
        const videoUrl = $('a[href*="dl"]').attr('href') || $('a[href$=".mp4"]').attr('href') || '';
        const img = $('img').first().attr('src') || '';
        if (videoUrl) {
            return {
                title: $('h2').text().trim() || $('.text-left p').first().text().trim() || 'TikTok Video',
                thumbnail: img,
                duration: '',
                platform: 'tiktok',
                formats: [{ url: videoUrl, label: 'Video', format: 'mp4', type: 'video', size: 0 }],
            };
        }
    } catch (e) { console.error('ssstik error:', e.message); }

    // Method 4: Use tiktokio.com
    try {
        const resp = await axios.post('https://tiktokio.com/api/v1/tk/download', new URLSearchParams({
            prefix: 'https://tiktokio.com/',
            vid: url,
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': userAgent('desktop'),
                'Origin': 'https://tiktokio.com',
                'Referer': 'https://tiktokio.com/',
            },
            timeout: 15000,
        });
        const d = resp.data;
        if (d && d.video) {
            return {
                title: d.title || 'TikTok Video',
                thumbnail: d.cover || '',
                duration: '',
                platform: 'tiktok',
                formats: [{ url: d.video, label: 'Video', format: 'mp4', type: 'video', size: 0 }],
            };
        }
    } catch (e) { console.error('tiktokio error:', e.message); }

    // Method 5: Scrape TikTok page directly
    try {
        const resp = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125.0.6422.165 Mobile Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cookie': 'tt_webid_v2=1; tt_csrf_token=1;',
            },
            timeout: 15000,
            maxRedirects: 5,
        });
        const html = resp.data;
        const $ = cheerio.load(html);

        // Try to extract from JSON-LD
        let videoUrl = '';
        let title = 'TikTok Video';
        let thumb = '';

        $('script[type="application/ld+json"]').each((i, el) => {
            try {
                const json = JSON.parse($(el).html());
                if (json.video && json.video.contentUrl) {
                    videoUrl = json.video.contentUrl;
                    title = json.video.name || title;
                    thumb = json.video.thumbnailUrl || thumb;
                }
            } catch (e) { /* skip */ }
        });

        // Try SIGI_STATE
        if (!videoUrl) {
            const scripts = $('script').text();
            const sigiMatch = scripts.match(/window\.__SIGI_STATE__\s*=\s*({.+?});\s*<\/script>/s);
            if (sigiMatch) {
                try {
                    const sigi = JSON.parse(sigiMatch[1]);
                    const videoData = sigi.ItemModule || sigi?.MobileItemModule || {};
                    const keys = Object.keys(videoData);
                    if (keys.length > 0) {
                        const item = videoData[keys[0]];
                        if (item) {
                            videoUrl = videoUrl || item.video?.playAddr?.[0]?.src || item.video?.downloadAddr || '';
                            title = title || item.desc || item.desc || 'TikTok Video';
                            thumb = thumb || item.video?.cover || item.video?.originCover || '';
                        }
                    }
                } catch (e) { /* skip */ }
            }
        }

        if (videoUrl) {
            return {
                title,
                thumbnail: thumb,
                duration: '',
                platform: 'tiktok',
                formats: [{ url: videoUrl, label: 'Video', format: 'mp4', type: 'video', size: 0 }],
            };
        }
    } catch (e) { console.error('tiktok direct scrape error:', e.message); }

    // Method 6: Direct TikTok oEmbed + scraping
    try {
        const resp = await axios.get(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
            headers: { 'User-Agent': userAgent('desktop') },
            timeout: 10000,
        });
        const d = resp.data;
        const title = d.title || 'TikTok Video';
        const thumb = d.thumbnail_url || '';
        const authorName = d.author_name || '';
        const embedHtml = d.html || '';
        // Try to extract video URL from embed HTML
        let videoUrl = '';
        if (embedHtml) {
            const $$ = cheerio.load(embedHtml);
            videoUrl = $$('video source').attr('src') || $$('video').attr('src') || '';
        }
        const formats = videoUrl
            ? [{ url: videoUrl, label: 'Video', format: 'mp4', type: 'video', size: 0 }]
            : [];
        return {
            title: `${title} by ${authorName}`,
            thumbnail: thumb,
            duration: '',
            platform: 'tiktok',
            formats,
        };
    } catch (e) { /* fall through */ }

    // Method 7: yt-dlp fallback (most reliable)
    try {
        return await fetchWithYtDlp(url, 'tiktok');
    } catch (e) { console.error('yt-dlp tiktok error:', e.message); }

    throw new Error('Could not fetch TikTok video. It may be private or unavailable.');
}

// ====== FACEBOOK ======
async function fetchFacebook(url) {
    // Method 1: Scrape mbasic.facebook.com
    try {
        let mobileUrl = url
            .replace('www.facebook.com', 'mbasic.facebook.com')
            .replace('m.facebook.com', 'mbasic.facebook.com')
            .replace('fb.watch', 'mbasic.facebook.com/watch');
        if (!mobileUrl.includes('mbasic.facebook.com')) {
            const u = new URL(url);
            mobileUrl = `https://mbasic.facebook.com${u.pathname}${u.search}`;
        }

        const resp = await axios.get(mobileUrl, {
            headers: {
                'User-Agent': userAgent('facebook'),
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cookie': 'locale=en_US;',
            },
            timeout: 15000,
            maxRedirects: 5,
        });
        const html = resp.data;
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
            $('source').each((i, el) => {
                const src = $(el).attr('src');
                if (src && src.includes('.mp4')) videoUrl = src;
            });
        }

        const title = $('title').text().trim() || $('meta[property="og:title"]').attr('content') || 'Facebook Video';
        const thumb = $('meta[property="og:image"]').attr('content') || '';

        if (videoUrl) {
            return {
                title,
                thumbnail: thumb,
                duration: '',
                platform: 'facebook',
                formats: [{ url: videoUrl, label: 'HD Video', format: 'mp4', type: 'video', size: 0 }],
            };
        }
    } catch (e) { /* fall through */ }

    // Method 2: Use fdown.net approach (Graph API)
    try {
        const resp = await axios.get(`https://graph.facebook.com/v19.0/?id=${encodeURIComponent(url)}&fields=og_object{title,image,video}`, {
            headers: { 'User-Agent': userAgent('desktop') },
            timeout: 10000,
        });
        const d = resp.data;
        const og = d.og_object || {};
        const title = og.title || 'Facebook Video';
        const thumb = (og.image && og.image[0] && og.image[0].url) || '';
        const videoSrc = (og.video && og.video.url) || '';
        const formats = videoSrc
            ? [{ url: videoSrc, label: 'Video', format: 'mp4', type: 'video', size: 0 }]
            : [];
        return { title, thumbnail: thumb, duration: '', platform: 'facebook', formats };
    } catch (e) {
        throw new Error('Could not fetch Facebook video. It may be private or unavailable.');
    }
}

// ====== TWITTER ======
async function fetchTwitter(url) {
    // Method 1: Syndication API
    try {
        const tweetId = extractTweetId(url);
        if (tweetId) {
            const resp = await axios.get(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=`, {
                headers: { 'User-Agent': userAgent('desktop') },
                timeout: 10000,
            });
            const d = resp.data;
            const title = (d.text || 'Tweet').substring(0, 200);
            const media = d.mediaDetails || [];
            const formats = [];
            for (const m of media) {
                if (m.type === 'video') {
                    const variants = (m.videoInfo && m.videoInfo.variants) || [];
                    variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                    if (variants.length > 0) {
                        formats.push({ url: variants[0].url, label: 'Best Quality', format: 'mp4', type: 'video', size: 0 });
                    }
                } else if (m.type === 'photo') {
                    formats.push({ url: m.media_url_https || m.media_url, label: 'Photo', format: 'jpg', type: 'video', size: 0 });
                }
            }
            const thumb = (media[0] && (media[0].media_url_https || media[0].media_url)) || '';
            if (formats.length > 0) {
                return { title, thumbnail: thumb, duration: '', platform: 'twitter', formats };
            }
        }
    } catch (e) { /* fall through */ }

    // Method 2: fxtwitter.com
    try {
        const fxUrl = url.replace('twitter.com', 'fxtwitter.com').replace('x.com', 'fxtwitter.com');
        const resp = await axios.get(fxUrl, {
            headers: {
                'User-Agent': userAgent('desktop'),
                'Accept': 'application/json',
            },
            timeout: 10000,
        });
        const d = resp.data;
        if (d && d.video && d.video.url) {
            return {
                title: d.text || 'Tweet',
                thumbnail: d.avatar || '',
                duration: '',
                platform: 'twitter',
                formats: [{ url: d.video.url, label: 'Video', format: 'mp4', type: 'video', size: 0 }],
            };
        }
    } catch (e) { /* fall through */ }

    throw new Error('Could not fetch tweet media. It may be deleted or protected.');
}

function extractTweetId(url) {
    const match = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i);
    return match ? match[1] : null;
}

// ====== INSTAGRAM ======
async function fetchInstagram(url) {
    // Method 1: oEmbed API
    try {
        const resp = await axios.get(`https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`, {
            headers: { 'User-Agent': userAgent('instagram') },
            timeout: 10000,
        });
        const d = resp.data;
        const title = d.title || 'Instagram Post';
        const thumb = d.thumbnail_url || '';
        return {
            title,
            thumbnail: thumb,
            duration: '',
            platform: 'instagram',
            formats: [],
        };
    } catch (e) { /* fall through */ }

    // Method 2: Scrape the page
    try {
        const resp = await axios.get(url, {
            headers: {
                'User-Agent': userAgent('instagram'),
                'Accept': 'text/html,application/xhtml+xml',
            },
            timeout: 10000,
        });
        const html = resp.data;
        const $ = cheerio.load(html);

        let videoUrl = '';
        let thumb = $('meta[property="og:image"]').attr('content') || '';
        let title = $('meta[property="og:title"]').attr('content') || 'Instagram Post';

        // Try to find video in meta tags
        const videoMeta = $('meta[property="og:video"]').attr('content') || '';
        if (videoMeta) videoUrl = videoMeta;

        // Try JSON embedded data
        const scripts = $('script[type="text/javascript"]').text();
        const jsonMatch = scripts.match(/window\.__additionalDataLoaded\s*\([^,]+,\s*(\{.+?\})\)/s);
        if (jsonMatch) {
            try {
                const data = JSON.parse(jsonMatch[1]);
                const media = data.graphql?.shortcode_media || data.media || data.items?.[0];
                if (media) {
                    videoUrl = videoUrl || media.video_url || '';
                    thumb = thumb || media.display_url || '';
                    title = title || media.edge_media_to_caption?.edges?.[0]?.node?.text || 'Instagram Post';
                }
            } catch (e) { /* ignore */ }
        }

        return {
            title: title.substring(0, 200),
            thumbnail: thumb,
            duration: '',
            platform: 'instagram',
            formats: videoUrl
                ? [{ url: videoUrl, label: 'Video', format: 'mp4', type: 'video', size: 0 }]
                : [],
        };
    } catch (e) { /* fall through */ }

    // Method 3: Imginn.com (third-party Instagram viewer)
    try {
        const shortcode = url.match(/instagram\.com\/p\/([^\/?#]+)/i);
        if (shortcode) {
            const resp = await axios.get(`https://imginn.com/p/${shortcode[1]}/`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml',
                },
                timeout: 10000,
            });
            const $$ = cheerio.load(resp.data);

            // Only accept posts that have a <video> element (actual video posts)
            const hasVideoElement = $$('video').length > 0 || $$('video source').length > 0;
            const downloadLink = $$('a.download').attr('href') || '';

            if (hasVideoElement && downloadLink) {
                const title = $$('meta[property="og:title"]').attr('content')
                    || $$('h1').text().trim() || 'Instagram Video';

                const thumb = $$('meta[property="og:image"]').attr('content')
                    || $$('img').first().attr('src') || '';

                return {
                    title: title.substring(0, 200),
                    thumbnail: thumb,
                    duration: '',
                    platform: 'instagram',
                    formats: [{ url: downloadLink, label: 'Video', format: 'mp4', type: 'video', size: 0 }],
                };
            }
        }
    } catch (e) { console.error('imginn error:', e.message); }

    throw new Error('Could not fetch Instagram content. It may be private or unavailable.');
}

// ====== YT-DLP FALLBACK (for any platform) ======
const { execSync } = require('child_process');

function findYtDlp() {
    const candidates = [
        'yt-dlp', 'yt-dlp.exe',
        path.join(__dirname, '..', 'bin', 'yt-dlp.exe'),
        path.join(__dirname, '..', 'bin', 'yt-dlp'),
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe'),
        path.join(process.env.TEMP || '', 'opencode', 'yt-dlp.exe'),
        path.join(process.env.TMP || '', 'opencode', 'yt-dlp.exe'),
        'C:\\Users\\jerus\\AppData\\Local\\Temp\\opencode\\yt-dlp.exe',
    ];
    for (const c of candidates) {
        try {
            execSync(`"${c}" --version 2>&1`, { stdio: 'pipe', timeout: 5000 });
            return c;
        } catch (e) { /* not found */ }
    }
    return null;
}

async function fetchWithYtDlp(url, platform) {
    const ytdlp = findYtDlp();
    if (!ytdlp) throw new Error('yt-dlp not found');

    try {
        const stdout = execSync(`"${ytdlp}" --dump-json --no-download --no-warnings --quiet "${url}" 2>NUL`, {
            encoding: 'utf-8',
            timeout: 30000,
            maxBuffer: 10 * 1024 * 1024,
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
            formats.push({
                url: f.url,
                label: type === 'video' ? label + 'p' : label,
                format: ext,
                type,
                size: f.filesize || f.filesize_approx || 0,
            });
        }

        formats.sort((a, b) => b.size - a.size);

        return {
            title: data.title || 'Untitled',
            thumbnail: data.thumbnail || '',
            duration: formatDuration(data.duration || 0),
            platform: platform || data.extractor_key?.toLowerCase().replace('_', '') || 'unknown',
            formats,
        };
    } catch (e) {
        throw new Error(`yt-dlp failed: ${e.message}`);
    }
}

// ====== UTILS ======
function formatDuration(seconds) {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
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

// ====== STATIC FILES (Frontend) ======
app.use(express.static(path.join(__dirname, '..'), {
    index: 'index.html',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
        if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    },
}));

// ====== ROUTES ======
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
        // If no formats found, try yt-dlp fallback
        if (!result.formats || result.formats.length === 0) {
            try {
                result = await fetchWithYtDlp(url, platform);
            } catch (e2) { /* yt-dlp also failed, return original result */ }
        }
        res.json({ success: true, data: result });
    } catch (e) {
        // Try yt-dlp as universal fallback
        try {
            const result = await fetchWithYtDlp(url, platform);
            return res.json({ success: true, data: result });
        } catch (e2) {
            res.status(422).json({ error: e.message });
        }
    }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Download proxy — streams video from CDN with proper headers
async function streamVideo(videoUrl, platform, req, res) {
    const referers = {
        youtube: 'https://www.youtube.com/',
        tiktok: 'https://www.tiktok.com/',
        facebook: 'https://www.facebook.com/',
        instagram: 'https://www.instagram.com/',
        twitter: 'https://twitter.com/',
    };
    const referer = referers[platform] || 'https://www.tiktok.com/';

    // Validate URL
    try {
        new URL(videoUrl);
    } catch {
        res.status(400).json({ error: 'Invalid video URL provided.' });
        return;
    }

    try {
        const response = await axios({
            method: 'GET',
            url: videoUrl,
            responseType: 'stream',
            timeout: 120000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
                'Referer': referer,
                'Origin': referer.replace(/\/$/, ''),
            },
            maxRedirects: 5,
        });

        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
        res.setHeader('Accept-Ranges', 'bytes');

        response.data.pipe(res);
    } catch (e) {
        if (e.response) {
            res.status(e.response.status).json({ error: `CDN error: ${e.response.status}` });
        } else {
            res.status(502).json({ error: `Download failed: ${e.message}` });
        }
    }
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

app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
});
