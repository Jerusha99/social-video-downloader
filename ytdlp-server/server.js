const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3002;
const TIMEOUT = 25000;

function detectPlatform(url) {
    const u = url.toLowerCase();
    if (u.includes('instagram.com') || u.includes('instagr.am')) return 'instagram';
    if (u.includes('facebook.com') || u.includes('fb.watch') || u.includes('fb.com')) return 'facebook';
    return null;
}

function findYtDlp() {
    const candidates = ['yt-dlp', 'yt-dlp.exe', path.join(__dirname, 'bin', 'yt-dlp'), path.join(__dirname, 'bin', 'yt-dlp.exe')];
    for (const c of candidates) {
        try { execSync('"' + c + '" --version 2>&1', { stdio: 'pipe', timeout: 5000 }); return c; } catch {}
    }
    return null;
}

app.post('/api/fetch', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const platform = detectPlatform(url);
    if (!platform) return res.status(400).json({ error: 'Unsupported platform. Use Instagram or Facebook URLs.' });

    const ytdlp = findYtDlp();
    if (!ytdlp) return res.status(500).json({ error: 'yt-dlp not installed. Run: pip install yt-dlp' });

    try {
        const stdout = execSync('"' + ytdlp + '" --dump-json --no-download --no-warnings --quiet --no-check-certificate "' + url + '" 2>NUL', {
            encoding: 'utf-8', timeout: TIMEOUT, maxBuffer: 10 * 1024 * 1024,
        });
        const data = JSON.parse(stdout.trim().split('\n')[0]);
        if (!data) throw new Error('No data returned');

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
            formats.push({ url: f.url, label: type === 'video' ? label : 'Audio', format: ext, type, size: f.filesize || f.filesize_approx || 0 });
        }
        formats.sort((a, b) => b.size - a.size);

        res.json({
            success: true,
            data: {
                title: data.title || platform + ' Video',
                thumbnail: data.thumbnail || '',
                duration: data.duration ? Math.floor(data.duration / 60) + ':' + String(data.duration % 60).padStart(2, '0') : '',
                platform,
                formats: formats.length > 0 ? formats : [{ url: data.url, label: 'Video', format: 'mp4', type: 'video', size: 0 }],
            },
        });
    } catch (e) {
        if (e.message.includes('Timed out')) return res.status(504).json({ error: 'yt-dlp timed out. The video may be too long or unavailable.' });
        res.status(422).json({ error: 'Could not fetch ' + platform + ' content: ' + e.message });
    }
});

app.get('/api/health', (req, res) => {
    const ytdlp = findYtDlp();
    res.json({ status: 'ok', ytdlp: !!ytdlp, platform: 'instagram, facebook' });
});

app.listen(PORT, () => {
    console.log('yt-dlp API server running on port ' + PORT);
    const ytdlp = findYtDlp();
    console.log('yt-dlp ' + (ytdlp ? 'found: ' + ytdlp : 'NOT FOUND - run: pip install yt-dlp'));
});
