export default {
    async fetch(req, env, ctx) {
        if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
        if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: corsHeaders() });
        try {
            const { url } = await req.json();
            if (!url) return new Response(JSON.stringify({ error: 'URL required' }), { status: 400, headers: corsHeaders() });

            const platform = detectPlatform(url);
            if (!platform) return new Response(JSON.stringify({ error: 'Unsupported platform' }), { status: 400, headers: corsHeaders() });

            let result;
            switch (platform) {
                case 'youtube': result = await fetchYouTube(url); break;
                case 'instagram': result = await fetchInstagram(url); break;
                case 'facebook': result = await fetchFacebook(url); break;
                default: return new Response(JSON.stringify({ error: 'Unsupported platform on worker' }), { status: 400, headers: corsHeaders() });
            }

            return new Response(JSON.stringify({ success: true, data: result }), { status: 200, headers: corsHeaders() });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 422, headers: corsHeaders() });
        }
    },
};

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    };
}

function detectPlatform(url) {
    const u = url.toLowerCase();
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
    if (u.includes('instagram.com') || u.includes('instagr.am')) return 'instagram';
    if (u.includes('facebook.com') || u.includes('fb.watch') || u.includes('fb.com')) return 'facebook';
    return null;
}

function extractYouTubeId(url) {
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        if (host.includes('youtu.be')) return u.pathname.slice(1).split('?')[0] || null;
        if (host.includes('youtube.com')) return u.searchParams.get('v');
    } catch {}
    return null;
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ':' + s.toString().padStart(2, '0');
}

