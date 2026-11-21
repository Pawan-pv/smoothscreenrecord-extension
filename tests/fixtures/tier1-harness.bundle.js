var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// node_modules/omggif/omggif.js
var require_omggif = __commonJS((exports) => {
  function GifWriter(buf, width, height, gopts) {
    var p = 0;
    var gopts = gopts === undefined ? {} : gopts;
    var loop_count = gopts.loop === undefined ? null : gopts.loop;
    var global_palette = gopts.palette === undefined ? null : gopts.palette;
    if (width <= 0 || height <= 0 || width > 65535 || height > 65535)
      throw new Error("Width/Height invalid.");
    function check_palette_and_num_colors(palette) {
      var num_colors = palette.length;
      if (num_colors < 2 || num_colors > 256 || num_colors & num_colors - 1) {
        throw new Error("Invalid code/color length, must be power of 2 and 2 .. 256.");
      }
      return num_colors;
    }
    buf[p++] = 71;
    buf[p++] = 73;
    buf[p++] = 70;
    buf[p++] = 56;
    buf[p++] = 57;
    buf[p++] = 97;
    var gp_num_colors_pow2 = 0;
    var background = 0;
    if (global_palette !== null) {
      var gp_num_colors = check_palette_and_num_colors(global_palette);
      while (gp_num_colors >>= 1)
        ++gp_num_colors_pow2;
      gp_num_colors = 1 << gp_num_colors_pow2;
      --gp_num_colors_pow2;
      if (gopts.background !== undefined) {
        background = gopts.background;
        if (background >= gp_num_colors)
          throw new Error("Background index out of range.");
        if (background === 0)
          throw new Error("Background index explicitly passed as 0.");
      }
    }
    buf[p++] = width & 255;
    buf[p++] = width >> 8 & 255;
    buf[p++] = height & 255;
    buf[p++] = height >> 8 & 255;
    buf[p++] = (global_palette !== null ? 128 : 0) | gp_num_colors_pow2;
    buf[p++] = background;
    buf[p++] = 0;
    if (global_palette !== null) {
      for (var i = 0, il = global_palette.length;i < il; ++i) {
        var rgb = global_palette[i];
        buf[p++] = rgb >> 16 & 255;
        buf[p++] = rgb >> 8 & 255;
        buf[p++] = rgb & 255;
      }
    }
    if (loop_count !== null) {
      if (loop_count < 0 || loop_count > 65535)
        throw new Error("Loop count invalid.");
      buf[p++] = 33;
      buf[p++] = 255;
      buf[p++] = 11;
      buf[p++] = 78;
      buf[p++] = 69;
      buf[p++] = 84;
      buf[p++] = 83;
      buf[p++] = 67;
      buf[p++] = 65;
      buf[p++] = 80;
      buf[p++] = 69;
      buf[p++] = 50;
      buf[p++] = 46;
      buf[p++] = 48;
      buf[p++] = 3;
      buf[p++] = 1;
      buf[p++] = loop_count & 255;
      buf[p++] = loop_count >> 8 & 255;
      buf[p++] = 0;
    }
    var ended = false;
    this.addFrame = function(x, y, w, h, indexed_pixels, opts) {
      if (ended === true) {
        --p;
        ended = false;
      }
      opts = opts === undefined ? {} : opts;
      if (x < 0 || y < 0 || x > 65535 || y > 65535)
        throw new Error("x/y invalid.");
      if (w <= 0 || h <= 0 || w > 65535 || h > 65535)
        throw new Error("Width/Height invalid.");
      if (indexed_pixels.length < w * h)
        throw new Error("Not enough pixels for the frame size.");
      var using_local_palette = true;
      var palette = opts.palette;
      if (palette === undefined || palette === null) {
        using_local_palette = false;
        palette = global_palette;
      }
      if (palette === undefined || palette === null)
        throw new Error("Must supply either a local or global palette.");
      var num_colors = check_palette_and_num_colors(palette);
      var min_code_size = 0;
      while (num_colors >>= 1)
        ++min_code_size;
      num_colors = 1 << min_code_size;
      var delay = opts.delay === undefined ? 0 : opts.delay;
      var disposal = opts.disposal === undefined ? 0 : opts.disposal;
      if (disposal < 0 || disposal > 3)
        throw new Error("Disposal out of range.");
      var use_transparency = false;
      var transparent_index = 0;
      if (opts.transparent !== undefined && opts.transparent !== null) {
        use_transparency = true;
        transparent_index = opts.transparent;
        if (transparent_index < 0 || transparent_index >= num_colors)
          throw new Error("Transparent color index.");
      }
      if (disposal !== 0 || use_transparency || delay !== 0) {
        buf[p++] = 33;
        buf[p++] = 249;
        buf[p++] = 4;
        buf[p++] = disposal << 2 | (use_transparency === true ? 1 : 0);
        buf[p++] = delay & 255;
        buf[p++] = delay >> 8 & 255;
        buf[p++] = transparent_index;
        buf[p++] = 0;
      }
      buf[p++] = 44;
      buf[p++] = x & 255;
      buf[p++] = x >> 8 & 255;
      buf[p++] = y & 255;
      buf[p++] = y >> 8 & 255;
      buf[p++] = w & 255;
      buf[p++] = w >> 8 & 255;
      buf[p++] = h & 255;
      buf[p++] = h >> 8 & 255;
      buf[p++] = using_local_palette === true ? 128 | min_code_size - 1 : 0;
      if (using_local_palette === true) {
        for (var i2 = 0, il2 = palette.length;i2 < il2; ++i2) {
          var rgb2 = palette[i2];
          buf[p++] = rgb2 >> 16 & 255;
          buf[p++] = rgb2 >> 8 & 255;
          buf[p++] = rgb2 & 255;
        }
      }
      p = GifWriterOutputLZWCodeStream(buf, p, min_code_size < 2 ? 2 : min_code_size, indexed_pixels);
      return p;
    };
    this.end = function() {
      if (ended === false) {
        buf[p++] = 59;
        ended = true;
      }
      return p;
    };
    this.getOutputBuffer = function() {
      return buf;
    };
    this.setOutputBuffer = function(v) {
      buf = v;
    };
    this.getOutputBufferPosition = function() {
      return p;
    };
    this.setOutputBufferPosition = function(v) {
      p = v;
    };
  }
  function GifWriterOutputLZWCodeStream(buf, p, min_code_size, index_stream) {
    buf[p++] = min_code_size;
    var cur_subblock = p++;
    var clear_code = 1 << min_code_size;
    var code_mask = clear_code - 1;
    var eoi_code = clear_code + 1;
    var next_code = eoi_code + 1;
    var cur_code_size = min_code_size + 1;
    var cur_shift = 0;
    var cur = 0;
    function emit_bytes_to_buffer(bit_block_size) {
      while (cur_shift >= bit_block_size) {
        buf[p++] = cur & 255;
        cur >>= 8;
        cur_shift -= 8;
        if (p === cur_subblock + 256) {
          buf[cur_subblock] = 255;
          cur_subblock = p++;
        }
      }
    }
    function emit_code(c) {
      cur |= c << cur_shift;
      cur_shift += cur_code_size;
      emit_bytes_to_buffer(8);
    }
    var ib_code = index_stream[0] & code_mask;
    var code_table = {};
    emit_code(clear_code);
    for (var i = 1, il = index_stream.length;i < il; ++i) {
      var k = index_stream[i] & code_mask;
      var cur_key = ib_code << 8 | k;
      var cur_code = code_table[cur_key];
      if (cur_code === undefined) {
        cur |= ib_code << cur_shift;
        cur_shift += cur_code_size;
        while (cur_shift >= 8) {
          buf[p++] = cur & 255;
          cur >>= 8;
          cur_shift -= 8;
          if (p === cur_subblock + 256) {
            buf[cur_subblock] = 255;
            cur_subblock = p++;
          }
        }
        if (next_code === 4096) {
          emit_code(clear_code);
          next_code = eoi_code + 1;
          cur_code_size = min_code_size + 1;
          code_table = {};
        } else {
          if (next_code >= 1 << cur_code_size)
            ++cur_code_size;
          code_table[cur_key] = next_code++;
        }
        ib_code = k;
      } else {
        ib_code = cur_code;
      }
    }
    emit_code(ib_code);
    emit_code(eoi_code);
    emit_bytes_to_buffer(1);
    if (cur_subblock + 1 === p) {
      buf[cur_subblock] = 0;
    } else {
      buf[cur_subblock] = p - cur_subblock - 1;
      buf[p++] = 0;
    }
    return p;
  }
  function GifReader(buf) {
    var p = 0;
    if (buf[p++] !== 71 || buf[p++] !== 73 || buf[p++] !== 70 || buf[p++] !== 56 || (buf[p++] + 1 & 253) !== 56 || buf[p++] !== 97) {
      throw new Error("Invalid GIF 87a/89a header.");
    }
    var width = buf[p++] | buf[p++] << 8;
    var height = buf[p++] | buf[p++] << 8;
    var pf0 = buf[p++];
    var global_palette_flag = pf0 >> 7;
    var num_global_colors_pow2 = pf0 & 7;
    var num_global_colors = 1 << num_global_colors_pow2 + 1;
    var background = buf[p++];
    buf[p++];
    var global_palette_offset = null;
    var global_palette_size = null;
    if (global_palette_flag) {
      global_palette_offset = p;
      global_palette_size = num_global_colors;
      p += num_global_colors * 3;
    }
    var no_eof = true;
    var frames = [];
    var delay = 0;
    var transparent_index = null;
    var disposal = 0;
    var loop_count = null;
    this.width = width;
    this.height = height;
    while (no_eof && p < buf.length) {
      switch (buf[p++]) {
        case 33:
          switch (buf[p++]) {
            case 255:
              if (buf[p] !== 11 || buf[p + 1] == 78 && buf[p + 2] == 69 && buf[p + 3] == 84 && buf[p + 4] == 83 && buf[p + 5] == 67 && buf[p + 6] == 65 && buf[p + 7] == 80 && buf[p + 8] == 69 && buf[p + 9] == 50 && buf[p + 10] == 46 && buf[p + 11] == 48 && buf[p + 12] == 3 && buf[p + 13] == 1 && buf[p + 16] == 0) {
                p += 14;
                loop_count = buf[p++] | buf[p++] << 8;
                p++;
              } else {
                p += 12;
                while (true) {
                  var block_size = buf[p++];
                  if (!(block_size >= 0))
                    throw Error("Invalid block size");
                  if (block_size === 0)
                    break;
                  p += block_size;
                }
              }
              break;
            case 249:
              if (buf[p++] !== 4 || buf[p + 4] !== 0)
                throw new Error("Invalid graphics extension block.");
              var pf1 = buf[p++];
              delay = buf[p++] | buf[p++] << 8;
              transparent_index = buf[p++];
              if ((pf1 & 1) === 0)
                transparent_index = null;
              disposal = pf1 >> 2 & 7;
              p++;
              break;
            case 254:
              while (true) {
                var block_size = buf[p++];
                if (!(block_size >= 0))
                  throw Error("Invalid block size");
                if (block_size === 0)
                  break;
                p += block_size;
              }
              break;
            default:
              throw new Error("Unknown graphic control label: 0x" + buf[p - 1].toString(16));
          }
          break;
        case 44:
          var x = buf[p++] | buf[p++] << 8;
          var y = buf[p++] | buf[p++] << 8;
          var w = buf[p++] | buf[p++] << 8;
          var h = buf[p++] | buf[p++] << 8;
          var pf2 = buf[p++];
          var local_palette_flag = pf2 >> 7;
          var interlace_flag = pf2 >> 6 & 1;
          var num_local_colors_pow2 = pf2 & 7;
          var num_local_colors = 1 << num_local_colors_pow2 + 1;
          var palette_offset = global_palette_offset;
          var palette_size = global_palette_size;
          var has_local_palette = false;
          if (local_palette_flag) {
            var has_local_palette = true;
            palette_offset = p;
            palette_size = num_local_colors;
            p += num_local_colors * 3;
          }
          var data_offset = p;
          p++;
          while (true) {
            var block_size = buf[p++];
            if (!(block_size >= 0))
              throw Error("Invalid block size");
            if (block_size === 0)
              break;
            p += block_size;
          }
          frames.push({
            x,
            y,
            width: w,
            height: h,
            has_local_palette,
            palette_offset,
            palette_size,
            data_offset,
            data_length: p - data_offset,
            transparent_index,
            interlaced: !!interlace_flag,
            delay,
            disposal
          });
          break;
        case 59:
          no_eof = false;
          break;
        default:
          throw new Error("Unknown gif block: 0x" + buf[p - 1].toString(16));
          break;
      }
    }
    this.numFrames = function() {
      return frames.length;
    };
    this.loopCount = function() {
      return loop_count;
    };
    this.frameInfo = function(frame_num) {
      if (frame_num < 0 || frame_num >= frames.length)
        throw new Error("Frame index out of range.");
      return frames[frame_num];
    };
    this.decodeAndBlitFrameBGRA = function(frame_num, pixels) {
      var frame = this.frameInfo(frame_num);
      var num_pixels = frame.width * frame.height;
      var index_stream = new Uint8Array(num_pixels);
      GifReaderLZWOutputIndexStream(buf, frame.data_offset, index_stream, num_pixels);
      var palette_offset2 = frame.palette_offset;
      var trans = frame.transparent_index;
      if (trans === null)
        trans = 256;
      var framewidth = frame.width;
      var framestride = width - framewidth;
      var xleft = framewidth;
      var opbeg = (frame.y * width + frame.x) * 4;
      var opend = ((frame.y + frame.height) * width + frame.x) * 4;
      var op = opbeg;
      var scanstride = framestride * 4;
      if (frame.interlaced === true) {
        scanstride += width * 4 * 7;
      }
      var interlaceskip = 8;
      for (var i = 0, il = index_stream.length;i < il; ++i) {
        var index = index_stream[i];
        if (xleft === 0) {
          op += scanstride;
          xleft = framewidth;
          if (op >= opend) {
            scanstride = framestride * 4 + width * 4 * (interlaceskip - 1);
            op = opbeg + (framewidth + framestride) * (interlaceskip << 1);
            interlaceskip >>= 1;
          }
        }
        if (index === trans) {
          op += 4;
        } else {
          var r = buf[palette_offset2 + index * 3];
          var g = buf[palette_offset2 + index * 3 + 1];
          var b = buf[palette_offset2 + index * 3 + 2];
          pixels[op++] = b;
          pixels[op++] = g;
          pixels[op++] = r;
          pixels[op++] = 255;
        }
        --xleft;
      }
    };
    this.decodeAndBlitFrameRGBA = function(frame_num, pixels) {
      var frame = this.frameInfo(frame_num);
      var num_pixels = frame.width * frame.height;
      var index_stream = new Uint8Array(num_pixels);
      GifReaderLZWOutputIndexStream(buf, frame.data_offset, index_stream, num_pixels);
      var palette_offset2 = frame.palette_offset;
      var trans = frame.transparent_index;
      if (trans === null)
        trans = 256;
      var framewidth = frame.width;
      var framestride = width - framewidth;
      var xleft = framewidth;
      var opbeg = (frame.y * width + frame.x) * 4;
      var opend = ((frame.y + frame.height) * width + frame.x) * 4;
      var op = opbeg;
      var scanstride = framestride * 4;
      if (frame.interlaced === true) {
        scanstride += width * 4 * 7;
      }
      var interlaceskip = 8;
      for (var i = 0, il = index_stream.length;i < il; ++i) {
        var index = index_stream[i];
        if (xleft === 0) {
          op += scanstride;
          xleft = framewidth;
          if (op >= opend) {
            scanstride = framestride * 4 + width * 4 * (interlaceskip - 1);
            op = opbeg + (framewidth + framestride) * (interlaceskip << 1);
            interlaceskip >>= 1;
          }
        }
        if (index === trans) {
          op += 4;
        } else {
          var r = buf[palette_offset2 + index * 3];
          var g = buf[palette_offset2 + index * 3 + 1];
          var b = buf[palette_offset2 + index * 3 + 2];
          pixels[op++] = r;
          pixels[op++] = g;
          pixels[op++] = b;
          pixels[op++] = 255;
        }
        --xleft;
      }
    };
  }
  function GifReaderLZWOutputIndexStream(code_stream, p, output, output_length) {
    var min_code_size = code_stream[p++];
    var clear_code = 1 << min_code_size;
    var eoi_code = clear_code + 1;
    var next_code = eoi_code + 1;
    var cur_code_size = min_code_size + 1;
    var code_mask = (1 << cur_code_size) - 1;
    var cur_shift = 0;
    var cur = 0;
    var op = 0;
    var subblock_size = code_stream[p++];
    var code_table = new Int32Array(4096);
    var prev_code = null;
    while (true) {
      while (cur_shift < 16) {
        if (subblock_size === 0)
          break;
        cur |= code_stream[p++] << cur_shift;
        cur_shift += 8;
        if (subblock_size === 1) {
          subblock_size = code_stream[p++];
        } else {
          --subblock_size;
        }
      }
      if (cur_shift < cur_code_size)
        break;
      var code = cur & code_mask;
      cur >>= cur_code_size;
      cur_shift -= cur_code_size;
      if (code === clear_code) {
        next_code = eoi_code + 1;
        cur_code_size = min_code_size + 1;
        code_mask = (1 << cur_code_size) - 1;
        prev_code = null;
        continue;
      } else if (code === eoi_code) {
        break;
      }
      var chase_code = code < next_code ? code : prev_code;
      var chase_length = 0;
      var chase = chase_code;
      while (chase > clear_code) {
        chase = code_table[chase] >> 8;
        ++chase_length;
      }
      var k = chase;
      var op_end = op + chase_length + (chase_code !== code ? 1 : 0);
      if (op_end > output_length) {
        console.log("Warning, gif stream longer than expected.");
        return;
      }
      output[op++] = k;
      op += chase_length;
      var b = op;
      if (chase_code !== code)
        output[op++] = k;
      chase = chase_code;
      while (chase_length--) {
        chase = code_table[chase];
        output[--b] = chase & 255;
        chase >>= 8;
      }
      if (prev_code !== null && next_code < 4096) {
        code_table[next_code++] = prev_code << 8 | k;
        if (next_code >= code_mask + 1 && cur_code_size < 12) {
          ++cur_code_size;
          code_mask = code_mask << 1 | 1;
        }
      }
      prev_code = code;
    }
    if (op !== output_length) {
      console.log("Warning, gif stream shorter than expected.");
    }
    return output;
  }
  try {
    exports.GifWriter = GifWriter;
    exports.GifReader = GifReader;
  } catch (e) {}
});

