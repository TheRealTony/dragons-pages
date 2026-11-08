// Cloudflare Worker: relays the Dragons page's requests to the league site and adds the
// header that lets a web page read the answer. It only forwards requests for league data.
const ALLOWED = "https://hockeylhai-stconstant.com/shark_modules/modules/Router.php?";

export default {
    async fetch(request) {
        const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
        if (request.method === "OPTIONS") return new Response(null, { headers: cors });
        if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });

        const target = new URL(request.url).searchParams.get("url") || "";
        if (!target.startsWith(ALLOWED)) return new Response("Forbidden", { status: 403, headers: cors });

        const upstream = await fetch(target, { headers: { "Accept": "application/json" } });
        return new Response(upstream.body, {
            status: upstream.status,
            headers: {
                ...cors,
                "Content-Type": upstream.headers.get("Content-Type") || "application/json",
                "Cache-Control": "public, max-age=60",
            },
        });
    },
};
