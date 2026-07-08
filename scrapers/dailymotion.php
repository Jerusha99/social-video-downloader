<?php

class Scraper_dailymotion
{
    public function fetch(string $url): array
    {
        $videoId = $this->extractVideoId($url);
        if (!$videoId) {
            throw new RuntimeException('Could not extract Dailymotion video ID.');
        }

        $apiUrl = "https://www.dailymotion.com/player/metadata/video/$videoId";
        $resp = $this->fetchUrl($apiUrl);
        $data = json_decode($resp, true);

        if (!$data || !isset($data['title'])) {
            throw new RuntimeException('Could not fetch Dailymotion video data.');
        }

        $title = $data['title'] ?? 'Dailymotion Video';
        $thumb = $data['thumbnail_url'] ?? $data['poster_url'] ?? '';
        $duration = $data['duration'] ?? 0;

        $qualities = $data['qualities'] ?? [];
        $formats = [];

        // Modern Dailymotion returns HLS stream under 'auto'
        if (isset($qualities['auto'])) {
            foreach ($qualities['auto'] as $item) {
                $url = $item['url'] ?? '';
                if ($url) {
                    $formats[] = [
                        'url'    => $url,
                        'label'  => 'HD',
                        'format' => 'm3u8',
                        'type'   => 'video',
                        'size'   => 0,
                    ];
                }
            }
        }

        // Try legacy format with numbered qualities
        $order = ['3840', '2160', '1920', '1280', '720', '480', '360', '240', '144'];
        foreach ($order as $q) {
            if (isset($qualities[$q])) {
                foreach ($qualities[$q] as $item) {
                    $formats[] = [
                        'url'    => $item['url'],
                        'label'  => $q . 'p',
                        'format' => str_contains($item['type'] ?? '', 'mpegURL') ? 'm3u8' : 'mp4',
                        'type'   => 'video',
                        'size'   => $item['size'] ?? 0,
                    ];
                }
            }
        }

        if (empty($formats)) {
            throw new RuntimeException('No downloadable formats found.');
        }

        return [
            'title'     => $title,
            'thumbnail' => $thumb,
            'duration'  => $duration ? sprintf('%d:%02d', floor($duration / 60), $duration % 60) : '',
            'platform'  => 'dailymotion',
            'formats'   => $formats,
        ];
    }

    private function extractVideoId(string $url): ?string
    {
        if (preg_match('/dailymotion\.com\/video\/([a-zA-Z0-9]+)/i', $url, $m)) {
            return $m[1];
        }
        if (preg_match('/dai\.ly\/([a-zA-Z0-9]+)/i', $url, $m)) {
            return $m[1];
        }
        if (preg_match('/dailymotion\.com\/embed\/video\/([a-zA-Z0-9]+)/i', $url, $m)) {
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
            CURLOPT_REFERER        => 'https://www.dailymotion.com/',
        ]);
        $html = curl_exec($ch);
        curl_close($ch);
        return $html ?: '';
    }
}