// node_modules/mp4-muxer/build/mp4-muxer.mjs
var __accessCheck = (obj, member, msg) => {
  if (!member.has(obj))
    throw TypeError("Cannot " + msg);
};
var __privateGet = (obj, member, getter) => {
  __accessCheck(obj, member, "read from private field");
  return getter ? getter.call(obj) : member.get(obj);
};
var __privateAdd = (obj, member, value) => {
  if (member.has(obj))
    throw TypeError("Cannot add the same private member more than once");
  member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
};
var __privateSet = (obj, member, value, setter) => {
  __accessCheck(obj, member, "write to private field");
  setter ? setter.call(obj, value) : member.set(obj, value);
  return value;
};
var __privateWrapper = (obj, member, setter, getter) => ({
  set _(value) {
    __privateSet(obj, member, value, setter);
  },
  get _() {
    return __privateGet(obj, member, getter);
  }
});
var __privateMethod = (obj, member, method) => {
  __accessCheck(obj, member, "access private method");
  return method;
};
var bytes = new Uint8Array(8);
var view = new DataView(bytes.buffer);
var u8 = (value) => {
  return [(value % 256 + 256) % 256];
};
var u16 = (value) => {
  view.setUint16(0, value, false);
  return [bytes[0], bytes[1]];
};
var i16 = (value) => {
  view.setInt16(0, value, false);
  return [bytes[0], bytes[1]];
};
var u24 = (value) => {
  view.setUint32(0, value, false);
  return [bytes[1], bytes[2], bytes[3]];
};
var u32 = (value) => {
  view.setUint32(0, value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
};
var i32 = (value) => {
  view.setInt32(0, value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
};
var u64 = (value) => {
  view.setUint32(0, Math.floor(value / 2 ** 32), false);
  view.setUint32(4, value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7]];
};
var fixed_8_8 = (value) => {
  view.setInt16(0, 2 ** 8 * value, false);
  return [bytes[0], bytes[1]];
};
var fixed_16_16 = (value) => {
  view.setInt32(0, 2 ** 16 * value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
};
var fixed_2_30 = (value) => {
  view.setInt32(0, 2 ** 30 * value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
};
var ascii = (text, nullTerminated = false) => {
  let bytes2 = Array(text.length).fill(null).map((_, i) => text.charCodeAt(i));
  if (nullTerminated)
    bytes2.push(0);
  return bytes2;
};
var last = (arr) => {
  return arr && arr[arr.length - 1];
};
var lastPresentedSample = (samples) => {
  let result = undefined;
  for (let sample of samples) {
    if (!result || sample.presentationTimestamp > result.presentationTimestamp) {
      result = sample;
    }
  }
  return result;
};
var intoTimescale = (timeInSeconds, timescale, round = true) => {
  let value = timeInSeconds * timescale;
  return round ? Math.round(value) : value;
};
var rotationMatrix = (rotationInDegrees) => {
  let theta = rotationInDegrees * (Math.PI / 180);
  let cosTheta = Math.cos(theta);
  let sinTheta = Math.sin(theta);
  return [
    cosTheta,
    sinTheta,
    0,
    -sinTheta,
    cosTheta,
    0,
    0,
    0,
    1
  ];
};
var IDENTITY_MATRIX = rotationMatrix(0);
var matrixToBytes = (matrix) => {
  return [
    fixed_16_16(matrix[0]),
    fixed_16_16(matrix[1]),
    fixed_2_30(matrix[2]),
    fixed_16_16(matrix[3]),
    fixed_16_16(matrix[4]),
    fixed_2_30(matrix[5]),
    fixed_16_16(matrix[6]),
    fixed_16_16(matrix[7]),
    fixed_2_30(matrix[8])
  ];
};
var deepClone = (x) => {
  if (!x)
    return x;
  if (typeof x !== "object")
    return x;
  if (Array.isArray(x))
    return x.map(deepClone);
  return Object.fromEntries(Object.entries(x).map(([key, value]) => [key, deepClone(value)]));
};
var isU32 = (value) => {
  return value >= 0 && value < 2 ** 32;
};
var box = (type, contents, children) => ({
  type,
  contents: contents && new Uint8Array(contents.flat(10)),
  children
});
var fullBox = (type, version, flags, contents, children) => box(type, [u8(version), u24(flags), contents ?? []], children);
var ftyp = (details) => {
  let minorVersion = 512;
  if (details.fragmented)
    return box("ftyp", [
      ascii("iso5"),
      u32(minorVersion),
      ascii("iso5"),
      ascii("iso6"),
      ascii("mp41")
    ]);
  return box("ftyp", [
    ascii("isom"),
    u32(minorVersion),
    ascii("isom"),
    details.holdsAvc ? ascii("avc1") : [],
    ascii("mp41")
  ]);
};
var mdat = (reserveLargeSize) => ({ type: "mdat", largeSize: reserveLargeSize });
var free = (size) => ({ type: "free", size });
var moov = (tracks, creationTime, fragmented = false) => box("moov", null, [
  mvhd(creationTime, tracks),
  ...tracks.map((x) => trak(x, creationTime)),
  fragmented ? mvex(tracks) : null
]);
var mvhd = (creationTime, tracks) => {
  let duration = intoTimescale(Math.max(0, ...tracks.filter((x) => x.samples.length > 0).map((x) => {
    const lastSample = lastPresentedSample(x.samples);
    return lastSample.presentationTimestamp + lastSample.duration;
  })), GLOBAL_TIMESCALE);
  let nextTrackId = Math.max(...tracks.map((x) => x.id)) + 1;
  let needsU64 = !isU32(creationTime) || !isU32(duration);
  let u32OrU64 = needsU64 ? u64 : u32;
  return fullBox("mvhd", +needsU64, 0, [
    u32OrU64(creationTime),
    u32OrU64(creationTime),
    u32(GLOBAL_TIMESCALE),
    u32OrU64(duration),
    fixed_16_16(1),
    fixed_8_8(1),
    Array(10).fill(0),
    matrixToBytes(IDENTITY_MATRIX),
    Array(24).fill(0),
    u32(nextTrackId)
  ]);
};
var trak = (track, creationTime) => box("trak", null, [
  tkhd(track, creationTime),
  mdia(track, creationTime)
]);
var tkhd = (track, creationTime) => {
  let lastSample = lastPresentedSample(track.samples);
  let durationInGlobalTimescale = intoTimescale(lastSample ? lastSample.presentationTimestamp + lastSample.duration : 0, GLOBAL_TIMESCALE);
  let needsU64 = !isU32(creationTime) || !isU32(durationInGlobalTimescale);
  let u32OrU64 = needsU64 ? u64 : u32;
  let matrix;
  if (track.info.type === "video") {
    matrix = typeof track.info.rotation === "number" ? rotationMatrix(track.info.rotation) : track.info.rotation;
  } else {
    matrix = IDENTITY_MATRIX;
  }
  return fullBox("tkhd", +needsU64, 3, [
    u32OrU64(creationTime),
    u32OrU64(creationTime),
    u32(track.id),
    u32(0),
    u32OrU64(durationInGlobalTimescale),
    Array(8).fill(0),
    u16(0),
    u16(0),
    fixed_8_8(track.info.type === "audio" ? 1 : 0),
    u16(0),
    matrixToBytes(matrix),
    fixed_16_16(track.info.type === "video" ? track.info.width : 0),
    fixed_16_16(track.info.type === "video" ? track.info.height : 0)
  ]);
};
var mdia = (track, creationTime) => box("mdia", null, [
  mdhd(track, creationTime),
  hdlr(track.info.type === "video" ? "vide" : "soun"),
  minf(track)
]);
var mdhd = (track, creationTime) => {
  let lastSample = lastPresentedSample(track.samples);
  let localDuration = intoTimescale(lastSample ? lastSample.presentationTimestamp + lastSample.duration : 0, track.timescale);
  let needsU64 = !isU32(creationTime) || !isU32(localDuration);
  let u32OrU64 = needsU64 ? u64 : u32;
  return fullBox("mdhd", +needsU64, 0, [
    u32OrU64(creationTime),
    u32OrU64(creationTime),
    u32(track.timescale),
    u32OrU64(localDuration),
    u16(21956),
    u16(0)
  ]);
};
var hdlr = (componentSubtype) => fullBox("hdlr", 0, 0, [
  ascii("mhlr"),
  ascii(componentSubtype),
  u32(0),
  u32(0),
  u32(0),
  ascii("mp4-muxer-hdlr", true)
]);
var minf = (track) => box("minf", null, [
  track.info.type === "video" ? vmhd() : smhd(),
  dinf(),
  stbl(track)
]);
var vmhd = () => fullBox("vmhd", 0, 1, [
  u16(0),
  u16(0),
  u16(0),
  u16(0)
]);
var smhd = () => fullBox("smhd", 0, 0, [
  u16(0),
  u16(0)
]);
var dinf = () => box("dinf", null, [
  dref()
]);
var dref = () => fullBox("dref", 0, 0, [
  u32(1)
], [
  url()
]);
var url = () => fullBox("url ", 0, 1);
var stbl = (track) => {
  const needsCtts = track.compositionTimeOffsetTable.length > 1 || track.compositionTimeOffsetTable.some((x) => x.sampleCompositionTimeOffset !== 0);
  return box("stbl", null, [
    stsd(track),
    stts(track),
    stss(track),
    stsc(track),
    stsz(track),
    stco(track),
    needsCtts ? ctts(track) : null
  ]);
};
var stsd = (track) => fullBox("stsd", 0, 0, [
  u32(1)
], [
  track.info.type === "video" ? videoSampleDescription(VIDEO_CODEC_TO_BOX_NAME[track.info.codec], track) : soundSampleDescription(AUDIO_CODEC_TO_BOX_NAME[track.info.codec], track)
]);
var videoSampleDescription = (compressionType, track) => box(compressionType, [
  Array(6).fill(0),
  u16(1),
  u16(0),
  u16(0),
  Array(12).fill(0),
  u16(track.info.width),
  u16(track.info.height),
  u32(4718592),
  u32(4718592),
  u32(0),
  u16(1),
  Array(32).fill(0),
  u16(24),
  i16(65535)
], [
  VIDEO_CODEC_TO_CONFIGURATION_BOX[track.info.codec](track),
  track.info.decoderConfig.colorSpace ? colr(track) : null
]);
var COLOR_PRIMARIES_MAP = {
  bt709: 1,
  bt470bg: 5,
  smpte170m: 6
};
var TRANSFER_CHARACTERISTICS_MAP = {
  bt709: 1,
  smpte170m: 6,
  "iec61966-2-1": 13
};
var MATRIX_COEFFICIENTS_MAP = {
  rgb: 0,
  bt709: 1,
  bt470bg: 5,
  smpte170m: 6
};
var colr = (track) => box("colr", [
  ascii("nclx"),
  u16(COLOR_PRIMARIES_MAP[track.info.decoderConfig.colorSpace.primaries]),
  u16(TRANSFER_CHARACTERISTICS_MAP[track.info.decoderConfig.colorSpace.transfer]),
  u16(MATRIX_COEFFICIENTS_MAP[track.info.decoderConfig.colorSpace.matrix]),
  u8((track.info.decoderConfig.colorSpace.fullRange ? 1 : 0) << 7)
]);
var avcC = (track) => track.info.decoderConfig && box("avcC", [
  ...new Uint8Array(track.info.decoderConfig.description)
]);
var hvcC = (track) => track.info.decoderConfig && box("hvcC", [
  ...new Uint8Array(track.info.decoderConfig.description)
]);
var vpcC = (track) => {
  if (!track.info.decoderConfig) {
    return null;
  }
  let decoderConfig = track.info.decoderConfig;
  if (!decoderConfig.colorSpace) {
    throw new Error(`'colorSpace' is required in the decoder config for VP9.`);
  }
  let parts = decoderConfig.codec.split(".");
  let profile = Number(parts[1]);
  let level = Number(parts[2]);
  let bitDepth = Number(parts[3]);
  let chromaSubsampling = 0;
  let thirdByte = (bitDepth << 4) + (chromaSubsampling << 1) + Number(decoderConfig.colorSpace.fullRange);
  let colourPrimaries = 2;
  let transferCharacteristics = 2;
  let matrixCoefficients = 2;
  return fullBox("vpcC", 1, 0, [
    u8(profile),
    u8(level),
    u8(thirdByte),
    u8(colourPrimaries),
    u8(transferCharacteristics),
    u8(matrixCoefficients),
    u16(0)
  ]);
};
var av1C = () => {
  let marker = 1;
  let version = 1;
  let firstByte = (marker << 7) + version;
  return box("av1C", [
    firstByte,
    0,
    0,
    0
  ]);
};
var soundSampleDescription = (compressionType, track) => box(compressionType, [
  Array(6).fill(0),
  u16(1),
  u16(0),
  u16(0),
  u32(0),
  u16(track.info.numberOfChannels),
  u16(16),
  u16(0),
  u16(0),
  fixed_16_16(track.info.sampleRate)
], [
  AUDIO_CODEC_TO_CONFIGURATION_BOX[track.info.codec](track)
]);
var esds = (track) => {
  let description = new Uint8Array(track.info.decoderConfig.description);
  return fullBox("esds", 0, 0, [
    u32(58753152),
    u8(32 + description.byteLength),
    u16(1),
    u8(0),
    u32(75530368),
    u8(18 + description.byteLength),
    u8(64),
    u8(21),
    u24(0),
    u32(130071),
    u32(130071),
    u32(92307584),
    u8(description.byteLength),
    ...description,
    u32(109084800),
    u8(1),
    u8(2)
  ]);
};
var dOps = (track) => {
  let preskip = 3840;
  let gain = 0;
  const description = track.info.decoderConfig?.description;
  if (description) {
    if (description.byteLength < 18) {
      throw new TypeError("Invalid decoder description provided for Opus; must be at least 18 bytes long.");
    }
    const view2 = ArrayBuffer.isView(description) ? new DataView(description.buffer, description.byteOffset, description.byteLength) : new DataView(description);
    preskip = view2.getUint16(10, true);
    gain = view2.getInt16(14, true);
  }
  return box("dOps", [
    u8(0),
    u8(track.info.numberOfChannels),
    u16(preskip),
    u32(track.info.sampleRate),
    fixed_8_8(gain),
    u8(0)
  ]);
};
var stts = (track) => {
  return fullBox("stts", 0, 0, [
    u32(track.timeToSampleTable.length),
    track.timeToSampleTable.map((x) => [
      u32(x.sampleCount),
      u32(x.sampleDelta)
    ])
  ]);
};
var stss = (track) => {
  if (track.samples.every((x) => x.type === "key"))
    return null;
  let keySamples = [...track.samples.entries()].filter(([, sample]) => sample.type === "key");
  return fullBox("stss", 0, 0, [
    u32(keySamples.length),
    keySamples.map(([index]) => u32(index + 1))
  ]);
};
var stsc = (track) => {
  return fullBox("stsc", 0, 0, [
    u32(track.compactlyCodedChunkTable.length),
    track.compactlyCodedChunkTable.map((x) => [
      u32(x.firstChunk),
      u32(x.samplesPerChunk),
      u32(1)
    ])
  ]);
};
var stsz = (track) => fullBox("stsz", 0, 0, [
  u32(0),
  u32(track.samples.length),
  track.samples.map((x) => u32(x.size))
]);
var stco = (track) => {
  if (track.finalizedChunks.length > 0 && last(track.finalizedChunks).offset >= 2 ** 32) {
    return fullBox("co64", 0, 0, [
      u32(track.finalizedChunks.length),
      track.finalizedChunks.map((x) => u64(x.offset))
    ]);
  }
  return fullBox("stco", 0, 0, [
    u32(track.finalizedChunks.length),
    track.finalizedChunks.map((x) => u32(x.offset))
  ]);
};
var ctts = (track) => {
  return fullBox("ctts", 0, 0, [
    u32(track.compositionTimeOffsetTable.length),
    track.compositionTimeOffsetTable.map((x) => [
      u32(x.sampleCount),
      u32(x.sampleCompositionTimeOffset)
    ])
  ]);
};
var mvex = (tracks) => {
  return box("mvex", null, tracks.map(trex));
};
var trex = (track) => {
  return fullBox("trex", 0, 0, [
    u32(track.id),
    u32(1),
    u32(0),
    u32(0),
    u32(0)
  ]);
};
var moof = (sequenceNumber, tracks) => {
  return box("moof", null, [
    mfhd(sequenceNumber),
    ...tracks.map(traf)
  ]);
};
var mfhd = (sequenceNumber) => {
  return fullBox("mfhd", 0, 0, [
    u32(sequenceNumber)
  ]);
};
var fragmentSampleFlags = (sample) => {
  let byte1 = 0;
  let byte2 = 0;
  let byte3 = 0;
  let byte4 = 0;
  let sampleIsDifferenceSample = sample.type === "delta";
  byte2 |= +sampleIsDifferenceSample;
  if (sampleIsDifferenceSample) {
    byte1 |= 1;
  } else {
    byte1 |= 2;
  }
  return byte1 << 24 | byte2 << 16 | byte3 << 8 | byte4;
};
var traf = (track) => {
  return box("traf", null, [
    tfhd(track),
    tfdt(track),
    trun(track)
  ]);
};
var tfhd = (track) => {
  let tfFlags = 0;
  tfFlags |= 8;
  tfFlags |= 16;
  tfFlags |= 32;
  tfFlags |= 131072;
  let referenceSample = track.currentChunk.samples[1] ?? track.currentChunk.samples[0];
  let referenceSampleInfo = {
    duration: referenceSample.timescaleUnitsToNextSample,
    size: referenceSample.size,
    flags: fragmentSampleFlags(referenceSample)
  };
  return fullBox("tfhd", 0, tfFlags, [
    u32(track.id),
    u32(referenceSampleInfo.duration),
    u32(referenceSampleInfo.size),
    u32(referenceSampleInfo.flags)
  ]);
};
var tfdt = (track) => {
  return fullBox("tfdt", 1, 0, [
    u64(intoTimescale(track.currentChunk.startTimestamp, track.timescale))
  ]);
};
var trun = (track) => {
  let allSampleDurations = track.currentChunk.samples.map((x) => x.timescaleUnitsToNextSample);
  let allSampleSizes = track.currentChunk.samples.map((x) => x.size);
  let allSampleFlags = track.currentChunk.samples.map(fragmentSampleFlags);
  let allSampleCompositionTimeOffsets = track.currentChunk.samples.map((x) => intoTimescale(x.presentationTimestamp - x.decodeTimestamp, track.timescale));
  let uniqueSampleDurations = new Set(allSampleDurations);
  let uniqueSampleSizes = new Set(allSampleSizes);
  let uniqueSampleFlags = new Set(allSampleFlags);
  let uniqueSampleCompositionTimeOffsets = new Set(allSampleCompositionTimeOffsets);
  let firstSampleFlagsPresent = uniqueSampleFlags.size === 2 && allSampleFlags[0] !== allSampleFlags[1];
  let sampleDurationPresent = uniqueSampleDurations.size > 1;
  let sampleSizePresent = uniqueSampleSizes.size > 1;
  let sampleFlagsPresent = !firstSampleFlagsPresent && uniqueSampleFlags.size > 1;
  let sampleCompositionTimeOffsetsPresent = uniqueSampleCompositionTimeOffsets.size > 1 || [...uniqueSampleCompositionTimeOffsets].some((x) => x !== 0);
  let flags = 0;
  flags |= 1;
  flags |= 4 * +firstSampleFlagsPresent;
  flags |= 256 * +sampleDurationPresent;
  flags |= 512 * +sampleSizePresent;
  flags |= 1024 * +sampleFlagsPresent;
  flags |= 2048 * +sampleCompositionTimeOffsetsPresent;
  return fullBox("trun", 1, flags, [
    u32(track.currentChunk.samples.length),
    u32(track.currentChunk.offset - track.currentChunk.moofOffset || 0),
    firstSampleFlagsPresent ? u32(allSampleFlags[0]) : [],
    track.currentChunk.samples.map((_, i) => [
      sampleDurationPresent ? u32(allSampleDurations[i]) : [],
      sampleSizePresent ? u32(allSampleSizes[i]) : [],
      sampleFlagsPresent ? u32(allSampleFlags[i]) : [],
      sampleCompositionTimeOffsetsPresent ? i32(allSampleCompositionTimeOffsets[i]) : []
    ])
  ]);
};
var mfra = (tracks) => {
  return box("mfra", null, [
    ...tracks.map(tfra),
    mfro()
  ]);
};
var tfra = (track, trackIndex) => {
  let version = 1;
  return fullBox("tfra", version, 0, [
    u32(track.id),
    u32(63),
    u32(track.finalizedChunks.length),
    track.finalizedChunks.map((chunk) => [
      u64(intoTimescale(chunk.startTimestamp, track.timescale)),
      u64(chunk.moofOffset),
      u32(trackIndex + 1),
      u32(1),
      u32(1)
    ])
  ]);
};
var mfro = () => {
  return fullBox("mfro", 0, 0, [
    u32(0)
  ]);
};
var VIDEO_CODEC_TO_BOX_NAME = {
  avc: "avc1",
  hevc: "hvc1",
  vp9: "vp09",
  av1: "av01"
};
var VIDEO_CODEC_TO_CONFIGURATION_BOX = {
  avc: avcC,
  hevc: hvcC,
  vp9: vpcC,
  av1: av1C
};
var AUDIO_CODEC_TO_BOX_NAME = {
  aac: "mp4a",
  opus: "Opus"
};
var AUDIO_CODEC_TO_CONFIGURATION_BOX = {
  aac: esds,
  opus: dOps
};
var isTarget = Symbol("isTarget");
var Target = class {
};
var ArrayBufferTarget = class extends Target {
  constructor() {
    super(...arguments);
    this.buffer = null;
  }
};
var StreamTarget = class extends Target {
  constructor(options) {
    super();
    this.options = options;
    if (typeof options !== "object") {
      throw new TypeError("StreamTarget requires an options object to be passed to its constructor.");
    }
    if (options.onData) {
      if (typeof options.onData !== "function") {
        throw new TypeError("options.onData, when provided, must be a function.");
      }
      if (options.onData.length < 2) {
        throw new TypeError("options.onData, when provided, must be a function that takes in at least two arguments (data and position). Ignoring the position argument, which specifies the byte offset at which the data is to be written, can lead to broken outputs.");
      }
    }
    if (options.chunked !== undefined && typeof options.chunked !== "boolean") {
      throw new TypeError("options.chunked, when provided, must be a boolean.");
    }
    if (options.chunkSize !== undefined && (!Number.isInteger(options.chunkSize) || options.chunkSize < 1024)) {
      throw new TypeError("options.chunkSize, when provided, must be an integer and not smaller than 1024.");
    }
  }
};
var FileSystemWritableFileStreamTarget = class extends Target {
  constructor(stream, options) {
    super();
    this.stream = stream;
    this.options = options;
    if (!(stream instanceof FileSystemWritableFileStream)) {
      throw new TypeError("FileSystemWritableFileStreamTarget requires a FileSystemWritableFileStream instance.");
    }
    if (options !== undefined && typeof options !== "object") {
      throw new TypeError("FileSystemWritableFileStreamTarget's options, when provided, must be an object.");
    }
    if (options) {
      if (options.chunkSize !== undefined && (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0)) {
        throw new TypeError("options.chunkSize, when provided, must be a positive integer");
      }
    }
  }
};
var _helper;
var _helperView;
var Writer = class {
  constructor() {
    this.pos = 0;
    __privateAdd(this, _helper, new Uint8Array(8));
    __privateAdd(this, _helperView, new DataView(__privateGet(this, _helper).buffer));
    this.offsets = /* @__PURE__ */ new WeakMap;
  }
  seek(newPos) {
    this.pos = newPos;
  }
  writeU32(value) {
    __privateGet(this, _helperView).setUint32(0, value, false);
    this.write(__privateGet(this, _helper).subarray(0, 4));
  }
  writeU64(value) {
    __privateGet(this, _helperView).setUint32(0, Math.floor(value / 2 ** 32), false);
    __privateGet(this, _helperView).setUint32(4, value, false);
    this.write(__privateGet(this, _helper).subarray(0, 8));
  }
  writeAscii(text) {
    for (let i = 0;i < text.length; i++) {
      __privateGet(this, _helperView).setUint8(i % 8, text.charCodeAt(i));
      if (i % 8 === 7)
        this.write(__privateGet(this, _helper));
    }
    if (text.length % 8 !== 0) {
      this.write(__privateGet(this, _helper).subarray(0, text.length % 8));
    }
  }
  writeBox(box2) {
    this.offsets.set(box2, this.pos);
    if (box2.contents && !box2.children) {
      this.writeBoxHeader(box2, box2.size ?? box2.contents.byteLength + 8);
      this.write(box2.contents);
    } else {
      let startPos = this.pos;
      this.writeBoxHeader(box2, 0);
      if (box2.contents)
        this.write(box2.contents);
      if (box2.children) {
        for (let child of box2.children)
          if (child)
            this.writeBox(child);
      }
      let endPos = this.pos;
      let size = box2.size ?? endPos - startPos;
      this.seek(startPos);
      this.writeBoxHeader(box2, size);
      this.seek(endPos);
    }
  }
  writeBoxHeader(box2, size) {
    this.writeU32(box2.largeSize ? 1 : size);
    this.writeAscii(box2.type);
    if (box2.largeSize)
      this.writeU64(size);
  }
  measureBoxHeader(box2) {
    return 8 + (box2.largeSize ? 8 : 0);
  }
  patchBox(box2) {
    let endPos = this.pos;
    this.seek(this.offsets.get(box2));
    this.writeBox(box2);
    this.seek(endPos);
  }
  measureBox(box2) {
    if (box2.contents && !box2.children) {
      let headerSize = this.measureBoxHeader(box2);
      return headerSize + box2.contents.byteLength;
    } else {
      let result = this.measureBoxHeader(box2);
      if (box2.contents)
        result += box2.contents.byteLength;
      if (box2.children) {
        for (let child of box2.children)
          if (child)
            result += this.measureBox(child);
      }
      return result;
    }
  }
};
_helper = new WeakMap;
_helperView = new WeakMap;
var _target;
var _buffer;
var _bytes;
var _maxPos;
var _ensureSize;
var ensureSize_fn;
var ArrayBufferTargetWriter = class extends Writer {
  constructor(target) {
    super();
    __privateAdd(this, _ensureSize);
    __privateAdd(this, _target, undefined);
    __privateAdd(this, _buffer, new ArrayBuffer(2 ** 16));
    __privateAdd(this, _bytes, new Uint8Array(__privateGet(this, _buffer)));
    __privateAdd(this, _maxPos, 0);
    __privateSet(this, _target, target);
  }
  write(data) {
    __privateMethod(this, _ensureSize, ensureSize_fn).call(this, this.pos + data.byteLength);
    __privateGet(this, _bytes).set(data, this.pos);
    this.pos += data.byteLength;
    __privateSet(this, _maxPos, Math.max(__privateGet(this, _maxPos), this.pos));
  }
  finalize() {
    __privateMethod(this, _ensureSize, ensureSize_fn).call(this, this.pos);
    __privateGet(this, _target).buffer = __privateGet(this, _buffer).slice(0, Math.max(__privateGet(this, _maxPos), this.pos));
  }
};
_target = new WeakMap;
_buffer = new WeakMap;
_bytes = new WeakMap;
_maxPos = new WeakMap;
_ensureSize = new WeakSet;
ensureSize_fn = function(size) {
  let newLength = __privateGet(this, _buffer).byteLength;
  while (newLength < size)
    newLength *= 2;
  if (newLength === __privateGet(this, _buffer).byteLength)
    return;
  let newBuffer = new ArrayBuffer(newLength);
  let newBytes = new Uint8Array(newBuffer);
  newBytes.set(__privateGet(this, _bytes), 0);
  __privateSet(this, _buffer, newBuffer);
  __privateSet(this, _bytes, newBytes);
};
var DEFAULT_CHUNK_SIZE = 2 ** 24;
var MAX_CHUNKS_AT_ONCE = 2;
var _target2;
var _sections;
var _chunked;
var _chunkSize;
var _chunks;
var _writeDataIntoChunks;
var writeDataIntoChunks_fn;
var _insertSectionIntoChunk;
var insertSectionIntoChunk_fn;
var _createChunk;
var createChunk_fn;
var _flushChunks;
var flushChunks_fn;
var StreamTargetWriter = class extends Writer {
  constructor(target) {
    super();
    __privateAdd(this, _writeDataIntoChunks);
    __privateAdd(this, _insertSectionIntoChunk);
    __privateAdd(this, _createChunk);
    __privateAdd(this, _flushChunks);
    __privateAdd(this, _target2, undefined);
    __privateAdd(this, _sections, []);
    __privateAdd(this, _chunked, undefined);
    __privateAdd(this, _chunkSize, undefined);
    __privateAdd(this, _chunks, []);
    __privateSet(this, _target2, target);
    __privateSet(this, _chunked, target.options?.chunked ?? false);
    __privateSet(this, _chunkSize, target.options?.chunkSize ?? DEFAULT_CHUNK_SIZE);
  }
  write(data) {
    __privateGet(this, _sections).push({
      data: data.slice(),
      start: this.pos
    });
    this.pos += data.byteLength;
  }
  flush() {
    if (__privateGet(this, _sections).length === 0)
      return;
    let chunks = [];
    let sorted = [...__privateGet(this, _sections)].sort((a, b) => a.start - b.start);
    chunks.push({
      start: sorted[0].start,
      size: sorted[0].data.byteLength
    });
    for (let i = 1;i < sorted.length; i++) {
      let lastChunk = chunks[chunks.length - 1];
      let section = sorted[i];
      if (section.start <= lastChunk.start + lastChunk.size) {
        lastChunk.size = Math.max(lastChunk.size, section.start + section.data.byteLength - lastChunk.start);
      } else {
        chunks.push({
          start: section.start,
          size: section.data.byteLength
        });
      }
    }
    for (let chunk of chunks) {
      chunk.data = new Uint8Array(chunk.size);
      for (let section of __privateGet(this, _sections)) {
        if (chunk.start <= section.start && section.start < chunk.start + chunk.size) {
          chunk.data.set(section.data, section.start - chunk.start);
        }
      }
      if (__privateGet(this, _chunked)) {
        __privateMethod(this, _writeDataIntoChunks, writeDataIntoChunks_fn).call(this, chunk.data, chunk.start);
        __privateMethod(this, _flushChunks, flushChunks_fn).call(this);
      } else {
        __privateGet(this, _target2).options.onData?.(chunk.data, chunk.start);
      }
    }
    __privateGet(this, _sections).length = 0;
  }
  finalize() {
    if (__privateGet(this, _chunked)) {
      __privateMethod(this, _flushChunks, flushChunks_fn).call(this, true);
    }
  }
};
_target2 = new WeakMap;
_sections = new WeakMap;
_chunked = new WeakMap;
_chunkSize = new WeakMap;
_chunks = new WeakMap;
_writeDataIntoChunks = new WeakSet;
writeDataIntoChunks_fn = function(data, position) {
  let chunkIndex = __privateGet(this, _chunks).findIndex((x) => x.start <= position && position < x.start + __privateGet(this, _chunkSize));
  if (chunkIndex === -1)
    chunkIndex = __privateMethod(this, _createChunk, createChunk_fn).call(this, position);
  let chunk = __privateGet(this, _chunks)[chunkIndex];
  let relativePosition = position - chunk.start;
  let toWrite = data.subarray(0, Math.min(__privateGet(this, _chunkSize) - relativePosition, data.byteLength));
  chunk.data.set(toWrite, relativePosition);
  let section = {
    start: relativePosition,
    end: relativePosition + toWrite.byteLength
  };
  __privateMethod(this, _insertSectionIntoChunk, insertSectionIntoChunk_fn).call(this, chunk, section);
  if (chunk.written[0].start === 0 && chunk.written[0].end === __privateGet(this, _chunkSize)) {
    chunk.shouldFlush = true;
  }
  if (__privateGet(this, _chunks).length > MAX_CHUNKS_AT_ONCE) {
    for (let i = 0;i < __privateGet(this, _chunks).length - 1; i++) {
      __privateGet(this, _chunks)[i].shouldFlush = true;
    }
    __privateMethod(this, _flushChunks, flushChunks_fn).call(this);
  }
  if (toWrite.byteLength < data.byteLength) {
    __privateMethod(this, _writeDataIntoChunks, writeDataIntoChunks_fn).call(this, data.subarray(toWrite.byteLength), position + toWrite.byteLength);
  }
};
_insertSectionIntoChunk = new WeakSet;
insertSectionIntoChunk_fn = function(chunk, section) {
  let low = 0;
  let high = chunk.written.length - 1;
  let index = -1;
  while (low <= high) {
    let mid = Math.floor(low + (high - low + 1) / 2);
    if (chunk.written[mid].start <= section.start) {
      low = mid + 1;
      index = mid;
    } else {
      high = mid - 1;
    }
  }
  chunk.written.splice(index + 1, 0, section);
  if (index === -1 || chunk.written[index].end < section.start)
    index++;
  while (index < chunk.written.length - 1 && chunk.written[index].end >= chunk.written[index + 1].start) {
    chunk.written[index].end = Math.max(chunk.written[index].end, chunk.written[index + 1].end);
    chunk.written.splice(index + 1, 1);
  }
};
_createChunk = new WeakSet;
createChunk_fn = function(includesPosition) {
  let start = Math.floor(includesPosition / __privateGet(this, _chunkSize)) * __privateGet(this, _chunkSize);
  let chunk = {
    start,
    data: new Uint8Array(__privateGet(this, _chunkSize)),
    written: [],
    shouldFlush: false
  };
  __privateGet(this, _chunks).push(chunk);
  __privateGet(this, _chunks).sort((a, b) => a.start - b.start);
  return __privateGet(this, _chunks).indexOf(chunk);
};
_flushChunks = new WeakSet;
flushChunks_fn = function(force = false) {
  for (let i = 0;i < __privateGet(this, _chunks).length; i++) {
    let chunk = __privateGet(this, _chunks)[i];
    if (!chunk.shouldFlush && !force)
      continue;
    for (let section of chunk.written) {
      __privateGet(this, _target2).options.onData?.(chunk.data.subarray(section.start, section.end), chunk.start + section.start);
    }
    __privateGet(this, _chunks).splice(i--, 1);
  }
};
var FileSystemWritableFileStreamTargetWriter = class extends StreamTargetWriter {
  constructor(target) {
    super(new StreamTarget({
      onData: (data, position) => target.stream.write({
        type: "write",
        data,
        position
      }),
      chunked: true,
      chunkSize: target.options?.chunkSize
    }));
  }
};
var GLOBAL_TIMESCALE = 1000;
var SUPPORTED_VIDEO_CODECS = ["avc", "hevc", "vp9", "av1"];
var SUPPORTED_AUDIO_CODECS = ["aac", "opus"];
var TIMESTAMP_OFFSET = 2082844800;
var FIRST_TIMESTAMP_BEHAVIORS = ["strict", "offset", "cross-track-offset"];
var _options;
var _writer;
var _ftypSize;
var _mdat;
var _videoTrack;
var _audioTrack;
var _creationTime;
var _finalizedChunks;
var _nextFragmentNumber;
var _videoSampleQueue;
var _audioSampleQueue;
var _finalized;
var _validateOptions;
var validateOptions_fn;
var _writeHeader;
var writeHeader_fn;
var _computeMoovSizeUpperBound;
var computeMoovSizeUpperBound_fn;
var _prepareTracks;
var prepareTracks_fn;
var _generateMpeg4AudioSpecificConfig;
var generateMpeg4AudioSpecificConfig_fn;
var _createSampleForTrack;
var createSampleForTrack_fn;
var _addSampleToTrack;
var addSampleToTrack_fn;
var _validateTimestamp;
var validateTimestamp_fn;
var _finalizeCurrentChunk;
var finalizeCurrentChunk_fn;
var _finalizeFragment;
var finalizeFragment_fn;
var _maybeFlushStreamingTargetWriter;
var maybeFlushStreamingTargetWriter_fn;
var _ensureNotFinalized;
var ensureNotFinalized_fn;
var Muxer = class {
  constructor(options) {
    __privateAdd(this, _validateOptions);
    __privateAdd(this, _writeHeader);
    __privateAdd(this, _computeMoovSizeUpperBound);
    __privateAdd(this, _prepareTracks);
    __privateAdd(this, _generateMpeg4AudioSpecificConfig);
    __privateAdd(this, _createSampleForTrack);
    __privateAdd(this, _addSampleToTrack);
    __privateAdd(this, _validateTimestamp);
    __privateAdd(this, _finalizeCurrentChunk);
    __privateAdd(this, _finalizeFragment);
    __privateAdd(this, _maybeFlushStreamingTargetWriter);
    __privateAdd(this, _ensureNotFinalized);
    __privateAdd(this, _options, undefined);
    __privateAdd(this, _writer, undefined);
    __privateAdd(this, _ftypSize, undefined);
    __privateAdd(this, _mdat, undefined);
    __privateAdd(this, _videoTrack, null);
    __privateAdd(this, _audioTrack, null);
    __privateAdd(this, _creationTime, Math.floor(Date.now() / 1000) + TIMESTAMP_OFFSET);
    __privateAdd(this, _finalizedChunks, []);
    __privateAdd(this, _nextFragmentNumber, 1);
    __privateAdd(this, _videoSampleQueue, []);
    __privateAdd(this, _audioSampleQueue, []);
    __privateAdd(this, _finalized, false);
    __privateMethod(this, _validateOptions, validateOptions_fn).call(this, options);
    options.video = deepClone(options.video);
    options.audio = deepClone(options.audio);
    options.fastStart = deepClone(options.fastStart);
    this.target = options.target;
    __privateSet(this, _options, {
      firstTimestampBehavior: "strict",
      ...options
    });
    if (options.target instanceof ArrayBufferTarget) {
      __privateSet(this, _writer, new ArrayBufferTargetWriter(options.target));
    } else if (options.target instanceof StreamTarget) {
      __privateSet(this, _writer, new StreamTargetWriter(options.target));
    } else if (options.target instanceof FileSystemWritableFileStreamTarget) {
      __privateSet(this, _writer, new FileSystemWritableFileStreamTargetWriter(options.target));
    } else {
      throw new Error(`Invalid target: ${options.target}`);
    }
    __privateMethod(this, _prepareTracks, prepareTracks_fn).call(this);
    __privateMethod(this, _writeHeader, writeHeader_fn).call(this);
  }
  addVideoChunk(sample, meta, timestamp, compositionTimeOffset) {
    if (!(sample instanceof EncodedVideoChunk)) {
      throw new TypeError("addVideoChunk's first argument (sample) must be of type EncodedVideoChunk.");
    }
    if (meta && typeof meta !== "object") {
      throw new TypeError("addVideoChunk's second argument (meta), when provided, must be an object.");
    }
    if (timestamp !== undefined && (!Number.isFinite(timestamp) || timestamp < 0)) {
      throw new TypeError("addVideoChunk's third argument (timestamp), when provided, must be a non-negative real number.");
    }
    if (compositionTimeOffset !== undefined && !Number.isFinite(compositionTimeOffset)) {
      throw new TypeError("addVideoChunk's fourth argument (compositionTimeOffset), when provided, must be a real number.");
    }
    let data = new Uint8Array(sample.byteLength);
    sample.copyTo(data);
    this.addVideoChunkRaw(data, sample.type, timestamp ?? sample.timestamp, sample.duration, meta, compositionTimeOffset);
  }
  addVideoChunkRaw(data, type, timestamp, duration, meta, compositionTimeOffset) {
    if (!(data instanceof Uint8Array)) {
      throw new TypeError("addVideoChunkRaw's first argument (data) must be an instance of Uint8Array.");
    }
    if (type !== "key" && type !== "delta") {
      throw new TypeError("addVideoChunkRaw's second argument (type) must be either 'key' or 'delta'.");
    }
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new TypeError("addVideoChunkRaw's third argument (timestamp) must be a non-negative real number.");
    }
    if (!Number.isFinite(duration) || duration < 0) {
      throw new TypeError("addVideoChunkRaw's fourth argument (duration) must be a non-negative real number.");
    }
    if (meta && typeof meta !== "object") {
      throw new TypeError("addVideoChunkRaw's fifth argument (meta), when provided, must be an object.");
    }
    if (compositionTimeOffset !== undefined && !Number.isFinite(compositionTimeOffset)) {
      throw new TypeError("addVideoChunkRaw's sixth argument (compositionTimeOffset), when provided, must be a real number.");
    }
    __privateMethod(this, _ensureNotFinalized, ensureNotFinalized_fn).call(this);
    if (!__privateGet(this, _options).video)
      throw new Error("No video track declared.");
    if (typeof __privateGet(this, _options).fastStart === "object" && __privateGet(this, _videoTrack).samples.length === __privateGet(this, _options).fastStart.expectedVideoChunks) {
      throw new Error(`Cannot add more video chunks than specified in 'fastStart' (${__privateGet(this, _options).fastStart.expectedVideoChunks}).`);
    }
    let videoSample = __privateMethod(this, _createSampleForTrack, createSampleForTrack_fn).call(this, __privateGet(this, _videoTrack), data, type, timestamp, duration, meta, compositionTimeOffset);
    if (__privateGet(this, _options).fastStart === "fragmented" && __privateGet(this, _audioTrack)) {
      while (__privateGet(this, _audioSampleQueue).length > 0 && __privateGet(this, _audioSampleQueue)[0].decodeTimestamp <= videoSample.decodeTimestamp) {
        let audioSample = __privateGet(this, _audioSampleQueue).shift();
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
      }
      if (videoSample.decodeTimestamp <= __privateGet(this, _audioTrack).lastDecodeTimestamp) {
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
      } else {
        __privateGet(this, _videoSampleQueue).push(videoSample);
      }
    } else {
      __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
    }
  }
  addAudioChunk(sample, meta, timestamp) {
    if (!(sample instanceof EncodedAudioChunk)) {
      throw new TypeError("addAudioChunk's first argument (sample) must be of type EncodedAudioChunk.");
    }
    if (meta && typeof meta !== "object") {
      throw new TypeError("addAudioChunk's second argument (meta), when provided, must be an object.");
    }
    if (timestamp !== undefined && (!Number.isFinite(timestamp) || timestamp < 0)) {
      throw new TypeError("addAudioChunk's third argument (timestamp), when provided, must be a non-negative real number.");
    }
    let data = new Uint8Array(sample.byteLength);
    sample.copyTo(data);
    this.addAudioChunkRaw(data, sample.type, timestamp ?? sample.timestamp, sample.duration, meta);
  }
  addAudioChunkRaw(data, type, timestamp, duration, meta) {
    if (!(data instanceof Uint8Array)) {
      throw new TypeError("addAudioChunkRaw's first argument (data) must be an instance of Uint8Array.");
    }
    if (type !== "key" && type !== "delta") {
      throw new TypeError("addAudioChunkRaw's second argument (type) must be either 'key' or 'delta'.");
    }
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new TypeError("addAudioChunkRaw's third argument (timestamp) must be a non-negative real number.");
    }
    if (!Number.isFinite(duration) || duration < 0) {
      throw new TypeError("addAudioChunkRaw's fourth argument (duration) must be a non-negative real number.");
    }
    if (meta && typeof meta !== "object") {
      throw new TypeError("addAudioChunkRaw's fifth argument (meta), when provided, must be an object.");
    }
    __privateMethod(this, _ensureNotFinalized, ensureNotFinalized_fn).call(this);
    if (!__privateGet(this, _options).audio)
      throw new Error("No audio track declared.");
    if (typeof __privateGet(this, _options).fastStart === "object" && __privateGet(this, _audioTrack).samples.length === __privateGet(this, _options).fastStart.expectedAudioChunks) {
      throw new Error(`Cannot add more audio chunks than specified in 'fastStart' (${__privateGet(this, _options).fastStart.expectedAudioChunks}).`);
    }
    let audioSample = __privateMethod(this, _createSampleForTrack, createSampleForTrack_fn).call(this, __privateGet(this, _audioTrack), data, type, timestamp, duration, meta);
    if (__privateGet(this, _options).fastStart === "fragmented" && __privateGet(this, _videoTrack)) {
      while (__privateGet(this, _videoSampleQueue).length > 0 && __privateGet(this, _videoSampleQueue)[0].decodeTimestamp <= audioSample.decodeTimestamp) {
        let videoSample = __privateGet(this, _videoSampleQueue).shift();
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
      }
      if (audioSample.decodeTimestamp <= __privateGet(this, _videoTrack).lastDecodeTimestamp) {
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
      } else {
        __privateGet(this, _audioSampleQueue).push(audioSample);
      }
    } else {
      __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
    }
  }
  finalize() {
    if (__privateGet(this, _finalized)) {
      throw new Error("Cannot finalize a muxer more than once.");
    }
    if (__privateGet(this, _options).fastStart === "fragmented") {
      for (let videoSample of __privateGet(this, _videoSampleQueue))
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
      for (let audioSample of __privateGet(this, _audioSampleQueue))
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
      __privateMethod(this, _finalizeFragment, finalizeFragment_fn).call(this, false);
    } else {
      if (__privateGet(this, _videoTrack))
        __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, __privateGet(this, _videoTrack));
      if (__privateGet(this, _audioTrack))
        __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, __privateGet(this, _audioTrack));
    }
    let tracks = [__privateGet(this, _videoTrack), __privateGet(this, _audioTrack)].filter(Boolean);
    if (__privateGet(this, _options).fastStart === "in-memory") {
      let mdatSize;
      for (let i = 0;i < 2; i++) {
        let movieBox2 = moov(tracks, __privateGet(this, _creationTime));
        let movieBoxSize = __privateGet(this, _writer).measureBox(movieBox2);
        mdatSize = __privateGet(this, _writer).measureBox(__privateGet(this, _mdat));
        let currentChunkPos = __privateGet(this, _writer).pos + movieBoxSize + mdatSize;
        for (let chunk of __privateGet(this, _finalizedChunks)) {
          chunk.offset = currentChunkPos;
          for (let { data } of chunk.samples) {
            currentChunkPos += data.byteLength;
            mdatSize += data.byteLength;
          }
        }
        if (currentChunkPos < 2 ** 32)
          break;
        if (mdatSize >= 2 ** 32)
          __privateGet(this, _mdat).largeSize = true;
      }
      let movieBox = moov(tracks, __privateGet(this, _creationTime));
      __privateGet(this, _writer).writeBox(movieBox);
      __privateGet(this, _mdat).size = mdatSize;
      __privateGet(this, _writer).writeBox(__privateGet(this, _mdat));
      for (let chunk of __privateGet(this, _finalizedChunks)) {
        for (let sample of chunk.samples) {
          __privateGet(this, _writer).write(sample.data);
          sample.data = null;
        }
      }
    } else if (__privateGet(this, _options).fastStart === "fragmented") {
      let startPos = __privateGet(this, _writer).pos;
      let mfraBox = mfra(tracks);
      __privateGet(this, _writer).writeBox(mfraBox);
      let mfraBoxSize = __privateGet(this, _writer).pos - startPos;
      __privateGet(this, _writer).seek(__privateGet(this, _writer).pos - 4);
      __privateGet(this, _writer).writeU32(mfraBoxSize);
    } else {
      let mdatPos = __privateGet(this, _writer).offsets.get(__privateGet(this, _mdat));
      let mdatSize = __privateGet(this, _writer).pos - mdatPos;
      __privateGet(this, _mdat).size = mdatSize;
      __privateGet(this, _mdat).largeSize = mdatSize >= 2 ** 32;
      __privateGet(this, _writer).patchBox(__privateGet(this, _mdat));
      let movieBox = moov(tracks, __privateGet(this, _creationTime));
      if (typeof __privateGet(this, _options).fastStart === "object") {
        __privateGet(this, _writer).seek(__privateGet(this, _ftypSize));
        __privateGet(this, _writer).writeBox(movieBox);
        let remainingBytes = mdatPos - __privateGet(this, _writer).pos;
        __privateGet(this, _writer).writeBox(free(remainingBytes));
      } else {
        __privateGet(this, _writer).writeBox(movieBox);
      }
    }
    __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
    __privateGet(this, _writer).finalize();
    __privateSet(this, _finalized, true);
  }
};
_options = new WeakMap;
_writer = new WeakMap;
_ftypSize = new WeakMap;
_mdat = new WeakMap;
_videoTrack = new WeakMap;
_audioTrack = new WeakMap;
_creationTime = new WeakMap;
_finalizedChunks = new WeakMap;
_nextFragmentNumber = new WeakMap;
_videoSampleQueue = new WeakMap;
_audioSampleQueue = new WeakMap;
_finalized = new WeakMap;
_validateOptions = new WeakSet;
validateOptions_fn = function(options) {
  if (typeof options !== "object") {
    throw new TypeError("The muxer requires an options object to be passed to its constructor.");
  }
  if (!(options.target instanceof Target)) {
    throw new TypeError("The target must be provided and an instance of Target.");
  }
  if (options.video) {
    if (!SUPPORTED_VIDEO_CODECS.includes(options.video.codec)) {
      throw new TypeError(`Unsupported video codec: ${options.video.codec}`);
    }
    if (!Number.isInteger(options.video.width) || options.video.width <= 0) {
      throw new TypeError(`Invalid video width: ${options.video.width}. Must be a positive integer.`);
    }
    if (!Number.isInteger(options.video.height) || options.video.height <= 0) {
      throw new TypeError(`Invalid video height: ${options.video.height}. Must be a positive integer.`);
    }
    const videoRotation = options.video.rotation;
    if (typeof videoRotation === "number" && ![0, 90, 180, 270].includes(videoRotation)) {
      throw new TypeError(`Invalid video rotation: ${videoRotation}. Has to be 0, 90, 180 or 270.`);
    } else if (Array.isArray(videoRotation) && (videoRotation.length !== 9 || videoRotation.some((value) => typeof value !== "number"))) {
      throw new TypeError(`Invalid video transformation matrix: ${videoRotation.join()}`);
    }
    if (options.video.frameRate !== undefined && (!Number.isInteger(options.video.frameRate) || options.video.frameRate <= 0)) {
      throw new TypeError(`Invalid video frame rate: ${options.video.frameRate}. Must be a positive integer.`);
    }
  }
  if (options.audio) {
    if (!SUPPORTED_AUDIO_CODECS.includes(options.audio.codec)) {
      throw new TypeError(`Unsupported audio codec: ${options.audio.codec}`);
    }
    if (!Number.isInteger(options.audio.numberOfChannels) || options.audio.numberOfChannels <= 0) {
      throw new TypeError(`Invalid number of audio channels: ${options.audio.numberOfChannels}. Must be a positive integer.`);
    }
    if (!Number.isInteger(options.audio.sampleRate) || options.audio.sampleRate <= 0) {
      throw new TypeError(`Invalid audio sample rate: ${options.audio.sampleRate}. Must be a positive integer.`);
    }
  }
  if (options.firstTimestampBehavior && !FIRST_TIMESTAMP_BEHAVIORS.includes(options.firstTimestampBehavior)) {
    throw new TypeError(`Invalid first timestamp behavior: ${options.firstTimestampBehavior}`);
  }
  if (typeof options.fastStart === "object") {
    if (options.video) {
      if (options.fastStart.expectedVideoChunks === undefined) {
        throw new TypeError(`'fastStart' is an object but is missing property 'expectedVideoChunks'.`);
      } else if (!Number.isInteger(options.fastStart.expectedVideoChunks) || options.fastStart.expectedVideoChunks < 0) {
        throw new TypeError(`'expectedVideoChunks' must be a non-negative integer.`);
      }
    }
    if (options.audio) {
      if (options.fastStart.expectedAudioChunks === undefined) {
        throw new TypeError(`'fastStart' is an object but is missing property 'expectedAudioChunks'.`);
      } else if (!Number.isInteger(options.fastStart.expectedAudioChunks) || options.fastStart.expectedAudioChunks < 0) {
        throw new TypeError(`'expectedAudioChunks' must be a non-negative integer.`);
      }
    }
  } else if (![false, "in-memory", "fragmented"].includes(options.fastStart)) {
    throw new TypeError(`'fastStart' option must be false, 'in-memory', 'fragmented' or an object.`);
  }
  if (options.minFragmentDuration !== undefined && (!Number.isFinite(options.minFragmentDuration) || options.minFragmentDuration < 0)) {
    throw new TypeError(`'minFragmentDuration' must be a non-negative number.`);
  }
};
_writeHeader = new WeakSet;
writeHeader_fn = function() {
  __privateGet(this, _writer).writeBox(ftyp({
    holdsAvc: __privateGet(this, _options).video?.codec === "avc",
    fragmented: __privateGet(this, _options).fastStart === "fragmented"
  }));
  __privateSet(this, _ftypSize, __privateGet(this, _writer).pos);
  if (__privateGet(this, _options).fastStart === "in-memory") {
    __privateSet(this, _mdat, mdat(false));
  } else if (__privateGet(this, _options).fastStart === "fragmented") {} else {
    if (typeof __privateGet(this, _options).fastStart === "object") {
      let moovSizeUpperBound = __privateMethod(this, _computeMoovSizeUpperBound, computeMoovSizeUpperBound_fn).call(this);
      __privateGet(this, _writer).seek(__privateGet(this, _writer).pos + moovSizeUpperBound);
    }
    __privateSet(this, _mdat, mdat(true));
    __privateGet(this, _writer).writeBox(__privateGet(this, _mdat));
  }
  __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
};
_computeMoovSizeUpperBound = new WeakSet;
computeMoovSizeUpperBound_fn = function() {
  if (typeof __privateGet(this, _options).fastStart !== "object")
    return;
  let upperBound = 0;
  let sampleCounts = [
    __privateGet(this, _options).fastStart.expectedVideoChunks,
    __privateGet(this, _options).fastStart.expectedAudioChunks
  ];
  for (let n of sampleCounts) {
    if (!n)
      continue;
    upperBound += (4 + 4) * Math.ceil(2 / 3 * n);
    upperBound += 4 * n;
    upperBound += (4 + 4 + 4) * Math.ceil(2 / 3 * n);
    upperBound += 4 * n;
    upperBound += 8 * n;
  }
  upperBound += 4096;
  return upperBound;
};
_prepareTracks = new WeakSet;
prepareTracks_fn = function() {
  if (__privateGet(this, _options).video) {
    __privateSet(this, _videoTrack, {
      id: 1,
      info: {
        type: "video",
        codec: __privateGet(this, _options).video.codec,
        width: __privateGet(this, _options).video.width,
        height: __privateGet(this, _options).video.height,
        rotation: __privateGet(this, _options).video.rotation ?? 0,
        decoderConfig: null
      },
      timescale: __privateGet(this, _options).video.frameRate ?? 57600,
      samples: [],
      finalizedChunks: [],
      currentChunk: null,
      firstDecodeTimestamp: undefined,
      lastDecodeTimestamp: -1,
      timeToSampleTable: [],
      compositionTimeOffsetTable: [],
      lastTimescaleUnits: null,
      lastSample: null,
      compactlyCodedChunkTable: []
    });
  }
  if (__privateGet(this, _options).audio) {
    __privateSet(this, _audioTrack, {
      id: __privateGet(this, _options).video ? 2 : 1,
      info: {
        type: "audio",
        codec: __privateGet(this, _options).audio.codec,
        numberOfChannels: __privateGet(this, _options).audio.numberOfChannels,
        sampleRate: __privateGet(this, _options).audio.sampleRate,
        decoderConfig: null
      },
      timescale: __privateGet(this, _options).audio.sampleRate,
      samples: [],
      finalizedChunks: [],
      currentChunk: null,
      firstDecodeTimestamp: undefined,
      lastDecodeTimestamp: -1,
      timeToSampleTable: [],
      compositionTimeOffsetTable: [],
      lastTimescaleUnits: null,
      lastSample: null,
      compactlyCodedChunkTable: []
    });
    if (__privateGet(this, _options).audio.codec === "aac") {
      let guessedCodecPrivate = __privateMethod(this, _generateMpeg4AudioSpecificConfig, generateMpeg4AudioSpecificConfig_fn).call(this, 2, __privateGet(this, _options).audio.sampleRate, __privateGet(this, _options).audio.numberOfChannels);
      __privateGet(this, _audioTrack).info.decoderConfig = {
        codec: __privateGet(this, _options).audio.codec,
        description: guessedCodecPrivate,
        numberOfChannels: __privateGet(this, _options).audio.numberOfChannels,
        sampleRate: __privateGet(this, _options).audio.sampleRate
      };
    }
  }
};
_generateMpeg4AudioSpecificConfig = new WeakSet;
generateMpeg4AudioSpecificConfig_fn = function(objectType, sampleRate, numberOfChannels) {
  let frequencyIndices = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  let frequencyIndex = frequencyIndices.indexOf(sampleRate);
  let channelConfig = numberOfChannels;
  let configBits = "";
  configBits += objectType.toString(2).padStart(5, "0");
  configBits += frequencyIndex.toString(2).padStart(4, "0");
  if (frequencyIndex === 15)
    configBits += sampleRate.toString(2).padStart(24, "0");
  configBits += channelConfig.toString(2).padStart(4, "0");
  let paddingLength = Math.ceil(configBits.length / 8) * 8;
  configBits = configBits.padEnd(paddingLength, "0");
  let configBytes = new Uint8Array(configBits.length / 8);
  for (let i = 0;i < configBits.length; i += 8) {
    configBytes[i / 8] = parseInt(configBits.slice(i, i + 8), 2);
  }
  return configBytes;
};
_createSampleForTrack = new WeakSet;
createSampleForTrack_fn = function(track, data, type, timestamp, duration, meta, compositionTimeOffset) {
  let presentationTimestampInSeconds = timestamp / 1e6;
  let decodeTimestampInSeconds = (timestamp - (compositionTimeOffset ?? 0)) / 1e6;
  let durationInSeconds = duration / 1e6;
  let adjusted = __privateMethod(this, _validateTimestamp, validateTimestamp_fn).call(this, presentationTimestampInSeconds, decodeTimestampInSeconds, track);
  presentationTimestampInSeconds = adjusted.presentationTimestamp;
  decodeTimestampInSeconds = adjusted.decodeTimestamp;
  if (meta?.decoderConfig) {
    if (track.info.decoderConfig === null) {
      track.info.decoderConfig = meta.decoderConfig;
    } else {
      Object.assign(track.info.decoderConfig, meta.decoderConfig);
    }
  }
  let sample = {
    presentationTimestamp: presentationTimestampInSeconds,
    decodeTimestamp: decodeTimestampInSeconds,
    duration: durationInSeconds,
    data,
    size: data.byteLength,
    type,
    timescaleUnitsToNextSample: intoTimescale(durationInSeconds, track.timescale)
  };
  return sample;
};
_addSampleToTrack = new WeakSet;
addSampleToTrack_fn = function(track, sample) {
  if (__privateGet(this, _options).fastStart !== "fragmented") {
    track.samples.push(sample);
  }
  const sampleCompositionTimeOffset = intoTimescale(sample.presentationTimestamp - sample.decodeTimestamp, track.timescale);
  if (track.lastTimescaleUnits !== null) {
    let timescaleUnits = intoTimescale(sample.decodeTimestamp, track.timescale, false);
    let delta = Math.round(timescaleUnits - track.lastTimescaleUnits);
    track.lastTimescaleUnits += delta;
    track.lastSample.timescaleUnitsToNextSample = delta;
    if (__privateGet(this, _options).fastStart !== "fragmented") {
      let lastTableEntry = last(track.timeToSampleTable);
      if (lastTableEntry.sampleCount === 1) {
        lastTableEntry.sampleDelta = delta;
        lastTableEntry.sampleCount++;
      } else if (lastTableEntry.sampleDelta === delta) {
        lastTableEntry.sampleCount++;
      } else {
        lastTableEntry.sampleCount--;
        track.timeToSampleTable.push({
          sampleCount: 2,
          sampleDelta: delta
        });
      }
      const lastCompositionTimeOffsetTableEntry = last(track.compositionTimeOffsetTable);
      if (lastCompositionTimeOffsetTableEntry.sampleCompositionTimeOffset === sampleCompositionTimeOffset) {
        lastCompositionTimeOffsetTableEntry.sampleCount++;
      } else {
        track.compositionTimeOffsetTable.push({
          sampleCount: 1,
          sampleCompositionTimeOffset
        });
      }
    }
  } else {
    track.lastTimescaleUnits = 0;
    if (__privateGet(this, _options).fastStart !== "fragmented") {
      track.timeToSampleTable.push({
        sampleCount: 1,
        sampleDelta: intoTimescale(sample.duration, track.timescale)
      });
      track.compositionTimeOffsetTable.push({
        sampleCount: 1,
        sampleCompositionTimeOffset
      });
    }
  }
  track.lastSample = sample;
  let beginNewChunk = false;
  if (!track.currentChunk) {
    beginNewChunk = true;
  } else {
    let currentChunkDuration = sample.presentationTimestamp - track.currentChunk.startTimestamp;
    if (__privateGet(this, _options).fastStart === "fragmented") {
      let mostImportantTrack = __privateGet(this, _videoTrack) ?? __privateGet(this, _audioTrack);
      const chunkDuration = __privateGet(this, _options).minFragmentDuration ?? 1;
      if (track === mostImportantTrack && sample.type === "key" && currentChunkDuration >= chunkDuration) {
        beginNewChunk = true;
        __privateMethod(this, _finalizeFragment, finalizeFragment_fn).call(this);
      }
    } else {
      beginNewChunk = currentChunkDuration >= 0.5;
    }
  }
  if (beginNewChunk) {
    if (track.currentChunk) {
      __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, track);
    }
    track.currentChunk = {
      startTimestamp: sample.presentationTimestamp,
      samples: []
    };
  }
  track.currentChunk.samples.push(sample);
};
_validateTimestamp = new WeakSet;
validateTimestamp_fn = function(presentationTimestamp, decodeTimestamp, track) {
  const strictTimestampBehavior = __privateGet(this, _options).firstTimestampBehavior === "strict";
  const noLastDecodeTimestamp = track.lastDecodeTimestamp === -1;
  const timestampNonZero = decodeTimestamp !== 0;
  if (strictTimestampBehavior && noLastDecodeTimestamp && timestampNonZero) {
    throw new Error(`The first chunk for your media track must have a timestamp of 0 (received DTS=${decodeTimestamp}).Non-zero first timestamps are often caused by directly piping frames or audio data from a MediaStreamTrack into the encoder. Their timestamps are typically relative to the age of thedocument, which is probably what you want.

If you want to offset all timestamps of a track such that the first one is zero, set firstTimestampBehavior: 'offset' in the options.
`);
  } else if (__privateGet(this, _options).firstTimestampBehavior === "offset" || __privateGet(this, _options).firstTimestampBehavior === "cross-track-offset") {
    if (track.firstDecodeTimestamp === undefined) {
      track.firstDecodeTimestamp = decodeTimestamp;
    }
    let baseDecodeTimestamp;
    if (__privateGet(this, _options).firstTimestampBehavior === "offset") {
      baseDecodeTimestamp = track.firstDecodeTimestamp;
    } else {
      baseDecodeTimestamp = Math.min(__privateGet(this, _videoTrack)?.firstDecodeTimestamp ?? Infinity, __privateGet(this, _audioTrack)?.firstDecodeTimestamp ?? Infinity);
    }
    decodeTimestamp -= baseDecodeTimestamp;
    presentationTimestamp -= baseDecodeTimestamp;
  }
  if (decodeTimestamp < track.lastDecodeTimestamp) {
    throw new Error(`Timestamps must be monotonically increasing (DTS went from ${track.lastDecodeTimestamp * 1e6} to ${decodeTimestamp * 1e6}).`);
  }
  track.lastDecodeTimestamp = decodeTimestamp;
  return { presentationTimestamp, decodeTimestamp };
};
_finalizeCurrentChunk = new WeakSet;
finalizeCurrentChunk_fn = function(track) {
  if (__privateGet(this, _options).fastStart === "fragmented") {
    throw new Error("Can't finalize individual chunks if 'fastStart' is set to 'fragmented'.");
  }
  if (!track.currentChunk)
    return;
  track.finalizedChunks.push(track.currentChunk);
  __privateGet(this, _finalizedChunks).push(track.currentChunk);
  if (track.compactlyCodedChunkTable.length === 0 || last(track.compactlyCodedChunkTable).samplesPerChunk !== track.currentChunk.samples.length) {
    track.compactlyCodedChunkTable.push({
      firstChunk: track.finalizedChunks.length,
      samplesPerChunk: track.currentChunk.samples.length
    });
  }
  if (__privateGet(this, _options).fastStart === "in-memory") {
    track.currentChunk.offset = 0;
    return;
  }
  track.currentChunk.offset = __privateGet(this, _writer).pos;
  for (let sample of track.currentChunk.samples) {
    __privateGet(this, _writer).write(sample.data);
    sample.data = null;
  }
  __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
};
_finalizeFragment = new WeakSet;
finalizeFragment_fn = function(flushStreamingWriter = true) {
  if (__privateGet(this, _options).fastStart !== "fragmented") {
    throw new Error("Can't finalize a fragment unless 'fastStart' is set to 'fragmented'.");
  }
  let tracks = [__privateGet(this, _videoTrack), __privateGet(this, _audioTrack)].filter((track) => track && track.currentChunk);
  if (tracks.length === 0)
    return;
  let fragmentNumber = __privateWrapper(this, _nextFragmentNumber)._++;
  if (fragmentNumber === 1) {
    let movieBox = moov(tracks, __privateGet(this, _creationTime), true);
    __privateGet(this, _writer).writeBox(movieBox);
  }
  let moofOffset = __privateGet(this, _writer).pos;
  let moofBox = moof(fragmentNumber, tracks);
  __privateGet(this, _writer).writeBox(moofBox);
  {
    let mdatBox = mdat(false);
    let totalTrackSampleSize = 0;
    for (let track of tracks) {
      for (let sample of track.currentChunk.samples) {
        totalTrackSampleSize += sample.size;
      }
    }
    let mdatSize = __privateGet(this, _writer).measureBox(mdatBox) + totalTrackSampleSize;
    if (mdatSize >= 2 ** 32) {
      mdatBox.largeSize = true;
      mdatSize = __privateGet(this, _writer).measureBox(mdatBox) + totalTrackSampleSize;
    }
    mdatBox.size = mdatSize;
    __privateGet(this, _writer).writeBox(mdatBox);
  }
  for (let track of tracks) {
    track.currentChunk.offset = __privateGet(this, _writer).pos;
    track.currentChunk.moofOffset = moofOffset;
    for (let sample of track.currentChunk.samples) {
      __privateGet(this, _writer).write(sample.data);
      sample.data = null;
    }
  }
  let endPos = __privateGet(this, _writer).pos;
  __privateGet(this, _writer).seek(__privateGet(this, _writer).offsets.get(moofBox));
  let newMoofBox = moof(fragmentNumber, tracks);
  __privateGet(this, _writer).writeBox(newMoofBox);
  __privateGet(this, _writer).seek(endPos);
  for (let track of tracks) {
    track.finalizedChunks.push(track.currentChunk);
    __privateGet(this, _finalizedChunks).push(track.currentChunk);
    track.currentChunk = null;
  }
  if (flushStreamingWriter) {
    __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
  }
};
_maybeFlushStreamingTargetWriter = new WeakSet;
maybeFlushStreamingTargetWriter_fn = function() {
  if (__privateGet(this, _writer) instanceof StreamTargetWriter) {
    __privateGet(this, _writer).flush();
  }
};
_ensureNotFinalized = new WeakSet;
ensureNotFinalized_fn = function() {
  if (__privateGet(this, _finalized)) {
    throw new Error("Cannot add new video or audio chunks after the file has been finalized.");
  }
};

