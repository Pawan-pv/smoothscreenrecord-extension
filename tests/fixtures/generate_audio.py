import wave
import math
import struct
import os

sample_rate = 44100
total_duration_sec = 20.0
total_samples = int(sample_rate * total_duration_sec)

# Gaps:
# 0 to 5s: tone
# 5s to 7s: silence (2s)
# 7s to 13s: tone
# 13s to 15s: silence (2s)
# 15s to 20s: tone

def is_silent(t_sec):
    if 5.0 <= t_sec < 7.0:
        return True
    if 13.0 <= t_sec < 15.0:
        return True
    return False

output_dir = os.path.dirname(os.path.abspath(__file__))
os.makedirs(output_dir, exist_ok=True)
output_path = os.path.join(output_dir, "test-audio.wav")

with wave.open(output_path, "w") as wav_file:
    wav_file.setnchannels(1)       # mono
    wav_file.setsampwidth(2)      # 16-bit
    wav_file.setframerate(sample_rate)

    frames = bytearray()
    for i in range(total_samples):
        t = i / sample_rate
        if is_silent(t):
            sample_val = 0
        else:
            # Multi-frequency tone for speech-like frequency spread
            f1 = 300.0
            f2 = 600.0
            f3 = 1200.0
            val = 0.5 * math.sin(2.0 * math.pi * f1 * t) + \
                  0.3 * math.sin(2.0 * math.pi * f2 * t) + \
                  0.2 * math.sin(2.0 * math.pi * f3 * t)
            # Apply slight volume envelope
            sample_val = int(val * 16000.0)
            sample_val = max(-32768, min(32767, sample_val))
        frames.extend(struct.pack("<h", sample_val))

    wav_file.writeframes(frames)

print(f"Generated {output_path} ({total_duration_sec}s, {total_samples} samples, {len(frames)} bytes)")
