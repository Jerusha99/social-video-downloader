<?php

class Scraper_youtube
{
    private ?string $ytDlpPath = null;

    public function fetch(string $url): array
    {
        $ytdlp = $this->findYtDlp();
        if ($ytdlp) {
            $this->ytDlpPath = $ytdlp;
            try {
                return $this->fetchWithYtDlp($url);
            } catch (Exception $e) {
                // yt-dlp failed (DNS, network, etc.) — fall back to InnerTube API
            }
        }
        return $this->fetchWithInnertube($url);
    }

    private function findYtDlp(): ?string
    {
        $candidates = [
            'yt-dlp',
            'yt-dlp.exe',
            __DIR__ . '/../bin/yt-dlp.exe',
            __DIR__ . '/../bin/yt-dlp',
            getenv('LOCALAPPDATA') . '/Microsoft/WinGet/Links/yt-dlp.exe',
            getenv('TEMP') . '/opencode/yt-dlp.exe',
            getenv('TMP') . '/opencode/yt-dlp.exe',
            'C:\Users\jerus\AppData\Local\Temp\opencode\yt-dlp.exe',
        ];
        foreach ($candidates as $c) {
            $out = null;
            $code = null;
            $cmd = escapeshellarg($c) . ' --version 2>&1';
            exec($cmd, $out, $code);
            if ($code === 0) {
                return $c;
            }
        }
        return null;
    }

    private function fetchWithYtDlp(string $url): array
    {
        $cmd = sprintf(
            '%s --dump-json --no-download --no-warnings --quiet "%s" 2>NUL',
            escapeshellarg($this->ytDlpPath),
            $url
        );
        exec($cmd, $output, $code);

        if ($code !== 0) {
            $errCmd = sprintf(
                '%s --dump-json --no-download "%s" 2>&1',
                escapeshellarg($this->ytDlpPath),
                $url
            );
            exec($errCmd, $errOut, $errCode);
            throw new RuntimeException('yt-dlp failed: ' . implode("\n", $errOut));
        }

        $data = json_decode(implode("\n", $output), true);
        if (!$data) {
            throw new RuntimeException('Failed to parse yt-dlp output.');
        }

        $formats = [];
        $seen = [];

        foreach ($data['formats'] ?? [] as $f) {
            $label = $f['format_note'] ?? $f['height'] ?? 'audio';
            $ext = $f['ext'] ?? 'mp4';
            $key = $label . '_' . $ext;
            if (isset($seen[$key])) continue;
            $seen[$key] = true;

            $type = ($f['vcodec'] ?? '') !== 'none' ? 'video' : 'audio';
            $formats[] = [
                'url'    => $f['url'],
                'label'  => $type === 'video' ? $label . 'p' : $label,
                'format' => $ext,
                'type'   => $type,
                'size'   => $f['filesize'] ?? $f['filesize_approx'] ?? 0,
            ];
        }

        usort($formats, fn($a, $b) => $b['size'] <=> $a['size']);

        return [
            'title'     => $data['title'] ?? 'Untitled',
            'thumbnail' => $data['thumbnail'] ?? '',
            'duration'  => $this->formatDuration($data['duration'] ?? 0),
            'platform'  => 'youtube',
            'formats'   => $formats,
        ];
    }

