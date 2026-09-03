// Temporal smear used for camera motion blur.  Blending the previous composite
// by an amount driven by angular velocity reads exactly like the smear a real
// body-worn camera produces when the operator whips their torso around.

export const MotionBlurShader = {
  name: 'MotionBlurShader',
  uniforms: {
    tDiffuse: { value: null },
    tPrev: { value: null },
    uAmount: { value: 0.0 },
    uOffset: { value: null }   // screen-space shift of the previous frame
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tPrev;
    uniform float uAmount;
    uniform vec2 uOffset;
    varying vec2 vUv;
    void main() {
      vec4 cur = texture2D(tDiffuse, vUv);
      if (uAmount < 0.001) { gl_FragColor = cur; return; }
      vec4 acc = vec4(0.0);
      float w = 0.0;
      for (int i = 1; i <= 4; i++) {
        float t = float(i) / 4.0;
        vec2 uv = clamp(vUv + uOffset * t, 0.001, 0.999);
        float wi = 1.0 - t * 0.55;
        acc += texture2D(tPrev, uv) * wi;
        w += wi;
      }
      acc /= max(w, 0.0001);
      gl_FragColor = mix(cur, acc, clamp(uAmount, 0.0, 0.82));
    }
  `
};
