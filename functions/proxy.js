export async function onRequest(context) {
  const { request } = context
  const url = new URL(request.url)
  const target = url.searchParams.get("url")

  if (!target) {
    return new Response("Missing url", { status: 400 })
  }

  const targetUrl = new URL(target)

  if (!targetUrl.hostname.includes("doubanio.com")) {
    return new Response("Forbidden", { status: 403 })
  }

  const fetchResponse = await fetch(target, {
    headers: {
      Referer: "https://movie.douban.com/",
      "User-Agent": "Mozilla/5.0"
    }
  })

  return new Response(fetchResponse.body, {
    headers: {
      "Content-Type": fetchResponse.headers.get("Content-Type"),
      "Cache-Control": "public, max-age=604800"
    }
  })
}
