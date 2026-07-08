<?php

class Scraper_facebook
{
    public function fetch(string $url): array
    {
        // Try mbasic scraping
        $mobileUrl = str_replace('www.facebook.com', 'mbasic.facebook.com', $url);
        $mobileUrl = str_replace('m.facebook.com', 'mbasic.facebook.com', $mobileUrl);
        if (!str_contains($mobileUrl, 'mbasic.facebook.com')) {
            $mobileUrl = str_replace('facebook.com', 'mbasic.facebook.com', $mobileUrl);
        }

        $html = $this->fetchUrl($mobileUrl);
        if ($html) {
            $videoUrl = $this->extractVideoUrl($html);
            if ($videoUrl) {
                return [
                    'title'     => $this->extractTitle($html) ?: 'Facebook Video',
                    'thumbnail' => $this->extractThumbnail($html) ?: '',
                    'duration'  => '',
                    'platform'  => 'facebook',
                    'formats'   => [['url' => $videoUrl, 'label' => 'HD Video', 'format' => 'mp4', 'type' => 'video', 'size' => 0]],
                ];
            }
        }

        // Try Graph API
        try {
            return $this->fetchWithGraphApi($url);
        } catch (Exception $e) { /* fall through */ }

        return callNodeApi($url);
    }

    private function fetchWithGraphApi(string $url): array
    {
        $graphUrl = 'https://graph.facebook.com/v19.0/?id=' . urlencode($url) . '&fields=og_object{title,image,video},engagement';
        $resp = $this->fetchUrl($graphUrl);
        $data = json_decode($resp, true);

        if (!$data || isset($data['error'])) {
            throw new RuntimeException('Could not fetch Facebook video. The video may be private or unavailable.');
        }

        $og = $data['og_object'] ?? [];
        $title = $og['title'] ?? 'Facebook Video';

        $thumb = '';
        if (isset($og['image'][0]['url'])) {
            $thumb = $og['image'][0]['url'];
        }

        $videoSrc = $og['video']['url'] ?? '';

        $formats = $videoSrc ? [
            [
                'url'    => $videoSrc,
                'label'  => 'Video',
                'format' => 'mp4',
                'type'   => 'video',
                'size'   => 0,
            ],
        ] : [];

        return [
            'title'     => $title,
            'thumbnail' => $thumb,
            'duration'  => '',
            'platform'  => 'facebook',
            'formats'   => $formats,
        ];
    }

    private function fetchUrl(string $url): string
    {
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_COOKIE         => 'locale=en_US;',
        ]);
        $html = curl_exec($ch);
        curl_close($ch);
        return $html ?: '';
    }

    private function extractVideoUrl(string $html): ?string
    {
        $patterns = [
            '/href="\/video_redirect\/\?src=([^"]+)"/',
            '/source src="([^"]+\.mp4[^"]*)"/i',
            '/data-src="([^"]+\.mp4[^"]*)"/i',
            '/video_url":"([^"]+\.mp4[^"]*)"/',
        ];

        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $html, $m)) {
                $url = str_replace('&amp;', '&', $m[1]);
                $url = html_entity_decode($url, ENT_QUOTES);
                $url = urldecode($url);
                if (str_starts_with($url, 'http')) return $url;
                return 'https://mbasic.facebook.com' . $url;
            }
        }

        if (preg_match('/video_redirect\/\?src=([^"&\s]+)/', $html, $m)) {
            $url = urldecode($m[1]);
            if (str_starts_with($url, 'http')) return $url;
        }

        return null;
    }

    private function extractTitle(string $html): ?string
    {
        if (preg_match('/<title>([^<]+)<\/title>/i', $html, $m)) {
            return trim(html_entity_decode($m[1], ENT_QUOTES));
        }
        if (preg_match('/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i', $html, $m)) {
            return html_entity_decode($m[1], ENT_QUOTES);
        }
        return null;
    }

    private function extractThumbnail(string $html): ?string
    {
        if (preg_match('/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i', $html, $m)) {
            return $m[1];
        }
        if (preg_match('/"preview_thumbnail":"([^"]+)"/', $html, $m)) {
            return $m[1];
        }
        return null;
    }
}
