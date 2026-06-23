/**
 * MurmurHash3 (x86, 32-bit) — the exact hash Optimizely's SDKs use for bucketing.
 *
 * Optimizely bucketing (see python-sdk/bucketer.py):
 *   HASH_SEED        = 1
 *   MAX_HASH_VALUE   = 2^32
 *   MAX_TRAFFIC_VALUE= 10000
 *   bucket = floor( (murmur32(bucketingId + parentId, 1) / 2^32) * 10000 )
 *
 * Canonical Gary Court implementation (the basis of the `murmurhash` npm
 * package that Optimizely's JS SDK depends on). Operates on the UTF-8/ASCII
 * bytes of the key; visitor IDs and numeric experiment IDs are ASCII, so
 * charCodeAt & 0xff equals the UTF-8 byte.
 */
'use strict';

function murmurhash3_32(key, seed) {
  let remainder = key.length & 3;       // key.length % 4
  let bytes = key.length - remainder;
  let h1 = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let i = 0;
  let k1 = 0;
  let h1b = 0;

  while (i < bytes) {
    k1 =
      (key.charCodeAt(i) & 0xff) |
      ((key.charCodeAt(++i) & 0xff) << 8) |
      ((key.charCodeAt(++i) & 0xff) << 16) |
      ((key.charCodeAt(++i) & 0xff) << 24);
    ++i;

    k1 = ((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = ((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;

    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1b = ((h1 & 0xffff) * 5 + ((((h1 >>> 16) * 5) & 0xffff) << 16)) & 0xffffffff;
    h1 = (((h1b & 0xffff) + 0x6b64) + ((((h1b >>> 16) + 0xe654) & 0xffff) << 16));
  }

  k1 = 0;
  switch (remainder) {
    case 3: k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16;  // falls through
    case 2: k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;   // falls through
    case 1:
      k1 ^= (key.charCodeAt(i) & 0xff);
      k1 = ((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = ((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;
      h1 ^= k1;
  }

  h1 ^= key.length;
  h1 ^= h1 >>> 16;
  h1 = ((h1 & 0xffff) * 0x85ebca6b + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) & 0xffffffff;
  h1 ^= h1 >>> 13;
  h1 = ((h1 & 0xffff) * 0xc2b2ae35 + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16)) & 0xffffffff;
  h1 ^= h1 >>> 16;

  return h1 >>> 0;  // unsigned 32-bit
}

module.exports = { murmurhash3_32 };