// src/engine/renderer.ts
function smootherstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}
var captionBlurCanvas = null;
var captionBlurCtx = null;
function getCaptionBlurContext(width, height) {
  if (typeof document === "undefined")
    return null;
  if (!captionBlurCanvas) {
    captionBlurCanvas = document.createElement("canvas");
  }
  if (captionBlurCanvas.width < width || captionBlurCanvas.height < height) {
    captionBlurCanvas.width = Math.ceil(width);
    captionBlurCanvas.height = Math.ceil(height);
  }
  if (!captionBlurCtx) {
    captionBlurCtx = captionBlurCanvas.getContext("2d");
  }
  return captionBlurCtx;
}
var VIBE_PRESETS = {
  "keynote-pro": {
    id: "keynote-pro",
    name: "Keynote Pro",
    gradientColors: ["#0C0D12", "#181A24", "#262A38", "#0E0F14"],
    borderRadius: 20,
    shadowBlur: 60,
    shadowColor: "rgba(0, 0, 0, 0.88)",
    cursorRingColor: "#38BDF8",
    keycapTheme: "glass",
    backdrop: {
      presetType: "keynote-pro",
      vignetteStrength: 75,
      illumination: 85,
      flowSpeed: 40,
      gridIntensity: 0,
      gradientAngle: 180
    }
  },
  "stripe-mesh": {
    id: "stripe-mesh",
    name: "Stripe Mesh",
    gradientColors: ["#090614", "#3B1578", "#6366F1", "#EC4899", "#06B6D4"],
    borderRadius: 18,
    shadowBlur: 55,
    shadowColor: "rgba(76, 29, 149, 0.42)",
    cursorRingColor: "#A855F7",
    keycapTheme: "glass",
    backdrop: {
      presetType: "stripe-mesh",
      vignetteStrength: 65,
      illumination: 80,
      flowSpeed: 60,
      gridIntensity: 0,
      gradientAngle: 135
    }
  },
  "linear-cosmic": {
    id: "linear-cosmic",
    name: "Linear Cosmic",
    gradientColors: ["#05060A", "#121422", "#1E1B4B", "#38BDF8", "#818CF8"],
    borderRadius: 16,
    shadowBlur: 50,
    shadowColor: "rgba(0, 0, 0, 0.90)",
    cursorRingColor: "#818CF8",
    keycapTheme: "dark",
    backdrop: {
      presetType: "linear-cosmic",
      vignetteStrength: 80,
      illumination: 75,
      flowSpeed: 35,
      gridIntensity: 45,
      gradientAngle: 125
    }
  },
  "linear-dark": {
    id: "linear-dark",
    name: "Linear Dark",
    gradientColors: ["#0B0C10", "#181A24", "#0F172A"],
    borderRadius: 16,
    shadowBlur: 45,
    shadowColor: "rgba(0, 0, 0, 0.75)",
    cursorRingColor: "#8B5CF6",
    keycapTheme: "dark",
    backdrop: {
      presetType: "keynote-pro",
      vignetteStrength: 70,
      illumination: 80,
      flowSpeed: 40,
      gridIntensity: 0,
      gradientAngle: 180
    }
  },
  "apple-keynote": {
    id: "apple-keynote",
    name: "Apple Keynote",
    gradientColors: ["#1E2028", "#2D313E", "#161820"],
    borderRadius: 20,
    shadowBlur: 55,
    shadowColor: "rgba(0, 0, 0, 0.85)",
    cursorRingColor: "#3B82F6",
    keycapTheme: "glass",
    backdrop: {
      presetType: "keynote-pro",
      vignetteStrength: 80,
      illumination: 90,
      flowSpeed: 30,
      gridIntensity: 0,
      gradientAngle: 180
    }
  },
  "indie-pop": {
    id: "indie-pop",
    name: "Indie Pop",
    gradientColors: ["#3B0764", "#831843", "#1E1B4B"],
    borderRadius: 18,
    shadowBlur: 50,
    shadowColor: "rgba(131, 24, 67, 0.35)",
    cursorRingColor: "#F43F5E",
    keycapTheme: "light",
    backdrop: {
      presetType: "stripe-mesh",
      vignetteStrength: 50,
      illumination: 85,
      flowSpeed: 70,
      gridIntensity: 0,
      gradientAngle: 140
    }
  },
  "minimal-clean": {
    id: "minimal-clean",
    name: "Minimal Clean",
    gradientColors: ["#09090B", "#121215", "#09090B"],
    borderRadius: 14,
    shadowBlur: 40,
    shadowColor: "rgba(0, 0, 0, 0.9)",
    cursorRingColor: "#E4E4E7",
    keycapTheme: "dark",
    backdrop: {
      presetType: "keynote-pro",
      vignetteStrength: 60,
      illumination: 60,
      flowSpeed: 20,
      gridIntensity: 0,
      gradientAngle: 180
    }
  },
  custom: {
    id: "custom",
    name: "Brand Palette",
    gradientColors: ["#0F172A", "#1E1B4B", "#020617"],
    borderRadius: 16,
    shadowBlur: 45,
    shadowColor: "rgba(0, 0, 0, 0.8)",
    cursorRingColor: "#8B5CF6",
    keycapTheme: "glass",
    backdrop: {
      presetType: "stripe-mesh",
      vignetteStrength: 65,
      illumination: 80,
      flowSpeed: 50,
      gridIntensity: 0,
      gradientAngle: 135
    }
  }
};
function getAspectDimensions(aspect, targetWidth = 1920) {
  switch (aspect) {
    case "16:9":
      return { width: targetWidth, height: Math.round(targetWidth * 9 / 16) };
    case "9:16":
      return { width: Math.round(targetWidth * 9 / 16), height: targetWidth };
    case "1:1":
      return { width: targetWidth, height: targetWidth };
    case "4:3":
      return { width: targetWidth, height: Math.round(targetWidth * 3 / 4) };
    default:
      return { width: 1920, height: 1080 };
  }
}

