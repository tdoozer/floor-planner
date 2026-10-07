// Cloudflare Pages Function: тот же путь /prompt/..., что отдаёт nginx в Docker
// и прокси Vite в dev, поэтому в коде приложения нет ветвлений по окружению.
// Обход CORS для генерации картинки через Pollinations.
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const upstream = new URL('https://image.pollinations.ai' + url.pathname + url.search);

  const res = await fetch(upstream, { headers: { Accept: 'image/*' } });
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: res.status, headers });
}
