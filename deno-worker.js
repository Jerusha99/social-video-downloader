// Deno Deploy worker for YouTube video fetching
// Deploy at https://dash.deno.com/

const YT_API_KEY = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';

function extractYouTubeId(url) {
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        if (host.includes('youtu.be')) return u.pathname.slice(1).split('?')[0] || null;
        if (host.includes('youtube.com')) return u.searchParams.get('v');
    } catch { }
    return null;
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ':' + s.toString().padStart(2, '0');
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    };
}

async function fetchYouTube(videoId) {
    const clients = [
        { name: 'ANDROID', version: '20.10.38', key: YT_API_KEY, ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip', extra: { androidSdkVersion: 34, osName: 'Android', osVersion: '14' } },
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

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders() });
    }

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: corsHeaders() });
    }

    try {
        const { url } = await req.json();
        if (!url) {
            return new Response(JSON.stringify({ error: 'URL required' }), { status: 400, headers: corsHeaders() });
        }

        const videoId = extractYouTubeId(url);
        if (!videoId) {
            return new Response(JSON.stringify({ error: 'Invalid YouTube URL' }), { status: 400, headers: corsHeaders() });
        }

        const result = await fetchYouTube(videoId);
        return new Response(JSON.stringify({ success: true, data: result }), { status: 200, headers: corsHeaders() });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 422, headers: corsHeaders() });
    }
});
