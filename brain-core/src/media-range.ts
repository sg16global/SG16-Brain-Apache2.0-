// Byte ranges for the site's media files (the homepage robot video).
//
// Safari (iPhone, iPad, Mac) only plays a video when the server answers
// "Range: bytes=…" requests with 206 Partial Content. If the static-asset
// layer already answers with 206, the response passes through untouched;
// if it answers 200 with the whole file, the requested slice is cut here.
// Only video/* and audio/* responses are touched.

const RANGE = /^bytes=(\d*)-(\d*)$/;

function isMedia(response: Response): boolean {
  return /^(video|audio)\//i.test(response.headers.get("content-type") ?? "");
}

export async function withByteRange(request: Request, response: Response): Promise<Response> {
  if (request.method !== "GET" || response.status !== 200 || !isMedia(response)) return response;
  const range = request.headers.get("range");
  if (!range) {
    const headers = new Headers(response.headers);
    headers.set("accept-ranges", "bytes");
    return new Response(response.body, { status: 200, headers });
  }
  const m = RANGE.exec(range.trim());
  const body = await response.arrayBuffer();
  const size = body.byteLength;
  let start: number, end: number;
  if (!m || (m[1] === "" && m[2] === "")) {
    start = NaN; end = NaN;
  } else if (m[1] === "") {
    // the last N bytes
    const n = Number(m[2]);
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  const headers = new Headers(response.headers);
  headers.set("accept-ranges", "bytes");
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    headers.set("content-range", `bytes */${size}`);
    headers.delete("content-length");
    return new Response(null, { status: 416, headers });
  }
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}
