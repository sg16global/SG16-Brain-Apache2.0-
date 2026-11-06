// Reads a stream of JSON lines (one object per line) as it arrives. Used by the chat box to show an
// answer word by word. A line that is cut in half between two network packets is held until its end
// arrives; a line that cannot be read is skipped rather than breaking the whole answer.

export async function readNdjson<T = unknown>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const emit = (line: string) => {
    const text = line.trim();
    if (!text) return;
    try {
      onEvent(JSON.parse(text) as T);
    } catch {
      // an unreadable line is skipped
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      emit(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  emit(buffer + decoder.decode());
}
