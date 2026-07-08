try:
    import yt_dlp
except ImportError:
    import subprocess
    subprocess.check_call(['pip', 'install', 'yt-dlp'], timeout=60)
    import yt_dlp

from http.server import BaseHTTPRequestHandler
import json
import re


def detect_platform(url):
    u = url.lower()
    if 'instagram.com' in u or 'instagr.am' in u:
        return 'instagram'
    if 'facebook.com' in u or 'fb.watch' in u or 'fb.com' in u:
        return 'facebook'
    return None


def format_duration(seconds):
    if not seconds:
        return ''
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f'{m}:{s:02d}'


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        
        try:
            data = json.loads(body)
            url = data.get('url', '')
        except:
            self._respond(400, {'error': 'Invalid JSON'})
            return

        if not url:
            self._respond(400, {'error': 'URL is required'})
            return

        platform = detect_platform(url)
        if not platform:
            self._respond(400, {'error': 'Unsupported platform. Use Instagram or Facebook URLs.'})
            return

        try:
            ydl_opts = {
                'quiet': True,
                'no_download': True,
                'dumpjson': True,
                'no_warnings': True,
                'extract_flat': False,
                'socket_timeout': 20,
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                
            if not info:
                self._respond(422, {'error': 'Could not extract video info'})
                return

            formats = []
            seen = set()
            
            for f in info.get('formats', []):
                ext = (f.get('ext', 'mp4') or '').lower()
                if ext not in ('mp4', 'mp3'):
                    continue
                    
                label = f.get('format_note') or (str(f.get('height', '')) + 'p' if f.get('height') else 'audio')
                is_video = f.get('vcodec') and f.get('vcodec') != 'none'
                key = label + '_' + ext
                
                if key in seen:
                    continue
                seen.add(key)
                
                formats.append({
                    'url': f.get('url', ''),
                    'label': label if is_video else 'Audio',
                    'format': ext,
                    'type': 'video' if is_video else 'audio',
                    'size': f.get('filesize') or f.get('filesize_approx') or 0,
                })
            
            formats.sort(key=lambda x: -x['size'])
            
            if not formats and info.get('url'):
                formats.append({
                    'url': info['url'],
                    'label': 'Video',
                    'format': 'mp4',
                    'type': 'video',
                    'size': 0,
                })

            result = {
                'title': info.get('title') or platform + ' Video',
                'thumbnail': info.get('thumbnail') or '',
                'duration': format_duration(info.get('duration')),
                'platform': platform,
                'formats': formats,
            }
            
            self._respond(200, {'success': True, 'data': result})
            
        except Exception as e:
            self._respond(422, {'error': f'Could not fetch {platform} content: {str(e)}'})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def _respond(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
