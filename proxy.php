<?php
$b64 = $_GET['url'] ?? '';
$platform = $_GET['platform'] ?? 'tiktok';

if (empty($b64)) {
    http_response_code(400);
    header('Content-Type: application/json');
    die(json_encode(['error' => 'URL parameter required']));
}

// Decode base64
$url = base64_decode($b64, true);
if ($url === false || empty($url)) {
    http_response_code(400);
    header('Content-Type: application/json');
    die(json_encode(['error' => 'Invalid URL encoding']));
}

// Forward to Node.js download API
$nodeUrl = 'http://localhost:3001/api/download?url=' . urlencode($url) . '&platform=' . urlencode($platform);

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $nodeUrl,
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_TIMEOUT => 120,
    CURLOPT_BUFFERSIZE => 256 * 1024,
]);

$contentType = '';
curl_setopt($ch, CURLOPT_HEADERFUNCTION, function($ch, $header) use (&$contentType) {
    if (stripos($header, 'Content-Type:') === 0 || stripos($header, 'content-type:') === 0) {
        $contentType = trim(substr($header, 13));
    } elseif (stripos($header, 'Content-Disposition:') === 0 || stripos($header, 'content-disposition:') === 0) {
        header($header);
    } elseif (stripos($header, 'Content-Length:') === 0 || stripos($header, 'content-length:') === 0) {
        header($header);
    } elseif (stripos($header, 'Accept-Ranges:') === 0 || stripos($header, 'accept-ranges:') === 0) {
        header($header);
    }
    return strlen($header);
});

curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode >= 400) {
    http_response_code($httpCode);
}