    private function fetchWithInnertube(string $url): array
    {
        $videoId = $this->extractVideoId($url);
        if (!$videoId) {
            throw new RuntimeException('Could not extract YouTube video ID.');
        }

        $apiKey = 'AIzaSyAOqs_vxje9dJ9Jqdoe1eS8n-j4d5upvlE';
        $client = [
            'hl' => 'en',
            'gl' => 'US',
            'clientName' => 'ANDROID',
            'clientVersion' => '20.10.38',
            'androidSdkVersion' => 34,
            'osName' => 'Android',
            'osVersion' => '14',
        ];

        $payload = json_encode([
            'videoId' => $videoId,
            'context' => ['client' => $client],
        ]);

        $ch = curl_init("https://www.youtube.com/youtubei/v1/player?key=$apiKey");
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'User-Agent: com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
            ],
            CURLOPT_TIMEOUT => 30,
        ]);

        $resp = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200 || !$resp) {
            // Try web client as last resort
            return $this->fetchWithWebClient($videoId);
        }

        $data = json_decode($resp, true);
        if (!$data || isset($data['error'])) {
            return $this->fetchWithWebClient($videoId);
        }

        if (!isset($data['streamingData']) || empty($data['streamingData']['formats']) && empty($data['streamingData']['adaptiveFormats'])) {
            return $this->fetchWithWebClient($videoId);
        }

        $formats = [];
        $streams = array_merge(
            $data['streamingData']['formats'] ?? [],
            $data['streamingData']['adaptiveFormats'] ?? []
        );

        foreach ($streams as $f) {
            $url = $f['url'] ?? '';
            if (!$url && isset($f['cipher'])) {
                $url = $this->decipher($f['cipher']);
            }
            if (!$url) continue;

            $label = $f['qualityLabel'] ?? $f['quality'] ?? 'audio';
            $ext = $f['container'] ?? $f['mimeType'] ?? 'mp4';
            if (str_contains($ext, '/')) {
                $ext = explode('/', $ext)[1] ?? 'mp4';
            }
            $ext = explode(';', $ext)[0] ?? 'mp4';

            $type = ($f['qualityLabel'] ?? '') ? 'video' : 'audio';
            $formats[] = [
                'url'    => $url,
                'label'  => $type === 'video' ? $label : $label,
                'format' => $ext,
                'type'   => $type,
                'size'   => $f['contentLength'] ?? 0,
            ];
        }

        if (empty($formats)) {
            throw new RuntimeException('No downloadable formats found.');
        }

        $formats = array_values(array_filter($formats, fn($f) => in_array(strtolower($f['format'] ?? ''), ['mp4', 'mp3'])));

        $thumbnails = $data['videoDetails']['thumbnail']['thumbnails'] ?? [];
        $thumb = '';
        if (!empty($thumbnails)) {
            $last = end($thumbnails);
            $thumb = $last['url'] ?? '';
        }

        return [
            'title'     => $data['videoDetails']['title'] ?? 'Untitled',
            'thumbnail' => $thumb,
            'duration'  => $this->formatDuration($data['videoDetails']['lengthSeconds'] ?? 0),
            'platform'  => 'youtube',
            'formats'   => $formats,
        ];
    }

    private function extractVideoId(string $url): ?string
    {
        $parsed = parse_url($url);
        if (!isset($parsed['host'])) return null;

        $host = strtolower($parsed['host']);

        if (str_contains($host, 'youtu.be')) {
            $path = ltrim($parsed['path'] ?? '', '/');
            return explode('?', $path)[0] ?: null;
        }

        if (str_contains($host, 'youtube.com')) {
            parse_str($parsed['query'] ?? '', $query);
            return $query['v'] ?? null;
        }

        return null;
    }

    private function fetchWithWebClient(string $videoId): array
    {
        $apiKey = 'AIzaSyAOqs_vxje9dJ9Jqdoe1eS8n-j4d5upvlE';
        $client = [
            'hl' => 'en',
            'gl' => 'US',
            'clientName' => 'WEB',
            'clientVersion' => '2.20240101.00.00',
        ];

        $payload = json_encode([
            'videoId' => $videoId,
            'context' => ['client' => $client],
        ]);

        $ch = curl_init("https://www.youtube.com/youtubei/v1/player?key=$apiKey");
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            ],
            CURLOPT_TIMEOUT => 30,
        ]);

        $resp = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200 || !$resp) {
            throw new RuntimeException('YouTube API request failed. The video may be private or unavailable.');
        }

        $data = json_decode($resp, true);
        if (!$data || isset($data['error'])) {
            throw new RuntimeException('YouTube API error: ' . ($data['error']['message'] ?? 'unknown'));
        }

        $playability = $data['playabilityStatus']['status'] ?? 'OK';
        if ($playability !== 'OK') {
            $reason = $data['playabilityStatus']['reason'] ?? 'Video cannot be played.';
            throw new RuntimeException($reason);
        }

        $formats = [];
        $streams = array_merge(
            $data['streamingData']['formats'] ?? [],
            $data['streamingData']['adaptiveFormats'] ?? []
        );

        foreach ($streams as $f) {
            $url = $f['url'] ?? '';
            if (!$url && isset($f['cipher'])) {
                $url = $this->decipher($f['cipher']);
            }
            if (!$url) continue;

            $label = $f['qualityLabel'] ?? $f['quality'] ?? 'audio';
            $mime = $f['mimeType'] ?? '';
            $ext = 'mp4';
            if ($mime) {
                $parts = explode('/', $mime);
                $ext = explode(';', $parts[1] ?? 'mp4')[0] ?? 'mp4';
            }
            $type = ($f['qualityLabel'] ?? '') ? 'video' : 'audio';
            $formats[] = [
                'url'    => $url,
                'label'  => $type === 'video' ? $label : $label,
                'format' => $ext,
                'type'   => $type,
                'size'   => $f['contentLength'] ?? 0,
            ];
        }

        if (empty($formats)) {
            throw new RuntimeException('No downloadable formats found for this video.');
        }

        $formats = array_values(array_filter($formats, fn($f) => in_array(strtolower($f['format'] ?? ''), ['mp4', 'mp3'])));

        $thumbnails = $data['videoDetails']['thumbnail']['thumbnails'] ?? [];
        $thumb = '';
        if (!empty($thumbnails)) {
            $last = end($thumbnails);
            $thumb = $last['url'] ?? '';
        }

        return [
            'title'     => $data['videoDetails']['title'] ?? 'Untitled',
            'thumbnail' => $thumb,
            'duration'  => $this->formatDuration($data['videoDetails']['lengthSeconds'] ?? 0),
            'platform'  => 'youtube',
            'formats'   => $formats,
        ];
    }

    private function decipher(string $cipher): string
    {
        parse_str($cipher, $parts);
        $url = $parts['url'] ?? '';
        if (isset($parts['sp']) && isset($parts['s'])) {
            $url .= '&' . $parts['sp'] . '=' . $parts['s'];
        }
        return $url;
    }

    private function formatDuration(int $seconds): string
    {
        $m = floor($seconds / 60);
        $s = $seconds % 60;
        return sprintf('%d:%02d', $m, $s);
    }
}