class StudioRenderer {
  offscreenVideoCanvas;
  offscreenVideoCtx;
  activeRipplesScratch = [];
  static STARS = Array.from({ length: 48 }, (_, i) => ({
    x: i * 137.5 % 1000 / 1000,
    y: i * 243.1 % 1000 / 1000,
    size: i % 3 === 0 ? 2.2 : 1.2,
    phase: i * 0.7,
    speed: 0.8 + i % 5 * 0.3
  }));
  constructor() {
    this.offscreenVideoCanvas = document.createElement("canvas");
    this.offscreenVideoCanvas.width = 1920;
    this.offscreenVideoCanvas.height = 1080;
    this.offscreenVideoCtx = this.offscreenVideoCanvas.getContext("2d", { willReadFrequently: false });
  }
  renderFrame(options) {
    const {
      canvas,
      video,
      currentTimeMs,
      camera,
      activePill,
      cursorEngine,
      keystrokes,
      preset,
      aspectRatio,
      showSpotlight,
      showCursor,
      showHud,
      metadata,
      cursorTheme,
      cursorScale,
      captions,
      captionStyle,
      captionBackdrop = 70,
      showCaptions,
      showIntroCard,
      introHeadline,
      introSubheadline,
      durationMs = 0,
      showOutroCard,
      outroHeadline,
      outroCtaText,
      backdropParams
    } = options;
    const ctx = canvas.getContext("2d");
    if (!ctx)
      return;
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    this.drawBackdropMatrix(ctx, canvasW, canvasH, preset, currentTimeMs, backdropParams);
    let introCardAlpha = 0;
    let introCardScale = 1;
    let windowIntroAlpha = 1;
    let windowIntroScale = 1;
    let windowIntroTiltX = 0;
    let windowIntroTiltY = 0;
    if (showIntroCard && currentTimeMs < 1500) {
      if (currentTimeMs < 1000) {
        const enterEase = smootherstep(currentTimeMs / 320);
        introCardAlpha = enterEase;
        introCardScale = 0.88 + 0.12 * enterEase;
        windowIntroAlpha = 0;
        windowIntroScale = 0.72;
      } else {
        const ease = smootherstep((currentTimeMs - 1000) / 500);
        introCardAlpha = Math.max(0, 1 - ease);
        introCardScale = 1 + 0.12 * ease;
        windowIntroAlpha = ease;
        windowIntroScale = 0.72 + 0.28 * ease;
        windowIntroTiltX = (1 - ease) * 8;
        windowIntroTiltY = (1 - ease) * -12;
      }
    }
    let outroCardAlpha = 0;
    let outroCardScale = 1;
    let windowOutroAlpha = 1;
    let windowOutroScale = 1;
    let windowOutroTiltX = 0;
    let windowOutroTiltY = 0;
    if (showOutroCard && durationMs > 0 && currentTimeMs >= durationMs - 1500) {
      const elapsed = currentTimeMs - (durationMs - 1500);
      if (elapsed < 1000) {
        const ease = smootherstep(elapsed / 320);
        outroCardAlpha = ease;
        outroCardScale = 0.88 + 0.12 * ease;
        windowOutroScale = 1 - 0.28 * ease;
        windowOutroTiltX = -6 * ease;
        windowOutroTiltY = 9 * ease;
      } else {
        const ease = smootherstep((elapsed - 1000) / 500);
        outroCardAlpha = 1;
        outroCardScale = 1 + 0.06 * ease;
        windowOutroAlpha = 1 - ease;
        windowOutroScale = 0.72 - 0.08 * ease;
        windowOutroTiltX = -6 + 6 * ease;
        windowOutroTiltY = 9 - 9 * ease;
      }
    }
    const windowAlpha = windowIntroAlpha * windowOutroAlpha;
    const windowScale = windowIntroScale * windowOutroScale;
    const windowTiltX = windowIntroTiltX + windowOutroTiltX;
    const windowTiltY = windowIntroTiltY + windowOutroTiltY;
    const paddingX = canvasW * 0.08;
    const paddingY = canvasH * 0.08;
    const availW = canvasW - paddingX * 2;
    const availH = canvasH - paddingY * 2;
    const sourceW = video.videoWidth || video.width || 1920;
    const sourceH = video.videoHeight || video.height || 1080;
    const videoAspect = sourceW / sourceH;
    let windowW = availW;
    let windowH = availW / videoAspect;
    if (windowH > availH) {
      windowH = availH;
      windowW = availH * videoAspect;
    }
    const windowX = (canvasW - windowW) / 2;
    const windowY = (canvasH - windowH) / 2;
    if (this.offscreenVideoCanvas.width !== sourceW || this.offscreenVideoCanvas.height !== sourceH) {
      this.offscreenVideoCanvas.width = sourceW;
      this.offscreenVideoCanvas.height = sourceH;
    }
    this.offscreenVideoCtx.clearRect(0, 0, sourceW, sourceH);
    try {
      this.offscreenVideoCtx.drawImage(video, 0, 0, sourceW, sourceH);
    } catch {}
    if (windowAlpha > 0.001) {
      const centerX = windowX + windowW * 0.5;
      const centerY = windowY + windowH * 0.5;
      ctx.save();
      ctx.globalAlpha = windowAlpha;
      const contactGrad = ctx.createRadialGradient(centerX, centerY + windowH * 0.44, windowW * 0.08, centerX, centerY + windowH * 0.44, windowW * 0.58);
      contactGrad.addColorStop(0, "rgba(0, 0, 0, 0.48)");
      contactGrad.addColorStop(0.5, "rgba(0, 0, 0, 0.18)");
      contactGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = contactGrad;
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }
    if (windowAlpha > 0.001) {
      ctx.save();
      ctx.globalAlpha = windowAlpha;
      const centerX = windowX + windowW / 2;
      const centerY = windowY + windowH / 2;
      ctx.translate(centerX, centerY);
      if (windowScale < 0.999) {
        ctx.scale(windowScale, windowScale);
      }
      const effectiveTiltX = camera.tiltX + windowTiltX;
      const effectiveTiltY = camera.tiltY + windowTiltY;
      if (Math.abs(effectiveTiltX) > 0.1 || Math.abs(effectiveTiltY) > 0.1) {
        const radY = effectiveTiltY * Math.PI / 180;
        const radX = effectiveTiltX * Math.PI / 180;
        ctx.transform(Math.cos(radY), Math.sin(radX) * 0.35, Math.sin(radY) * 0.35, Math.cos(radX), 0, 0);
      }
      ctx.translate(-windowW / 2, -windowH / 2);
      ctx.save();
      ctx.shadowColor = preset.shadowColor;
      ctx.shadowBlur = canvasW > 2560 ? Math.min(30, preset.shadowBlur) : preset.shadowBlur;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 24;
      ctx.fillStyle = "#0F1117";
      this.roundRect(ctx, 0, 0, windowW, windowH, preset.borderRadius);
      ctx.fill();
      ctx.restore();
      ctx.save();
      this.roundRect(ctx, 0, 0, windowW, windowH, preset.borderRadius);
      ctx.clip();
      const S = Math.max(1, camera.scale);
      const halfViewX = 0.5 / S;
      const halfViewY = 0.5 / S;
      const clampedCamX = Math.max(halfViewX, Math.min(1 - halfViewX, camera.x));
      const clampedCamY = Math.max(halfViewY, Math.min(1 - halfViewY, camera.y));
      ctx.save();
      ctx.translate(windowW * 0.5, windowH * 0.5);
      ctx.scale(S, S);
      ctx.translate(-clampedCamX * windowW, -clampedCamY * windowH);
      ctx.drawImage(this.offscreenVideoCanvas, 0, 0, windowW, windowH);
      ctx.restore();
      const isSpotlightActive = showSpotlight && (activePill ? activePill.spotlight : false);
      if (isSpotlightActive) {
        this.applySpotlightMask(ctx, windowW, windowH, windowW * 0.5, windowH * 0.5);
      }
      if (showCursor) {
        const cursor = cursorEngine.getCursorAt(currentTimeMs);
        const metaW = metadata?.width || sourceW;
        const metaH = metadata?.height || sourceH;
        const rawCursorX = cursor.x <= 1 ? cursor.x : metaW > 0 ? cursor.x / metaW : cursor.x;
        const rawCursorY = cursor.y <= 1 ? cursor.y : metaH > 0 ? cursor.y / metaH : cursor.y;
        const normCursorX = Math.max(0.01, Math.min(0.99, rawCursorX));
        const normCursorY = Math.max(0.01, Math.min(0.99, rawCursorY));
        const cursorScreenX = windowW * 0.5 + (normCursorX - clampedCamX) * windowW * S;
        const cursorScreenY = windowH * 0.5 + (normCursorY - clampedCamY) * windowH * S;
        this.activeRipplesScratch.length = 0;
        for (const click of cursorEngine.getClicks()) {
          const elapsed = currentTimeMs - click.t;
          if (elapsed >= 0 && elapsed <= 500) {
            const clickNormX = click.x <= 1 ? click.x : metaW > 0 ? click.x / metaW : click.x;
            const clickNormY = click.y <= 1 ? click.y : metaH > 0 ? click.y / metaH : click.y;
            const rx = windowW * 0.5 + (clickNormX - clampedCamX) * windowW * S;
            const ry = windowH * 0.5 + (clickNormY - clampedCamY) * windowH * S;
            this.activeRipplesScratch.push({ x: rx, y: ry, progress: elapsed / 500 });
          }
        }
        cursorEngine.drawCursorAt(ctx, cursor, cursorScreenX, cursorScreenY, currentTimeMs, preset.cursorRingColor, this.activeRipplesScratch, cursorTheme || "mac-obsidian", cursorScale || 1);
      }
      if (showCaptions && captions && captions.length > 0) {
        this.drawAnimatedCaptions(ctx, windowW, windowH, captions, currentTimeMs, captionStyle || "tiktok-bold", captionBackdrop);
      }
      ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
      ctx.lineWidth = 1.5;
      this.roundRect(ctx, 0, 0, windowW, windowH, preset.borderRadius);
      ctx.stroke();
      ctx.restore();
      ctx.restore();
    }
    if (showIntroCard && introCardAlpha > 0.001) {
      this.drawIntroTitleCard(ctx, canvasW, canvasH, introHeadline, introSubheadline, introCardAlpha, introCardScale, preset);
    }
    if (showOutroCard && outroCardAlpha > 0.001) {
      this.drawOutroCtaCard(ctx, canvasW, canvasH, outroHeadline, outroCtaText ?? "", outroCardAlpha, outroCardScale, preset);
    }
    if (showHud) {
      this.drawKeystrokeHud(ctx, canvasW, canvasH, keystrokes, currentTimeMs, preset);
    }
  }
  drawBackdropMatrix(ctx, w, h, preset, timeMs, params) {
    const presetType = params?.presetType || preset.backdrop?.presetType || (preset.id === "keynote-pro" ? "keynote-pro" : preset.id === "stripe-mesh" ? "stripe-mesh" : preset.id === "linear-cosmic" ? "linear-cosmic" : preset.id === "apple-keynote" ? "keynote-pro" : "keynote-pro");
    const vignetteStrength = (params?.vignetteStrength ?? preset.backdrop?.vignetteStrength ?? 75) / 100;
    const illumination = (params?.illumination ?? preset.backdrop?.illumination ?? 85) / 100;
    const flowSpeed = (params?.flowSpeed ?? preset.backdrop?.flowSpeed ?? 50) / 50;
    const gridIntensity = (params?.gridIntensity ?? preset.backdrop?.gridIntensity ?? 30) / 100;
    const gradientAngle = (params?.gradientAngle ?? preset.backdrop?.gradientAngle ?? 135) * Math.PI / 180;
    const colors = preset.gradientColors;
    if (presetType === "keynote-pro") {
      ctx.fillStyle = colors[0] || "#0C0D12";
      ctx.fillRect(0, 0, w, h);
      const kx = w * 0.5;
      const ky = h * 0.36;
      const kr = Math.max(w, h) * 0.72;
      const keyLight = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
      keyLight.addColorStop(0, `rgba(45, 52, 72, ${0.55 * illumination})`);
      keyLight.addColorStop(0.35, `rgba(28, 33, 46, ${0.35 * illumination})`);
      keyLight.addColorStop(0.7, `rgba(18, 20, 28, ${0.12 * illumination})`);
      keyLight.addColorStop(1, "rgba(10, 11, 16, 0)");
      ctx.fillStyle = keyLight;
      ctx.fillRect(0, 0, w, h);
      const cycGrad = ctx.createLinearGradient(0, h, 0, h * 0.52);
      cycGrad.addColorStop(0, `rgba(0, 0, 0, ${0.55 * vignetteStrength})`);
      cycGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = cycGrad;
      ctx.fillRect(0, h * 0.5, w, h * 0.5);
      const cx = w * 0.5;
      const cy = h * 0.5;
      const inR = Math.min(w, h) * 0.28;
      const outR = Math.max(w, h) * 0.76;
      const vignette = ctx.createRadialGradient(cx, cy, inR, cx, cy, outR);
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.addColorStop(0.6, `rgba(0, 0, 0, ${0.35 * vignetteStrength})`);
      vignette.addColorStop(1, `rgba(0, 0, 0, ${0.85 * vignetteStrength})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
    } else if (presetType === "stripe-mesh") {
      ctx.fillStyle = colors[0] || "#090614";
      ctx.fillRect(0, 0, w, h);
      const dx = Math.cos(gradientAngle) * w;
      const dy = Math.sin(gradientAngle) * h;
      const x0 = w * 0.5 - dx * 0.5;
      const y0 = h * 0.5 - dy * 0.5;
      const x1 = w * 0.5 + dx * 0.5;
      const y1 = h * 0.5 + dy * 0.5;
      const linearMesh = ctx.createLinearGradient(x0, y0, x1, y1);
      linearMesh.addColorStop(0, "#0E0C28");
      linearMesh.addColorStop(0.32, "#1E103E");
      linearMesh.addColorStop(0.68, "#12092B");
      linearMesh.addColorStop(1, "#070414");
      ctx.fillStyle = linearMesh;
      ctx.fillRect(0, 0, w, h);
      const t = timeMs * 0.0004 * flowSpeed;
      const bx1 = w * 0.3 + Math.sin(t * 1.05) * (w * 0.16);
      const by1 = h * 0.34 + Math.cos(t * 0.9) * (h * 0.15);
      const r1 = w * 0.62;
      const grad1 = ctx.createRadialGradient(bx1, by1, 10, bx1, by1, r1);
      grad1.addColorStop(0, `rgba(99, 102, 241, ${0.44 * illumination})`);
      grad1.addColorStop(0.45, `rgba(79, 70, 229, ${0.2 * illumination})`);
      grad1.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad1;
      ctx.fillRect(0, 0, w, h);
      const bx2 = w * 0.72 + Math.cos(t * 0.85) * (w * 0.18);
      const by2 = h * 0.62 + Math.sin(t * 1.15) * (h * 0.16);
      const r2 = w * 0.66;
      const grad2 = ctx.createRadialGradient(bx2, by2, 20, bx2, by2, r2);
      grad2.addColorStop(0, `rgba(217, 70, 239, ${0.34 * illumination})`);
      grad2.addColorStop(0.5, `rgba(168, 85, 247, ${0.16 * illumination})`);
      grad2.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad2;
      ctx.fillRect(0, 0, w, h);
      const bx3 = w * 0.78 + Math.sin(t * 1.25) * (w * 0.12);
      const by3 = h * 0.24 + Math.cos(t * 1.1) * (h * 0.12);
      const r3 = w * 0.48;
      const grad3 = ctx.createRadialGradient(bx3, by3, 10, bx3, by3, r3);
      grad3.addColorStop(0, `rgba(6, 182, 212, ${0.3 * illumination})`);
      grad3.addColorStop(0.5, `rgba(14, 116, 144, ${0.12 * illumination})`);
      grad3.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad3;
      ctx.fillRect(0, 0, w, h);
      const bx4 = w * 0.2 + Math.cos(t * 0.7) * (w * 0.14);
      const by4 = h * 0.8 + Math.sin(t * 0.8) * (h * 0.12);
      const r4 = w * 0.56;
      const grad4 = ctx.createRadialGradient(bx4, by4, 20, bx4, by4, r4);
      grad4.addColorStop(0, `rgba(59, 130, 246, ${0.28 * illumination})`);
      grad4.addColorStop(0.5, `rgba(30, 58, 138, ${0.12 * illumination})`);
      grad4.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad4;
      ctx.fillRect(0, 0, w, h);
      const vcx = w * 0.5;
      const vcy = h * 0.5;
      const vinR = Math.min(w, h) * 0.32;
      const voutR = Math.max(w, h) * 0.78;
      const vignette = ctx.createRadialGradient(vcx, vcy, vinR, vcx, vcy, voutR);
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.addColorStop(0.65, `rgba(5, 3, 10, ${0.28 * vignetteStrength})`);
      vignette.addColorStop(1, `rgba(5, 3, 10, ${0.8 * vignetteStrength})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
    } else if (presetType === "linear-cosmic") {
      ctx.fillStyle = colors[0] || "#05060A";
      ctx.fillRect(0, 0, w, h);
      const dx = Math.cos(gradientAngle) * w;
      const dy = Math.sin(gradientAngle) * h;
      const x0 = w * 0.5 - dx * 0.5;
      const y0 = h * 0.5 - dy * 0.5;
      const x1 = w * 0.5 + dx * 0.5;
      const y1 = h * 0.5 + dy * 0.5;
      const dualTone = ctx.createLinearGradient(x0, y0, x1, y1);
      dualTone.addColorStop(0, "#060710");
      dualTone.addColorStop(0.28, "#0C1022");
      dualTone.addColorStop(0.5, "#171632");
      dualTone.addColorStop(0.72, "#0A1424");
      dualTone.addColorStop(1, "#040509");
      ctx.fillStyle = dualTone;
      ctx.fillRect(0, 0, w, h);
      const t = timeMs * 0.0003 * flowSpeed;
      const fx1 = w * 0.22 + Math.sin(t * 0.6) * 45;
      const fy1 = h * 0.22 + Math.cos(t * 0.6) * 35;
      const fr1 = w * 0.52;
      const flare1 = ctx.createRadialGradient(fx1, fy1, 10, fx1, fy1, fr1);
      flare1.addColorStop(0, `rgba(129, 140, 248, ${0.32 * illumination})`);
      flare1.addColorStop(0.45, `rgba(99, 102, 241, ${0.12 * illumination})`);
      flare1.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = flare1;
      ctx.fillRect(0, 0, w, h);
      const fx2 = w * 0.8 + Math.cos(t * 0.7) * 45;
      const fy2 = h * 0.76 + Math.sin(t * 0.7) * 35;
      const fr2 = w * 0.56;
      const flare2 = ctx.createRadialGradient(fx2, fy2, 20, fx2, fy2, fr2);
      flare2.addColorStop(0, `rgba(56, 189, 248, ${0.26 * illumination})`);
      flare2.addColorStop(0.45, `rgba(14, 165, 233, ${0.08 * illumination})`);
      flare2.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = flare2;
      ctx.fillRect(0, 0, w, h);
      if (gridIntensity > 0.01) {
        ctx.save();
        ctx.strokeStyle = `rgba(148, 163, 184, ${0.05 * gridIntensity})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const gridSize = 80;
        for (let gx = 0;gx <= w; gx += gridSize) {
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, h);
        }
        for (let gy = 0;gy <= h; gy += gridSize) {
          ctx.moveTo(0, gy);
          ctx.lineTo(w, gy);
        }
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      for (let i = 0;i < StudioRenderer.STARS.length; i++) {
        const s = StudioRenderer.STARS[i];
        const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.speed * 4 + s.phase));
        ctx.fillStyle = `rgba(255, 255, 255, ${twinkle * 0.55 * illumination})`;
        ctx.fillRect(s.x * w, s.y * h, s.size, s.size);
      }
      ctx.restore();
      const vcx = w * 0.5;
      const vcy = h * 0.5;
      const vinR = Math.min(w, h) * 0.25;
      const voutR = Math.max(w, h) * 0.78;
      const cosmicVignette = ctx.createRadialGradient(vcx, vcy, vinR, vcx, vcy, voutR);
      cosmicVignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      cosmicVignette.addColorStop(0.7, `rgba(4, 5, 10, ${0.45 * vignetteStrength})`);
      cosmicVignette.addColorStop(1, `rgba(3, 4, 8, ${0.85 * vignetteStrength})`);
      ctx.fillStyle = cosmicVignette;
      ctx.fillRect(0, 0, w, h);
    } else {
      this.drawMeshGradientBackground(ctx, w, h, preset, timeMs);
    }
  }
  drawMeshGradientBackground(ctx, w, h, preset, timeMs) {
    const t = timeMs * 0.0004;
    const colors = preset.gradientColors;
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, w, h);
    const x1 = w * 0.3 + Math.sin(t) * (w * 0.15);
    const y1 = h * 0.4 + Math.cos(t * 1.2) * (h * 0.15);
    const grad1 = ctx.createRadialGradient(x1, y1, 10, x1, y1, w * 0.65);
    grad1.addColorStop(0, colors[1] || "#8B5CF6");
    grad1.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad1;
    ctx.fillRect(0, 0, w, h);
    const x2 = w * 0.7 + Math.cos(t * 0.8) * (w * 0.18);
    const y2 = h * 0.6 + Math.sin(t * 1.1) * (h * 0.18);
    const grad2 = ctx.createRadialGradient(x2, y2, 20, x2, y2, w * 0.7);
    grad2.addColorStop(0, colors[2] || "#3B82F6");
    grad2.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad2;
    ctx.fillRect(0, 0, w, h);
  }
  applySpotlightMask(ctx, w, h, focalX, focalY) {
    ctx.save();
    const radius = Math.min(w, h) * 0.48;
    const innerRadius = Math.min(w, h) * 0.14;
    const spotGrad = ctx.createRadialGradient(focalX, focalY, innerRadius, focalX, focalY, radius);
    spotGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
    spotGrad.addColorStop(0.45, "rgba(0, 0, 0, 0.18)");
    spotGrad.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    ctx.fillStyle = spotGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  drawKeystrokeHud(ctx, canvasW, canvasH, keystrokes, currentTimeMs, preset) {
    let recent = null;
    for (let i = keystrokes.length - 1;i >= 0; i--) {
      const k = keystrokes[i];
      if (currentTimeMs >= k.t && currentTimeMs - k.t <= 1400) {
        if (!recent || k.t > recent.t) {
          recent = k;
        }
      }
    }
    if (!recent)
      return;
    const elapsed = currentTimeMs - recent.t;
    let alpha = 1;
    let offsetY = 0;
    if (elapsed < 200) {
      const enterProgress = elapsed / 200;
      alpha = enterProgress;
      offsetY = (1 - enterProgress) * 15;
    } else if (elapsed > 1100) {
      alpha = Math.max(0, 1 - (elapsed - 1100) / 300);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    const text = recent.combo;
    ctx.font = '600 22px "JetBrains Mono", Inter, monospace';
    const textMetrics = ctx.measureText(text);
    const padX = 26;
    const padY = 14;
    const badgeW = textMetrics.width + padX * 2;
    const badgeH = 50;
    const x = (canvasW - badgeW) / 2;
    const y = canvasH - 90 + offsetY;
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    const bgGrad = ctx.createLinearGradient(x, y, x, y + badgeH);
    if (preset.keycapTheme === "light") {
      bgGrad.addColorStop(0, "#FFFFFF");
      bgGrad.addColorStop(1, "#E4E4E7");
    } else {
      bgGrad.addColorStop(0, "rgba(30, 32, 42, 0.95)");
      bgGrad.addColorStop(1, "rgba(15, 17, 23, 0.95)");
    }
    ctx.fillStyle = bgGrad;
    this.roundRect(ctx, x, y, badgeW, badgeH, 12);
    ctx.fill();
    ctx.strokeStyle = preset.keycapTheme === "light" ? "rgba(0,0,0,0.15)" : "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, x, y, badgeW, badgeH, 12);
    ctx.stroke();
    ctx.fillStyle = preset.keycapTheme === "light" ? "#0F1117" : "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvasW / 2, y + badgeH / 2);
    ctx.restore();
  }
  drawAnimatedCaptions(ctx, windowW, windowH, captions, timeMs, style, backdrop = 70) {
    const active = captions.find((c) => timeMs >= c.startTime && timeMs <= c.endTime);
    if (!active)
      return;
    ctx.save();
    const isTikTok = style === "tiktok-bold";
    const isKeynote = style === "apple-keynote";
    const isMinimal = style === "minimal-pill";
    const backdropLevel = Math.max(0, Math.min(100, backdrop));
    const backdropAlpha = 0.25 + backdropLevel / 100 * 0.65;
    const backdropBlurPx = backdropLevel / 100 * 16;
    const borderAlpha = 0.1 + backdropLevel / 100 * 0.38;
    const baseFontSize = isTikTok ? Math.max(18, Math.min(26, Math.round(windowW * 0.022))) : isKeynote ? Math.max(16, Math.min(22, Math.round(windowW * 0.019))) : Math.max(15, Math.min(20, Math.round(windowW * 0.017)));
    const fontFace = isKeynote ? '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Plus Jakarta Sans", Inter, sans-serif' : '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.font = `${isTikTok ? "900" : "600"} ${baseFontSize}px ${fontFace}`;
    ctx.textBaseline = "middle";
    const words = active.words && active.words.length > 0 ? active.words : active.text.split(" ").map((w, i, arr) => {
      const dur = active.endTime - active.startTime;
      return {
        word: w,
        startTime: active.startTime + i / arr.length * dur,
        endTime: active.startTime + (i + 1) / arr.length * dur
      };
    });
    const maxLineWidth = windowW * 0.84;
    const spaceWidth = ctx.measureText(" ").width;
    const lines = [];
    let currentLineWords = [];
    let currentLineWidth = 0;
    let currentWordWidths = [];
    words.forEach((w) => {
      const wWidth = ctx.measureText(w.word).width;
      const addedWidth = currentLineWords.length === 0 ? wWidth : spaceWidth + wWidth;
      if (currentLineWidth + addedWidth > maxLineWidth && currentLineWords.length > 0) {
        lines.push({
          words: currentLineWords,
          lineWidth: currentLineWidth,
          wordWidths: currentWordWidths
        });
        currentLineWords = [w];
        currentLineWidth = wWidth;
        currentWordWidths = [wWidth];
      } else {
        currentLineWords.push(w);
        currentLineWidth += addedWidth;
        currentWordWidths.push(wWidth);
      }
    });
    if (currentLineWords.length > 0) {
      lines.push({
        words: currentLineWords,
        lineWidth: currentLineWidth,
        wordWidths: currentWordWidths
      });
    }
    const lineHeight = baseFontSize * 1.5;
    const maxLineW = Math.max(...lines.map((l) => l.lineWidth));
    const padX = isKeynote ? 28 : 22;
    const padY = 12;
    const badgeW = maxLineW + padX * 2;
    const badgeH = lines.length * lineHeight + padY * 2;
    const badgeX = (windowW - badgeW) / 2;
    const badgeY = windowH - badgeH - 36;
    const pillRadius = isTikTok ? 14 : isKeynote || isMinimal ? 9999 : 8;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    this.fillCaptionPill(ctx, badgeX, badgeY, badgeW, badgeH, pillRadius, style, backdropAlpha, backdropBlurPx);
    ctx.restore();
    const borderColor = isMinimal ? `rgba(139, 92, 246, ${Math.min(1, borderAlpha + 0.18)})` : isKeynote ? `rgba(125, 211, 252, ${Math.min(1, borderAlpha + 0.08)})` : `rgba(255, 255, 255, ${borderAlpha})`;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, badgeX, badgeY, badgeW, badgeH, pillRadius);
    ctx.stroke();
    lines.forEach((line, lineIdx) => {
      let curX = (windowW - line.lineWidth) / 2;
      const curY = badgeY + padY + lineIdx * lineHeight + lineHeight / 2;
      line.words.forEach((w, wIdx) => {
        const isWordActive = timeMs >= w.startTime && timeMs <= w.endTime;
        const isPast = timeMs > w.endTime;
        const wWidth = line.wordWidths[wIdx];
        ctx.save();
        if (isWordActive) {
          if (isTikTok) {
            ctx.fillStyle = "#FACC15";
            ctx.shadowColor = "#FACC15";
            ctx.shadowBlur = 14;
            ctx.translate(curX + wWidth / 2, curY);
            ctx.scale(1.08, 1.08);
            ctx.translate(-(curX + wWidth / 2), -curY);
          } else if (isKeynote) {
            ctx.fillStyle = "#38BDF8";
            ctx.shadowColor = "#38BDF8";
            ctx.shadowBlur = 12;
            ctx.translate(curX + wWidth / 2, curY);
            ctx.scale(1.05, 1.05);
            ctx.translate(-(curX + wWidth / 2), -curY);
          } else if (isMinimal) {
            ctx.fillStyle = "#C084FC";
            ctx.shadowColor = "#C084FC";
            ctx.shadowBlur = 8;
          } else {
            ctx.fillStyle = "#FDE047";
          }
        } else if (isPast) {
          ctx.fillStyle = "#FFFFFF";
        } else {
          ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
        }
        ctx.textAlign = "left";
        ctx.fillText(w.word, curX, curY);
        ctx.restore();
        curX += wWidth + spaceWidth;
      });
    });
    ctx.restore();
  }
  fillCaptionPill(ctx, x, y, w, h, radius, style, alpha, blurPx) {
    ctx.save();
    this.roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    if (blurPx >= 1 && "filter" in ctx) {
      try {
        const m = ctx.getTransform();
        const tl = m.transformPoint(new DOMPoint(x, y));
        const br = m.transformPoint(new DOMPoint(x + w, y + h));
        const sx = Math.max(0, Math.floor(Math.min(tl.x, br.x)));
        const sy = Math.max(0, Math.floor(Math.min(tl.y, br.y)));
        const sw = Math.min(ctx.canvas.width - sx, Math.ceil(Math.abs(br.x - tl.x)));
        const sh = Math.min(ctx.canvas.height - sy, Math.ceil(Math.abs(br.y - tl.y)));
        if (sw > 1 && sh > 1) {
          const bctx = getCaptionBlurContext(sw, sh);
          if (bctx && captionBlurCanvas) {
            bctx.clearRect(0, 0, sw, sh);
            bctx.filter = `blur(${blurPx}px)`;
            bctx.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
            bctx.filter = "none";
            ctx.drawImage(captionBlurCanvas, 0, 0, sw, sh, x, y, w, h);
          }
        }
      } catch {}
    }
    const tint = style === "apple-keynote" ? "15, 20, 30" : style === "minimal-pill" ? "15, 17, 23" : "0, 0, 0";
    ctx.fillStyle = `rgba(${tint}, ${alpha})`;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  drawIntroTitleCard(ctx, canvasW, canvasH, headline, subheadline, alpha, scale, preset) {
    if (alpha <= 0.001)
      return;
    const headlineText = headline ?? "";
    const subheadlineText = subheadline ?? "";
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.scale(scale, scale);
    const cardW = Math.min(canvasW * 0.78, 860);
    const cardH = Math.min(canvasH * 0.44, 300);
    const cardX = -cardW / 2;
    const cardY = -cardH / 2;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
    ctx.shadowBlur = 48;
    ctx.shadowOffsetY = 20;
    const cardGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    cardGrad.addColorStop(0, "rgba(20, 24, 35, 0.88)");
    cardGrad.addColorStop(1, "rgba(11, 13, 20, 0.94)");
    ctx.fillStyle = cardGrad;
    this.roundRect(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.fill();
    ctx.restore();
    ctx.save();
    const borderGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    borderGrad.addColorStop(0, "rgba(255, 255, 255, 0.28)");
    borderGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.1)");
    borderGrad.addColorStop(1, "rgba(139, 92, 246, 0.35)");
    ctx.strokeStyle = borderGrad;
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.stroke();
    ctx.restore();
    const badgeText = "SMOOTHSTUDIO PRO DEMO";
    ctx.save();
    ctx.font = "700 11px Inter, sans-serif";
    const badgeMetrics = ctx.measureText(badgeText);
    const badgeW = badgeMetrics.width + 24;
    const badgeH = 26;
    const badgeX = -badgeW / 2;
    const badgeY = cardY + 36;
    ctx.fillStyle = "rgba(139, 92, 246, 0.2)";
    this.roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 13);
    ctx.fill();
    ctx.strokeStyle = "rgba(168, 85, 247, 0.45)";
    ctx.lineWidth = 1;
    this.roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 13);
    ctx.stroke();
    ctx.fillStyle = "#C084FC";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badgeText, 0, badgeY + badgeH / 2);
    ctx.restore();
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const headlineFontSize = Math.max(28, Math.min(52, Math.round(cardW * 0.058)));
    ctx.font = `bold ${headlineFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#FFFFFF";
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
    ctx.fillText(headlineText, 0, cardY + cardH * 0.52);
    ctx.restore();
    if (subheadlineText) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const subFontSize = Math.max(15, Math.min(22, Math.round(cardW * 0.026)));
      ctx.font = `400 ${subFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = "rgba(226, 232, 240, 0.85)";
      ctx.fillText(subheadlineText, 0, cardY + cardH * 0.76);
      ctx.restore();
    }
    ctx.restore();
  }
  drawOutroCtaCard(ctx, canvasW, canvasH, headline, ctaText, alpha, scale, preset) {
    if (alpha <= 0.001)
      return;
    const headlineText = headline ?? "";
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.scale(scale, scale);
    const cardW = Math.min(canvasW * 0.72, 780);
    const cardH = Math.min(canvasH * 0.46, 320);
    const cardX = -cardW / 2;
    const cardY = -cardH / 2;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
    ctx.shadowBlur = 48;
    ctx.shadowOffsetY = 20;
    const cardGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    cardGrad.addColorStop(0, "rgba(20, 24, 35, 0.88)");
    cardGrad.addColorStop(1, "rgba(11, 13, 20, 0.94)");
    ctx.fillStyle = cardGrad;
    this.roundRect(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.fill();
    ctx.restore();
    ctx.save();
    const borderGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    borderGrad.addColorStop(0, "rgba(255, 255, 255, 0.28)");
    borderGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.1)");
    borderGrad.addColorStop(1, "rgba(236, 72, 153, 0.4)");
    ctx.strokeStyle = borderGrad;
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 11px Inter, sans-serif";
    ctx.fillStyle = "#C084FC";
    ctx.fillText("THANKS FOR WATCHING", 0, cardY + 38);
    ctx.restore();
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const headlineFontSize = Math.max(26, Math.min(46, Math.round(cardW * 0.054)));
    ctx.font = `bold ${headlineFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#FFFFFF";
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
    ctx.fillText(headlineText, 0, cardY + cardH * 0.44);
    ctx.restore();
    const cta = ctaText ?? "";
    ctx.save();
    ctx.font = "700 15px Inter, sans-serif";
    const ctaMetrics = ctx.measureText(cta);
    const ctaPadX = 24;
    const ctaW = ctaMetrics.width + ctaPadX * 2;
    const ctaH = 46;
    const ctaX = -ctaW / 2;
    const ctaY = cardY + cardH * 0.64;
    ctx.shadowColor = "rgba(139, 92, 246, 0.8)";
    ctx.shadowBlur = 28;
    const ctaGrad = ctx.createLinearGradient(ctaX, ctaY, ctaX + ctaW, ctaY + ctaH);
    ctaGrad.addColorStop(0, "#8B5CF6");
    ctaGrad.addColorStop(0.5, "#6366F1");
    ctaGrad.addColorStop(1, "#EC4899");
    ctx.fillStyle = ctaGrad;
    this.roundRect(ctx, ctaX, ctaY, ctaW, ctaH, 9999);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    this.roundRect(ctx, ctaX, ctaY, ctaW, ctaH, 9999);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 15px Inter, sans-serif";
    ctx.fillStyle = "#FFFFFF";
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 6;
    ctx.fillText(cta, 0, ctaY + ctaH / 2 + 1);
    ctx.restore();
    ctx.restore();
  }
  roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

// src/engine/spring-physics.ts
var DEFAULT_SPRING_CONFIG = {
  stiffness: 170,
  damping: 26,
  mass: 1
};

class SpringVariable {
  current;
  target;
  velocity = 0;
  config;
  constructor(initialValue, config = DEFAULT_SPRING_CONFIG) {
    this.current = initialValue;
    this.target = initialValue;
    this.config = config;
  }
  update(dt) {
    const clampedDt = Math.min(0.064, Math.max(0.001, Number.isFinite(dt) ? dt : 0.016));
    const displacement = this.current - this.target;
    const springForce = -this.config.stiffness * displacement;
    const dampingForce = -this.config.damping * this.velocity;
    const acceleration = (springForce + dampingForce) / (this.config.mass || 1);
    this.velocity += acceleration * clampedDt;
    this.current += this.velocity * clampedDt;
    if (!Number.isFinite(this.current) || !Number.isFinite(this.velocity)) {
      this.current = this.target;
      this.velocity = 0;
    }
    if (Math.abs(displacement) < 0.0001 && Math.abs(this.velocity) < 0.0001) {
      this.current = this.target;
      this.velocity = 0;
    }
    return this.current;
  }
  setTarget(target) {
    this.target = target;
  }
  snapTo(value) {
    this.current = value;
    this.target = value;
    this.velocity = 0;
  }
}

class SpringCameraSolver {
  xSpring;
  ySpring;
  scaleSpring;
  tiltXSpring;
  tiltYSpring;
  constructor(initialState = { x: 0.5, y: 0.5, scale: 1, tiltX: 0, tiltY: 0 }) {
    this.xSpring = new SpringVariable(initialState.x);
    this.ySpring = new SpringVariable(initialState.y);
    this.scaleSpring = new SpringVariable(initialState.scale);
    this.tiltXSpring = new SpringVariable(initialState.tiltX);
    this.tiltYSpring = new SpringVariable(initialState.tiltY);
  }
  setTarget(state) {
    if (state.x !== undefined)
      this.xSpring.setTarget(state.x);
    if (state.y !== undefined)
      this.ySpring.setTarget(state.y);
    if (state.scale !== undefined)
      this.scaleSpring.setTarget(state.scale);
    if (state.tiltX !== undefined)
      this.tiltXSpring.setTarget(state.tiltX);
    if (state.tiltY !== undefined)
      this.tiltYSpring.setTarget(state.tiltY);
  }
  update(dt) {
    return {
      x: this.xSpring.update(dt),
      y: this.ySpring.update(dt),
      scale: this.scaleSpring.update(dt),
      tiltX: this.tiltXSpring.update(dt),
      tiltY: this.tiltYSpring.update(dt)
    };
  }
  getState() {
    return {
      x: this.xSpring.current,
      y: this.ySpring.current,
      scale: this.scaleSpring.current,
      tiltX: this.tiltXSpring.current,
      tiltY: this.tiltYSpring.current
    };
  }
  snapTo(state) {
    this.xSpring.snapTo(state.x);
    this.ySpring.snapTo(state.y);
    this.scaleSpring.snapTo(state.scale);
    this.tiltXSpring.snapTo(state.tiltX);
    this.tiltYSpring.snapTo(state.tiltY);
  }
}
function computeCinematicCameraState(timeMs, pills, cursor, viewportWidth = 1920, viewportHeight = 1080, followCursor = true) {
  const TRANSITION_MS = 500;
  const smootherStep = (t) => {
    const c = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
    return c * c * c * (c * (c * 6 - 15) + 10);
  };
  let activePill;
  let activePillIndex = -1;
  for (let i = 0;i < pills.length; i++) {
    if (timeMs >= pills[i].startTime && timeMs <= pills[i].endTime) {
      activePill = pills[i];
      activePillIndex = i;
      break;
    }
  }
  let normCursorX = 0.5;
  let normCursorY = 0.5;
  const hasCursor = Boolean(cursor && viewportWidth > 0 && viewportHeight > 0);
  if (hasCursor && cursor) {
    const rawX = cursor.x <= 1 ? cursor.x : cursor.x / viewportWidth;
    const rawY = cursor.y <= 1 ? cursor.y : cursor.y / viewportHeight;
    normCursorX = Math.max(0.05, Math.min(0.95, rawX));
    normCursorY = Math.max(0.05, Math.min(0.95, rawY));
  }
  if (!activePill && pills.length > 1) {
    for (let i = 0;i < pills.length - 1; i++) {
      const p1 = pills[i];
      const p2 = pills[i + 1];
      const gap = p2.startTime - p1.endTime;
      if (gap >= 0 && gap <= 800 && timeMs >= p1.endTime && timeMs <= p2.startTime) {
        const p = gap > 0 ? (timeMs - p1.endTime) / gap : 0;
        const ease = smootherStep(p);
        return {
          x: p1.targetX + (p2.targetX - p1.targetX) * ease,
          y: p1.targetY + (p2.targetY - p1.targetY) * ease,
          scale: p1.targetScale + (p2.targetScale - p1.targetScale) * ease,
          tiltX: p1.tiltX + (p2.tiltX - p1.tiltX) * ease,
          tiltY: p1.tiltY + (p2.tiltY - p1.tiltY) * ease
        };
      }
    }
  }
  if (activePill) {
    const start = activePill.startTime;
    const end = activePill.endTime;
    const totalPillDuration = Math.max(1, end - start);
    const actualTransition = Math.max(1, Math.min(TRANSITION_MS, totalPillDuration * 0.35));
    const nextPill = activePillIndex >= 0 && activePillIndex < pills.length - 1 ? pills[activePillIndex + 1] : undefined;
    const isChainedToNext = nextPill && nextPill.startTime - end <= 800;
    const prevPill = activePillIndex > 0 ? pills[activePillIndex - 1] : undefined;
    const isChainedFromPrev = prevPill && start - prevPill.endTime <= 800;
    let targetX = activePill.targetX;
    let targetY = activePill.targetY;
    if (hasCursor && followCursor) {
      targetX = targetX + (normCursorX - targetX) * 0.32;
      targetY = targetY + (normCursorY - targetY) * 0.32;
    }
    if (timeMs < start + actualTransition && !isChainedFromPrev) {
      const p = Math.max(0, Math.min(1, (timeMs - start) / actualTransition));
      const ease = smootherStep(p);
      return {
        x: 0.5 + (targetX - 0.5) * ease,
        y: 0.5 + (targetY - 0.5) * ease,
        scale: 1 + (activePill.targetScale - 1) * ease,
        tiltX: activePill.tiltX * ease,
        tiltY: activePill.tiltY * ease
      };
    } else if (timeMs < start + actualTransition && isChainedFromPrev && prevPill) {
      return {
        x: targetX,
        y: targetY,
        scale: activePill.targetScale,
        tiltX: activePill.tiltX,
        tiltY: activePill.tiltY
      };
    } else if (timeMs > end - actualTransition && isChainedToNext && nextPill) {
      const p = Math.max(0, Math.min(1, (timeMs - (end - actualTransition)) / actualTransition));
      const ease = smootherStep(p);
      return {
        x: targetX + (nextPill.targetX - targetX) * ease,
        y: targetY + (nextPill.targetY - targetY) * ease,
        scale: activePill.targetScale + (nextPill.targetScale - activePill.targetScale) * ease,
        tiltX: activePill.tiltX + (nextPill.tiltX - activePill.tiltX) * ease,
        tiltY: activePill.tiltY + (nextPill.tiltY - activePill.tiltY) * ease
      };
    } else if (timeMs > end - actualTransition && !isChainedToNext) {
      const p = Math.max(0, Math.min(1, (end - timeMs) / actualTransition));
      const ease = smootherStep(p);
      return {
        x: 0.5 + (targetX - 0.5) * ease,
        y: 0.5 + (targetY - 0.5) * ease,
        scale: 1 + (activePill.targetScale - 1) * ease,
        tiltX: activePill.tiltX * ease,
        tiltY: activePill.tiltY * ease
      };
    }
    return {
      x: targetX,
      y: targetY,
      scale: activePill.targetScale,
      tiltX: activePill.tiltX,
      tiltY: activePill.tiltY
    };
  }
  if (hasCursor && followCursor) {
    return {
      x: 0.5 + (normCursorX - 0.5) * 0.12,
      y: 0.5 + (normCursorY - 0.5) * 0.12,
      scale: 1,
      tiltX: 0,
      tiltY: 0
    };
  }
  return { x: 0.5, y: 0.5, scale: 1, tiltX: 0, tiltY: 0 };
}

// src/engine/diagnostic-channel.ts
class DiagnosticDataChannel {
  listeners = new Set;
  activeDegradations = new Map;
  storageMode = "opfs";
  encoderStreamMode = "hardware-mp4";
  frameDropCount = 0;
  subscribe(listener) {
    this.listeners.add(listener);
    for (const evt of this.activeDegradations.values()) {
      try {
        listener(evt);
      } catch (err) {
        console.error("[DiagnosticChannel] Listener error:", err);
      }
    }
    return () => {
      this.listeners.delete(listener);
    };
  }
  reportDegradation(event) {
    const fullEvent = {
      ...event,
      id: `${event.source}_${Date.now()}`,
      timestamp: Date.now()
    };
    this.activeDegradations.set(event.source, fullEvent);
    this.notifyAll(fullEvent);
    return fullEvent;
  }
  recordFrameDrop(errorDetail) {
    this.frameDropCount++;
    if (this.frameDropCount >= 1) {
      this.reportDegradation({
        source: "webcodecs",
        severity: "critical",
        title: "Hardware Encoding Frame Drops Detected",
        message: `WebCodecs GPU pipeline dropped hardware encoding frames (${this.frameDropCount} detected). Local GPU may be throttled or saturated.`,
        canDowngradeEncoder: true,
        details: errorDetail || `Frame drop event count: ${this.frameDropCount}`
      });
    }
  }
  recordStorageCap(errorDetail) {
    this.reportDegradation({
      source: "opfs",
      severity: "critical",
      title: "OPFS Storage Quota / Permission Cap Reached",
      message: "The local profile storage quota or permission boundary capped disk writes. Disk-heavy OPFS stream is degraded.",
      canFallbackToRam: true,
      details: errorDetail || "Origin Private File System write stream encountered a storage cap or permission rejection."
    });
  }
  clearDegradation(source) {
    if (source) {
      this.activeDegradations.delete(source);
      if (source === "webcodecs")
        this.frameDropCount = 0;
    } else {
      this.activeDegradations.clear();
      this.frameDropCount = 0;
    }
  }
  getActiveDegradations() {
    return Array.from(this.activeDegradations.values());
  }
  getStorageMode() {
    return this.storageMode;
  }
  setStorageMode(mode) {
    this.storageMode = mode;
  }
  getEncoderStreamMode() {
    return this.encoderStreamMode;
  }
  setEncoderStreamMode(mode) {
    this.encoderStreamMode = mode;
  }
  notifyAll(event) {
    this.listeners.forEach((l) => {
      try {
        l(event);
      } catch (err) {
        console.error("[DiagnosticChannel] Notification error:", err);
      }
    });
  }
}
var diagnosticChannel = new DiagnosticDataChannel;

// src/engine/webm-timestamps.ts
var SEGMENT = 408125543;
var INFO = 357149030;
var TIMECODE_SCALE = 2807729;
var TRACKS = 374648427;
var TRACK_ENTRY = 174;
var TRACK_NUMBER = 215;
var TRACK_TYPE = 131;
var CLUSTER = 524531317;
var TIMECODE = 231;
var SIMPLE_BLOCK = 163;
var BLOCK_GROUP = 160;
var BLOCK = 161;
var DEFAULT_TIMECODE_SCALE_NS = 1e6;
var DEFAULT_SCAN_BYTES = 16 * 1024 * 1024;
function readVint(bytes2, pos, limit) {
  if (pos >= limit)
    return null;
  const first = bytes2[pos];
  if (first === 0)
    return null;
  let length = 1;
  let mask = 128;
  while ((first & mask) === 0) {
    mask >>= 1;
    length++;
    if (length > 8 || pos + length > limit)
      return null;
  }
  let value = first & mask - 1;
  let allOnes = value === mask - 1;
  for (let i = 1;i < length; i++) {
    const b = bytes2[pos + i];
    value = value * 256 + b;
    if (b !== 255)
      allOnes = false;
  }
  return { length, value, unknown: allOnes };
}
function readElement(bytes2, pos, limit) {
  if (pos + 1 > limit)
    return null;
  const first = bytes2[pos];
  if (first === 0)
    return null;
  let idLength = 1;
  if (first & 128)
    idLength = 1;
  else if (first & 64)
    idLength = 2;
  else if (first & 32)
    idLength = 3;
  else if (first & 16)
    idLength = 4;
  else
    return null;
  if (pos + idLength > limit)
    return null;
  let id = 0;
  for (let i = 0;i < idLength; i++)
    id = id * 256 + bytes2[pos + i];
  const sizePos = pos + idLength;
  const size = readVint(bytes2, sizePos, limit);
  if (!size)
    return null;
  const contentStart = sizePos + size.length;
  const contentEnd = size.unknown ? limit : Math.min(limit, contentStart + size.value);
  if (contentEnd < contentStart)
    return null;
  return { id, start: pos, contentStart, contentEnd, unknownSize: size.unknown };
}
function readUint(bytes2, start, end) {
  let value = 0;
  for (let i = start;i < end; i++)
    value = value * 256 + bytes2[i];
  return value;
}
function readBlockHeader(bytes2, start, end) {
  const trackVint = readVint(bytes2, start, end);
  if (!trackVint)
    return null;
  const relPos = start + trackVint.length;
  if (relPos + 2 > end)
    return null;
  let rel = bytes2[relPos] << 8 | bytes2[relPos + 1];
  if (rel & 32768)
    rel -= 65536;
  return { track: trackVint.value, relTime: rel };
}
var EMPTY_TRACK_TIMES = {
  videoStartMs: null,
  audioStartMs: null,
  videoTrackNumber: null,
  audioTrackNumber: null,
  unknownSegmentSize: false
};
function readWebmTrackStartTimes(bytes2) {
  if (!bytes2 || bytes2.length < 8)
    return { ...EMPTY_TRACK_TIMES };
  const limit = bytes2.length;
  let segment = null;
  let pos = 0;
  while (pos < limit) {
    const el = readElement(bytes2, pos, limit);
    if (!el)
      break;
    if (el.id === SEGMENT) {
      segment = el;
      break;
    }
    if (el.unknownSize)
      break;
    pos = el.contentEnd;
  }
  if (!segment)
    return { ...EMPTY_TRACK_TIMES };
  const trackTypes = new Map;
  let timecodeScale = DEFAULT_TIMECODE_SCALE_NS;
  let audioStartTicks = null;
  let videoStartTicks = null;
  const parseTracks = (tracks) => {
    let p = tracks.contentStart;
    while (p < tracks.contentEnd) {
      const entry = readElement(bytes2, p, tracks.contentEnd);
      if (!entry)
        break;
      if (entry.id === TRACK_ENTRY) {
        let number = null;
        let type = null;
        let q = entry.contentStart;
        while (q < entry.contentEnd) {
          const child = readElement(bytes2, q, entry.contentEnd);
          if (!child)
            break;
          if (child.id === TRACK_NUMBER)
            number = readUint(bytes2, child.contentStart, child.contentEnd);
          else if (child.id === TRACK_TYPE)
            type = readUint(bytes2, child.contentStart, child.contentEnd);
          if (child.unknownSize)
            break;
          q = child.contentEnd;
        }
        if (number !== null && type !== null)
          trackTypes.set(number, type);
      }
      if (entry.unknownSize)
        break;
      p = entry.contentEnd;
    }
  };
  const recordBlock = (clusterTimecode, block) => {
    const header = readBlockHeader(bytes2, block.contentStart, block.contentEnd);
    if (!header)
      return;
    const type = trackTypes.get(header.track);
    const absolute = clusterTimecode + header.relTime;
    if (type === 2 && audioStartTicks === null)
      audioStartTicks = absolute;
    else if (type === 1 && videoStartTicks === null)
      videoStartTicks = absolute;
  };
  let current = segment.contentStart;
  while (current < limit) {
    const el = readElement(bytes2, current, limit);
    if (!el)
      break;
    if (el.id === TRACKS) {
      parseTracks(el);
    } else if (el.id === INFO) {
      let q = el.contentStart;
      while (q < el.contentEnd) {
        const child = readElement(bytes2, q, el.contentEnd);
        if (!child)
          break;
        if (child.id === TIMECODE_SCALE) {
          const scale = readUint(bytes2, child.contentStart, child.contentEnd);
          if (scale > 0)
            timecodeScale = scale;
        }
        if (child.unknownSize)
          break;
        q = child.contentEnd;
      }
    } else if (el.id === CLUSTER) {
      let clusterTimecode = 0;
      let c = el.contentStart;
      while (c < el.contentEnd) {
        if (c + 4 <= limit && readUint(bytes2, c, c + 4) === CLUSTER)
          break;
        const child = readElement(bytes2, c, el.contentEnd);
        if (!child)
          break;
        if (child.id === TIMECODE) {
          clusterTimecode = readUint(bytes2, child.contentStart, child.contentEnd);
        } else if (child.id === SIMPLE_BLOCK) {
          recordBlock(clusterTimecode, child);
        } else if (child.id === BLOCK_GROUP) {
          let g = child.contentStart;
          while (g < child.contentEnd) {
            const grand = readElement(bytes2, g, child.contentEnd);
            if (!grand)
              break;
            if (grand.id === BLOCK)
              recordBlock(clusterTimecode, grand);
            if (grand.unknownSize)
              break;
            g = grand.contentEnd;
          }
        }
        if (child.unknownSize)
          break;
        c = child.contentEnd;
      }
      if (audioStartTicks !== null && videoStartTicks !== null)
        break;
    }
    if (el.unknownSize)
      break;
    current = el.contentEnd;
  }
  const ticksToMs = (ticks) => ticks * timecodeScale / 1e6;
  let audioTrackNumber = null;
  let videoTrackNumber = null;
  for (const [num, type] of trackTypes) {
    if (type === 2 && audioTrackNumber === null)
      audioTrackNumber = num;
    if (type === 1 && videoTrackNumber === null)
      videoTrackNumber = num;
  }
  return {
    audioStartMs: audioStartTicks === null ? null : ticksToMs(audioStartTicks),
    videoStartMs: videoStartTicks === null ? null : ticksToMs(videoStartTicks),
    audioTrackNumber,
    videoTrackNumber,
    unknownSegmentSize: segment.unknownSize
  };
}
async function readWebmAudioStartMs(blob, scanBytes = DEFAULT_SCAN_BYTES) {
  if (!blob || blob.size < 8)
    return 0;
  try {
    const slice = blob.slice(0, Math.min(blob.size, scanBytes));
    const bytes2 = new Uint8Array(await slice.arrayBuffer());
    const info = readWebmTrackStartTimes(bytes2);
    if (info.audioStartMs === null)
      return 0;
    return Math.max(0, Math.round(info.audioStartMs * 1000) / 1000);
  } catch {
    return 0;
  }
}

// src/engine/audio-track.ts
var MAX_ALIGNMENT_MS = 60000;
function alignPcmToTimeline(pcm, startTimeMs) {
  if (!Number.isFinite(startTimeMs) || startTimeMs <= 0)
    return pcm;
  if (!Number.isFinite(pcm.sampleRate) || pcm.sampleRate <= 0)
    return pcm;
  const capped = Math.min(startTimeMs, MAX_ALIGNMENT_MS);
  const padSamples = Math.round(capped / 1000 * pcm.sampleRate);
  if (padSamples <= 0)
    return pcm;
  const channels = pcm.channels.map((src) => {
    const out = new Float32Array(src.length + padSamples);
    out.set(src, padSamples);
    return out;
  });
  return { channels, sampleRate: pcm.sampleRate };
}
function webmHasAudioTrack(bytes2) {
  const limit = Math.min(bytes2.length, 4 * 1024 * 1024);
  const find = (needle) => {
    const n = needle.length;
    outer:
      for (let i = 0;i <= limit - n; i++) {
        for (let j = 0;j < n; j++) {
          if (bytes2[i + j] !== needle.charCodeAt(j))
            continue outer;
        }
        return true;
      }
    return false;
  };
  return find("A_OPUS") || find("A_VORBIS");
}
async function decodeRecordingPcm(blob) {
  const ctx = new AudioContext;
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (decoded.numberOfChannels === 0 || decoded.length === 0) {
      throw new Error("The recording contains an audio track with no samples.");
    }
    const channels = [];
    for (let c = 0;c < decoded.numberOfChannels; c++) {
      channels.push(new Float32Array(decoded.getChannelData(c)));
    }
    const audioStartMs = await readWebmAudioStartMs(blob);
    return alignPcmToTimeline({ channels, sampleRate: decoded.sampleRate }, audioStartMs);
  } catch (err) {
    throw new Error(`Could not decode the recording's audio track: ${err?.message || err}`);
  } finally {
    await ctx.close().catch(() => {
      return;
    });
  }
}
function pcmDurationMs(pcm) {
  const len = pcm.channels.length ? Math.max(...pcm.channels.map((c) => c.length)) : 0;
  if (!pcm.sampleRate || pcm.sampleRate <= 0)
    return 0;
  return len * 1000 / pcm.sampleRate;
}
var clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function keepRangesFromCuts(cuts, durationMs) {
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  if (duration === 0)
    return [];
  const normalized = [];
  for (const c of cuts) {
    if (!Number.isFinite(c?.startTime) || !Number.isFinite(c?.endTime))
      continue;
    const start = clamp(c.startTime, 0, duration);
    const end = clamp(c.endTime, 0, duration);
    if (end > start)
      normalized.push({ start, end });
  }
  normalized.sort((a, b) => a.start - b.start);
  const keep = [];
  let cursor = 0;
  for (const c of normalized) {
    if (c.start > cursor)
      keep.push({ startTime: cursor, endTime: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < duration)
    keep.push({ startTime: cursor, endTime: duration });
  return keep;
}
function cutPcmToKeepRanges(pcm, keep) {
  if (!pcm.channels.length) {
    throw new Error("The recording has no audio channels to cut.");
  }
  if (!Number.isFinite(pcm.sampleRate) || pcm.sampleRate <= 0) {
    throw new Error(`The recording's audio has an invalid sample rate (${pcm.sampleRate}).`);
  }
  const totalLen = Math.min(...pcm.channels.map((c) => c.length));
  if (totalLen === 0) {
    throw new Error("The recording's audio track has no samples.");
  }
  const spans = [];
  for (const r of keep) {
    if (!Number.isFinite(r?.startTime) || !Number.isFinite(r?.endTime))
      continue;
    const from = clamp(Math.floor(r.startTime / 1000 * pcm.sampleRate), 0, totalLen);
    const to = clamp(Math.floor(r.endTime / 1000 * pcm.sampleRate), 0, totalLen);
    if (to > from)
      spans.push({ from, to });
  }
  spans.sort((a, b) => a.from - b.from);
  const merged = [];
  for (const s of spans) {
    const last2 = merged[merged.length - 1];
    if (last2 && s.from <= last2.to) {
      last2.to = Math.max(last2.to, s.to);
    } else {
      merged.push({ ...s });
    }
  }
  const outLen = merged.reduce((sum, s) => sum + (s.to - s.from), 0);
  if (outLen === 0) {
    throw new Error("The cut ranges removed the whole audio track: the export would have no audio.");
  }
  const channels = pcm.channels.map((src) => {
    const out = new Float32Array(outLen);
    let w = 0;
    for (const s of merged) {
      out.set(src.subarray(s.from, s.to), w);
      w += s.to - s.from;
    }
    return out;
  });
  return { channels, sampleRate: pcm.sampleRate };
}
var AAC_CODEC = "mp4a.40.2";
var AAC_OUTPUT_CHANNELS = 2;
var AAC_BITRATE = 160000;
var AAC_FRAME_SAMPLES = 1024;
function emitWithoutPriming(chunks, sampleRate) {
  if (chunks.length < 2)
    return chunks;
  const primingUs = Math.round(AAC_FRAME_SAMPLES / sampleRate * 1e6);
  return chunks.slice(1).map((chunk) => ({
    ...chunk,
    timestamp: Math.max(0, chunk.timestamp - primingUs)
  }));
}
async function encodeAac(pcm, onChunk) {
  const config = {
    codec: AAC_CODEC,
    sampleRate: pcm.sampleRate,
    numberOfChannels: AAC_OUTPUT_CHANNELS,
    bitrate: AAC_BITRATE
  };
  const support = await AudioEncoder.isConfigSupported(config);
  if (!support.supported) {
    throw new Error(`AAC audio encoding (${AAC_CODEC}, ${pcm.sampleRate} Hz) is not supported by this browser. Export aborted.`);
  }
  let encoderError = null;
  const encoded = [];
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      encoded.push({
        data,
        type: chunk.type,
        timestamp: chunk.timestamp,
        duration: chunk.duration ?? Math.round(AAC_FRAME_SAMPLES / pcm.sampleRate * 1e6),
        meta
      });
    },
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e));
    }
  });
  encoder.configure(config);
  const left = pcm.channels[0];
  const right = pcm.channels[1] ?? pcm.channels[0];
  const total = left.length;
  try {
    const priming = new AudioData({
      format: "f32-planar",
      sampleRate: pcm.sampleRate,
      numberOfFrames: AAC_FRAME_SAMPLES,
      numberOfChannels: 2,
      timestamp: 0,
      data: new Float32Array(AAC_FRAME_SAMPLES * 2)
    });
    encoder.encode(priming);
    priming.close();
    for (let start = 0;start < total; start += AAC_FRAME_SAMPLES) {
      if (encoderError)
        throw encoderError;
      const frames = Math.min(AAC_FRAME_SAMPLES, total - start);
      const planar = new Float32Array(frames * 2);
      planar.set(left.subarray(start, start + frames), 0);
      planar.set(right.subarray(start, start + frames), frames);
      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate: pcm.sampleRate,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: Math.round((start + AAC_FRAME_SAMPLES) / pcm.sampleRate * 1e6),
        data: planar
      });
      encoder.encode(audioData);
      audioData.close();
      while (encoder.encodeQueueSize > 64) {
        await new Promise((r) => setTimeout(r, 2));
      }
    }
    await encoder.flush();
    if (encoderError)
      throw encoderError;
  } finally {
    try {
      encoder.close();
    } catch {}
  }
  const chunks = emitWithoutPriming(encoded, pcm.sampleRate);
  for (const chunk of chunks)
    onChunk(chunk);
  return chunks.length;
}