async function fetchYouTube(url) {
    const videoId = extractYouTubeId(url);
    if (!videoId) throw new Error('Could not extract YouTube video ID.');

    const clients = [
        { name: 'ANDROID', version: '20.10.38', key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w', ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip', extra: { androidSdkVersion: 34, osName: 'Android', osVersion: '14' } },
        { name: 'ANDROID_VR', version: '1.71.26', key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', ua: 'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36', extra: { androidSdkVersion: 32, osName: 'Android', osVersion: '12L', deviceMake: 'Oculus', deviceModel: 'Quest 3' } },
        { name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', version: '2.0', key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36', extra: { clientScreen: 'EMBED' } },
        { name: 'ANDROID_MUSIC', version: '6.33.2', key: 'AIzaSyAOghZGza2MQSZkY_zfZ370N-PUdXEo8AI', ua: 'com.google.android.apps.youtube.music/6.33.2 (Linux; U; Android 14) gzip', extra: { androidSdkVersion: 34, osName: 'Android', osVersion: '14' } },
        { name: 'WEB', version: '2.20240101.00.00', key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36', extra: {} },
    ];

    for (const client of clients) {
        try {
            const payload = {
                videoId,
                context: { client: { hl: 'en', gl: 'US', clientName: client.name, clientVersion: client.version, ...client.extra } },
                contentCheckOk: true, racyCheckOk: true,
            };
            if (client.name === 'TVHTML5_SIMPLY_EMBEDDED_PLAYER') {
                payload.context.thirdParty = { embedUrl: 'https://www.youtube.com/embed/' + videoId };
            }
            const resp = await fetch('https://youtubei.googleapis.com/youtubei/v1/player?key=' + client.key, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': client.ua },
                body: JSON.stringify(payload),
            });
            if (!resp.ok) continue;
            const data = await resp.json();
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
                formats.push({ url: streamUrl, label, format: ext, type, size: parseInt(f.contentLength || '0', 10) || 0 });
            }
            if (formats.length > 0) {
                formats.sort((a, b) => b.size - a.size);
                const filtered = formats.filter(f => { const e = (f.format || '').toLowerCase(); return e === 'mp4' || e === 'mp3'; });
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
        } catch { continue; }
    }
    throw new Error('Could not fetch YouTube video.');
}

async function fetchInstagram(url) {
    const shortcodeMatch = url.match(/(?:instagram\.com(?:\/[a-z]+)?)\/(p|reel|tv)\/([^\/?#]+)/i);
    const shortcode = shortcodeMatch ? shortcodeMatch[2] : null;
    if (!shortcode) throw new Error('Could not extract Instagram shortcode.');

    // Method 1: Try the oEmbed API (used to work, now returns FB page but try anyway)
    try {
        const resp = await fetch('https://api.instagram.com/oembed?url=https://www.instagram.com/p/' + shortcode + '/&format=json', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
            },
        });
        if (resp.ok) {
            const ct = resp.headers.get('content-type') || '';
            if (ct.includes('json')) {
                const d = await resp.json();
                const title = d.title || 'Instagram Video';
                const thumb = d.thumbnail_url || '';
                return { title: title.substring(0, 200), thumbnail: thumb, duration: '', platform: 'instagram', formats: [] };
            }
        }
    } catch {}

    // Method 2: Try different GraphQL query hashes
    const queryHashes = [
        '2efa0f37edf79b2eefbae5e3dd0b4f4d',  // old
        '477b7c6a1b1270a548210be15406b4d2',  // alternative
        '2b0673fb2bb132f59b6c9b5dbd402db6',  // another
    ];
    for (const qh of queryHashes) {
        try {
            const resp = await fetch('https://www.instagram.com/graphql/query/?query_hash=' + qh + '&variables=' + encodeURIComponent(JSON.stringify({
                shortcode: shortcode,
                child_comment_count: 0, fetch_comment_count: 0, parent_comment_count: 0, has_threaded_comments: false,
            })), {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125.0.6422.165 Mobile Safari/537.36',
                    'Accept': 'application/json',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
            });
            if (resp.ok) {
                const data = await resp.json();
                const media = data?.data?.shortcode_media;
                if (media) {
                    const isVideo = media.is_video || media.__typename === 'GraphVideo' || media.__typename === 'GraphSidecar';
                    const formats = [];
                    if (media.video_url) {
                        formats.push({ url: media.video_url, label: 'HD Video', format: 'mp4', type: 'video', size: 0 });
                    }
                    // Handle sidecar (multiple media)
                    if (media.__typename === 'GraphSidecar' && media.edge_sidecar_to_children?.edges) {
                        for (const edge of media.edge_sidecar_to_children.edges) {
                            const node = edge.node;
                            if (node.is_video && node.video_url) {
                                formats.push({ url: node.video_url, label: 'Video', format: 'mp4', type: 'video', size: 0 });
                            }
                        }
                    }
                    const title = media.edge_media_to_caption?.edges?.[0]?.node?.text || media.accessibility_caption || 'Instagram Video';
                    const thumb = media.display_url || media.thumbnail_src || '';
                    return { title: title.substring(0, 200), thumbnail: thumb, duration: '', platform: 'instagram', formats };
                }
            }
        } catch {}
    }

    // Method 3: Scrape the page for og:image (thumbnail only)
    try {
        const resp = await fetch('https://www.instagram.com/p/' + shortcode + '/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125.0.6422.165 Mobile Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
            },
        });
        const html = await resp.text();
        let thumb = '';
        let title = 'Instagram Video';
        const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        if (ogImageMatch) thumb = ogImageMatch[1].replace(/&amp;/g, '&');
        const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        if (ogTitleMatch) title = ogTitleMatch[1].replace(/&amp;/g, '&').replace(/&#\d+;/g, '');
        if (thumb) {
            return { title: title.substring(0, 200), thumbnail: thumb, duration: '', platform: 'instagram', formats: [] };
        }
    } catch {}

    throw new Error('Could not fetch Instagram content. It may be private or unavailable.');
}

async function fetchFacebook(url) {
    // Normalize URL
    const normalizedUrl = url
        .replace('www.facebook.com', 'mbasic.facebook.com')
        .replace('m.facebook.com', 'mbasic.facebook.com')
        .replace('fb.watch', 'mbasic.facebook.com/watch');

    const u = new URL(url);
    const mbasicUrl = normalizedUrl.includes('mbasic.facebook.com')
        ? normalizedUrl
        : 'https://mbasic.facebook.com' + u.pathname + u.search;

    // Method 1: Try Graph API (works for public posts)
    try {
        const resp = await fetch('https://graph.facebook.com/v19.0/?id=' + encodeURIComponent(url) + '&fields=og_object{title,image,video}', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        if (resp.ok) {
            const d = await resp.json();
            const og = d.og_object || {};
            const title = og.title || 'Facebook Video';
            const thumb = (og.image && og.image[0] && og.image[0].url) || '';
            const videoSrc = (og.video && og.video.url) || '';
            const formats = videoSrc ? [{ url: videoSrc, label: 'HD Video', format: 'mp4', type: 'video', size: 0 }] : [];
            return { title, thumbnail: thumb, duration: '', platform: 'facebook', formats };
        }
    } catch {}

    // Method 2: Scrape mbasic with redirect following
    try {
        let currentUrl = mbasicUrl;
        for (let i = 0; i < 5; i++) {
            const resp = await fetch(currentUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125.0.6422.165 Mobile Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                redirect: 'manual',
            });

            if (resp.status >= 300 && resp.status < 400) {
                const location = resp.headers.get('Location');
                if (location) {
                    currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
                    continue;
                }
            }

            const html = await resp.text();

            // Check if this is a login page
            if (html.includes('login.php') || html.includes('Log in') || html.includes('login_form')) {
                throw new Error('Facebook requires login to view this content');
            }

            let videoUrl = '';
            const redirectRegex = /href="([^"]*video_redirect[^"]*)"/g;
            let match;
            while ((match = redirectRegex.exec(html)) !== null) {
                const href = match[1].replace(/&amp;/g, '&');
                const srcMatch = href.match(/src=([^&]+)/);
                if (srcMatch) {
                    try { videoUrl = decodeURIComponent(srcMatch[1]); break; } catch {}
                }
            }

            if (!videoUrl) {
                const sourceMatch = html.match(/<source[^>]*src="([^"]+\.mp4[^"]*)"[^>]*>/gi);
                if (sourceMatch) {
                    const src = sourceMatch[0].match(/src="([^"]+)"/i);
                    if (src) videoUrl = src[1].replace(/&amp;/g, '&');
                }
            }

            if (!videoUrl) {
                const videoSrcMatch = html.match(/<video[^>]*src="([^"]+\.mp4[^"]*)"[^>]*>/gi);
                if (videoSrcMatch) {
                    const src = videoSrcMatch[0].match(/src="([^"]+)"/i);
                    if (src) videoUrl = src[1].replace(/&amp;/g, '&');
                }
            }

            const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : 'Facebook Video';
            const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
            const thumb = ogImageMatch ? ogImageMatch[1].replace(/&amp;/g, '&') : '';

            if (videoUrl) {
                return { title, thumbnail: thumb, duration: '', platform: 'facebook', formats: [{ url: videoUrl, label: 'HD Video', format: 'mp4', type: 'video', size: 0 }] };
            }

            return { title, thumbnail: thumb, duration: '', platform: 'facebook', formats: [] };
        }
    } catch (e) {
        if (e.message.includes('requires login')) throw e;
    }

    throw new Error('Could not fetch Facebook video. It may be private or unavailable.');
}
