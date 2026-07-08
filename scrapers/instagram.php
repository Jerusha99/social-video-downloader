<?php

class Scraper_instagram
{
    public function fetch(string $url): array
    {
        $data = $this->fetchGraphQL($url);
        if ($data && !empty($data['formats'])) return $data;

        $data = $this->fetchEmbed($url);
        if ($data) return $data;

        return callNodeApi($url);
    }

    private function fetchGraphQL(string $url): ?array
    {
        $html = $this->fetchUrl($url);
        if (!$html) return null;

        if (preg_match('/window\.__additionalDataLoaded\s*\([^,]+,\s*(\{.+?\})\)\s*;?\s*<\/script>/s', $html, $m)) {
            $json = $m[1];
        } elseif (preg_match('/<script type="text\/javascript">window\.__initialState__\s*=\s*(\{.+?\})\s*<\/script>/s', $html, $m)) {
            $json = $m[1];
        } else {
            return null;
        }

        $data = json_decode($json, true);
        if (!$data) return null;

        $media = $this->findMedia($data);
        if (!$media) return null;

        $title = $media['edge_media_to_caption']['edges'][0]['node']['text'] ?? 'Instagram Post';
        $title = mb_substr($title, 0, 200);

        $thumb = $media['display_url'] ?? '';

        $videoUrl = $media['video_url'] ?? '';
        $duration = $media['video_duration'] ?? 0;

        if (!$videoUrl) {
            $videoUrl = $media['video_dash_url'] ?? '';
        }

        $formats = [];
        if ($videoUrl) {
            $formats[] = [
                'url'    => $videoUrl,
                'label'  => $media['is_video'] ?? false ? 'HD Video' : 'Image',
                'format' => 'mp4',
                'type'   => 'video',
                'size'   => 0,
            ];
        }

        if (empty($formats)) {
            $formats[] = [
                'url'    => $thumb,
                'label'  => 'Image',
                'format' => 'jpg',
                'type'   => 'video',
                'size'   => 0,
            ];
        }

        return [
            'title'     => $title ?: 'Instagram Post',
            'thumbnail' => $thumb,
            'duration'  => $duration ? sprintf('%d:%02d', floor($duration / 60), $duration % 60) : '',
            'platform'  => 'instagram',
            'formats'   => $formats,
        ];
    }

    private function fetchEmbed(string $url): ?array
    {
        $embedUrl = 'https://api.instagram.com/oembed?url=' . urlencode($url);
        $resp = $this->fetchUrl($embedUrl);
        $data = json_decode($resp, true);

        if (!$data || isset($data['error'])) return null;

        $thumb = $data['thumbnail_url'] ?? $data['author_url'] ?? '';

        return [
            'title'     => $data['title'] ?? 'Instagram Post',
            'thumbnail' => $thumb,
            'duration'  => '',
            'platform'  => 'instagram',
            'formats'   => [],
        ];
    }

    private function findMedia(array $data): ?array
    {
        $paths = [
            'shortcode_media',
            'media',
            'graphql.shortcode_media',
            'entry_data.PostPage.0.graphql.shortcode_media',
            'entry_data.ProfilePage.0.graphql.user.edge_owner_to_timeline_media.edges.0.node',
        ];

        foreach ($paths as $path) {
            $current = $data;
            $parts = explode('.', $path);
            foreach ($parts as $part) {
                if (is_array($current) && isset($current[$part])) {
                    $current = $current[$part];
                } else {
                    $current = null;
                    break;
                }
            }
            if ($current) return $current;
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
