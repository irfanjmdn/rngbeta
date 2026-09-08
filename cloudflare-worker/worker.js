/**
 * Cloudflare Worker for Spotify Crate RNG
 * Proxies public Spotify embed playlist metadata with CORS enabled.
 */
export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    let playlistId = null;
    const match = pathname.match(/\/playlist\/([a-zA-Z0-9]{22})/);
    if (match) {
      playlistId = match[1];
    } else {
      playlistId = url.searchParams.get("playlist") || url.searchParams.get("id");
    }

    if (!playlistId) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Spotify playlist ID (must be 22 alphanumeric characters)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
      const spotifyRes = await fetch(embedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      if (!spotifyRes.ok) {
        return new Response(
          JSON.stringify({ error: `Spotify returned HTTP ${spotifyRes.status}` }),
          { status: spotifyRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const html = await spotifyRes.text();
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);

      if (!nextDataMatch) {
        return new Response(
          JSON.stringify({ error: "Could not locate Spotify playlist embed data. Ensure the playlist is public." }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const parsed = JSON.parse(nextDataMatch[1]);
      const entity = parsed?.props?.pageProps?.state?.data?.entity;

      if (!entity) {
        return new Response(
          JSON.stringify({ error: "Spotify playlist entity is empty or unavailable." }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, entity }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message || "Internal Worker Error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
