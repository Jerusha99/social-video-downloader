<?php

class Scraper_tiktok
{
    public function fetch(string $url): array
    {
        // Use Node.js API as primary source (tikwm.com is most reliable)
        try {
            return callNodeApi($url);
        } catch (Exception $e) {
            // Fall through to PHP fallback
        }

        // PHP fallback: try oEmbed for metadata only
        $data = $this->fetchOembed($url);
        if ($data) return $data;

        throw new RuntimeException('Could not fetch TikTok video. It may be private or unavailable.');
    }

    private function fetchOembed(string $url): ?array
    {
        $oembedUrl = 'https://www.tiktok.com/oembed?url=' . urlencode($url);
        $resp = $this->fetchUrl($oembedUrl);
        $data = json_decode($resp, true);

        if (!$data || isset($data['error'])) return null;

        $title = $data['title'] ?? 'TikTok Video';
        $thumb = $data['thumbnail_url'] ?? $data['author_url'] ?? '';

        $formats = [];
        if (!empty($data['video_url'])) {
            $videoUrl = $data['video_url'];
            if ($this->isValidUrl($videoUrl)) {
                $formats[] = [
                    'url'    => $videoUrl,
                    'label'  => 'Video',
                    'format' => 'mp4',
                    'type'   => 'video',
                    'size'   => 0,
                ];
            }
        }

        return [
            'title'     => $title,
            'thumbnail' => $thumb,
            'duration'  => '',
            'platform'  => 'tiktok',
            'formats'   => $formats,
        ];
    }

    private function isValidUrl(string $url): bool
    {
        if (empty($url)) return false;
        if (str_starts_with($url, '//')) return false;
        return str_starts_with($url, 'http://') || str_starts_with($url, 'https://');
    }

    private function fetchUrl(string $url): string
    {
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_HTTPHEADER     => [
                'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language: en-US,en;q=0.5',
            ],
        ]);
        $html = curl_exec($ch);
        curl_close($ch);
        return $html ?: '';
    }
}