// src/engine/video-seeker.ts
var DEFAULT_SEEK_TIMEOUT_MS = 2000;
var DEFAULT_READY_TIMEOUT_MS = 1e4;
var DEFAULT_POLL_MS = 50;
var DEFAULT_EPSILON_SEC = 0.004;
var DEFAULT_FRAME_GRACE_MS = 0;
function describeMediaState(video) {
  const range = (r) => {
    if (!r || r.length === 0)
      return "empty";
    return `[${r.start(0).toFixed(3)}..${r.end(r.length - 1).toFixed(3)}]`;
  };
  return [
    `currentTime=${video.currentTime.toFixed(3)}`,
    `duration=${Number.isFinite(video.duration) ? video.duration.toFixed(3) : String(video.duration)}`,
    `readyState=${video.readyState}`,
    `seeking=${video.seeking}`,
    `seekable=${range(video.seekable)}`,
    `buffered=${range(video.buffered)}`,
    `error=${video.error ? `${video.error.code}:${video.error.message ?? ""}` : "none"}`
  ].join(", ");
}

class VideoFrameSeeker {
  video;
  options;
  disposed = false;
  rvfcUsable = true;
  activeCleanup = null;
  constructor(video, options = {}) {
    this.video = video;
    this.options = options;
  }
  get timeoutMs() {
    return this.options.timeoutMs ?? DEFAULT_SEEK_TIMEOUT_MS;
  }
  get pollMs() {
    return this.options.pollIntervalMs ?? DEFAULT_POLL_MS;
  }
  get epsilon() {
    return this.options.epsilonSec ?? DEFAULT_EPSILON_SEC;
  }
  get frameGraceMs() {
    return this.options.frameGraceMs ?? DEFAULT_FRAME_GRACE_MS;
  }
  async waitUntilReady(signal, timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
    if (this.disposed)
      throw new Error("The video seeker has been disposed.");
    if (signal?.aborted)
      throw abortError();
    if (this.video.error)
      throw mediaError(this.video, "while waiting for the video to become ready");
    if (this.video.readyState >= 2)
      return;
    await new Promise((resolve, reject) => {
      const started = Date.now();
      let timer = null;
      let settled = false;
      const cleanup = () => {
        if (timer !== null)
          clearInterval(timer);
        this.video.removeEventListener("loadeddata", onReady);
        this.video.removeEventListener("canplay", onReady);
        this.video.removeEventListener("error", onError);
        this.video.removeEventListener("abort", onAbort);
        signal?.removeEventListener("abort", onAbort);
        this.activeCleanup = null;
      };
      const finish = (fn) => {
        if (settled)
          return;
        settled = true;
        cleanup();
        fn();
      };
      const onReady = () => {
        if (this.video.readyState >= 2)
          finish(resolve);
      };
      const onError = () => finish(() => reject(mediaError(this.video, "while waiting for the video to become ready")));
      const onAbort = () => finish(() => reject(abortError()));
      this.video.addEventListener("loadeddata", onReady);
      this.video.addEventListener("canplay", onReady);
      this.video.addEventListener("error", onError);
      this.video.addEventListener("abort", onAbort);
      signal?.addEventListener("abort", onAbort);
      this.activeCleanup = () => finish(() => reject(abortError("The video seeker was disposed.")));
      timer = setInterval(() => {
        if (this.video.error)
          return onError();
        if (this.video.readyState >= 2)
          return onReady();
        if (Date.now() - started >= timeoutMs) {
          finish(() => reject(new Error(`The video element did not become decodable within ${timeoutMs}ms (${describeMediaState(this.video)}).`)));
        }
      }, this.pollMs);
      onReady();
    });
  }
  async seekTo(targetSec, signal) {
    if (this.disposed)
      throw new Error("The video seeker has been disposed.");
    if (!Number.isFinite(targetSec))
      throw new Error(`Cannot seek to a non-finite time (${targetSec}).`);
    if (signal?.aborted)
      throw abortError();
    if (this.video.error)
      throw mediaError(this.video, `before seeking to ${targetSec.toFixed(3)}s`);
    if (this.video.readyState < 1) {
      await this.waitUntilReady(signal);
    }
    const range = this.video.seekable;
    let maxSec;
    if (range && range.length > 0) {
      maxSec = range.end(range.length - 1);
    } else if (Number.isFinite(this.video.duration) && this.video.duration > 0) {
      maxSec = this.video.duration;
    } else {
      throw new Error(`Cannot seek to ${targetSec.toFixed(3)}s: the media has no seekable range (${describeMediaState(this.video)}).`);
    }
    const clampedSec = Math.min(Math.max(targetSec, 0), Math.max(0, maxSec));
    const clamped = Math.abs(clampedSec - targetSec) > 0.000001;
    if (!this.video.seeking && this.video.readyState >= 2 && Math.abs(this.video.currentTime - clampedSec) <= this.epsilon) {
      return { targetSec: clampedSec, clamped, waited: false, presentedMediaTimeSec: null };
    }
    return await new Promise((resolve, reject) => {
      const started = Date.now();
      let settled = false;
      let timer = null;
      let frameHandle = null;
      let graceTimer = null;
      let presented = null;
      const cleanup = () => {
        this.video.removeEventListener("seeked", onSeeked);
        this.video.removeEventListener("loadeddata", onSeeked);
        this.video.removeEventListener("canplay", onSeeked);
        this.video.removeEventListener("error", onError);
        this.video.removeEventListener("abort", onAbort);
        this.video.removeEventListener("emptied", onAbort);
        signal?.removeEventListener("abort", onAbort);
        if (timer !== null)
          clearInterval(timer);
        if (graceTimer !== null)
          clearTimeout(graceTimer);
        if (frameHandle !== null && this.video.cancelVideoFrameCallback) {
          try {
            this.video.cancelVideoFrameCallback(frameHandle);
          } catch {}
        }
        this.activeCleanup = null;
      };
      const finish = (fn) => {
        if (settled)
          return;
        settled = true;
        cleanup();
        fn();
      };
      const succeed = () => finish(() => resolve({
        targetSec: clampedSec,
        clamped,
        waited: true,
        presentedMediaTimeSec: presented
      }));
      const failWith = (error) => finish(() => reject(typeof error === "string" ? new Error(error) : error));
      const onError = () => failWith(mediaError(this.video, `while seeking to ${clampedSec.toFixed(3)}s`));
      const onAbort = () => failWith(abortError());
      const frameIsAvailable = () => !this.video.seeking && this.video.readyState >= 2 && Math.abs(this.video.currentTime - clampedSec) <= this.epsilon;
      const onSeeked = () => {
        if (this.video.error)
          return onError();
        if (this.rvfcUsable && this.frameGraceMs > 0 && typeof this.video.requestVideoFrameCallback === "function") {
          let handled = false;
          frameHandle = this.video.requestVideoFrameCallback((_now, metadata) => {
            presented = metadata.mediaTime;
            if (!handled && frameIsAvailable()) {
              handled = true;
              succeed();
            }
          });
          graceTimer = setTimeout(() => {
            if (handled)
              return;
            if (presented === null)
              this.rvfcUsable = false;
            if (frameIsAvailable()) {
              handled = true;
              succeed();
            }
          }, this.frameGraceMs);
          return;
        }
        if (frameIsAvailable())
          succeed();
      };
      this.video.addEventListener("seeked", onSeeked);
      this.video.addEventListener("loadeddata", onSeeked);
      this.video.addEventListener("canplay", onSeeked);
      this.video.addEventListener("error", onError);
      this.video.addEventListener("abort", onAbort);
      this.video.addEventListener("emptied", onAbort);
      signal?.addEventListener("abort", onAbort);
      this.activeCleanup = () => finish(() => reject(abortError("The video seeker was disposed.")));
      timer = setInterval(() => {
        if (this.video.error)
          return onError();
        if (frameIsAvailable())
          return succeed();
        if (Date.now() - started >= this.timeoutMs) {
          failWith(`Seek timeout: the video frame at ${clampedSec.toFixed(3)}s was not presented within ${this.timeoutMs}ms ` + `(${describeMediaState(this.video)}).`);
        }
      }, this.pollMs);
      try {
        this.video.currentTime = clampedSec;
      } catch (err) {
        failWith(`Seek failed at ${clampedSec.toFixed(3)}s: ${err?.message || err}`);
      }
    });
  }
  dispose() {
    this.disposed = true;
    this.activeCleanup?.();
    this.activeCleanup = null;
  }
}
function abortError(message = "The export was cancelled while seeking.") {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}
function mediaError(video, context) {
  const detail = video.error ? `code ${video.error.code}${video.error.message ? ` (${video.error.message})` : ""}` : "unknown";
  return new Error(`The video decoder failed ${context}: ${detail} (${describeMediaState(video)}).`);
}

