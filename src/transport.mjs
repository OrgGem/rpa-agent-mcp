export const MAX_BYTES = 1024 * 1024;

export function nativeFrame(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (!body.length || body.length > MAX_BYTES) throw new Error('Native message exceeds the bridge limit');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

export class NativeDecoder {
  buffer = Buffer.alloc(0);
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (!length || length > MAX_BYTES) throw new Error('Invalid native frame length');
      if (this.buffer.length < 4 + length) break;
      messages.push(JSON.parse(this.buffer.subarray(4, 4 + length).toString('utf8')));
      this.buffer = this.buffer.subarray(4 + length);
    }
    return messages;
  }
}

export class LineDecoder {
  buffer = Buffer.alloc(0);
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages = [];
    let end;
    while ((end = this.buffer.indexOf(10)) >= 0) {
      if (end > MAX_BYTES) throw new Error('JSON line exceeds the bridge limit');
      const line = this.buffer.subarray(0, end).toString('utf8').trim();
      this.buffer = this.buffer.subarray(end + 1);
      if (line) messages.push(JSON.parse(line));
    }
    if (this.buffer.length > MAX_BYTES) throw new Error('JSON line exceeds the bridge limit');
    return messages;
  }
}
