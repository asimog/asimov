// Field shaders (docs/UI.md). Clouds are bundles of curved strands, so a coin reads as fibre, not fog; a second, wider and
// fainter pass of the same points is the glow. Every visible change comes from uniforms the scene sets from real events.
export const MAX_CLUSTERS = 64; // slot 63 is the Core (the firm itself)
export const CORE = MAX_CLUSTERS - 1;

const common = /* glsl */ `
uniform float uTime;
uniform float uPx;
uniform float uHalo;    // 0: the points, 1: the glow pass
uniform float uTemp;    // 0 amber, 1 crimson: the risk state
uniform vec4 uCenter[${MAX_CLUSTERS}]; // xyz, radius
uniform vec4 uState[${MAX_CLUSTERS}];  // flare, shimmer, kind (0 coin, 1 held, 2 core), density
uniform float uSeed[${MAX_CLUSTERS}];
attribute float aCluster;
attribute vec4 aRand;
attribute vec4 aRand2;
varying vec3 vColor;
varying float vAlpha;
float h(float n) { return fract(sin(n) * 43758.5453123); }
`;

export const cloudVertex = /* glsl */ `
${common}
void main() {
  int i = int(aCluster + 0.5);
  vec4 c = uCenter[i];
  vec4 st = uState[i];
  float seed = uSeed[i];
  bool core = st.z > 1.5;

  // a strand: a short curved fibre inside the cloud; most points sit on one, the rest fill the volume
  float k = floor(aRand2.w * 56.0);
  vec3 base = vec3(h(seed + k * 1.31) - 0.5, (h(seed + k * 2.17) - 0.5) * 0.55, h(seed + k * 3.71) - 0.5) * 1.65 * c.w;
  vec3 T = normalize(vec3(h(seed + k * 4.13) - 0.5, (h(seed + k * 5.29) - 0.5) * 0.5, h(seed + k * 6.07) - 0.5) + 1e-3);
  vec3 N = normalize(cross(T, vec3(0.13, 1.0, 0.21)));
  vec3 B = cross(T, N);
  float len = c.w * (0.7 + 1.1 * h(seed + k * 7.73));
  float t = aRand.w - 0.5;
  float wave = sin(t * (3.0 + 5.0 * h(seed + k * 8.9)) + h(seed + k) * 6.28);
  vec3 p = c.xyz + base + T * t * len + N * wave * 0.22 * c.w + B * cos(t * 4.0 + k) * 0.12 * c.w;
  p += (aRand.xyz - 0.5) * c.w * (0.05 + 0.25 * aRand2.y * aRand2.y);
  if (aRand2.z < 0.22) {
    vec3 dir = normalize(aRand.xyz * 2.0 - 1.0 + 1e-4);
    p = c.xyz + dir * pow(aRand2.x, 0.5) * c.w * 1.1;
  }
  if (core) p = c.xyz + normalize(aRand.xyz * 2.0 - 1.0 + 1e-4) * pow(aRand.w, 0.8) * c.w;

  // breathing, stirred by recent activity; a flare pushes the fibres outward
  vec3 off = p - c.xyz;
  float stir = 0.035 + st.x * 0.2;
  p += sin(vec3(p.y * 0.9 + seed, p.z * 1.1, p.x * 0.8) + uTime * vec3(0.17, 0.13, 0.15)) * stir * c.w * 0.3;
  p += normalize(off + 1e-4) * st.x * 0.28 * c.w * aRand.w;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = (0.7 + aRand2.y * 1.6) * (core ? 0.9 : 1.0) * (1.0 + st.x * 0.8);
  gl_PointSize = sz * uPx / max(1.0, -mv.z) * mix(1.0, 4.2, uHalo);

  vec3 amber = vec3(0.95, 0.68, 0.32);
  vec3 deep = vec3(0.62, 0.36, 0.13);
  vec3 crimson = vec3(0.80, 0.21, 0.16);
  vec3 bone = vec3(0.96, 0.92, 0.84);
  vec3 col = mix(deep, amber, 0.35 + 0.65 * aRand2.y);
  col = mix(col, crimson, uTemp);
  if (core) col = mix(mix(amber, bone, 0.55), crimson, uTemp * 0.5);
  else if (st.z > 0.5) col = mix(col, bone, 0.2);
  float front = dot(normalize(off + 1e-4), normalize(vec3(0.8, 0.35, 0.45)));
  float sweep = st.y * exp(-pow((front + 1.0) * 0.5 - (1.0 - st.y), 2.0) * 30.0);
  col = mix(col, bone, clamp(st.x * 0.7 * aRand2.y + sweep, 0.0, 1.0));

  float visible = step(aRand2.x, st.w) * step(0.01, c.w);
  float depthFade = clamp(1.3 - (-mv.z) / 90.0, 0.2, 1.0);
  float a = visible * depthFade * (core ? 0.42 : 0.7) * (1.0 + st.x * 0.9 + sweep);
  vAlpha = a * mix(1.0, 0.06, uHalo);
  vColor = col;
}
`;

export const cloudFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  if (a * vAlpha < 0.002) discard;
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`;

/** Network strands and Core filaments: hairlines with a per-vertex alpha. */
export const lineVertex = /* glsl */ `
attribute float aAlpha;
attribute float aKind; // 0 caller link, 1 core filament
varying float vAlpha;
varying float vKind;
void main() {
  vAlpha = aAlpha;
  vKind = aKind;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const lineFragment = /* glsl */ `
uniform float uTemp;
varying float vAlpha;
varying float vKind;
void main() {
  vec3 link = vec3(0.86, 0.6, 0.3);
  vec3 held = vec3(0.98, 0.86, 0.62);
  vec3 col = mix(mix(link, held, vKind), vec3(0.8, 0.24, 0.18), uTemp * 0.85);
  gl_FragColor = vec4(col, vAlpha);
}
`;

/** Packets: one per real event, each a head and a fading trail. */
export const packetVertex = /* glsl */ `
uniform float uPx;
attribute float aAlpha;
attribute float aHot;
varying float vAlpha;
varying float vHot;
void main() {
  vAlpha = aAlpha;
  vHot = aHot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.9 + aAlpha * 2.2 + aHot * 1.4) * uPx / max(1.0, -mv.z);
}
`;

export const packetFragment = /* glsl */ `
uniform float uTemp;
varying float vAlpha;
varying float vHot;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  vec3 col = mix(mix(vec3(0.98, 0.74, 0.38), vec3(1.0, 0.97, 0.9), vHot), vec3(0.86, 0.3, 0.22), uTemp * 0.7);
  gl_FragColor = vec4(col, a * vAlpha);
}
`;

export const dustVertex = /* glsl */ `
uniform float uTime;
uniform float uPx;
attribute vec4 aRand;
varying float vAlpha;
void main() {
  vec3 p = (aRand.xyz - 0.5) * vec3(150.0, 60.0, 110.0);
  p += sin(vec3(uTime * 0.04 + aRand.w * 30.0, uTime * 0.03 + aRand.x * 20.0, uTime * 0.02)) * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.4 + aRand.w * 0.8) * uPx / max(1.0, -mv.z);
  vAlpha = 0.22 * clamp(1.4 - (-mv.z) / 110.0, 0.0, 1.0);
}
`;

export const dustFragment = /* glsl */ `
uniform float uTemp;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(mix(vec3(0.75, 0.6, 0.4), vec3(0.7, 0.3, 0.24), uTemp), a * vAlpha);
}
`;
