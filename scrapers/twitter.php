<?php

class Scraper_twitter
{
    public function fetch(string $url): array
    {
        $data = $this->fetchSyndication($url);
        if ($data && !empty($data['formats'])) return $data;

        $data = $this->fetchFxtwitter($url);
        if ($data && !empty($data['formats'])) return $data;

        $data = $this->fetchOEmbed($url);
        if ($data) return $data;

        return callNodeApi($url);
    }

    private function fetchSyndication(string $url): ?array
    {
        $tweetId = $this->extractTweetId($url);
        if (!$tweetId) return null;

        $apiUrl = "https://cdn.syndication.twimg.com/tweet-result?id=$tweetId&lang=en&token=";
        $resp = $this->fetchUrl($apiUrl);
        $data = json_decode($resp, true);

        if (!$data || isset($data['error'])) return null;

        $title = $data['text'] ?? 'Tweet';
        $title = mb_substr(html_entity_decode(strip_tags($title)), 0, 200);

        $media = $data['mediaDetails'] ?? [];
        $formats = [];

        foreach ($media as $m) {
            if (($m['type'] ?? '') === 'video') {
                $variants = $m['videoInfo']['variants'] ?? [];
                usort($variants, fn($a, $b) => ($b['bitrate'] ?? 0) <=> ($a['bitrate'] ?? 0));
                if (!empty($variants)) {
                    $best = $variants[0];
                    $formats[] = [
                        'url'    => $best['url'],
                        'label'  => 'Best Quality',
                        'format' => 'mp4',
                        'type'   => 'video',
                        'size'   => 0,
                    ];
                }
            } elseif (($m['type'] ?? '') === 'photo') {
                $formats[] = [
                    'url'    => $m['media_url_https'] ?? $m['media_url'] ?? '',
                    'label'  => 'Photo',
                    'format' => 'jpg',
                    'type'   => 'video',
                    'size'   => 0,
                ];
            }
        }

        if (empty($formats)) return null;

        $thumb = $media[0]['media_url_https'] ?? $media[0]['media_url'] ?? '';

        return [
            'title'     => $title,
            'thumbnail' => $thumb,
            'duration'  => '',
            'platform'  => 'twitter',
            'formats'   => $formats,
        ];
    }

    private function fetchOEmbed(string $url): ?array
    {
        $oembedUrl = 'https://publish.twitter.com/oembed?url=' . urlencode($url);
        $resp = $this->fetchUrl($oembedUrl);
        $data = json_decode($resp, true);

        if (!$data || isset($data['error'])) return null;

        $title = strip_tags($data['html'] ?? 'Tweet');
        $title = mb_substr(html_entity_decode($title), 0, 200);

        $thumb = $data['thumbnail_url'] ?? $data['author_url'] ?? '';

        return [
            'title'     => $title,
            'thumbnail' => $thumb,
            'duration'  => '',
            'platform'  => 'twitter',
            'formats'   => [],
        ];
    }

    private function fetchFxtwitter(string $url): ?array
    {
        $fxUrl = str_replace(['twitter.com', 'x.com'], 'fxtwitter.com', $url);
        $resp = $this->fetchUrl($fxUrl);

        $data = json_decode($resp, true);
        if (!$data || isset($data['error'])) return null;

        $formats = [];
        if (!empty($data['video']['url'])) {
            $formats[] = [
                'url'    => $data['video']['url'],
                'label'  => 'Video',
                'format' => 'mp4',
                'type'   => 'video',
                'size'   => 0,
            ];
        }

        return [
            'title'     => $data['text'] ?? 'Tweet',
            'thumbnail' => $data['avatar'] ?? '',
            'duration'  => '',
            'platform'  => 'twitter',
            'formats'   => $formats,
        ];
    }

    private function extractTweetId(string $url): ?string
    {
        if (preg_match('/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i', $url, $m)) {
            return $m[1];
        }
        return null;
    }

    private function fetchUrl(string $url): string
    {
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            CURLOPT_TIMEOUT        => 20,
        ]);
        $html = curl_exec($ch);
        curl_close($ch);
        return $html ?: '';
    }
}
