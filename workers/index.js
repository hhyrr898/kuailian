export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "kuailian-worker" });
    }

    if (url.pathname.startsWith("/api/redirect/download")) {
      const platform = url.searchParams.get("p") || "windows";
      const map = {
        windows: "/download.html#windows",
        macos: "/download.html#macos",
        android: "/download.html#android",
        ios: "/download.html#ios"
      };
      const target = map[platform] || "/download.html";
      return Response.redirect(new URL(target, url.origin), 302);
    }

    return new Response("Worker OK", { status: 200 });
  }
};
