export function pcmS16leToWav(
  pcm: Uint8Array,
  sampleRateHz: number,
  channels: number,
): Uint8Array {
  if (!Number.isInteger(sampleRateHz) || sampleRateHz <= 0)
    throw new RangeError("invalid sample rate");
  if (!Number.isInteger(channels) || channels <= 0 || channels > 8)
    throw new RangeError("invalid channel count");
  if (pcm.byteLength % (channels * 2) !== 0)
    throw new RangeError("PCM data is not sample aligned");
  const output = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(output.buffer);
  writeAscii(output, 0, "RIFF");
  view.setUint32(4, output.byteLength - 8, true);
  writeAscii(output, 8, "WAVE");
  writeAscii(output, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(output, 36, "data");
  view.setUint32(40, pcm.byteLength, true);
  output.set(pcm, 44);
  return output;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  target.set(new TextEncoder().encode(value), offset);
}
