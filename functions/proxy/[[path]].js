// functions/proxy/[[path]].js

const MEDIA_FILE_EXTENSIONS = [
    '.mp4', '.webm', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.f4v', '.m4v', '.3gp', '.3g2', '.ts', '.mts', '.m2ts',
    '.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac', '.wma', '.alac', '.aiff', '.opus',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg', '.avif', '.heic'
];
const MEDIA_CONTENT_TYPES = ['video/', 'audio/', 'image/'];

const DOUBAN_HOSTS = [
    "movie.douban.com",
    "img1.doubanio.com",
    "img2.doubanio.com",
    "img3.doubanio.com",
    "img9.doubanio.com"
];

export async function onRequest(context) {
    const { request, env, waitUntil } = context;
    const url = new URL(request.url);

    // 豆瓣白名单：?url= 参数形式，直接放行不鉴权
    const targetParam = url.searchParams.get("url");
    if (targetParam) {
        try {
            const targetHost = new URL(targetParam).hostname;
            if (DOUBAN_HOSTS.includes(targetHost)) {
                const response = await fetch(targetParam, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                        "Referer": "https://movie.douban.com/",
                        "Accept": "application/json, text/plain, */*",
                        "Accept-Language": "zh-CN,zh;q=0.9",
                    }
                });
                return new Response(response.body, {
                    status: response.status,
                    headers: {
                        "Content-Type": response.headers.get("Content-Type") || "application/json",
                        "Access-Control-Allow-Origin": "*",
                        "Cache-Control": "public, max-age=300",
                    }
                });
            }
        } catch (e) {
            return new Response("Invalid url", { status: 400 });
        }
    }

    // 鉴权验证
    async function validateAuth(req, environment) {
        const reqUrl = new URL(req.url);
        const authHash = reqUrl.searchParams.get('auth');
        const timestamp = reqUrl.searchParams.get('t');
        const serverPassword = environment.PASSWORD;
        if (!serverPassword) {
            console.error('服务器未设置 PASSWORD 环境变量');
            return false;
        }
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(serverPassword);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const serverPasswordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            if (!authHash || authHash !== serverPasswordHash) return false;
        } catch (error) {
            return false;
        }
        if (timestamp) {
            const now = Date.now();
            if (now - parseInt(timestamp) > 10 * 60 * 1000) return false;
        }
        return true;
    }

    const isValidAuth = await validateAuth(request, env);
    if (!isValidAuth) {
        return new Response(JSON.stringify({
            success: false,
            error: '代理访问未授权：请检查密码配置或鉴权参数'
        }), {
            status: 401,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Content-Type': 'application/json'
            }
        });
    }

    const DEBUG_ENABLED = (env.DEBUG === 'true');
    const CACHE_TTL = parseInt(env.CACHE_TTL || '86400');
    const MAX_RECURSION = parseInt(env.MAX_RECURSION || '5');
    let USER_AGENTS = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    try {
        const agentsJson = env.USER_AGENTS_JSON;
        if (agentsJson) {
            const parsedAgents = JSON.parse(agentsJson);
            if (Array.isArray(parsedAgents) && parsedAgents.length > 0) {
                USER_AGENTS = parsedAgents;
            }
        }
    } catch (e) {}

    function logDebug(message) {
        if (DEBUG_ENABLED) console.log(`[Proxy Func] ${message}`);
    }

    function getTargetUrlFromPath(pathname) {
        const encodedUrl = pathname.replace(/^\/proxy\//, '');
        if (!encodedUrl) return null;
        try {
            let decodedUrl = decodeURIComponent(encodedUrl);
            if (!decodedUrl.match(/^https?:\/\//i)) {
                if (encodedUrl.match(/^https?:\/\//i)) {
                    decodedUrl = encodedUrl;
                } else {
                    return null;
                }
            }
            return decodedUrl;
        } catch (e) {
            return null;
        }
    }

    function createResponse(body, status, headers) {
        status = status || 200;
        headers = headers || {};
        const responseHeaders = new Headers(headers);
        responseHeaders.set("Access-Control-Allow-Origin", "*");
        responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
        responseHeaders.set("Access-Control-Allow-Headers", "*");
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: responseHeaders });
        }
        return new Response(body, { status: status, headers: responseHeaders });
    }

    function createM3u8Response(content) {
        return createResponse(content, 200, {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "public, max-age=" + CACHE_TTL
        });
    }

    function getRandomUserAgent() {
        return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    }

    function getBaseUrl(urlStr) {
        try {
            const parsedUrl = new URL(urlStr);
            if (!parsedUrl.pathname || parsedUrl.pathname === '/') return parsedUrl.origin + '/';
            const pathParts = parsedUrl.pathname.split('/');
            pathParts.pop();
            return parsedUrl.origin + pathParts.join('/') + '/';
        } catch (e) {
            const lastSlashIndex = urlStr.lastIndexOf('/');
            return lastSlashIndex > urlStr.indexOf('://') + 2 ? urlStr.substring(0, lastSlashIndex + 1) : urlStr + '/';
        }
    }

    function resolveUrl(baseUrl, relativeUrl) {
        if (relativeUrl.match(/^https?:\/\//i)) return relativeUrl;
        try {
            return new URL(relativeUrl, baseUrl).toString();
        } catch (e) {
            if (relativeUrl.startsWith('/')) {
                const urlObj = new URL(baseUrl);
                return urlObj.origin + relativeUrl;
            }
            return baseUrl.replace(/\/[^/]*$/, '/') + relativeUrl;
        }
    }

    function rewriteUrlToProxy(targetUrl) {
        return '/proxy/' + encodeURIComponent(targetUrl);
    }

    async function fetchContentWithType(targetUrl) {
        const headers = new Headers({
            'User-Agent': getRandomUserAgent(),
            'Accept': '*/*',
            'Accept-Language': request.headers.get('Accept-Language') || 'zh-CN,zh;q=0.9,en;q=0.8',
            'Referer': request.headers.get('Referer') || new URL(targetUrl).origin
        });
        try {
            const response = await fetch(targetUrl, { headers: headers, redirect: 'follow' });
            if (!response.ok) {
                throw new Error('HTTP error ' + response.status + ': ' + response.statusText);
            }
            const content = await response.text();
            const contentType = response.headers.get('Content-Type') || '';
            return { content: content, contentType: contentType, responseHeaders: response.headers };
        } catch (error) {
            throw new Error('请求目标URL失败 ' + targetUrl + ': ' + error.message);
        }
    }

    function isM3u8Content(content, contentType) {
        if (contentType && (
            contentType.includes('application/vnd.apple.mpegurl') ||
            contentType.includes('application/x-mpegurl') ||
            contentType.includes('audio/mpegurl')
        )) return true;
        return content && typeof content === 'string' && content.trim().startsWith('#EXTM3U');
    }

    function processKeyLine(line, baseUrl) {
        return line.replace(/URI="([^"]+)"/, function(match, uri) {
            const absoluteUri = resolveUrl(baseUrl, uri);
            return 'URI="' + rewriteUrlToProxy(absoluteUri) + '"';
        });
    }

    function processMapLine(line, baseUrl) {
        return line.replace(/URI="([^"]+)"/, function(match, uri) {
            const absoluteUri = resolveUrl(baseUrl, uri);
            return 'URI="' + rewriteUrlToProxy(absoluteUri) + '"';
        });
    }

    function processMediaPlaylist(url, content) {
        const baseUrl = getBaseUrl(url);
        const lines = content.split('\n');
        const output = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line && i === lines.length - 1) { output.push(line); continue; }
            if (!line) continue;
            if (line.startsWith('#EXT-X-KEY')) { output.push(processKeyLine(line, baseUrl)); continue; }
            if (line.startsWith('#EXT-X-MAP')) { output.push(processMapLine(line, baseUrl)); continue; }
            if (line.startsWith('#EXTINF')) { output.push(line); continue; }
            if (!line.startsWith('#')) {
                output.push(rewriteUrlToProxy(resolveUrl(baseUrl, line)));
                continue;
            }
            output.push(line);
        }
        return output.join('\n');
    }

    async function processM3u8Content(targetUrl, content, recursionDepth, environment) {
        recursionDepth = recursionDepth || 0;
        if (content.includes('#EXT-X-STREAM-INF') || content.includes('#EXT-X-MEDIA:')) {
            return await processMasterPlaylist(targetUrl, content, recursionDepth, environment);
        }
        return processMediaPlaylist(targetUrl, content);
    }

    async function processMasterPlaylist(url, content, recursionDepth, environment) {
        if (recursionDepth > MAX_RECURSION) throw new Error('递归层数过多: ' + url);
        const baseUrl = getBaseUrl(url);
        const lines = content.split('\n');
        let highestBandwidth = -1;
        let bestVariantUrl = '';

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                const bandwidthMatch = lines[i].match(/BANDWIDTH=(\d+)/);
                const currentBandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;
                let variantUriLine = '';
                for (let j = i + 1; j < lines.length; j++) {
                    const line = lines[j].trim();
                    if (line && !line.startsWith('#')) { variantUriLine = line; i = j; break; }
                }
                if (variantUriLine && currentBandwidth >= highestBandwidth) {
                    highestBandwidth = currentBandwidth;
                    bestVariantUrl = resolveUrl(baseUrl, variantUriLine);
                }
            }
        }

        if (!bestVariantUrl) {
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line && !line.startsWith('#') && (line.endsWith('.m3u8') || line.includes('.m3u8?'))) {
                    bestVariantUrl = resolveUrl(baseUrl, line);
                    break;
                }
            }
        }

        if (!bestVariantUrl) return processMediaPlaylist(url, content);

        let kvNamespace = null;
        try {
            kvNamespace = environment.LIBRETV_PROXY_KV;
            if (!kvNamespace) throw new Error("KV未绑定");
        } catch (e) { kvNamespace = null; }

        const cacheKey = 'm3u8_processed:' + bestVariantUrl;
        if (kvNamespace) {
            try {
                const cachedContent = await kvNamespace.get(cacheKey);
                if (cachedContent) return cachedContent;
            } catch (e) {}
        }

        const fetched = await fetchContentWithType(bestVariantUrl);
        if (!isM3u8Content(fetched.content, fetched.contentType)) {
            return processMediaPlaylist(bestVariantUrl, fetched.content);
        }

        const processedVariant = await processM3u8Content(bestVariantUrl, fetched.content, recursionDepth + 1, environment);

        if (kvNamespace) {
            try {
                waitUntil(kvNamespace.put(cacheKey, processedVariant, { expirationTtl: CACHE_TTL }));
            } catch (e) {}
        }
        return processedVariant;
    }

    // 主处理逻辑
    try {
        const targetUrl = getTargetUrlFromPath(url.pathname);
        if (!targetUrl) return createResponse("无效的代理请求", 400);

        let kvNamespace = null;
        try {
            kvNamespace = env.LIBRETV_PROXY_KV;
            if (!kvNamespace) throw new Error("KV未绑定");
        } catch (e) { kvNamespace = null; }

        const cacheKey = 'proxy_raw:' + targetUrl;
        if (kvNamespace) {
            try {
                const cachedDataJson = await kvNamespace.get(cacheKey);
                if (cachedDataJson) {
                    const cachedData = JSON.parse(cachedDataJson);
                    const content = cachedData.body;
                    let headers = {};
                    try { headers = JSON.parse(cachedData.headers); } catch (e) {}
                    const contentType = headers['content-type'] || '';
                    if (isM3u8Content(content, contentType)) {
                        return createM3u8Response(await processM3u8Content(targetUrl, content, 0, env));
                    } else {
                        return createResponse(content, 200, new Headers(headers));
                    }
                }
            } catch (e) {}
        }

        const fetched = await fetchContentWithType(targetUrl);

        if (kvNamespace) {
            try {
                const headersToCache = {};
                fetched.responseHeaders.forEach(function(value, key) { headersToCache[key.toLowerCase()] = value; });
                waitUntil(kvNamespace.put(cacheKey, JSON.stringify({ body: fetched.content, headers: JSON.stringify(headersToCache) }), { expirationTtl: CACHE_TTL }));
            } catch (e) {}
        }

        if (isM3u8Content(fetched.content, fetched.contentType)) {
            return createM3u8Response(await processM3u8Content(targetUrl, fetched.content, 0, env));
        } else {
            const finalHeaders = new Headers(fetched.responseHeaders);
            finalHeaders.set('Cache-Control', 'public, max-age=' + CACHE_TTL);
            finalHeaders.set("Access-Control-Allow-Origin", "*");
            finalHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
            finalHeaders.set("Access-Control-Allow-Headers", "*");
            return createResponse(fetched.content, 200, finalHeaders);
        }
    } catch (error) {
        return createResponse('代理处理错误: ' + error.message, 500);
    }
}

export async function onRequestOptions(context) {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Max-Age": "86400",
        },
    });
}