// src/engine/webm-demuxer.ts
var SEGMENT2 = 408125543;
var INFO2 = 357149030;
var TIMECODE_SCALE2 = 2807729;
var TRACKS2 = 374648427;
var TRACK_ENTRY2 = 174;
var TRACK_NUMBER2 = 215;
var TRACK_TYPE2 = 131;
var CODEC_ID = 134;
var CODEC_PRIVATE = 25506;
var VIDEO = 224;
var PIXEL_WIDTH = 176;
var PIXEL_HEIGHT = 186;
var CLUSTER2 = 524531317;
var TIMECODE2 = 231;
var SIMPLE_BLOCK2 = 163;
var BLOCK_GROUP2 = 160;
var BLOCK2 = 161;
var REFERENCE_BLOCK = 251;
var LEVEL1_IDS = new Set([
  CLUSTER2,
  INFO2,
  TRACKS2,
  475249515,
  307544935,
  290298740,
  272869232,
  423732329
]);
var TRACK_TYPE_VIDEO = 1;
var DEFAULT_TIMECODE_SCALE_NS2 = 1e6;
function readHeader(bytes2, pos, limit) {
  if (pos >= limit)
    return null;
  const first = bytes2[pos];
  let idLength;
  if (first & 128)
    idLength = 1;
  else if (first & 64)
    idLength = 2;
  else if (first & 32)
    idLength = 3;
  else if (first & 16)
    idLength = 4;
  else
    return null;
  if (pos + idLength > limit)
    return null;
  let id = 0;
  for (let i = 0;i < idLength; i++)
    id = id * 256 + bytes2[pos + i];
  const size = readVint(bytes2, pos + idLength, limit);
  if (!size)
    return null;
  const contentStart = pos + idLength + size.length;
  return {
    id,
    contentStart,
    declaredEnd: size.unknown ? Infinity : contentStart + size.value,
    unknownSize: size.unknown
  };
}
function readString(bytes2, start, end) {
  let s = "";
  for (let i = start;i < end && bytes2[i] !== 0; i++)
    s += String.fromCharCode(bytes2[i]);
  return s;
}
function demuxWebmVideo(bytes2) {
  if (!bytes2 || bytes2.length < 8)
    return { ok: false, reason: "the file is empty" };
  const limit = bytes2.length;
  let pos = 0;
  let segment = null;
  while (pos < limit) {
    const h = readHeader(bytes2, pos, limit);
    if (!h)
      break;
    if (h.id === SEGMENT2) {
      segment = h;
      break;
    }
    if (h.unknownSize)
      break;
    pos = h.declaredEnd;
  }
  if (!segment)
    return { ok: false, reason: "no Matroska Segment" };
  let timecodeScale = DEFAULT_TIMECODE_SCALE_NS2;
  const tracks = [];
  let video = null;
  const frames = [];
  let truncated = false;
  let unsupported = null;
  const parseTracks = (start, end) => {
    let p = start;
    while (p < end) {
      const entry = readHeader(bytes2, p, end);
      if (!entry || entry.unknownSize)
        break;
      const entryEnd = Math.min(entry.declaredEnd, end);
      if (entry.id === TRACK_ENTRY2) {
        const info = { number: -1, type: null, codecId: "", codecPrivate: null, width: null, height: null };
        let q = entry.contentStart;
        while (q < entryEnd) {
          const child = readHeader(bytes2, q, entryEnd);
          if (!child || child.unknownSize)
            break;
          const childEnd = Math.min(child.declaredEnd, entryEnd);
          if (child.id === TRACK_NUMBER2)
            info.number = readUint(bytes2, child.contentStart, childEnd);
          else if (child.id === TRACK_TYPE2)
            info.type = readUint(bytes2, child.contentStart, childEnd);
          else if (child.id === CODEC_ID)
            info.codecId = readString(bytes2, child.contentStart, childEnd);
          else if (child.id === CODEC_PRIVATE)
            info.codecPrivate = bytes2.slice(child.contentStart, childEnd);
          else if (child.id === VIDEO) {
            let v = child.contentStart;
            while (v < childEnd) {
              const vc = readHeader(bytes2, v, childEnd);
              if (!vc || vc.unknownSize)
                break;
              const vcEnd = Math.min(vc.declaredEnd, childEnd);
              if (vc.id === PIXEL_WIDTH)
                info.width = readUint(bytes2, vc.contentStart, vcEnd);
              else if (vc.id === PIXEL_HEIGHT)
                info.height = readUint(bytes2, vc.contentStart, vcEnd);
              v = vcEnd;
            }
          }
          q = childEnd;
        }
        if (info.number >= 0)
          tracks.push(info);
      }
      p = entryEnd;
    }
    video = tracks.find((t) => t.type === TRACK_TYPE_VIDEO) ?? null;
  };
  const readBlock = (start, declaredEnd, clusterTimecode, simple, keyFromGroup) => {
    if (declaredEnd > limit) {
      truncated = true;
      return false;
    }
    const trackVint = readVint(bytes2, start, declaredEnd);
    if (!trackVint)
      return true;
    const videoTrack = video;
    if (!videoTrack || trackVint.value !== videoTrack.number)
      return true;
    const relPos = start + trackVint.length;
    if (relPos + 3 > declaredEnd)
      return true;
    let rel = bytes2[relPos] << 8 | bytes2[relPos + 1];
    if (rel & 32768)
      rel -= 65536;
    const flags = bytes2[relPos + 2];
    const lacing = flags >> 1 & 3;
    if (lacing !== 0) {
      unsupported = "laced video blocks";
      return true;
    }
    const dataStart = relPos + 3;
    const length = declaredEnd - dataStart;
    if (length <= 0)
      return true;
    const timestampNs = (clusterTimecode + rel) * timecodeScale;
    frames.push({
      timestampUs: Math.round(timestampNs / 1000),
      keyframe: simple ? (flags & 128) !== 0 : keyFromGroup,
      invisible: (flags & 8) !== 0,
      offset: dataStart,
      length
    });
    return true;
  };
  let current = segment.contentStart;
  const segmentEnd = Math.min(segment.declaredEnd, limit);
  outer:
    while (current < segmentEnd) {
      const el = readHeader(bytes2, current, segmentEnd);
      if (!el)
        break;
      const elEnd = Math.min(el.declaredEnd, segmentEnd);
      if (el.id === INFO2) {
        let q = el.contentStart;
        while (q < elEnd) {
          const child = readHeader(bytes2, q, elEnd);
          if (!child || child.unknownSize)
            break;
          const childEnd = Math.min(child.declaredEnd, elEnd);
          if (child.id === TIMECODE_SCALE2) {
            const scale = readUint(bytes2, child.contentStart, childEnd);
            if (scale > 0)
              timecodeScale = scale;
          }
          q = childEnd;
        }
      } else if (el.id === TRACKS2) {
        parseTracks(el.contentStart, elEnd);
      } else if (el.id === CLUSTER2) {
        let clusterTimecode = 0;
        let c = el.contentStart;
        while (c < elEnd) {
          const child = readHeader(bytes2, c, segmentEnd);
          if (!child)
            break;
          if (el.unknownSize && LEVEL1_IDS.has(child.id)) {
            current = c;
            continue outer;
          }
          if (child.unknownSize)
            break outer;
          if (child.id === TIMECODE2) {
            clusterTimecode = readUint(bytes2, child.contentStart, Math.min(child.declaredEnd, limit));
          } else if (child.id === SIMPLE_BLOCK2) {
            if (!readBlock(child.contentStart, child.declaredEnd, clusterTimecode, true, false))
              break outer;
          } else if (child.id === BLOCK_GROUP2) {
            if (child.declaredEnd > limit) {
              truncated = true;
              break outer;
            }
            let blockStart = -1;
            let blockEnd = -1;
            let referenced = false;
            let g = child.contentStart;
            while (g < child.declaredEnd) {
              const grand = readHeader(bytes2, g, child.declaredEnd);
              if (!grand || grand.unknownSize)
                break;
              if (grand.id === BLOCK2) {
                blockStart = grand.contentStart;
                blockEnd = grand.declaredEnd;
              } else if (grand.id === REFERENCE_BLOCK) {
                referenced = true;
              }
              g = grand.declaredEnd;
            }
            if (blockStart >= 0 && !readBlock(blockStart, blockEnd, clusterTimecode, false, !referenced))
              break outer;
          }
          if (child.declaredEnd > limit) {
            truncated = true;
            break outer;
          }
          c = child.declaredEnd;
        }
        if (el.unknownSize)
          break;
      }
      if (el.unknownSize)
        break;
      if (el.declaredEnd > limit) {
        truncated = true;
        break;
      }
      current = el.declaredEnd;
    }
  const track = video;
  if (!track)
    return { ok: false, reason: "no video track" };
  if (unsupported)
    return { ok: false, reason: unsupported };
  if (frames.length === 0)
    return { ok: false, reason: "the video track has no frames" };
  return {
    ok: true,
    track: {
      trackNumber: track.number,
      codecId: track.codecId,
      codecPrivate: track.codecPrivate,
      width: track.width,
      height: track.height,
      frames,
      truncated
    }
  };
}
function webmVideoDecoderConfig(track) {
  const sized = (config) => {
    if (track.width && track.height) {
      config.codedWidth = track.width;
      config.codedHeight = track.height;
    }
    return config;
  };
  switch (track.codecId) {
    case "V_VP8":
      return sized({ codec: "vp8" });
    case "V_VP9":
      return sized({ codec: "vp09.00.10.08" });
    case "V_MPEG4/ISO/AVC": {
      const avcc = track.codecPrivate;
      if (!avcc || avcc.length < 7 || avcc[0] !== 1)
        return null;
      const hex = (b) => b.toString(16).padStart(2, "0");
      return sized({ codec: `avc1.${hex(avcc[1])}${hex(avcc[2])}${hex(avcc[3])}`, description: avcc });
    }
    default:
      return null;
  }
}

// src/engine/sequential-frame-source.ts
var LOOKAHEAD_CHUNKS = 2;
var MAX_DECODE_QUEUE = 4;
function abortError2(message = "The export was cancelled.") {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}
function browserDeps() {
  if (typeof VideoDecoder === "undefined" || typeof EncodedVideoChunk === "undefined")
    return null;
  return {
    createDecoder: (init) => new VideoDecoder({ output: init.output, error: (e) => init.error(e) }),
    createChunk: (init) => new EncodedVideoChunk(init),
    isConfigSupported: (config) => VideoDecoder.isConfigSupported(config)
  };
}

class SequentialVideoFrameSource {
  bytes;
  config;
  deps;
  static async open(blob) {
    const deps = browserDeps();
    if (!deps)
      return { ok: false, reason: "WebCodecs VideoDecoder is not available" };
    const bytes2 = new Uint8Array(await blob.arrayBuffer());
    return SequentialVideoFrameSource.fromBytes(bytes2, deps);
  }
  static async fromBytes(bytes2, deps) {
    const demuxed = demuxWebmVideo(bytes2);
    if (!demuxed.ok)
      return { ok: false, reason: `WebM demux: ${demuxed.reason}` };
    const config = webmVideoDecoderConfig(demuxed.track);
    if (!config)
      return { ok: false, reason: `unsupported video codec ${demuxed.track.codecId || "(none)"}` };
    let support;
    try {
      support = await deps.isConfigSupported(config);
    } catch (err) {
      return { ok: false, reason: `decoder config check failed: ${err?.message || err}` };
    }
    if (!support?.supported)
      return { ok: false, reason: `the browser cannot decode ${config.codec}` };
    const firstKey = demuxed.track.frames.findIndex((f) => f.keyframe);
    if (firstKey < 0)
      return { ok: false, reason: "the video track has no keyframe" };
    if (!demuxed.track.frames.slice(firstKey).some((f) => !f.invisible)) {
      return { ok: false, reason: "the video track has no displayable frame" };
    }
    return { ok: true, source: new SequentialVideoFrameSource(bytes2, demuxed.track, config, firstKey, deps) };
  }
  codec;
  width;
  height;
  frameCount;
  sortedPts;
  gopStart;
  decodeIndexOfPts = new Map;
  chunks;
  decoder;
  generation = 0;
  feedIndex = 0;
  flushed = false;
  fedVisible = 0;
  outputs = 0;
  pending = [];
  current = null;
  failure = null;
  closed = false;
  waiter = null;
  onDequeue = () => this.wake();
  decodedChunks = 0;
  restarts = 0;
  constructor(bytes2, track, config, firstKey, deps) {
    this.bytes = bytes2;
    this.config = config;
    this.deps = deps;
    this.codec = config.codec;
    this.width = track.width;
    this.height = track.height;
    this.chunks = track.frames.slice(firstKey).map((f) => ({
      type: f.keyframe ? "key" : "delta",
      timestamp: f.timestampUs,
      offset: f.offset,
      length: f.length,
      visible: !f.invisible
    }));
    this.frameCount = this.chunks.length;
    this.sortedPts = this.chunks.filter((c) => c.visible).map((c) => c.timestamp).sort((a, b) => a - b);
    let gop = 0;
    this.gopStart = this.chunks.map((c, i) => {
      if (c.type === "key")
        gop = i;
      return gop;
    });
    this.chunks.forEach((c, i) => {
      if (c.visible && !this.decodeIndexOfPts.has(c.timestamp))
        this.decodeIndexOfPts.set(c.timestamp, i);
    });
    this.startDecoder(0);
  }
  startDecoder(decodeIndex) {
    const generation = ++this.generation;
    this.decoder = this.deps.createDecoder({
      output: (frame) => {
        if (this.closed || generation !== this.generation) {
          frame.close();
          return;
        }
        this.outputs++;
        this.pending.push(frame);
        this.wake();
      },
      error: (error) => {
        if (generation !== this.generation)
          return;
        this.fail(new Error(`The video decoder failed: ${error?.message || error}`));
      }
    });
    this.decoder.configure(this.config);
    this.decoder.addEventListener("dequeue", this.onDequeue);
    this.feedIndex = decodeIndex;
    this.flushed = false;
    this.fedVisible = 0;
    this.outputs = 0;
  }
  get lastTimestampUs() {
    return this.sortedPts[this.sortedPts.length - 1];
  }
  get heldFrames() {
    return this.pending.length + (this.current ? 1 : 0);
  }
  frameAt(timeMs, signal) {
    const run = this.chain.then(() => this.frameAtSerial(timeMs, signal));
    this.chain = run.then(() => {
      return;
    }, () => {
      return;
    });
    return run;
  }
  chain = Promise.resolve();
  async frameAtSerial(timeMs, signal) {
    this.assertUsable(signal);
    if (!Number.isFinite(timeMs))
      throw new Error(`Cannot read a frame at a non-finite time (${timeMs}).`);
    const targetPts = this.sortedPts[this.indexAtOrBefore(Math.round(timeMs * 1000))];
    const targetDecodeIndex = this.decodeIndexOfPts.get(targetPts);
    if (this.current && this.current.timestamp === targetPts)
      return this.current;
    const gop = this.gopStart[targetDecodeIndex];
    const behind = this.current !== null && this.current.timestamp > targetPts;
    if (behind || gop > this.feedIndex)
      this.restartAt(gop);
    for (;; ) {
      this.assertUsable(signal);
      while (this.pending.length > 0 && this.pending[0].timestamp <= targetPts) {
        this.current?.close();
        this.current = this.pending.shift();
      }
      if (this.current && this.current.timestamp === targetPts)
        return this.current;
      if (this.current && this.pending.length > 0)
        return this.current;
      const canFeed = this.feedIndex < this.chunks.length;
      const inFlight = this.fedVisible - this.outputs;
      if (canFeed && this.decoder.decodeQueueSize < MAX_DECODE_QUEUE && (this.feedIndex <= targetDecodeIndex + LOOKAHEAD_CHUNKS || inFlight === 0)) {
        this.feedNext();
        continue;
      }
      if (!canFeed && !this.flushed) {
        this.flushed = true;
        await this.flushDecoder(signal);
        continue;
      }
      if (!canFeed && this.flushed) {
        if (this.current)
          return this.current;
        if (this.pending.length > 0) {
          this.current = this.pending.shift();
          return this.current;
        }
        throw new Error(`The video decoder produced no frame for ${timeMs.toFixed(1)} ms (${this.decodedChunks} chunks decoded).`);
      }
      await this.waitForProgress(signal);
    }
  }
  close() {
    if (this.closed)
      return;
    this.closed = true;
    this.releaseFrames();
    this.stopDecoder();
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(abortError2("The frame source was closed."));
  }
  assertUsable(signal) {
    if (this.closed)
      throw new Error("The frame source is closed.");
    if (signal?.aborted)
      throw abortError2();
    if (this.failure)
      throw this.failure;
  }
  indexAtOrBefore(tUs) {
    let lo = 0;
    let hi = this.sortedPts.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      if (this.sortedPts[mid] <= tUs) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }
  feedNext() {
    const c = this.chunks[this.feedIndex++];
    if (c.visible)
      this.fedVisible++;
    this.decodedChunks++;
    this.decoder.decode(this.deps.createChunk({
      type: c.type,
      timestamp: c.timestamp,
      data: this.bytes.subarray(c.offset, c.offset + c.length)
    }));
  }
  releaseFrames() {
    this.current?.close();
    this.current = null;
    for (const f of this.pending)
      f.close();
    this.pending = [];
  }
  stopDecoder() {
    this.decoder.removeEventListener("dequeue", this.onDequeue);
    try {
      if (this.decoder.state !== "closed")
        this.decoder.close();
    } catch {}
  }
  restartAt(decodeIndex) {
    this.restarts++;
    this.releaseFrames();
    this.stopDecoder();
    this.startDecoder(decodeIndex);
  }
  fail(error) {
    if (this.failure)
      return;
    this.failure = error;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.reject(error);
  }
  wake() {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.resolve();
  }
  waitForProgress(signal) {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.waiter = null;
        reject(abortError2());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiter = {
        resolve: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        reject: (e) => {
          signal?.removeEventListener("abort", onAbort);
          reject(e);
        }
      };
    });
  }
  async flushDecoder(signal) {
    const decoder = this.decoder;
    await new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError2());
      signal?.addEventListener("abort", onAbort, { once: true });
      decoder.flush().then(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, (e) => {
        signal?.removeEventListener("abort", onAbort);
        reject(this.failure ?? new Error(`The video decoder failed while flushing: ${e?.message || e}`));
      });
    });
  }
}

// src/engine/export-timeline.ts
function resolveExportTimelineMs(input) {
  const wallClock = Number.isFinite(input.wallClockDurationMs) && input.wallClockDurationMs > 0 ? input.wallClockDurationMs : 0;
  const container = Number.isFinite(input.containerDurationMs) && input.containerDurationMs > 0 ? input.containerDurationMs : 0;
  const audioEnd = Number.isFinite(input.audioEndMs) && input.audioEndMs > 0 ? input.audioEndMs : 0;
  const lastVideoPts = Number.isFinite(input.lastVideoPtsMs) && input.lastVideoPtsMs > 0 ? input.lastVideoPtsMs : 0;
  const claimedVideoEnd = Math.max(wallClock, container);
  const videoEnd = lastVideoPts > 0 ? Math.min(claimedVideoEnd || lastVideoPts, lastVideoPts) : claimedVideoEnd;
  return Math.ceil(Math.max(videoEnd, audioEnd));
}

// src/engine/mp4-exporter.ts
function abortError3() {
  const err = new Error("The export was cancelled.");
  err.name = "AbortError";
  return err;
}

class HardwareMp4Exporter {
  renderer;
  constructor() {
    this.renderer = new StudioRenderer;
  }
  async exportMp4(options) {
    const {
      videoSource,
      videoBlob,
      onRenderCanvasFrame,
      durationMs,
      aspectRatio,
      preset,
      pills,
      silences,
      cursorEngine,
      keystrokes,
      cutSilences,
      showSpotlight,
      showCursor,
      showHud,
      signal,
      onProgress
    } = options;
    if (signal?.aborted)
      throw abortError3();
    const wallClockDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
    const containerDurationMs = Number.isFinite(options.mediaDurationMs) && options.mediaDurationMs > 0 ? options.mediaDurationMs : 0;
    const sourceW = options.metadata?.width && options.metadata.width > 0 ? options.metadata.width : 1920;
    const targetBaseW = options.targetWidth || sourceW;
    const { width: outW, height: outH } = getAspectDimensions(aspectRatio, targetBaseW);
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = outW;
    exportCanvas.height = outH;
    let video = videoSource || document.createElement("canvas");
    let exportVideoUrl = null;
    let attachedExportVideo = null;
    let frameSource = null;
    let stagingCanvas = null;
    try {
      if (videoBlob && typeof VideoEncoder !== "undefined") {
        const opened = await SequentialVideoFrameSource.open(videoBlob);
        if (opened.ok) {
          frameSource = opened.source;
          stagingCanvas = document.createElement("canvas");
          stagingCanvas.width = frameSource.width || sourceW;
          stagingCanvas.height = frameSource.height || Math.round(sourceW * 9 / 16);
          video = stagingCanvas;
          console.log(`[SmoothStudio MP4 Exporter] Frame source: sequential ${frameSource.codec} decode (${frameSource.frameCount} frames).`);
        } else {
          console.warn(`[SmoothStudio MP4 Exporter] Frame source: <video> seeks (${opened.reason}).`);
        }
      }
      if (videoBlob && !frameSource) {
        try {
          const dedicatedVideo = document.createElement("video");
          dedicatedVideo.muted = true;
          dedicatedVideo.playsInline = true;
          dedicatedVideo.preload = "auto";
          dedicatedVideo.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;";
          document.body.appendChild(dedicatedVideo);
          attachedExportVideo = dedicatedVideo;
          exportVideoUrl = URL.createObjectURL(videoBlob);
          dedicatedVideo.src = exportVideoUrl;
          await new Promise((resolve) => {
            if (dedicatedVideo.readyState >= 1)
              return resolve();
            dedicatedVideo.onloadedmetadata = () => resolve();
            dedicatedVideo.onerror = () => resolve();
            setTimeout(resolve, 1000);
          });
          video = dedicatedVideo;
        } catch (err) {
          console.warn("[SmoothStudio MP4 Exporter] Could not create dedicated video element:", err);
        }
      }
      const fps = 60;
      const frameIntervalMs = 1000 / fps;
      const activeCutSilences = cutSilences ? silences.filter((s) => s.markedForCut).map((s) => options.showOutroCard ? { ...s, endTime: Math.min(s.endTime, Math.max(s.startTime, durationMs - 1500)) } : s).filter((s) => s.endTime > s.startTime) : [];
      let decodedPcm = null;
      if (videoBlob && await webmHasAudioTrack(new Uint8Array(await videoBlob.slice(0, 4 * 1024 * 1024).arrayBuffer()))) {
        decodedPcm = await decodeRecordingPcm(videoBlob);
      }
      const audioEndMs = decodedPcm ? pcmDurationMs(decodedPcm) : 0;
      const timelineDurationMs = resolveExportTimelineMs({
        wallClockDurationMs,
        containerDurationMs,
        audioEndMs,
        lastVideoPtsMs: frameSource ? frameSource.lastTimestampUs / 1000 : 0
      });
      if (timelineDurationMs <= 0) {
        throw new Error("The recording has no timeline: duration, container and audio are all empty.");
      }
      const audioTrack = decodedPcm ? cutPcmToKeepRanges(decodedPcm, keepRangesFromCuts(activeCutSilences, timelineDurationMs)) : null;
      const timelineTimestamps = [];
      for (let t = 0;t <= timelineDurationMs; t += frameIntervalMs) {
        const isCut = activeCutSilences.some((s) => t >= s.startTime && t <= s.endTime);
        if (!isCut) {
          timelineTimestamps.push(t);
        }
      }
      const totalFrames = timelineTimestamps.length;
      console.log(`[SmoothStudio MP4 Exporter] Starting hardware export: ${totalFrames} frames at 60fps (${outW}x${outH})`);
      const hasWebCodecs = typeof VideoEncoder !== "undefined";
      if (hasWebCodecs) {
        return await this.exportWithWebCodecs({
          video,
          frameSource,
          stagingCanvas,
          onRenderCanvasFrame,
          exportCanvas,
          outW,
          outH,
          fps,
          durationMs: timelineDurationMs,
          totalFrames,
          timelineTimestamps,
          pills,
          preset,
          aspectRatio,
          cursorEngine,
          keystrokes,
          showSpotlight,
          showCursor,
          showHud,
          signal,
          metadata: options.metadata,
          cursorTheme: options.cursorTheme,
          cursorScale: options.cursorScale,
          captions: options.captions,
          captionStyle: options.captionStyle,
          captionBackdrop: options.captionBackdrop,
          showCaptions: options.showCaptions,
          showIntroCard: options.showIntroCard,
          introHeadline: options.introHeadline,
          introSubheadline: options.introSubheadline,
          showOutroCard: options.showOutroCard,
          outroHeadline: options.outroHeadline,
          outroCtaText: options.outroCtaText,
          onProgress,
          audioTrack
        });
      }
      if (audioTrack) {
        throw new Error("This browser has no WebCodecs support, so the MP4 export cannot include the recording audio. Export aborted.");
      }
      return await this.exportWithCanvasStream({
        video,
        onRenderCanvasFrame,
        exportCanvas,
        durationMs,
        timelineTimestamps,
        pills,
        preset,
        aspectRatio,
        cursorEngine,
        keystrokes,
        showSpotlight,
        showCursor,
        showHud,
        metadata: options.metadata,
        cursorTheme: options.cursorTheme,
        cursorScale: options.cursorScale,
        captions: options.captions,
        captionStyle: options.captionStyle,
        captionBackdrop: options.captionBackdrop,
        showCaptions: options.showCaptions,
        showIntroCard: options.showIntroCard,
        introHeadline: options.introHeadline,
        introSubheadline: options.introSubheadline,
        showOutroCard: options.showOutroCard,
        outroHeadline: options.outroHeadline,
        outroCtaText: options.outroCtaText,
        onProgress
      });
    } finally {
      frameSource?.close();
      if (exportVideoUrl) {
        URL.revokeObjectURL(exportVideoUrl);
      }
      if (attachedExportVideo) {
        try {
          attachedExportVideo.remove();
        } catch {}
      }
    }
  }
  async exportWithWebCodecs(params) {
    const {
      video,
      frameSource,
      stagingCanvas,
      audioTrack,
      onRenderCanvasFrame,
      exportCanvas,
      outW,
      outH,
      fps,
      durationMs,
      totalFrames,
      timelineTimestamps,
      pills,
      preset,
      aspectRatio,
      cursorEngine,
      keystrokes,
      showSpotlight,
      showCursor,
      showHud,
      metadata,
      cursorTheme,
      cursorScale,
      captions,
      captionStyle,
      captionBackdrop,
      showCaptions,
      showIntroCard,
      introHeadline,
      introSubheadline,
      showOutroCard,
      outroHeadline,
      outroCtaText,
      signal,
      onProgress
    } = params;
    if (totalFrames <= 0) {
      throw new Error("No timeline frames to encode into MP4.");
    }
    if (signal?.aborted)
      throw abortError3();
    const frameSeeker = !frameSource && video instanceof HTMLVideoElement ? new VideoFrameSeeker(video) : null;
    if (frameSeeker) {
      await frameSeeker.waitUntilReady(signal);
    }
    const stagingCtx = frameSource && stagingCanvas ? stagingCanvas.getContext("2d") : null;
    if (frameSource && !stagingCtx) {
      throw new Error("Could not create the 2D context that receives the decoded recording frames.");
    }
    let isFinalized = false;
    let encodedChunksCount = 0;
    const muxer = new Muxer({
      target: new ArrayBufferTarget,
      video: {
        codec: "avc",
        width: outW,
        height: outH
      },
      ...audioTrack ? {
        audio: {
          codec: "aac",
          numberOfChannels: AAC_OUTPUT_CHANNELS,
          sampleRate: audioTrack.sampleRate
        }
      } : {},
      fastStart: "in-memory"
    });
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (!isFinalized) {
          try {
            encodedChunksCount++;
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            const durationMicros = typeof chunk.duration === "number" && Number.isFinite(chunk.duration) && chunk.duration > 0 ? chunk.duration : Math.round(1 / fps * 1e6);
            muxer.addVideoChunkRaw(data, chunk.type, chunk.timestamp, durationMicros, meta);
          } catch (muxErr) {
            console.error("[SmoothStudio VideoEncoder Output Mux Error]", muxErr);
          }
        }
      },
      error: (e) => {
        console.error("[SmoothStudio VideoEncoder Error]", e);
        diagnosticChannel.recordFrameDrop(e?.message || String(e));
      }
    });
    const is4K = outW >= 3840 || outH >= 2160;
    let targetBitrate = 14000000;
    if (is4K) {
      targetBitrate = 38000000;
    } else if (outW >= 2560 || outH >= 1440) {
      targetBitrate = 22000000;
    } else if (outW >= 1920 || outH >= 1080) {
      targetBitrate = 14000000;
    } else {
      targetBitrate = 6000000;
    }
    let chosenCodec = is4K ? "avc1.640033" : "avc1.640028";
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: chosenCodec,
        width: outW,
        height: outH,
        bitrate: targetBitrate,
        framerate: fps
      });
      if (!support.supported) {
        chosenCodec = is4K ? "avc1.4d0033" : "avc1.4D002A";
      }
    } catch {
      chosenCodec = is4K ? "avc1.4d0033" : "avc1.4D002A";
    }
    videoEncoder.configure({
      codec: chosenCodec,
      width: outW,
      height: outH,
      bitrate: targetBitrate,
      framerate: fps,
      hardwareAcceleration: "prefer-hardware",
      latencyMode: "realtime"
    });
    const springCamera = new SpringCameraSolver;
    if (totalFrames > 0) {
      const firstTarget = computeCinematicCameraState(timelineTimestamps[0], pills, cursorEngine.getCursorAt(timelineTimestamps[0]), metadata?.width || outW, metadata?.height || outH, true);
      springCamera.snapTo(firstTarget);
    }
    try {
      for (let f = 0;f < totalFrames; f++) {
        const currentMs = timelineTimestamps[f];
        const cursor = cursorEngine.getCursorAt(currentMs);
        const targetCamera = computeCinematicCameraState(currentMs, pills, cursor, metadata?.width || outW, metadata?.height || outH, true);
        springCamera.setTarget(targetCamera);
        const camera = f === 0 ? targetCamera : springCamera.update(1 / fps);
        const activePill = pills.find((p) => currentMs >= p.startTime && currentMs <= p.endTime);
        if (signal?.aborted)
          throw abortError3();
        if (frameSource && stagingCanvas && stagingCtx) {
          if (videoEncoder.encodeQueueSize > 12) {
            while (videoEncoder.encodeQueueSize > 6) {
              if (signal?.aborted)
                throw abortError3();
              await new Promise((r) => setTimeout(r, 2));
            }
          }
          const frame = await frameSource.frameAt(currentMs, signal);
          if (stagingCanvas.width !== frame.displayWidth || stagingCanvas.height !== frame.displayHeight) {
            stagingCanvas.width = frame.displayWidth;
            stagingCanvas.height = frame.displayHeight;
          }
          stagingCtx.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight);
        } else if (video instanceof HTMLVideoElement && frameSeeker) {
          if (videoEncoder.encodeQueueSize > 12) {
            while (videoEncoder.encodeQueueSize > 6) {
              if (signal?.aborted)
                throw abortError3();
              await new Promise((r) => setTimeout(r, 2));
            }
          }
          await frameSeeker.seekTo(currentMs / 1000, signal);
        } else if (onRenderCanvasFrame) {
          onRenderCanvasFrame(currentMs);
        }
        this.renderer.renderFrame({
          canvas: exportCanvas,
          video,
          currentTimeMs: currentMs,
          durationMs,
          camera,
          activePill,
          cursorEngine,
          keystrokes,
          preset,
          aspectRatio,
          showSpotlight,
          showCursor,
          showHud,
          metadata,
          cursorTheme,
          cursorScale,
          captions,
          captionStyle,
          captionBackdrop,
          showCaptions,
          showIntroCard,
          introHeadline,
          introSubheadline,
          showOutroCard,
          outroHeadline,
          outroCtaText
        });
        const frameTimestampMicroseconds = Math.round(f / fps * 1e6);
        const frameDurationMicroseconds = Math.round(1 / fps * 1e6);
        const videoFrame = new VideoFrame(exportCanvas, {
          timestamp: frameTimestampMicroseconds,
          duration: frameDurationMicroseconds
        });
        const isKeyFrame = f === 0 || f % 120 === 0;
        try {
          videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
        } finally {
          videoFrame.close();
        }
        if (videoEncoder.encodeQueueSize > 30) {
          while (videoEncoder.encodeQueueSize > 15) {
            await new Promise((r) => setTimeout(r, 2));
          }
        }
        if (f % 60 === 0) {
          const percent = Math.round((f + 1) / totalFrames * 100);
          console.log(`[SmoothStudio MP4 Exporter] Encoded frame ${f}/${totalFrames} (${percent}%)`);
          if (onProgress) {
            onProgress(percent, f + 1, totalFrames);
          }
        } else if (f % 15 === 0 && onProgress) {
          const percent = Math.round((f + 1) / totalFrames * 100);
          onProgress(percent, f + 1, totalFrames);
        }
      }
      if (onProgress) {
        onProgress(100, totalFrames, totalFrames);
      }
      if (frameSource) {
        console.log(`[SmoothStudio MP4 Exporter] Frame source decoded ${frameSource.decodedChunks} of ${frameSource.frameCount} recording frames (${frameSource.restarts} keyframe restarts).`);
      }
      let drainWait = 0;
      while (videoEncoder.encodeQueueSize > 0 && drainWait < 200) {
        await new Promise((r) => setTimeout(r, 10));
        drainWait++;
      }
      try {
        await Promise.race([
          videoEncoder.flush(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Flush timeout")), 5000))
        ]);
      } catch (flushErr) {
        console.warn("[SmoothStudio MP4 Exporter] Flush completed or notice:", flushErr);
      }
      if (encodedChunksCount === 0) {
        throw new Error(`VideoEncoder did not produce any encoded video chunks for ${totalFrames} frames.`);
      }
      if (audioTrack) {
        const audioChunkCount = await encodeAac(audioTrack, (chunk) => {
          muxer.addAudioChunkRaw(chunk.data, chunk.type, chunk.timestamp, chunk.duration, chunk.meta);
        });
        if (audioChunkCount === 0) {
          throw new Error("The AAC encoder produced no audio chunks. Export aborted.");
        }
        console.log(`[SmoothStudio MP4 Exporter] Muxed ${audioChunkCount} AAC chunks (${audioTrack.sampleRate} Hz).`);
      }
      isFinalized = true;
      muxer.finalize();
      try {
        videoEncoder.close();
      } catch {}
      const buffer = muxer.target.buffer;
      const mp4Blob = new Blob([buffer], { type: "video/mp4" });
      console.log("[SmoothStudio MP4 Exporter] Hardware MP4 export completed! Size:", (mp4Blob.size / 1024 / 1024).toFixed(2), "MB");
      return mp4Blob;
    } catch (err) {
      isFinalized = true;
      try {
        videoEncoder.close();
      } catch {}
      throw err;
    } finally {
      frameSeeker?.dispose();
    }
  }
  async exportWithCanvasStream(params) {
    const {
      video,
      onRenderCanvasFrame,
      exportCanvas,
      durationMs,
      timelineTimestamps,
      pills,
      preset,
      aspectRatio,
      cursorEngine,
      keystrokes,
      showSpotlight,
      showCursor,
      showHud,
      metadata,
      cursorTheme,
      cursorScale,
      captions,
      captionStyle,
      captionBackdrop,
      showCaptions,
      showIntroCard,
      introHeadline,
      introSubheadline,
      showOutroCard,
      outroHeadline,
      outroCtaText,
      onProgress
    } = params;
    const stream = exportCanvas.captureStream(60);
    const chunks = [];
    let fallbackBps = 14000000;
    const canW = exportCanvas.width;
    const canH = exportCanvas.height;
    if (canW >= 3840 || canH >= 2160) {
      fallbackBps = 38000000;
    } else if (canW >= 2560 || canH >= 1440) {
      fallbackBps = 22000000;
    } else if (canW >= 1920 || canH >= 1080) {
      fallbackBps = 14000000;
    } else {
      fallbackBps = 6000000;
    }
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported("video/webm; codecs=vp9") ? "video/webm; codecs=vp9" : "video/webm",
      videoBitsPerSecond: fallbackBps
    });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0)
        chunks.push(e.data);
    };
    mediaRecorder.start();
    const totalFrames = timelineTimestamps.length;
    const springCameraFallback = new SpringCameraSolver;
    const fallbackSeeker = video instanceof HTMLVideoElement ? new VideoFrameSeeker(video) : null;
    if (fallbackSeeker) {
      await fallbackSeeker.waitUntilReady();
    }
    if (totalFrames > 0) {
      const firstTarget = computeCinematicCameraState(timelineTimestamps[0], pills, cursorEngine.getCursorAt(timelineTimestamps[0]), metadata?.width || exportCanvas.width, metadata?.height || exportCanvas.height, true);
      springCameraFallback.snapTo(firstTarget);
    }
    try {
      for (let f = 0;f < totalFrames; f++) {
        const currentMs = timelineTimestamps[f];
        const cursor = cursorEngine.getCursorAt(currentMs);
        const targetCamera = computeCinematicCameraState(currentMs, pills, cursor, metadata?.width || exportCanvas.width, metadata?.height || exportCanvas.height, true);
        springCameraFallback.setTarget(targetCamera);
        const camera = f === 0 ? targetCamera : springCameraFallback.update(1 / 60);
        const activePill = pills.find((p) => currentMs >= p.startTime && currentMs <= p.endTime);
        if (video instanceof HTMLVideoElement && fallbackSeeker) {
          await fallbackSeeker.seekTo(currentMs / 1000);
        } else if (onRenderCanvasFrame) {
          onRenderCanvasFrame(currentMs);
        }
        this.renderer.renderFrame({
          canvas: exportCanvas,
          video,
          currentTimeMs: currentMs,
          durationMs,
          camera,
          activePill,
          cursorEngine,
          keystrokes,
          preset,
          aspectRatio,
          showSpotlight,
          showCursor,
          showHud,
          metadata,
          cursorTheme,
          cursorScale,
          captions,
          captionStyle,
          captionBackdrop,
          showCaptions,
          showIntroCard,
          introHeadline,
          introSubheadline,
          showOutroCard,
          outroHeadline,
          outroCtaText
        });
        if (f % 10 === 0) {
          await new Promise((r) => setTimeout(r, 2));
        }
        if (f % 15 === 0 && onProgress) {
          onProgress(Math.round((f + 1) / totalFrames * 100), f + 1, totalFrames);
        }
      }
      if (onProgress) {
        onProgress(100, totalFrames, totalFrames);
      }
      return new Promise((resolve) => {
        mediaRecorder.onstop = () => {
          resolve(new Blob(chunks, { type: "video/webm" }));
        };
        mediaRecorder.stop();
      });
    } finally {
      fallbackSeeker?.dispose();
    }
  }
  static downloadBlob(blob, filename = "SmoothStudio_Export.mp4") {
    const url2 = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url2;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url2);
    }, 1000);
  }
}

