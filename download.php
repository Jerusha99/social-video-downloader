<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$url = trim($input['url'] ?? $_POST['url'] ?? '');

if (empty($url)) {
    http_response_code(400);
    echo json_encode(['error' => 'URL is required']);
    exit;
}

require_once __DIR__ . '/scrapers/loader.php';

try {
    $loader = new PlatformLoader();
    $data = $loader->process($url);
    echo json_encode(['success' => true, 'data' => $data]);
} catch (Exception $e) {
    http_response_code(422);
    echo json_encode(['error' => $e->getMessage()]);
}
