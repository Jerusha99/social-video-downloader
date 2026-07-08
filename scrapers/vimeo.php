<?php

class Scraper_vimeo
{
    public function fetch(string $url): array
    {
        $videoId = $this->extractVideoId($url);
        if (!$videoId) {
            throw new RuntimeException('Could not extract Vimeo video ID.');
        }

        $apiUrl = "https://player.vimeo.com/video/$videoId/config";
        $resp = $this->fetchUrl($apiUrl);
        $data = json_decode($resp, true);

        if (!$data || isset($data['error'])) {
            $apiUrl = "https://vimeo.com/api/v2/video/$videoId.json";
            $resp = $this->fetchUrl($apiUrl);
            $dataArr = json_decode($resp, true);
            if (is_array($dataArr) && !empty($dataArr[0])) {
                $data = $dataArr[0];
            } else {
                throw new RuntimeException('Could not fetch Vimeo video data.');
            }

            $title = $data['title'] ?? 'Vimeo Video';
            $thumb = $data['thumbnail_large'] ?? $data['thumbnail_medium'] ?? '';
            $duration = $data['duration'] ?? 0;

            $formats = [];
            if (!empty($data['url'])) {
                $formats[] = [
                    'url'    => $data['url'],
                    'label'  => 'Video',
                    'format' => 'mp4',
                    'type'   => 'video',
                    'size'   => 0,
                ];
            }

            return [
                'title'     => $title,
                'thumbnail' => $thumb,
                'duration'  => $duration ? sprintf('%d:%02d', floor($duration / 60), $duration % 60) : '',
                'platform'  => 'vimeo',
                'formats'   => $formats,
            ];
        }

        $video = $data['video'] ?? [];
        $title = $video['title'] ?? 'Vimeo Video';
        $thumb = $video['thumbs']['base'] ?? $video['thumbs']['720'] ?? '';
        $duration = $video['duration'] ?? 0;

        $files = $data['request']['files']['progressive'] ?? [];
        $formats = [];

        foreach ($files as $f) {
            $formats[] = [
                'url'    => $f['url'],
                'label'  => $f['quality'] ?? 'HD',
                'format' => 'mp4',
                'type'   => 'video',
                'size'   => $f['size'] ?? 0,
            ];
        }

        if (empty($formats)) {
            $hls = $data['request']['files']['hls']['cdns'] ?? [];
            $defaultCdn = $hls['default'] ?? reset($hls);
            if ($defaultCdn && !empty($defaultCdn['url'])) {
                $formats[] = [
                    'url'    => $defaultCdn['url'],
                    'label'  => 'HLS',
                    'format' => 'm3u8',
                    'type'   => 'video',
                    'size'   => 0,
                ];
            }
        }

        if (empty($formats)) {
            throw new RuntimeException('No downloadable formats found.');
        }

        return [
            'title'     => $title,
            'thumbnail' => $thumb,
            'duration'  => $duration ? sprintf('%d:%02d', floor($duration / 60), $duration % 60) : '',
            'platform'  => 'vimeo',
            'formats'   => $formats,
        ];
    }

    private function extractVideoId(string $url): ?string
    {
        if (preg_match('/vimeo\.com\/(\d+)/i', $url, $m)) {
            return $m[1];
        }
        if (preg_match('/player\.vimeo\.com\/video\/(\d+)/i', $url, $m)) {
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
            CURLOPT_REFERER        => 'https://vimeo.com/',
        ]);
        $html = curl_exec($ch);
        curl_close($ch);
        return $html ?: '';
    }
}
