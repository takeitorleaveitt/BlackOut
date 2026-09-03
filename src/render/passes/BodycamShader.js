// The bodycam look, in one pass: barrel (fisheye) distortion, chromatic
// aberration that grows toward the edges, sensor noise + film grain, rolling
// scanlines, block-compression artefacts, exposure/auto-gain, vignette,
// lens glare streaks and damage interference.

export const BodycamShader = {
  name: 'BodycamShader',
  uniforms: {
    tDiffuse: { value: null },
    tNoise: { value: null },
    uTime: { value: 0 },
    uResolution: { value: null },
    uDistortion: { value: 0.30 },      // barrel amount
    uChroma: { value: 0.55 },
    uGrain: { value: 0.5 },
    uScanline: { value: 0.35 },
    uVignette: { value: 0.72 },
    uExposure: { value: 1.0 },
    uContrast: { value: 1.06 },
    uSaturation: { value: 0.92 },
    uCompression: { value: 0.4 },
    uGlare: { value: 0.35 },
    uDamage: { value: 0.0 },           // 0..1 hit interference
    uFlash: { value: 0.0 },
    uGain: { value: 1.0 },             // auto-gain from scene luminance
    uStrength: { value: 1.0 }          // master bodycam intensity
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D tNoise;
    uniform vec2 uResolution;
    uniform float uTime, uDistortion, uChroma, uGrain, uScanline, uVignette;
    uniform float uExposure, uContrast, uSaturation, uCompression, uGlare;
    uniform float uDamage, uFlash, uGain, uStrength;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    // Barrel distortion around the frame centre.  The result is scaled back
    // in so the corners stay filled instead of showing black wedges.
    vec2 distort(vec2 uv, float k) {
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      float f = 1.0 + k * r2 + k * 0.30 * r2 * r2;
      float corner = 1.0 + k * 0.5 + k * 0.30 * 0.25;
      return 0.5 + c * f / corner;
    }

    vec3 sampleRGB(vec2 uv, float chroma) {
      vec2 c = uv - 0.5;
      float r = length(c);
      vec2 dir = r > 0.0001 ? c / r : vec2(0.0);
      float amt = chroma * 0.0022 * (r * r * 2.2 + 0.15);
      float rr = texture2D(tDiffuse, uv + dir * amt).r;
      float gg = texture2D(tDiffuse, uv).g;
      float bb = texture2D(tDiffuse, uv - dir * amt).b;
      return vec3(rr, gg, bb);
    }

    void main() {
      float S = uStrength;
      vec2 uv = vUv;

      // rolling shutter wobble + damage jitter
      float wob = sin(uv.y * 90.0 + uTime * 2.3) * 0.00035 * S;
      float dmg = uDamage;
      if (dmg > 0.001) {
        float band = step(0.995 - dmg * 0.35, hash(vec2(floor(uv.y * 44.0), floor(uTime * 12.0))));
        uv.x += band * (hash(vec2(uTime, uv.y)) - 0.5) * 0.06 * dmg;
        uv.x += sin(uTime * 40.0 + uv.y * 30.0) * 0.002 * dmg;
      }
      uv.x += wob;

      vec2 duv = distort(uv, uDistortion * S);
      if (duv.x < 0.0 || duv.x > 1.0 || duv.y < 0.0 || duv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      // block compression: quantise UVs slightly inside 8px macroblocks
      if (uCompression > 0.01) {
        vec2 px = uResolution / 8.0;
        vec2 blk = floor(duv * px) / px;
        float noiseAmt = hash(blk + floor(uTime * 8.0)) ;
        float q = uCompression * 0.5 * step(0.82, noiseAmt);
        duv = mix(duv, blk + 0.5 / px, q);
      }

      vec3 col = sampleRGB(duv, uChroma * S);

      // lens glare: cheap anamorphic streak from bright pixels
      if (uGlare > 0.001) {
        vec3 streak = vec3(0.0);
        for (int i = 1; i <= 6; i++) {
          float o = float(i) * 0.006;
          streak += texture2D(tDiffuse, duv + vec2(o, 0.0)).rgb;
          streak += texture2D(tDiffuse, duv - vec2(o, 0.0)).rgb;
        }
        streak /= 12.0;
        streak = max(streak - 0.62, 0.0);
        col += streak * uGlare * vec3(0.6, 0.78, 1.25) * 1.6;
      }

      // exposure / auto-gain
      col *= uExposure * uGain;

      // filmic-ish contrast and desaturation toward the sensor look
      col = (col - 0.5) * uContrast + 0.5;
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lum), col, uSaturation);
      col = max(col, 0.0);

      // grain (animated sensor noise, stronger in shadows like a real sensor)
      if (uGrain > 0.001) {
        vec2 nuv = duv * (uResolution / 256.0) + vec2(fract(uTime * 13.0), fract(uTime * 7.3));
        vec3 n = texture2D(tNoise, nuv).rgb - 0.5;
        float shadowBoost = 1.0 + (1.0 - smoothstep(0.0, 0.45, lum)) * 1.9;
        col += n * uGrain * 0.09 * shadowBoost * S;
      }

      // scanlines + faint horizontal sync line
      if (uScanline > 0.001) {
        float sl = sin(duv.y * uResolution.y * 1.5708) * 0.5 + 0.5;
        col *= 1.0 - uScanline * 0.10 * sl * S;
        float sync = smoothstep(0.0, 0.02, abs(fract(duv.y + uTime * 0.06) - 0.5) - 0.48);
        col += sync * 0.02 * S;
      }

      // vignette + corner falloff
      float r = length(duv - 0.5);
      col *= 1.0 - uVignette * S * smoothstep(0.42, 0.92, r) * 0.72;

      // muzzle / grenade flash
      col += uFlash;

      // damage desaturation + red lift
      if (dmg > 0.001) {
        float l2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, vec3(l2) * vec3(1.25, 0.68, 0.64), dmg * 0.40);
      }

      gl_FragColor = vec4(col, 1.0);
    }
  `
};
