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

    // 1. Check for /user/:userId endpoint
    const userMatch = pathname.match(/\/user\/([a-zA-Z0-9_.-]+)/);
    const queryUser = url.searchParams.get("user");
    const targetUser = userMatch ? userMatch[1] : queryUser;

    if (targetUser) {
      try {
        const spotifyUserUrl = `https://open.spotify.com/user/${encodeURIComponent(targetUser)}`;
        const res = await fetch(spotifyUserUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          },
        });

        if (!res.ok) {
          return new Response(
            JSON.stringify({ error: `Spotify user profile returned HTTP ${res.status}. Profile may be private or invalid.` }),
            { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const html = await res.text();
        const scriptIdMatches = Array.from(html.matchAll(/<script\b[^>]*id=["']([^"']+)["'][^>]*>/gi)).map(m => m[1]);
        const stateMatch = html.match(/<script\b[^>]*id=["']initialState["'][^>]*>([\s\S]*?)<\/script>/i);

        if (!stateMatch) {
          const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
          return new Response(
            JSON.stringify({
              error: "Could not locate Spotify user profile data.",
              title: titleMatch ? titleMatch[1] : null,
              htmlLength: html.length,
              scriptIds: scriptIdMatches,
              hasInitialStateWord: html.includes("initialState"),
            }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Decode base64 initialState
        const decoded = atob(stateMatch[1].trim());
        const data = JSON.parse(decoded);
        const items = data?.entities?.items || {};

        let userEntity = null;
        for (const [key, val] of Object.entries(items)) {
          if (val && val.__typename === "User") {
            userEntity = val;
            break;
          }
        }

        if (!userEntity) {
          return new Response(
            JSON.stringify({ error: "No public user profile found for this identifier." }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const rawPlaylists = userEntity.publicPlaylistsV2?.items || [];
        const playlists = rawPlaylists.map((p) => {
          const d = p?.data || {};
          const uri = d.uri || p._uri || "";
          const id = uri.split(":").pop() || "";
          const img = d.images?.items?.[0]?.sources?.[0]?.url || "";
          return {
            id,
            uri,
            name: d.name || "Untitled Playlist",
            followers: d.followers || 0,
            imageUrl: img,
            url: `https://open.spotify.com/playlist/${id}`,
          };
        }).filter((p) => p.id);

        const avatarUrl = userEntity.avatar?.sources?.[0]?.url || "";

        return new Response(
          JSON.stringify({
            ok: true,
            user: {
              id: userEntity.id || targetUser,
              name: userEntity.name || targetUser,
              avatarUrl,
              totalPlaylists: playlists.length,
            },
            playlists,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err.message || "Failed to fetch Spotify user profile" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let playlistId = null;
    const match = pathname.match(/\/playlist\/([a-zA-Z0-9]{22})/);
    if (match) {
      playlistId = match[1];
    } else {
      playlistId = url.searchParams.get("playlist") || url.searchParams.get("id");
    }

    if (!playlistId) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid request. Provide a /playlist/:id or /user/:userId" }),
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
