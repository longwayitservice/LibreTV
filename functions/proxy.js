export async function onRequest(context) {
  const url = new URL(context.request.url)
  const target = url.searchParams.get("url")

  if (!target) {
    return new Response("Missing url", { status: 400 })
  }

  const response = await fetch(target, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": "https://movie.douban.com/",
    }
  })

  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "image/jpeg",
      "Access-Control-Allow-Origin": "*"
    }
  })
}
