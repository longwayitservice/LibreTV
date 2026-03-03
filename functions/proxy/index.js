export async function onRequest(context) {
  const url = new URL(context.request.url)
  const target = url.searchParams.get("url")

  if (!target) {
    return new Response("Missing url", { status: 400 })
  }

  let targetUrl
  try {
    targetUrl = new URL(target)
  } catch {
    return new Response("Invalid url", { status: 400 })
  }

  const allowedHosts = [
    "movie.douban.com",
    "img1.doubanio.com",
    "img2.doubanio.com",
    "img3.doubanio.com",
    "img9.doubanio.com"
  ]

  if (!allowedHosts.some(h => targetUrl.hostname === h)) {
    return new Response("Forbidden host", { status: 403 })
  }

  try {
    const response = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Referer": "https://movie.douban.com/",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
      }
    })

    const contentType = response.headers.get("Content-Type") || "application/json"

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      }
    })
  } catch (err) {
    return new Response("Proxy error: " + err.message, { status: 502 })
  }
}
