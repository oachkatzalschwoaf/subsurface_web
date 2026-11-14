<?php
/**
 * Topside git proxy.
 *
 * Browsers cannot talk to the Subsurface cloud directly because it sends no CORS headers. This
 * script forwards git smart-HTTP requests from the Topside web app to the cloud:
 *
 *   git-proxy.php/<host>/git/<account>/info/refs?service=git-upload-pack
 *   git-proxy.php/<host>/git/<account>/git-upload-pack
 *   git-proxy.php/<host>/git/<account>/git-receive-pack
 *
 * It must never become an open proxy: only the hosts and paths below are forwarded.
 * It stores nothing and logs nothing. Requires PHP 8 with cURL.
 *
 * SPDX-License-Identifier: GPL-2.0-only
 */

declare(strict_types=1);

/** Hosts that may be reached. Add your own git server here if you use one. */
const ALLOWED_HOSTS = '/^(?:cloud|ssrf-cloud-[a-z0-9]+)\.subsurface-divelog\.org$/';
const ALLOWED_PATH = '#^/git/[^/]+/(info/refs|git-upload-pack|git-receive-pack)$#';
const ALLOWED_QUERY = '/^(|service=git-(upload|receive)-pack)$/';
const MAX_BODY_BYTES = 64 * 1024 * 1024;

function fail(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo $message;
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'POST') {
    fail(405, 'Method not allowed');
}

$pathInfo = $_SERVER['PATH_INFO'] ?? $_SERVER['ORIG_PATH_INFO'] ?? '';

// Health check used by the app to tell "proxy missing" from "server error".
if ($pathInfo === '' && ($_SERVER['QUERY_STRING'] ?? '') === 'ping') {
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo 'topside-proxy 1';
    exit;
}
if (!preg_match('#^/([^/]+)(/.*)$#', $pathInfo, $m)) {
    fail(400, 'Bad request');
}
[, $host, $path] = $m;
$query = $_SERVER['QUERY_STRING'] ?? '';

if (!preg_match(ALLOWED_HOSTS, $host) || !preg_match(ALLOWED_PATH, $path, $pm) || !preg_match(ALLOWED_QUERY, $query)) {
    fail(403, 'Forbidden');
}
$isRefs = $pm[1] === 'info/refs';
if ($isRefs !== ($method === 'GET') || ($isRefs && $query === '')) {
    fail(403, 'Forbidden');
}

// Apache may hide the Authorization header from PHP; see the .htaccess next to this file.
$authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if ($authorization === '' && function_exists('apache_request_headers')) {
    foreach (apache_request_headers() as $name => $value) {
        if (strcasecmp($name, 'Authorization') === 0) {
            $authorization = $value;
        }
    }
}

$headers = ['User-Agent: git/topside-proxy', 'Expect:'];
if ($authorization !== '') {
    $headers[] = 'Authorization: ' . $authorization;
}
foreach (['CONTENT_TYPE' => 'Content-Type', 'HTTP_ACCEPT' => 'Accept', 'HTTP_GIT_PROTOCOL' => 'Git-Protocol'] as $key => $name) {
    if (!empty($_SERVER[$key])) {
        $headers[] = $name . ': ' . $_SERVER[$key];
    }
}

// The account part is an e-mail address; encode it for the URL.
$segments = array_map('rawurlencode', explode('/', ltrim($path, '/')));
$url = 'https://' . $host . '/' . implode('/', $segments) . ($query !== '' ? '?' . $query : '');

$curl = curl_init($url);
curl_setopt_array($curl, [
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_TIMEOUT => 120,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
]);

if ($method === 'POST') {
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MAX_BODY_BYTES) {
        fail(413, 'Request too large');
    }
    $body = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if ($body === false || strlen($body) > MAX_BODY_BYTES) {
        fail(413, 'Request too large');
    }
    curl_setopt($curl, CURLOPT_POST, true);
    curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
}

$sentHeaders = false;
$contentType = 'application/octet-stream';

// Only the content type is passed back. In particular WWW-Authenticate is dropped, so the
// browser does not open its own login dialog on a wrong password.
curl_setopt($curl, CURLOPT_HEADERFUNCTION, static function ($curl, string $line) use (&$contentType): int {
    if (stripos($line, 'Content-Type:') === 0) {
        $contentType = trim(substr($line, 13));
    }
    return strlen($line);
});
curl_setopt($curl, CURLOPT_WRITEFUNCTION, static function ($curl, string $chunk) use (&$sentHeaders, &$contentType): int {
    if (!$sentHeaders) {
        http_response_code(curl_getinfo($curl, CURLINFO_RESPONSE_CODE));
        header('Content-Type: ' . $contentType);
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        $sentHeaders = true;
    }
    echo $chunk;
    flush();
    return strlen($chunk);
});

$ok = curl_exec($curl);
if (!$sentHeaders) {
    if ($ok === false) {
        fail(502, 'Upstream not reachable');
    }
    http_response_code(curl_getinfo($curl, CURLINFO_RESPONSE_CODE));
    header('Cache-Control: no-store');
}
