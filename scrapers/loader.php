<?php

if (!function_exists('callNodeApi')) {
    function callNodeApi(string $url): array {
        $payload = json_encode(['url' => $url]);
        $ch = curl_init('http://localhost:3001/api/fetch');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_TIMEOUT => 15,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        $resp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code !== 200 || !$resp) {
            throw new RuntimeException('API server unavailable.');
        }

        $data = json_decode($resp, true);
        if (!$data || !($data['success'] ?? false)) {
            throw new RuntimeException($data['error'] ?? 'API request failed.');
        }
        return $data['data'];
    }
}

if (!function_exists('str_contains')) {
    function str_contains(string $haystack, string $needle): bool {
        return $needle === '' || strpos($haystack, $needle) !== false;
    }
}

if (!function_exists('str_starts_with')) {
    function str_starts_with(string $haystack, string $needle): bool {
        return $needle === '' || strncmp($haystack, $needle, strlen($needle)) === 0;
    }
}

class PlatformLoader
{
    private array $scrapers = [];

    public function __construct()
    {
        $this->scrapers = [
            'youtube'     => __DIR__ . '/youtube.php',
            'facebook'    => __DIR__ . '/facebook.php',
            'instagram'   => __DIR__ . '/instagram.php',
            'twitter'     => __DIR__ . '/twitter.php',
            'tiktok'      => __DIR__ . '/tiktok.php',
            'vimeo'       => __DIR__ . '/vimeo.php',
            'dailymotion' => __DIR__ . '/dailymotion.php',
        ];
    }

    public function detect(string $url): string
    {
        $url = strtolower($url);

        $patterns = [
            'youtube'     => ['youtube.com', 'youtu.be'],
            'facebook'    => ['facebook.com', 'fb.watch', 'fb.com'],
            'instagram'   => ['instagram.com', 'instagr.am'],
            'twitter'     => ['twitter.com', 'x.com'],
            'tiktok'      => ['tiktok.com', 'vm.tiktok.com'],
            'vimeo'       => ['vimeo.com', 'player.vimeo.com'],
            'dailymotion' => ['dailymotion.com', 'dai.ly'],
        ];

        foreach ($patterns as $platform => $hosts) {
            foreach ($hosts as $host) {
                if (str_contains($url, $host)) {
                    return $platform;
                }
            }
        }

        throw new InvalidArgumentException('Unsupported platform or invalid URL.');
    }

    public function process(string $url): array
    {
        $platform = $this->detect($url);

        // Try Node.js API first (async, faster, handles all platforms)
        try {
            return callNodeApi($url);
        } catch (Exception $e) {
            // Node.js API unavailable — fall back to PHP scraper
        }

        if (!isset($this->scrapers[$platform])) {
            throw new RuntimeException("Scraper not found for: $platform");
        }

        require_once $this->scrapers[$platform];
        $className = 'Scraper_' . $platform;

        if (!class_exists($className)) {
            throw new RuntimeException("Scraper class not found: $className");
        }

        $scraper = new $className();
        return $scraper->fetch($url);
    }
}
