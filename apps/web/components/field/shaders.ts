// Field shaders. Every visible change is driven by uniforms the Animator sets from real events (docs/19).
export const MAX_CLUSTERS = 64; // slot 63 is the Core (the firm itself)
export const CORE = MAX_CLUSTERS - 1;

export const cloudVertex = /* glsl */ `
uniform float uTime;
uniform float uPx;
uniform vec4 uCenter[${MAX_CLUSTERS}]; // xyz, radius
uniform vec4 uState[${MAX_CLUSTERS}];  // flare, shimmer, kind (0 coin, 1 held, 2 core), density
uniform float uSeed[${MAX_CLUSTERS}];
uniform float uTemp;
attribute float aCluster;
attribute vec4 aRand;   // direction, radius
attribute vec4 aRand2;  // density threshold, size, twinkle phase, lobe
varying vec3 vColor;
varying float vAlpha;

float h(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
  int i = int(aCluster + 0.5);
  vec4 c = uCenter[i];
  vec4 st = uState[i];
  float seed = uSeed[i];
  float lobes = 3.0 + floor(h(seed) * 4.0);
  float lobe = floor(aRand2.w * lobes);
  vec3 lc = vec3(h(seed + lobe * 1.7) - 0.5, (h(seed + lobe * 3.1) - 0.5) * 0.6, h(seed + lobe * 5.3) - 0.5) * 1.5 * c.w;
  float lr = c.w * (0.42 + 0.4 * h(seed + lobe * 9.1));
  vec3 dir = normalize(aRand.xyz * 2.0 - 1.0 + 1e-4);
  float rr = pow(aRand.w, 0.62);
  vec3 p = c.xyz + lc + dir * rr * lr;
  // breathing: slow, low-frequency; flares stir it
  float stir = 0.05 + st.x * 0.22;
  p += sin(vec3(p.y * 1.1 + seed, p.z * 1.3, p.x * 0.9) + uTime * vec3(0.21, 0.17, 0.19)) * stir * c.w;
  // a flare pushes the outer points outward for a moment
  p += dir * st.x * 0.35 * c.w * rr;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = (0.55 + aRand2.y * 1.25) * (st.z > 1.5 ? 1.15 : 1.0);
  gl_PointSize = size * uPx / max(1.0, -mv.z) * (1.0 + st.x * 0.6);

  vec3 amber = vec3(0.91, 0.66, 0.30);
  vec3 crimson = vec3(0.78, 0.22, 0.17);
  vec3 bone = vec3(0.93, 0.90, 0.84);
  vec3 col = mix(amber, crimson, uTemp);
  if (st.z > 1.5) col = mix(bone, crimson, uTemp * 0.5);
  else if (st.z > 0.5) col = mix(col, bone, 0.22);
  // shimmer: a front sweeping across the cloud (a Jev read)
  float front = dot(dir, normalize(vec3(0.8, 0.35, 0.45)));
  float sweep = st.y * exp(-pow((front + 1.0) * 0.5 - (1.0 - st.y), 2.0) * 40.0);
  col = mix(col, bone, clamp(st.x * 0.8 * aRand2.y + sweep * 0.9, 0.0, 1.0));

  float visible = step(aRand2.x, st.w);
  float twinkle = 0.78 + 0.22 * sin(uTime * (0.6 + aRand2.z * 1.4) + aRand2.z * 40.0);
  float edge = 1.0 - rr * 0.55;
  float depthFade = clamp(1.25 - (-mv.z) / 60.0, 0.15, 1.0);
  vAlpha = visible * edge * twinkle * depthFade * (st.z > 1.5 ? 0.95 : 0.62) * (1.0 + st.x * 0.8 + sweep);
  vColor = col;
}
`;

export const cloudFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d);
  if (a * vAlpha < 0.004) discard;
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`;

export const dustVertex = /* glsl */ `
uniform float uTime;
uniform float uPx;
attribute vec4 aRand;
varying float vAlpha;
void main() {
  vec3 p = (aRand.xyz - 0.5) * vec3(90.0, 34.0, 70.0);
  p += sin(vec3(uTime * 0.05 + aRand.w * 30.0, uTime * 0.04 + aRand.x * 20.0, uTime * 0.03)) * 0.4; // breath only
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.6 + aRand.w) * uPx / max(1.0, -mv.z);
  vAlpha = 0.16 * clamp(1.4 - (-mv.z) / 70.0, 0.0, 1.0);
}
`;

export const dustFragment = /* glsl */ `
uniform float uTemp;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(mix(vec3(0.75, 0.62, 0.42), vec3(0.7, 0.3, 0.24), uTemp), a * vAlpha);
}
`;

export const lineVertex = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const lineFragment = /* glsl */ `
uniform float uTemp;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(mix(vec3(0.86, 0.62, 0.30), vec3(0.78, 0.24, 0.18), uTemp), vAlpha);
}
`;

export const cometVertex = /* glsl */ `
uniform float uPx;
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.8 + aAlpha * 2.6) * uPx / max(1.0, -mv.z);
}
`;

export const cometFragment = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(mix(vec3(0.91, 0.66, 0.30), vec3(0.96, 0.94, 0.88), vAlpha), a * vAlpha);
}
`;
