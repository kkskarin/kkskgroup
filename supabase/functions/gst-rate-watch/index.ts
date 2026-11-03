// Removed: Official Notifications (Tally (Demo)) used too much of the Anthropic API. This stub answers every call
// without doing anything, and makes no Anthropic call.
Deno.serve(() => new Response(JSON.stringify({ code: "removed", message: "Official Notifications has been removed." }), { status: 410, headers: { "Content-Type": "application/json" } }));