// src/engine/gif-exporter.ts
var import_omggif = __toESM(require_omggif(), 1);

// src/engine/gif-budget.ts
var GIF_MAX_DIMENSION = 1024;
var GIF_MIN_DIMENSION = 64;
var GIF_MAX_BUFFER_BYTES = 192 * 1024 * 1024;
var GIF_MIN_BUFFER_BYTES = 4 * 1024 * 1024;
var GIF_TRAILER_BYTES = 1024 * 1024;
function resolveGifMaxDimension(requested) {
  const n = Number.isFinite(requested) ? Math.round(requested) : GIF_MAX_DIMENSION;
  return Math.min(GIF_MAX_DIMENSION, Math.max(GIF_MIN_DIMENSION, n));
}
function planGifBufferBytes(outW, outH, frameCount) {
  const pixels = Math.max(1, Math.round(outW)) * Math.max(1, Math.round(outH));
  const frames = Math.max(1, Math.round(frameCount));
  const estimate = Math.ceil(pixels * frames * 0.4) + GIF_TRAILER_BYTES;
  return Math.max(GIF_MIN_BUFFER_BYTES, Math.min(GIF_MAX_BUFFER_BYTES, estimate));
}
function gifFrameHeadroomBytes(outW, outH) {
  return Math.ceil(Math.max(1, outW) * Math.max(1, outH) * 1.5) + 4096;
}
function assertGifBufferHasRoom(writtenBytes, capacityBytes, frameHeadroomBytes, frameIndex) {
  if (writtenBytes + frameHeadroomBytes <= capacityBytes)
    return;
  const capMb = Math.round(capacityBytes / (1024 * 1024));
  throw new Error(`GIF export stopped at the ${capMb} MB safety limit (frame ${frameIndex}). ` + `The clip is too long or too detailed for this preset: choose a smaller GIF preset or a shorter range.`);
}

// src/engine/gif-exporter.ts
var GIF_QUALITY_PRESETS = {
  compact: {
    fps: 12,
    maxDimension: 640,
    maxColors: 128,
    description: "Compact (<5 MB, 12fps, 640px)"
  },
  web: {
    fps: 15,
    maxDimension: 720,
    maxColors: 192,
    description: "Web (15fps, 720px)"
  },
  high: {
    fps: 20,
    maxDimension: 840,
    maxColors: 256,
    description: "High Quality (20fps, 840px)"
  }
};
function quantizeFrame(rgba, width, height, maxColors = 128) {
  const numPixels = width * height;
  const indexed = new Uint8Array(numPixels);
  const colorCounts = new Map;
  const step = Math.max(1, Math.floor(numPixels / 8000));
  for (let i = 0;i < rgba.length; i += 4 * step) {
    const r = rgba[i] >> 3;
    const g = rgba[i + 1] >> 3;
    const b = rgba[i + 2] >> 3;
    const key = r << 10 | g << 5 | b;
    colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
  }
  const effectiveMaxColors = Math.min(256, Math.max(2, maxColors));
  const sorted = Array.from(colorCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, effectiveMaxColors);
  const palette = [];
  const paletteMap = new Map;
  sorted.forEach(([key], index) => {
    const r5 = key >> 10 & 31;
    const g5 = key >> 5 & 31;
    const b5 = key & 31;
    const r = r5 << 3 | r5 >> 2;
    const g = g5 << 3 | g5 >> 2;
    const b = b5 << 3 | b5 >> 2;
    const hex = r << 16 | g << 8 | b;
    palette.push(hex);
    paletteMap.set(key, index);
  });
  let targetPaletteLen = 2;
  while (targetPaletteLen < palette.length && targetPaletteLen < 256) {
    targetPaletteLen <<= 1;
  }
  while (palette.length < targetPaletteLen) {
    palette.push(0);
  }
  for (let i = 0, p = 0;i < rgba.length; i += 4, p++) {
    const r5 = rgba[i] >> 3;
    const g5 = rgba[i + 1] >> 3;
    const b5 = rgba[i + 2] >> 3;
    const key = r5 << 10 | g5 << 5 | b5;
    let match = paletteMap.get(key);
    if (match === undefined) {
      const pr = rgba[i];
      const pg = rgba[i + 1];
      const pb = rgba[i + 2];
      let minDist = Infinity;
      let bestIdx = 0;
      for (let c = 0;c < palette.length; c++) {
        const hex = palette[c];
        const cr = hex >> 16 & 255;
        const cg = hex >> 8 & 255;
        const cb = hex & 255;
        const dist = (pr - cr) * (pr - cr) + (pg - cg) * (pg - cg) + (pb - cb) * (pb - cb);
        if (dist < minDist) {
          minDist = dist;
          bestIdx = c;
          if (dist === 0)
            break;
        }
      }
      match = bestIdx;
      paletteMap.set(key, match);
    }
    indexed[p] = match;
  }
  return { indexed, palette };
}
function areFramesSimilar(prev, curr, threshold = 0.002) {
  if (prev.length !== curr.length)
    return false;
  let diffCount = 0;
  const maxDiff = Math.floor(prev.length / 4 * threshold);
  for (let i = 0;i < prev.length; i += 4) {
    const dr = Math.abs(prev[i] - curr[i]);
    const dg = Math.abs(prev[i + 1] - curr[i + 1]);
    const db = Math.abs(prev[i + 2] - curr[i + 2]);
    if (dr > 4 || dg > 4 || db > 4) {
      diffCount++;
      if (diffCount > maxDiff)
        return false;
    }
  }
  return true;
}

class HardwareGifExporter {
  renderer;
  constructor() {
    this.renderer = new StudioRenderer;
  }
  async exportGif(options) {
    const {
      videoSource,
      videoBlob,
      onRenderCanvasFrame,
      durationMs,
      aspectRatio,
      preset,
      pills,
      silences,
      cursorEngine,
      keystrokes,
      cutSilences,
      showSpotlight,
      showCursor,
      showHud,
      metadata,
      cursorTheme,
      cursorScale,
      captions,
      captionStyle,
      captionBackdrop,
      showCaptions,
      showIntroCard,
      introHeadline,
      introSubheadline,
      showOutroCard,
      outroHeadline,
      outroCtaText,
      qualityPreset = "compact",
      fps: explicitFps,
      maxDimension: explicitMaxDimension,
      maxColors: explicitMaxColors,
      enableDeduplication = true,
      onProgress
    } = options;
    const presetConfig = GIF_QUALITY_PRESETS[qualityPreset] || GIF_QUALITY_PRESETS.compact;
    const fps = explicitFps ?? presetConfig.fps;
    const maxDimension = resolveGifMaxDimension(explicitMaxDimension ?? presetConfig.maxDimension);
    const maxColors = explicitMaxColors ?? presetConfig.maxColors;
    const { width: fullW, height: fullH } = getAspectDimensions(aspectRatio, 1920);
    const scale = maxDimension / Math.max(fullW, fullH);
    const outW = Math.round(fullW * scale);
    const outH = Math.round(fullH * scale);
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = fullW;
    exportCanvas.height = fullH;
    const downscaleCanvas = document.createElement("canvas");
    downscaleCanvas.width = outW;
    downscaleCanvas.height = outH;
    const downscaleCtx = downscaleCanvas.getContext("2d", { willReadFrequently: true });
    const frameIntervalMs = 1000 / fps;
    const timestamps = [];
    const cutIntervals = cutSilences ? silences.filter((s) => s.markedForCut).map((s) => showOutroCard ? { ...s, endTime: Math.min(s.endTime, Math.max(s.startTime, durationMs - 1500)) } : s).filter((s) => s.endTime > s.startTime) : [];
    for (let t = 0;t < durationMs; t += frameIntervalMs) {
      const inCut = cutIntervals.some((c) => t >= c.startTime && t <= c.endTime);
      if (!inCut) {
        timestamps.push(t);
      }
    }
    const totalFrames = timestamps.length;
    const buffer = new Uint8Array(planGifBufferBytes(outW, outH, totalFrames));
    const frameHeadroom = gifFrameHeadroomBytes(outW, outH);
    const gifWriter = new import_omggif.GifWriter(buffer, outW, outH, { loop: 0 });
    const delayHundredths = Math.max(2, Math.round(100 / fps));
    const springCamera = new SpringCameraSolver;
    if (totalFrames > 0) {
      const firstTarget = computeCinematicCameraState(timestamps[0], pills, cursorEngine.getCursorAt(timestamps[0]), metadata?.width || fullW, metadata?.height || fullH, true);
      springCamera.snapTo(firstTarget);
    }
    let pendingFrameData = null;
    let pendingDelayHundredths = 0;
    let writtenFrames = 0;
    const flushPendingFrame = () => {
      if (!pendingFrameData)
        return;
      const { indexed, palette } = quantizeFrame(pendingFrameData, outW, outH, maxColors);
      assertGifBufferHasRoom(gifWriter.end(), buffer.length, frameHeadroom, writtenFrames);
      try {
        gifWriter.addFrame(0, 0, outW, outH, indexed, {
          palette,
          delay: Math.min(65535, pendingDelayHundredths)
        });
      } catch (err) {
        throw new Error(`GIF export could not write frame ${writtenFrames}: ${err?.message || err}`);
      }
      writtenFrames++;
      pendingFrameData = null;
      pendingDelayHundredths = 0;
    };
    let frameSource = null;
    let stagingCanvas = null;
    let stagingCtx = null;
    let renderVideo = videoSource || document.createElement("canvas");
    if (videoBlob && typeof VideoDecoder !== "undefined") {
      const opened = await SequentialVideoFrameSource.open(videoBlob);
      if (opened.ok) {
        frameSource = opened.source;
        stagingCanvas = document.createElement("canvas");
        stagingCanvas.width = frameSource.width || outW;
        stagingCanvas.height = frameSource.height || outH;
        stagingCtx = stagingCanvas.getContext("2d");
        if (!stagingCtx) {
          frameSource.close();
          frameSource = null;
          stagingCanvas = null;
        } else {
          renderVideo = stagingCanvas;
          console.log(`[SmoothStudio GIF Exporter] Frame source: sequential ${frameSource.codec} decode (${frameSource.frameCount} frames).`);
        }
      } else {
        console.warn(`[SmoothStudio GIF Exporter] Frame source: <video> seeks (${opened.reason}).`);
      }
    }
    try {
      for (let f = 0;f < totalFrames; f++) {
        const currentMs = timestamps[f];
        const cursor = cursorEngine.getCursorAt(currentMs);
        const targetCamera = computeCinematicCameraState(currentMs, pills, cursor, metadata?.width || fullW, metadata?.height || fullH, true);
        springCamera.setTarget(targetCamera);
        const camera = f === 0 ? targetCamera : springCamera.update(1 / fps);
        const activePill = pills.find((p) => currentMs >= p.startTime && currentMs <= p.endTime);
        if (frameSource && stagingCanvas && stagingCtx) {
          const frame = await frameSource.frameAt(currentMs);
          if (stagingCanvas.width !== frame.displayWidth || stagingCanvas.height !== frame.displayHeight) {
            stagingCanvas.width = frame.displayWidth;
            stagingCanvas.height = frame.displayHeight;
          }
          stagingCtx.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight);
        } else if (videoSource instanceof HTMLVideoElement) {
          const targetSec = currentMs / 1000;
          await new Promise((resolve) => {
            let settled = false;
            let timer = null;
            const done = () => {
              if (settled)
                return;
              settled = true;
              videoSource.removeEventListener("seeked", onSeeked);
              if (timer !== null)
                clearTimeout(timer);
              resolve();
            };
            const onSeeked = () => done();
            if (Math.abs(videoSource.currentTime - targetSec) < 0.005) {
              done();
              return;
            }
            videoSource.addEventListener("seeked", onSeeked);
            timer = setTimeout(done, 2000);
            try {
              videoSource.currentTime = targetSec;
            } catch {
              done();
            }
          });
        } else if (onRenderCanvasFrame) {
          onRenderCanvasFrame(currentMs);
        }
        this.renderer.renderFrame({
          canvas: exportCanvas,
          video: renderVideo,
          currentTimeMs: currentMs,
          durationMs,
          camera,
          activePill,
          cursorEngine,
          keystrokes,
          preset,
          aspectRatio,
          showSpotlight,
          showCursor,
          showHud,
          metadata,
          cursorTheme,
          cursorScale,
          captions,
          captionStyle,
          captionBackdrop,
          showCaptions,
          showIntroCard,
          introHeadline,
          introSubheadline,
          showOutroCard,
          outroHeadline,
          outroCtaText
        });
        downscaleCtx.clearRect(0, 0, outW, outH);
        downscaleCtx.drawImage(exportCanvas, 0, 0, outW, outH);
        const imgData = downscaleCtx.getImageData(0, 0, outW, outH).data;
        if (enableDeduplication && pendingFrameData && areFramesSimilar(pendingFrameData, imgData)) {
          pendingDelayHundredths += delayHundredths;
        } else {
          flushPendingFrame();
          pendingFrameData = new Uint8ClampedArray(imgData);
          pendingDelayHundredths = delayHundredths;
        }
        if (f % 5 === 0) {
          await new Promise((r) => setTimeout(r, 1));
        }
        if (f % 6 === 0 && onProgress) {
          const percent = Math.round((f + 1) / totalFrames * 100);
          onProgress(percent, f + 1, totalFrames);
        }
      }
      flushPendingFrame();
      if (onProgress) {
        onProgress(100, totalFrames, totalFrames);
      }
      const gifBytes = buffer.subarray(0, gifWriter.end());
      const gifBlob = new Blob([gifBytes], { type: "image/gif" });
      console.log("[SmoothStudio GIF Exporter] GIF export complete! Size:", (gifBlob.size / 1024 / 1024).toFixed(2), "MB");
      return gifBlob;
    } finally {
      frameSource?.close();
    }
  }
  static downloadBlob(blob, filename = "SmoothStudio_Capture.gif") {
    const url2 = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url2;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url2);
    }, 1500);
  }
}

// src/engine/audio-processor.ts
class AudioProcessor {
  audioCtx = null;
  getAudioContext() {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtxClass;
    }
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }
  async decodeAudioBuffer(videoBlob) {
    if (!videoBlob || videoBlob.size === 0)
      return null;
    try {
      const arrayBuffer = await videoBlob.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength === 0)
        return null;
      const ctx = this.getAudioContext();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      if (!decoded || decoded.numberOfChannels === 0 || decoded.length === 0)
        return null;
      const audioStartMs = await readWebmAudioStartMs(videoBlob);
      return this.alignDecodedBuffer(ctx, decoded, audioStartMs);
    } catch {
      return null;
    }
  }
  alignDecodedBuffer(ctx, decoded, startTimeMs) {
    if (!Number.isFinite(startTimeMs) || startTimeMs <= 0)
      return decoded;
    const capped = Math.min(startTimeMs, 60000);
    const pad = Math.round(capped / 1000 * decoded.sampleRate);
    if (pad <= 0)
      return decoded;
    const out = ctx.createBuffer(decoded.numberOfChannels, decoded.length + pad, decoded.sampleRate);
    for (let c = 0;c < decoded.numberOfChannels; c++) {
      out.getChannelData(c).set(decoded.getChannelData(c), pad);
    }
    return out;
  }
  async buildWaveformPeaks(videoBlob, buckets = 160) {
    const audioBuffer = await this.decodeAudioBuffer(videoBlob);
    if (!audioBuffer) {
      console.log("[SmoothStudio Audio] No decodable audio track: waveform will not be drawn.");
      return [];
    }
    const channelData = audioBuffer.getChannelData(0);
    const bucketSize = Math.max(1, Math.floor(channelData.length / buckets));
    const peaks = [];
    let maxAbs = 0;
    for (let b = 0;b < buckets; b++) {
      const start = b * bucketSize;
      const end = Math.min(channelData.length, start + bucketSize);
      let peak = 0;
      for (let i = start;i < end; i++) {
        const v = Math.abs(channelData[i]);
        if (v > peak)
          peak = v;
      }
      peaks.push(peak);
      if (peak > maxAbs)
        maxAbs = peak;
    }
    if (maxAbs > 0) {
      for (let i = 0;i < peaks.length; i++) {
        peaks[i] = peaks[i] / maxAbs;
      }
    }
    console.log(`[SmoothStudio Audio] Waveform built from ${audioBuffer.duration.toFixed(2)}s of real audio: ${peaks.length} buckets.`);
    return peaks;
  }
  async analyzeSilences(videoBlob, clicks = [], keystrokes = [], dbThreshold = -42, minSilenceDurationMs = 1200, videoDurationMs = 1e4) {
    try {
      if (!videoBlob || videoBlob.size === 0) {
        return [];
      }
      const audioBuffer = await this.decodeAudioBuffer(videoBlob);
      if (!audioBuffer || audioBuffer.numberOfChannels === 0 || audioBuffer.length === 0) {
        console.log("[SmoothStudio Audio] No audio track detected or decode failed. Auto-cut disabled (0 cuts).");
        return [];
      }
      const channelData = audioBuffer.getChannelData(0);
      const silences = detectSilenceSegments(channelData, audioBuffer.sampleRate, clicks, keystrokes, dbThreshold, minSilenceDurationMs);
      return silences;
    } catch (err) {
      console.warn("[SmoothStudio Audio] Silence analysis exception caught, returning empty silences:", err);
      return [];
    }
  }
  detectActivityGapSilences(clicks = [], keystrokes = [], durationMs = 1e4, minSilenceDurationMs = 1200) {
    const silences = [];
    const eventTimes = [
      ...clicks.map((c) => c.t),
      ...keystrokes.map((k) => k.t)
    ].sort((a, b) => a - b);
    if (eventTimes.length === 0) {
      if (durationMs > minSilenceDurationMs * 2) {
        const midStart = Math.round(durationMs * 0.35);
        const midEnd = Math.round(durationMs * 0.55);
        silences.push({
          id: "silence_" + midStart,
          startTime: midStart,
          endTime: midEnd,
          duration: midEnd - midStart,
          markedForCut: true
        });
      }
      return silences;
    }
    let prevTime = 0;
    for (const t of eventTimes) {
      const gap = t - prevTime;
      if (gap >= minSilenceDurationMs) {
        const start = Math.round(prevTime + 200);
        const end = Math.round(t - 200);
        if (end - start >= minSilenceDurationMs) {
          silences.push({
            id: "silence_" + start,
            startTime: start,
            endTime: end,
            duration: end - start,
            markedForCut: true
          });
        }
      }
      prevTime = t;
    }
    if (durationMs - prevTime >= minSilenceDurationMs) {
      const start = Math.round(prevTime + 200);
      const end = Math.round(durationMs - 100);
      if (end - start >= minSilenceDurationMs) {
        silences.push({
          id: "silence_" + start,
          startTime: start,
          endTime: end,
          duration: end - start,
          markedForCut: true
        });
      }
    }
    return silences;
  }
  playClickPop(volume = 0.35) {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(750, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.035);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.045);
    } catch {}
  }
  playKeyboardThock(volume = 0.3) {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const bufferSize = ctx.sampleRate * 0.04;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0;i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(320, now);
      filter.Q.setValueAtTime(4, now);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
      noise.stop(now + 0.05);
    } catch {}
  }
  playCameraWhoosh(volume = 0.25) {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const duration = 0.32;
      const bufferSize = ctx.sampleRate * duration;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0;i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(140, now);
      filter.frequency.exponentialRampToValueAtTime(750, now + duration * 0.5);
      filter.frequency.exponentialRampToValueAtTime(180, now + duration);
      filter.Q.setValueAtTime(2.5, now);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(volume, now + duration * 0.4);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
      noise.stop(now + duration + 0.02);
    } catch {}
  }
}
function detectSilenceSegments(channelData, sampleRate, clicks = [], keystrokes = [], dbThreshold = -42, minSilenceDurationMs = 1200) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0)
    return [];
  if (!channelData || channelData.length === 0)
    return [];
  const windowSize = Math.max(1, Math.floor(sampleRate * 0.05));
  const totalWindows = Math.floor(channelData.length / windowSize);
  const totalMs = channelData.length * 1000 / sampleRate;
  const windowMs = windowSize * 1000 / sampleRate;
  const MIN_CONTRAST_DB = 6;
  const MAX_BLIP_WINDOWS = 2;
  const CORE_WINDOWS = Math.max(1, Math.ceil(300 / windowMs));
  const SMOOTH_WINDOWS = Math.max(1, Math.ceil(300 / windowMs));
  const LOCAL_RADIUS_WINDOWS = Math.max(4, Math.round(2000 / windowMs));
  const thresholdDb = Number.isFinite(dbThreshold) ? dbThreshold : -42;
  const minPauseMs = Number.isFinite(minSilenceDurationMs) && minSilenceDurationMs >= 0 ? minSilenceDurationMs : 1200;
  const levels = new Float32Array(totalWindows);
  for (let w = 0;w < totalWindows; w++) {
    const startIdx = w * windowSize;
    let sumSquares = 0;
    let invalid = false;
    for (let i = 0;i < windowSize; i++) {
      const val = channelData[startIdx + i];
      if (!Number.isFinite(val)) {
        invalid = true;
        break;
      }
      sumSquares += val * val;
    }
    const rms = invalid ? 1 : Math.sqrt(sumSquares / windowSize);
    levels[w] = rms > 0.00001 ? 20 * Math.log10(rms) : -100;
  }
  const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))];
  const smoothed = new Float32Array(totalWindows);
  for (let w = 0;w < totalWindows; w++) {
    const start = Math.max(0, w - Math.floor(SMOOTH_WINDOWS / 2));
    const end = Math.min(totalWindows, start + SMOOTH_WINDOWS);
    let power = 0;
    for (let i = start;i < end; i++)
      power += Math.pow(10, levels[i] / 10);
    smoothed[w] = 10 * Math.log10(Math.max(0.000000000001, power / Math.max(1, end - start)));
  }
  const sortedSmoothed = Array.from(smoothed).sort((x, y) => x - y);
  const globalQuiet = percentile(sortedSmoothed, 0.1);
  const globalSpeech = percentile(sortedSmoothed, 0.9);
  const sortedLevels = Array.from(levels).sort((x, y) => x - y);
  if (sortedLevels[sortedLevels.length - 1] < thresholdDb)
    return [];
  const adaptive = totalWindows >= 20 && globalSpeech - globalQuiet >= MIN_CONTRAST_DB;
  const globalMidpoint = Math.max(thresholdDb, (globalQuiet + globalSpeech) / 2);
  const thresholdFor = (w) => {
    if (!adaptive)
      return thresholdDb;
    const start = Math.max(0, w - LOCAL_RADIUS_WINDOWS);
    const end = Math.min(totalWindows, w + LOCAL_RADIUS_WINDOWS + 1);
    const local = Array.from(smoothed.subarray(start, end)).sort((x, y) => x - y);
    const localQuiet = percentile(local, 0.1);
    const localSpeech = percentile(local, 0.9);
    if (localSpeech - localQuiet < MIN_CONTRAST_DB)
      return globalMidpoint;
    return Math.max(thresholdDb, (localQuiet + localSpeech) / 2);
  };
  const thresholds = new Float32Array(totalWindows);
  for (let w = 0;w < totalWindows; w++)
    thresholds[w] = thresholdFor(w);
  const silences = [];
  const push = (startMs, endMs) => {
    const duration = endMs - startMs;
    if (duration < minPauseMs)
      return;
    const hasActivity = clicks.some((c) => c.t >= startMs && c.t <= endMs) || keystrokes.some((k) => k.t >= startMs && k.t <= endMs);
    if (hasActivity)
      return;
    silences.push({
      id: "silence_" + Math.round(startMs),
      startTime: Math.round(startMs),
      endTime: Math.round(endMs),
      duration: Math.round(duration),
      markedForCut: true
    });
  };
  const quietCoreStart = (startW, endW) => {
    for (let s = startW;s + CORE_WINDOWS <= endW; s++) {
      let quiet = true;
      for (let k = 0;k < CORE_WINDOWS; k++) {
        if (!(levels[s + k] < thresholds[s + k])) {
          quiet = false;
          break;
        }
      }
      if (quiet)
        return s;
    }
    return startW;
  };
  const quietCoreEnd = (startW, endW) => {
    for (let e = endW;e - CORE_WINDOWS >= startW; e--) {
      let quiet = true;
      for (let k = e - CORE_WINDOWS;k < e; k++) {
        if (!(levels[k] < thresholds[k])) {
          quiet = false;
          break;
        }
      }
      if (quiet)
        return e;
    }
    return endW;
  };
  const pushRun = (startW, endW) => {
    const s = quietCoreStart(startW, endW);
    const e = quietCoreEnd(s, endW);
    push(s * windowMs, e * windowMs);
  };
  let silenceStartW = null;
  let loudRun = 0;
  for (let w = 0;w < totalWindows; w++) {
    if (levels[w] < thresholds[w]) {
      if (silenceStartW === null)
        silenceStartW = w;
      loudRun = 0;
    } else if (silenceStartW !== null) {
      loudRun++;
      if (loudRun > MAX_BLIP_WINDOWS) {
        pushRun(silenceStartW, w - loudRun + 1);
        silenceStartW = null;
        loudRun = 0;
      }
    }
  }
  if (silenceStartW !== null) {
    const endW = loudRun > 0 ? totalWindows - loudRun : totalWindows;
    pushRun(silenceStartW, endW);
  }
  const cutMs = silences.reduce((sum, s) => sum + s.duration, 0);
  if (cutMs >= totalMs * 0.95)
    return [];
  return silences;
}

// src/content/privacy-redactor.ts
var isPickerActive = false;
var hoveredElement = null;
var blurredElements = new Set;
var activeObservers = [];
var observedTargets = [];
var mutationTimeout = null;
var previousInlineFilter = new Map;
var bodyLevelWrappers = new Set;
var manualBlurElements = new Set;
var EMAIL_DETECT = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i;
var REVENUE_DETECT = /(?:[\$€£¥₹\u20B9]\s?|\b(?:USD|INR|EUR|GBP)\s?)[0-9,]+(?:\.[0-9]{2})?(?:\s?(?:k|m|b|billion|million|crore|lakh))?\b|\b[0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{2})?\b/i;
var API_KEY_DETECT = /\b(?:sk_live_[0-9a-zA-Z_-]{14,}|sk-[A-Za-z0-9_-]{14,}|AIza[0-9A-Za-z_-]{25,}|gh[pousr]_[A-Za-z0-9_-]{25,}|Bearer\s+[A-Za-z0-9._-]{14,})\b/i;
function isSensitiveString(str) {
  if (!str)
    return false;
  return EMAIL_DETECT.test(str) || API_KEY_DETECT.test(str) || REVENUE_DETECT.test(str) || /(password|secret|sk_live_|bearer\s+)/i.test(str);
}
function redactTextString(text, options = { blurEmails: true, blurRevenue: true, blurApiKeys: true }) {
  let content = text;
  if (options.blurEmails && EMAIL_DETECT.test(content)) {
    content = content.replace(new RegExp(EMAIL_DETECT.source, "gi"), "••••••@••••.com");
  }
  if (options.blurRevenue && REVENUE_DETECT.test(content)) {
    content = content.replace(new RegExp(REVENUE_DETECT.source, "gi"), "$••,•••");
  }
  if (options.blurApiKeys && API_KEY_DETECT.test(content)) {
    content = content.replace(new RegExp(API_KEY_DETECT.source, "gi"), "••••••••••••••••");
  }
  return content;
}
function isRevenueTableCell(el) {
  const text = (el.textContent || "").trim();
  if (!text || !/^[0-9,]+(?:\.[0-9]{1,2})?$/.test(text))
    return false;
  const tagOrClass = `${el.className || ""} ${el.id || ""} ${el.getAttribute("data-type") || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
  if (/(revenue|mrr|arr|sales|amount|price|billing|income|balance)/i.test(tagOrClass)) {
    return true;
  }
  if (el.tagName === "TD") {
    const tr = el.parentElement;
    if (tr) {
      const cellIndex = Array.prototype.indexOf.call(tr.children, el);
      const table = tr.closest("table");
      if (table && cellIndex >= 0) {
        const ths = table.querySelectorAll("th");
        if (ths[cellIndex]) {
          const headerText = ths[cellIndex].textContent || "";
          if (/(revenue|mrr|arr|sales|amount|price|billing|income|balance)/i.test(headerText)) {
            return true;
          }
        }
      }
    }
  }
  const revenueParent = el.closest('[id*="revenue" i], [class*="revenue" i], [data-revenue], [data-type*="revenue" i]');
  if (revenueParent)
    return true;
  return false;
}
function ensureRedactionStyles(docOrShadow) {
  try {
    if (docOrShadow.querySelector("#smoothstudio-redaction-styles"))
      return;
    const style = document.createElement("style");
    style.id = "smoothstudio-redaction-styles";
    style.textContent = `
      .smoothstudio-blur-redacted {
        filter: blur(8px) !important;
        -webkit-filter: blur(8px) !important;
      }
      input.smoothstudio-blur-redacted, textarea.smoothstudio-blur-redacted {
        filter: blur(8px) !important;
        -webkit-filter: blur(8px) !important;
        color: transparent !important;
        text-shadow: 0 0 8px rgba(255, 255, 255, 0.8) !important;
      }
    `;
    const targetHead = docOrShadow.head || docOrShadow;
    targetHead.appendChild(style);
  } catch {}
}
function blurElement(el) {
  if (!blurredElements.has(el)) {
    previousInlineFilter.set(el, {
      value: el.style.getPropertyValue("filter"),
      priority: el.style.getPropertyPriority("filter")
    });
    el.classList.add("smoothstudio-blur-redacted");
    el.setAttribute("data-smoothstudio-redacted", "true");
    el.style.filter = "blur(8px)";
    blurredElements.add(el);
  }
}
function unblurElement(el) {
  el.classList.remove("smoothstudio-blur-redacted");
  el.removeAttribute("data-smoothstudio-redacted");
  const prev = previousInlineFilter.get(el);
  if (prev && prev.value) {
    el.style.setProperty("filter", prev.value, prev.priority);
  } else {
    el.style.removeProperty("filter");
  }
  previousInlineFilter.delete(el);
  blurredElements.delete(el);
}
function blurSensitiveTextNodes(root, options) {
  let blurred = 0;
  const doc = root.ownerDocument || document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  const bodyLevel = [];
  while (node = walker.nextNode()) {
    const value = node.nodeValue;
    if (!value || !node.parentElement)
      continue;
    const parent = node.parentElement;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "INPUT"].includes(parent.tagName))
      continue;
    if (parent.closest("#smoothstudio-floating-hud"))
      continue;
    const sensitive = options.blurEmails && EMAIL_DETECT.test(value) || options.blurRevenue && REVENUE_DETECT.test(value) || options.blurApiKeys && API_KEY_DETECT.test(value);
    if (!sensitive)
      continue;
    if (parent.tagName === "BODY" || parent.tagName === "HTML") {
      bodyLevel.push(node);
      continue;
    }
    if (!blurredElements.has(parent))
      blurred++;
    blurElement(parent);
  }
  for (const textNode of bodyLevel) {
    const parent = textNode.parentNode;
    if (!parent)
      continue;
    const wrapper = doc.createElement("span");
    wrapper.setAttribute("data-smoothstudio-wrapper", "true");
    wrapper.style.display = "inline";
    parent.insertBefore(wrapper, textNode);
    wrapper.appendChild(textNode);
    bodyLevelWrappers.add(wrapper);
    blurElement(wrapper);
    blurred++;
  }
  return blurred;
}
function checkAndBlurInput(el, options) {
  if (el.type === "password") {
    blurElement(el);
    return;
  }
  const val = el.value || "";
  const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
  const nameOrId = `${el.name || ""} ${el.id || ""} ${el.placeholder || ""}`.toLowerCase();
  let shouldBlur = false;
  if (["cc-number", "current-password", "one-time-code", "new-password"].some((v) => autocomplete.includes(v))) {
    shouldBlur = true;
  }
  if (/(password|passwd|credit[_-]?card|cvv|cvc)/i.test(nameOrId)) {
    shouldBlur = true;
  }
  if (options.blurApiKeys && /(secret|api[_-]?key|token)/i.test(nameOrId)) {
    shouldBlur = true;
  }
  if (options.blurEmails && (el.type === "email" || EMAIL_DETECT.test(val) || autocomplete.includes("email") || nameOrId.includes("email"))) {
    shouldBlur = true;
  }
  if (options.blurRevenue && (REVENUE_DETECT.test(val) || nameOrId.includes("revenue") || nameOrId.includes("mrr"))) {
    shouldBlur = true;
  }
  if (options.blurApiKeys && (API_KEY_DETECT.test(val) || nameOrId.includes("token") || nameOrId.includes("key"))) {
    shouldBlur = true;
  }
  if (shouldBlur) {
    blurElement(el);
  }
}
function checkAndBlurElement(el, options) {
  if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName))
    return;
  if (el.id === "smoothstudio-floating-hud" || el.closest("#smoothstudio-floating-hud"))
    return;
  if (el.getAttribute("data-sensitive") === "true") {
    blurElement(el);
    return;
  }
  if (el.children.length > 0 && el.tagName !== "BUTTON" && el.tagName !== "A" && el.tagName !== "SPAN") {
    return;
  }
  const text = (el.innerText || el.textContent || "").trim();
  if (!text)
    return;
  let shouldBlur = false;
  if (options.blurEmails && EMAIL_DETECT.test(text)) {
    shouldBlur = true;
  }
  if (options.blurRevenue && (REVENUE_DETECT.test(text) || isRevenueTableCell(el))) {
    shouldBlur = true;
  }
  if (options.blurApiKeys && API_KEY_DETECT.test(text)) {
    shouldBlur = true;
  }
  if (shouldBlur) {
    blurElement(el);
  }
}
function scanContainer(root, options) {
  try {
    const docOrShadow = root instanceof Document || root instanceof ShadowRoot ? root : root.ownerDocument || document;
    ensureRedactionStyles(docOrShadow);
    blurSensitiveTextNodes(root, options);
    const elements = root.querySelectorAll("*");
    for (let i = 0;i < elements.length; i++) {
      const el = elements[i];
      if (!el || !el.tagName)
        continue;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName))
        continue;
      if (el.id === "smoothstudio-floating-hud")
        continue;
      if (el.shadowRoot) {
        ensureRedactionStyles(el.shadowRoot);
        observeContainer(el.shadowRoot, options);
        scanContainer(el.shadowRoot, options);
      }
      if (el.tagName === "IFRAME") {
        try {
          const iframeDoc = el.contentDocument;
          if (iframeDoc && iframeDoc.body) {
            ensureRedactionStyles(iframeDoc);
            observeContainer(iframeDoc.body, options);
            scanContainer(iframeDoc.body, options);
          }
        } catch {}
      }
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        checkAndBlurInput(el, options);
      } else if (isRevenueTableCell(el)) {
        if (options.blurRevenue) {
          blurElement(el);
        }
      } else {
        checkAndBlurElement(el, options);
      }
    }
  } catch (err) {
    console.warn("[SmoothStudio Privacy] Error during container scan:", err);
  }
}
function observeContainer(target, options) {
  if (target.__smoothstudio_observed)
    return;
  target.__smoothstudio_observed = true;
  observedTargets.push(target);
  const obs = new MutationObserver((mutations) => {
    let hasRelevantChanges = false;
    for (const m of mutations) {
      if (m.type === "childList" && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
        hasRelevantChanges = true;
        break;
      }
      if (m.type === "characterData") {
        hasRelevantChanges = true;
        break;
      }
      if (m.type === "attributes" && (m.attributeName === "value" || m.attributeName === "class")) {
        hasRelevantChanges = true;
        break;
      }
    }
    if (hasRelevantChanges) {
      if (!mutationTimeout) {
        mutationTimeout = setTimeout(() => {
          mutationTimeout = null;
          scanContainer(target, options);
        }, 30);
      }
    }
  });
  obs.observe(target, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["value", "class"]
  });
  activeObservers.push(obs);
}
function applyAutoRedaction(options = { blurEmails: true, blurRevenue: true, blurApiKeys: true }) {
  if (!document?.body)
    return 0;
  const manual = [];
  for (const el of Array.from(manualBlurElements)) {
    if (el.isConnected)
      manual.push(el);
    else
      manualBlurElements.delete(el);
  }
  resetRedactions({ keepPicker: true });
  ensureRedactionStyles(document);
  observeContainer(document.body, options);
  scanContainer(document.body, options);
  for (const el of manual) {
    if (el.isConnected)
      blurElement(el);
  }
  return blurredElements.size;
}
function handlePickerMouseMove(e) {
  if (!isPickerActive)
    return;
  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (!target || target === document.body || target === document.documentElement)
    return;
  if (hoveredElement && hoveredElement !== target) {
    hoveredElement.style.outline = "";
  }
  hoveredElement = target;
  hoveredElement.style.outline = "2px dashed #8B5CF6";
  hoveredElement.style.cursor = "crosshair";
}
function handlePickerClick(e) {
  if (!isPickerActive)
    return;
  e.preventDefault();
  e.stopPropagation();
  const target = hoveredElement;
  if (!target)
    return;
  if (blurredElements.has(target)) {
    unblurElement(target);
    manualBlurElements.delete(target);
    target.style.outline = "";
  } else {
    blurElement(target);
    manualBlurElements.add(target);
    target.style.outline = "";
  }
}
function handlePickerKeyDown(e) {
  if (e.key === "Escape" && isPickerActive) {
    stopElementPicker();
  }
}
function startElementPicker() {
  isPickerActive = true;
  document.addEventListener("mousemove", handlePickerMouseMove, true);
  document.addEventListener("click", handlePickerClick, true);
  document.addEventListener("keydown", handlePickerKeyDown, true);
  console.log("[SmoothStudio Privacy] Interactive element picker activated. Click elements to blur, press ESC to finish.");
}
function stopElementPicker() {
  isPickerActive = false;
  if (hoveredElement) {
    hoveredElement.style.outline = "";
    hoveredElement.style.cursor = "";
    hoveredElement = null;
  }
  document.removeEventListener("mousemove", handlePickerMouseMove, true);
  document.removeEventListener("click", handlePickerClick, true);
  document.removeEventListener("keydown", handlePickerKeyDown, true);
  console.log("[SmoothStudio Privacy] Interactive element picker deactivated.");
}
function resetRedactions(opts = {}) {
  if (!opts.keepPicker) {
    stopElementPicker();
    manualBlurElements.clear();
  }
  if (mutationTimeout) {
    clearTimeout(mutationTimeout);
    mutationTimeout = null;
  }
  for (const obs of activeObservers) {
    try {
      obs.disconnect();
    } catch {}
  }
  activeObservers = [];
  for (const target of observedTargets) {
    try {
      delete target.__smoothstudio_observed;
    } catch {}
  }
  observedTargets = [];
  for (const el of Array.from(blurredElements)) {
    try {
      unblurElement(el);
      el.style.outline = "";
    } catch {}
  }
  blurredElements.clear();
  previousInlineFilter.clear();
  for (const wrapper of bodyLevelWrappers) {
    try {
      const parent = wrapper.parentNode;
      if (parent) {
        while (wrapper.firstChild)
          parent.insertBefore(wrapper.firstChild, wrapper);
        parent.removeChild(wrapper);
      }
    } catch {}
  }
  bodyLevelWrappers.clear();
  try {
    document.querySelectorAll("#smoothstudio-redaction-styles").forEach((s) => s.remove());
  } catch {}
}
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage && !window.__smoothstudio_privacy_listener) {
  window.__smoothstudio_privacy_listener = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "APPLY_PRIVACY_OPTIONS") {
      const count = applyAutoRedaction(message.options || {});
      sendResponse({ status: "applied", count });
      return true;
    } else if (message.type === "START_PICKER") {
      startElementPicker();
      sendResponse({ status: "picker_active" });
      return true;
    } else if (message.type === "STOP_PICKER") {
      stopElementPicker();
      sendResponse({ status: "picker_stopped" });
      return true;
    } else if (message.type === "RESET_PRIVACY") {
      resetRedactions();
      sendResponse({ status: "reset" });
      return true;
    }
    return false;
  });
}

// src/engine/export-safety.ts
var SNAPSHOT_MAX_DISTANCE_MS = 3000;
var OBJECT_URL_REVOKE_DELAY_MS = 60000;
var HTML_ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};
function escapeHtmlText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}
function serializeForInlineScript(value) {
  const json = JSON.stringify(value) ?? "null";
  return json.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function toPercent(value, total, fallback = 50) {
  const safeFallback = Number.isFinite(fallback) ? fallback : 50;
  if (!Number.isFinite(value)) {
    return safeFallback.toFixed(1);
  }
  if (value >= 0 && value <= 1) {
    return (value * 100).toFixed(1);
  }
  if (!Number.isFinite(total) || total <= 0) {
    return safeFallback.toFixed(1);
  }
  const percent = value / total * 100;
  return Math.min(100, Math.max(0, percent)).toFixed(1);
}
function findNearestSnapshot(snapshots, timestamp, maxDistanceMs = SNAPSHOT_MAX_DISTANCE_MS) {
  if (!snapshots || snapshots.length === 0 || !Number.isFinite(timestamp)) {
    return;
  }
  let best;
  let bestDelta = Infinity;
  for (const snapshot of snapshots) {
    if (!snapshot || !Number.isFinite(snapshot.timestamp))
      continue;
    const delta = Math.abs(snapshot.timestamp - timestamp);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = snapshot;
    }
  }
  return best && bestDelta <= maxDistanceMs ? best : undefined;
}
function scheduleObjectUrlRevoke(url2, delayMs = OBJECT_URL_REVOKE_DELAY_MS) {
  if (typeof window === "undefined")
    return;
  const revoke = () => {
    try {
      URL.revokeObjectURL(url2);
    } catch {}
  };
  let timer;
  const onPageHide = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
    window.removeEventListener?.("pagehide", onPageHide);
    revoke();
  };
  timer = window.setTimeout(() => {
    window.removeEventListener?.("pagehide", onPageHide);
    revoke();
  }, delayMs);
  window.addEventListener?.("pagehide", onPageHide, { once: true });
}
function maskIfSensitive(text, alreadyHidden = false, blur = { blurEmails: true, blurRevenue: true, blurApiKeys: true }) {
  if (!text)
    return { text: "", hidden: false };
  if (alreadyHidden || text === "[hidden input]") {
    return { text: "[hidden input]", hidden: true };
  }
  const isPasswordOrSecret = /(password|passwd|secret|api[_-]?key|token|sk_live_|bearer\s+)/i.test(text);
  const patternHit = Boolean(blur.blurEmails && EMAIL_DETECT.test(text)) || Boolean(blur.blurRevenue && REVENUE_DETECT.test(text)) || Boolean(blur.blurApiKeys && API_KEY_DETECT.test(text)) || isPasswordOrSecret;
  if (patternHit) {
    if (isPasswordOrSecret) {
      return { text: "[hidden input]", hidden: true };
    }
    const redacted = redactTextString(text, blur);
    return { text: redacted.includes("••••") || redacted.includes("$••,•••") ? "[hidden input]" : redacted, hidden: true };
  }
  return { text, hidden: false };
}

// src/engine/sop-guide-exporter.ts
var TYPING_ABSORB_WINDOW_MS = 3000;

class SopGuideExporter {
  static generateMarkdownGuide(telemetry, snapshots = [], autoBlur = true) {
    const blurOptions = typeof autoBlur === "boolean" ? { blurEmails: autoBlur, blurRevenue: autoBlur, blurApiKeys: autoBlur } : {
      blurEmails: Boolean(autoBlur?.blurEmails),
      blurRevenue: Boolean(autoBlur?.blurRevenue),
      blurApiKeys: Boolean(autoBlur?.blurApiKeys)
    };
    const { metadata, clicks, keystrokes } = telemetry;
    const typingSessions = telemetry.typingSessions || [];
    const durationSec = (metadata.durationMs / 1000).toFixed(1);
    const safeTitle = maskIfSensitive(metadata.title, false, blurOptions).text || "Screen Recording";
    const dateStr = new Date(metadata.startTime).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
    let md = `# Standard Operating Procedure (SOP): ${safeTitle}

`;
    md += `> **Source URL**: [${metadata.url || "Web Application"}](${metadata.url || "#"})
`;
    md += `> **Recorded On**: ${dateStr} | **Duration**: ${durationSec}s | **Actions**: ${clicks.length} clicks, ${keystrokes.length} keystrokes

`;
    md += `---

`;
    md += `## \uD83D\uDCCB Overview
`;
    md += `This step-by-step walkthrough was automatically captured using **SmoothStudio**. Follow the sequential actions below to execute this procedure.

`;
    md += `## \uD83D\uDEE0️ Step-by-Step Execution Guide

`;
    const steps = [];
    clicks.forEach((c) => {
      steps.push({
        kind: "click",
        t: c.t,
        tag: c.targetTag,
        text: c.targetText,
        label: c.targetLabel
      });
    });
    const consumedKeystrokeTimes = new Set;
    typingSessions.forEach((s) => {
      keystrokes.forEach((k) => {
        const isPlainCharacter = k.key && k.key.length === 1 && !k.combo.includes("+");
        if (isPlainCharacter && k.t >= s.t - 60 && k.t <= s.endT + 60) {
          consumedKeystrokeTimes.add(k.t);
        }
      });
      steps.push({
        kind: "type",
        t: s.t,
        endT: s.endT,
        text: s.text,
        sensitive: s.sensitive,
        label: s.targetLabel,
        tag: s.targetTag
      });
    });
    keystrokes.forEach((k) => {
      if (consumedKeystrokeTimes.has(k.t))
        return;
      steps.push({ kind: "shortcut", t: k.t, combo: k.combo });
    });
    const filteredSteps = steps.filter((step) => {
      if (step.kind !== "click")
        return true;
      const isField = ["input", "textarea"].includes(step.tag.toLowerCase());
      if (!isField)
        return true;
      const absorbed = typingSessions.some((s) => s.t >= step.t - 200 && s.t <= step.t + TYPING_ABSORB_WINDOW_MS);
      return !absorbed;
    });
    filteredSteps.sort((a, b) => a.t - b.t);
    if (filteredSteps.length === 0) {
      md += `*No discrete click or keyboard actions were recorded during this session.*

`;
    }
    const findSnapshot = (t) => findNearestSnapshot(snapshots, t);
    let stepNumber = 1;
    for (const step of filteredSteps) {
      const timeStr = (step.t / 1000).toFixed(1) + "s";
      if (step.kind === "click") {
        const masked = maskIfSensitive(step.text, false, blurOptions);
        const target = masked.hidden ? "**[hidden input]**" : masked.text ? `**"${masked.text}"**` : `the **${step.tag.toUpperCase()}** element`;
        const maskedLabel = maskIfSensitive(step.label, false, blurOptions);
        const label = maskedLabel.hidden ? " ([hidden input])" : maskedLabel.text ? ` (${maskedLabel.text})` : "";
        md += `### Step ${stepNumber}: Click on ${target}${label} \`[${timeStr}]\`

`;
        md += `1. Locate the **${step.tag.toUpperCase()}** component on the screen.
`;
        md += `2. Perform a primary click action on ${masked.hidden ? "**[hidden input]**" : masked.text ? `**"${masked.text}"**` : "the element"}.

`;
      } else if (step.kind === "type") {
        if (step.sensitive) {
          md += `### Step ${stepNumber}: Enter \`[hidden input]\` into \`[hidden input]\` \`[${timeStr}]\`

`;
          md += `1. Ensure the sensitive field is in focus.
`;
          md += `2. Enter the value. It is intentionally not recorded.

`;
        } else {
          const masked = maskIfSensitive(step.text, false, blurOptions);
          const maskedLabel = maskIfSensitive(step.label, false, blurOptions);
          const fieldName = maskedLabel.text || step.tag;
          md += `### Step ${stepNumber}: Type **"${masked.text}"** into **"${fieldName}"** \`[${timeStr}]\`

`;
          md += `1. Click the **${fieldName}** field to focus it.
`;
          md += `2. Type **${masked.text}**.

`;
        }
      } else {
        const masked = maskIfSensitive(step.combo, step.combo === "[hidden input]", blurOptions);
        md += `### Step ${stepNumber}: Press Shortcut \`${masked.text}\` \`[${timeStr}]\`

`;
        md += `1. Ensure the active window or target input is in focus.
`;
        md += `2. Press the keyboard shortcut: \`${masked.text}\`.

`;
      }
      const snap = findSnapshot(step.t);
      if (snap) {
        md += `![Step ${stepNumber} Snapshot](${snap.dataUrl})

`;
      }
      stepNumber++;
    }
    md += `---

`;
    md += `*Generated automatically by [SmoothStudio](https://github.com/smoothscreenrecord) — $0 Server Cost Screen Studio.*`;
    return md;
  }
  static downloadMarkdown(markdownContent, filename = "SOP_Guide.md") {
    const blob = new Blob([markdownContent], { type: "text/markdown;charset=utf-8;" });
    const url2 = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url2;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    scheduleObjectUrlRevoke(url2);
  }
}

// src/engine/html-widget-exporter.ts
class HtmlWidgetExporter {
  static generateInteractiveWidget(telemetry, snapshots = [], autoBlur = true) {
    const blurOptions = typeof autoBlur === "boolean" ? { blurEmails: autoBlur, blurRevenue: autoBlur, blurApiKeys: autoBlur } : {
      blurEmails: Boolean(autoBlur?.blurEmails),
      blurRevenue: Boolean(autoBlur?.blurRevenue),
      blurApiKeys: Boolean(autoBlur?.blurApiKeys)
    };
    const isAutoBlurOn = Boolean(blurOptions.blurEmails || blurOptions.blurRevenue || blurOptions.blurApiKeys);
    const { metadata, clicks } = telemetry;
    const rawTitle = metadata.title || "Screen Recording";
    const maskedTitle = maskIfSensitive(rawTitle, false, blurOptions);
    const safeTitle = maskedTitle.hidden ? maskedTitle.text : rawTitle;
    const escapedTitle = escapeHtmlText(safeTitle);
    const steps = clicks.map((c, idx) => {
      const snap = findNearestSnapshot(snapshots, c.t, 3000);
      const raw = c.targetText;
      const maskedRaw = maskIfSensitive(raw, raw === "[hidden input]", blurOptions);
      const safeText = maskedRaw.hidden ? "[hidden input]" : raw || undefined;
      let label = c.targetLabel && c.targetLabel !== "[hidden input]" ? c.targetLabel : undefined;
      if (label) {
        const maskedLabel = maskIfSensitive(label, false, blurOptions);
        label = maskedLabel.hidden ? "[hidden input]" : maskedLabel.text;
      }
      let stepTitle;
      if (label) {
        stepTitle = `Click "${label.slice(0, 30)}"`;
      } else if (safeText) {
        stepTitle = `Click "${safeText.slice(0, 30)}"`;
      } else {
        stepTitle = `Click <${c.targetTag || "element"}>`;
      }
      return {
        step: idx + 1,
        title: stepTitle,
        xPercent: toPercent(c.x, metadata.width),
        yPercent: toPercent(c.y, metadata.height),
        img: snap?.dataUrl || ""
      };
    });
    const initialStepDesc = escapeHtmlText(steps[0]?.title || "Follow the highlighted steps.");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Interactive Walkthrough — ${escapedTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0B0C10;
      color: #F3F4F6;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .container {
      width: 100%;
      max-width: 1100px;
      background: #14161D;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.7);
    }
    .header {
      padding: 16px 24px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .title { font-size: 16px; font-weight: 600; }
    .progress-pill {
      background: rgba(139, 92, 246, 0.2);
      color: #C4B5FD;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
    }
    .viewport {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .slide-image {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .empty-placeholder {
      color: #9CA3AF;
      font-size: 14px;
      text-align: center;
      padding: 40px;
    }
    /* Pulsing Interactive Hotspot */
    .hotspot {
      position: absolute;
      width: 38px;
      height: 38px;
      transform: translate(-50%, -50%);
      cursor: pointer;
      z-index: 10;
    }
    .hotspot-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 3px solid #8B5CF6;
      animation: pulse-ring 1.6s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
    }
    .hotspot-dot {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 14px;
      height: 14px;
      background: #8B5CF6;
      border: 2px solid #FFF;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 0 15px rgba(139, 92, 246, 0.8);
    }
    @keyframes pulse-ring {
      0% { transform: scale(0.6); opacity: 1; }
      100% { transform: scale(2.2); opacity: 0; }
    }
    .footer {
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .step-desc { font-size: 14px; color: #D1D5DB; }
    .btn {
      background: #8B5CF6;
      color: white;
      border: none;
      padding: 8px 18px;
      border-radius: 8px;
      font-weight: 500;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn:hover { background: #7C3AED; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title">${escapedTitle}</div>
      <div class="progress-pill" id="step-pill">Step 1 of ${steps.length || 1}</div>
    </div>
    <div class="viewport" id="viewport">
      <img id="step-img" class="slide-image" src="${steps[0]?.img || ""}" alt="Step Preview" style="${steps[0]?.img ? "" : "display:none;"}" />
      <div id="placeholder" class="empty-placeholder" style="${steps[0]?.img ? "display:none;" : ""}">
        Interactive Hotspot Walkthrough<br><small style="color:#6B7280;">Click the pulsing target below to proceed</small>
      </div>
      <div class="hotspot" id="hotspot" style="left: ${steps[0]?.xPercent || 50}%; top: ${steps[0]?.yPercent || 50}%;">
        <div class="hotspot-ring"></div>
        <div class="hotspot-dot"></div>
      </div>
    </div>
    <div class="footer">
      <div class="step-desc" id="step-desc">${initialStepDesc}</div>
      <div style="display:flex; gap:8px;">
        <button class="btn" id="prev-btn" onclick="prevStep()" disabled>Previous</button>
        <button class="btn" id="next-btn" onclick="nextStep()">Next Step</button>
      </div>
    </div>
  </div>

  <script>
    const steps = window.steps = ${serializeForInlineScript(steps)};
    let currentIdx = 0;

    function renderStep() {
      if (!steps || steps.length === 0) return;
      const s = steps[currentIdx];
      document.getElementById('step-pill').innerText = 'Step ' + (currentIdx + 1) + ' of ' + steps.length;
      document.getElementById('step-desc').innerText = s.title;

      const img = document.getElementById('step-img');
      const placeholder = document.getElementById('placeholder');
      if (s.img) {
        img.src = s.img;
        img.style.display = 'block';
        placeholder.style.display = 'none';
      } else {
        img.style.display = 'none';
        placeholder.style.display = 'block';
      }

      const hotspot = document.getElementById('hotspot');
      hotspot.style.left = s.xPercent + '%';
      hotspot.style.top = s.yPercent + '%';

      document.getElementById('prev-btn').disabled = currentIdx === 0;
      document.getElementById('next-btn').disabled = currentIdx === steps.length - 1;
    }

    function nextStep() {
      if (currentIdx < steps.length - 1) {
        currentIdx++;
        renderStep();
      }
    }

    function prevStep() {
      if (currentIdx > 0) {
        currentIdx--;
        renderStep();
      }
    }

    document.getElementById('hotspot').addEventListener('click', nextStep);
  </script>
</body>
</html>`;
  }
  static downloadWidget(htmlContent, filename = "Interactive_Walkthrough.html") {
    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8;" });
    const url2 = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url2;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    scheduleObjectUrlRevoke(url2);
  }
}

// src/engine/cursor-spline.ts
function catmullRom(p0, p1, p2, p3, t) {
  const v0 = (p2 - p0) * 0.5;
  const v1 = (p3 - p1) * 0.5;
  const t2 = t * t;
  const t3 = t * t2;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}

class CursorSplineEngine {
  mousePoints = [];
  clicks = [];
  constructor(mousePoints = [], clicks = []) {
    this.setData(mousePoints, clicks);
  }
  setData(mousePoints, clicks) {
    this.mousePoints = [...mousePoints].sort((a, b) => a.t - b.t);
    this.clicks = [...clicks].sort((a, b) => a.t - b.t);
  }
  getCursorAt(timeMs) {
    if (this.mousePoints.length === 0) {
      return { x: 0, y: 0, style: "default", vx: 0, vy: 0, speed: 0 };
    }
    if (timeMs <= this.mousePoints[0].t) {
      const p = this.mousePoints[0];
      return { x: p.x, y: p.y, style: p.c, vx: 0, vy: 0, speed: 0 };
    }
    const last2 = this.mousePoints[this.mousePoints.length - 1];
    if (timeMs >= last2.t) {
      return { x: last2.x, y: last2.y, style: last2.c, vx: 0, vy: 0, speed: 0 };
    }
    let low = 0;
    let high = this.mousePoints.length - 1;
    let index = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.mousePoints[mid].t <= timeMs) {
        index = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const i1 = index;
    const i2 = Math.min(this.mousePoints.length - 1, i1 + 1);
    const i0 = Math.max(0, i1 - 1);
    const i3 = Math.min(this.mousePoints.length - 1, i2 + 1);
    const p0 = this.mousePoints[i0];
    const p1 = this.mousePoints[i1];
    const p2 = this.mousePoints[i2];
    const p3 = this.mousePoints[i3];
    const segmentDuration = p2.t - p1.t;
    const t = segmentDuration > 0 ? (timeMs - p1.t) / segmentDuration : 0;
    const clampedT = Math.max(0, Math.min(1, t));
    let x;
    let y;
    if (segmentDuration > 120) {
      x = p1.x + (p2.x - p1.x) * clampedT;
      y = p1.y + (p2.y - p1.y) * clampedT;
    } else {
      x = catmullRom(p0.x, p1.x, p2.x, p3.x, clampedT);
      y = catmullRom(p0.y, p1.y, p2.y, p3.y, clampedT);
    }
    const dt = Math.max(0.001, segmentDuration / 1000);
    const vx = segmentDuration < 300 ? (p2.x - p1.x) / dt : 0;
    const vy = segmentDuration < 300 ? (p2.y - p1.y) / dt : 0;
    const speed = Math.hypot(vx, vy);
    return {
      x,
      y,
      style: p1.c || "default",
      vx,
      vy,
      speed
    };
  }
  getClicks() {
    return this.clicks;
  }
  drawCursorAt(ctx, cursor, screenX, screenY, currentTimeMs, ringColor = "#8B5CF6", activeRipples, theme = "mac-obsidian", cursorScale = 1) {
    ctx.save();
    if (activeRipples && activeRipples.length > 0) {
      for (const ripple of activeRipples) {
        const progress = ripple.progress;
        const radius = (10 + progress * 34) * Math.min(1.4, Math.max(0.8, cursorScale));
        const alpha = Math.max(0, (1 - progress) * 0.85);
        ctx.save();
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 2.5 * (1 - progress * 0.5);
        ctx.globalAlpha = alpha;
        ctx.shadowColor = ringColor;
        ctx.shadowBlur = 12;
        ctx.stroke();
        if (progress < 0.4) {
          ctx.beginPath();
          ctx.arc(ripple.x, ripple.y, 4 * (1 - progress * 2), 0, Math.PI * 2);
          ctx.fillStyle = "#FFFFFF";
          ctx.fill();
        }
        ctx.restore();
      }
    }
    const effectiveSpeed = cursor.x <= 1 ? cursor.speed * 1920 : cursor.speed;
    if (effectiveSpeed > 350) {
      ctx.save();
      const blurLen = Math.min(24, effectiveSpeed * 0.02) * cursorScale;
      const angle = Math.atan2(cursor.vy, cursor.vx);
      ctx.beginPath();
      ctx.moveTo(screenX, screenY);
      ctx.lineTo(screenX - Math.cos(angle) * blurLen, screenY - Math.sin(angle) * blurLen);
      ctx.strokeStyle = theme === "neon-glow" ? "rgba(168, 85, 247, 0.45)" : "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 4 * cursorScale;
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.restore();
    }
    ctx.translate(screenX, screenY);
    if (cursorScale !== 1) {
      ctx.scale(cursorScale, cursorScale);
    }
    if (theme === "neon-glow") {
      ctx.shadowColor = "#8B5CF6";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 2;
    }
    if (cursor.style.includes("pointer") || cursor.style.includes("hand")) {
      this.drawHandCursor(ctx, theme);
    } else if (cursor.style.includes("text")) {
      this.drawIBeamCursor(ctx, theme);
    } else {
      this.drawArrowCursor(ctx, theme);
    }
    ctx.restore();
  }
  drawCursor(ctx, cursor, currentTimeMs, ringColor = "#8B5CF6") {
    ctx.save();
    const canvasW = ctx.canvas?.width || 1920;
    const canvasH = ctx.canvas?.height || 1080;
    for (const click of this.clicks) {
      const elapsed = currentTimeMs - click.t;
      if (elapsed >= 0 && elapsed <= 500) {
        const progress = elapsed / 500;
        const radius = 10 + progress * 34;
        const alpha = Math.max(0, (1 - progress) * 0.85);
        const clickX = click.x <= 1 ? click.x * canvasW : click.x;
        const clickY = click.y <= 1 ? click.y * canvasH : click.y;
        ctx.save();
        ctx.beginPath();
        ctx.arc(clickX, clickY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 2.5 * (1 - progress * 0.5);
        ctx.globalAlpha = alpha;
        ctx.shadowColor = ringColor;
        ctx.shadowBlur = 12;
        ctx.stroke();
        if (progress < 0.4) {
          ctx.beginPath();
          ctx.arc(clickX, clickY, 4 * (1 - progress * 2), 0, Math.PI * 2);
          ctx.fillStyle = "#FFFFFF";
          ctx.fill();
        }
        ctx.restore();
      }
    }
    const cursorX = cursor.x <= 1 ? cursor.x * canvasW : cursor.x;
    const cursorY = cursor.y <= 1 ? cursor.y * canvasH : cursor.y;
    const effectiveSpeed = cursor.x <= 1 ? cursor.speed * canvasW : cursor.speed;
    if (effectiveSpeed > 350) {
      ctx.save();
      const blurLen = Math.min(24, effectiveSpeed * 0.02);
      const angle = Math.atan2(cursor.vy, cursor.vx);
      ctx.beginPath();
      ctx.moveTo(cursorX, cursorY);
      ctx.lineTo(cursorX - Math.cos(angle) * blurLen, cursorY - Math.sin(angle) * blurLen);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.restore();
    }
    ctx.translate(cursorX, cursorY);
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    if (cursor.style.includes("pointer") || cursor.style.includes("hand")) {
      this.drawHandCursor(ctx);
    } else if (cursor.style.includes("text")) {
      this.drawIBeamCursor(ctx);
    } else {
      this.drawArrowCursor(ctx);
    }
    ctx.restore();
  }
  drawArrowCursor(ctx, theme = "mac-obsidian") {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 19);
    ctx.lineTo(5.2, 14.8);
    ctx.lineTo(9.5, 23.5);
    ctx.lineTo(13, 22);
    ctx.lineTo(8.5, 13.5);
    ctx.lineTo(15, 13.5);
    ctx.closePath();
    if (theme === "neon-glow") {
      ctx.fillStyle = "#8B5CF6";
      ctx.fill();
      ctx.strokeStyle = "#F3E8FF";
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else if (theme === "minimal-white") {
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.strokeStyle = "#18181B";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = "#0F1117";
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 1.8;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }
  drawHandCursor(ctx, theme = "mac-obsidian") {
    ctx.translate(-4, -1);
    ctx.scale(0.85, 0.85);
    ctx.beginPath();
    ctx.moveTo(8, 2);
    ctx.lineTo(8, 12);
    ctx.lineTo(6, 12);
    ctx.lineTo(6, 14);
    ctx.lineTo(4, 15);
    ctx.lineTo(4, 21);
    ctx.quadraticCurveTo(4, 25, 9, 25);
    ctx.lineTo(16, 25);
    ctx.quadraticCurveTo(20, 25, 20, 21);
    ctx.lineTo(20, 13);
    ctx.quadraticCurveTo(20, 11, 18, 11);
    ctx.quadraticCurveTo(16, 11, 16, 13);
    ctx.lineTo(16, 11);
    ctx.quadraticCurveTo(16, 9, 14, 9);
    ctx.quadraticCurveTo(12, 9, 12, 11);
    ctx.lineTo(12, 2);
    ctx.quadraticCurveTo(10, 0, 8, 2);
    ctx.closePath();
    if (theme === "neon-glow") {
      ctx.fillStyle = "#8B5CF6";
      ctx.fill();
      ctx.strokeStyle = "#F3E8FF";
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else if (theme === "minimal-white") {
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.strokeStyle = "#18181B";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = "#0F1117";
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 1.8;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }
  drawIBeamCursor(ctx, theme = "mac-obsidian") {
    ctx.translate(0, -9);
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(5, 0);
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 18);
    ctx.moveTo(-5, 18);
    ctx.lineTo(5, 18);
    if (theme === "neon-glow") {
      ctx.strokeStyle = "#C084FC";
      ctx.lineWidth = 2.4;
      ctx.stroke();
    } else if (theme === "minimal-white") {
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 1);
      ctx.lineTo(0, 17);
      ctx.strokeStyle = "#18181B";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 1);
      ctx.lineTo(0, 17);
      ctx.strokeStyle = "#0F1117";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

// tests/fixtures/tier1-harness.ts
window.__tier1Harness = {
  HardwareMp4Exporter,
  HardwareGifExporter,
  AudioProcessor,
  SopGuideExporter,
  HtmlWidgetExporter,
  CursorSplineEngine,
  VIBE_PRESETS,
  applyAutoRedaction,
  redactTextString,
  isSensitiveString,
  resetRedactions
};
console.log("[Tier1 Harness] Loaded successfully.");
