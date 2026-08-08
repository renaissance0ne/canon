"use client";

import { useEffect, useRef } from "react";
import { Mesh, Program, Renderer, Triangle } from "ogl";
import { cn } from "@/lib/cn";

/* The four ramp stops, lifted straight from styles/tokens.css. The waves are
   made of the same twelve steps as every border and label in the app — that is
   the whole reason this reads as part of Canon rather than as stock chrome.
   AGENTS.md § Design System: twelve steps, zero hues. */
const RAMP = [
  [0.9804, 0.9804, 0.9804], // --g-50   #FAFAFA
  [0.9569, 0.9569, 0.9608], // --g-100  #F4F4F5
  [0.8941, 0.8941, 0.9059], // --g-200  #E4E4E7
  [0.8314, 0.8314, 0.8471], // --g-300  #D4D4D8
] as const;

const VERTEX = /* glsl */ `
attribute vec2 uv;
attribute vec2 position;

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

/* Three sine layers at incommensurate frequencies. The sum has no visible
   period, so the field flows instead of tiling — which matters because this
   sits behind a page people scroll slowly.

   The contour term draws a hairline every sixth of the ramp. It is the same
   logic as the console's 1px borders, drawn by the shader rather than by a
   box-shadow, and it is what keeps an achromatic gradient from turning into
   grey mush. */
const FRAGMENT = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec2  uResolution;
uniform float uAmplitude;
uniform float uFrequency;
uniform float uContour;
uniform vec3  uC0;
uniform vec3  uC1;
uniform vec3  uC2;
uniform vec3  uC3;

varying vec2 vUv;

vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(uC0, uC1, smoothstep(0.00, 0.34, t));
  c      = mix(c,   uC2, smoothstep(0.34, 0.68, t));
  c      = mix(c,   uC3, smoothstep(0.68, 1.00, t));
  return c;
}

void main() {
  // Aspect-correct on x only, so the waves keep their proportions on a wide
  // viewport instead of stretching into flat bands.
  vec2 uv = vUv;
  uv.x *= uResolution.x / max(uResolution.y, 1.0);

  float t = uTime * 0.06;

  float w = 0.0;
  w += sin(uv.x * uFrequency        + t * 1.00)                  * 0.50;
  w += sin(uv.x * uFrequency * 1.71 - t * 0.73 + uv.y * 2.10)    * 0.30;
  w += sin(uv.x * uFrequency * 0.53 + t * 1.31 - uv.y * 1.30)    * 0.20;

  // A vertical ramp displaced by the wave. The ramp is shallow enough that the
  // displacement dominates, which is what makes this read as travelling swells
  // rather than as a tint that happens to wobble.
  float band = vUv.y * 0.78 + w * uAmplitude;

  vec3 color = ramp(band);

  // Contours every sixth of the ramp. Undulating hairlines, which is the same
  // vocabulary as every border in the console — and the thing that stops an
  // achromatic gradient from turning into grey mush.
  // Fixed thresholds rather than fwidth(): no derivative extension needed, so
  // this renders identically under WebGL1 and WebGL2.
  float ridge = abs(fract(band * 6.0) - 0.5) * 2.0;
  float line  = 1.0 - smoothstep(0.74, 1.0, ridge);
  color = mix(color, uC3, line * uContour);

  gl_FragColor = vec4(color, 1.0);
}
`;

type GradientWavesProps = {
  /** Vertical travel of the wave field. Higher reads as steeper swells. */
  amplitude?: number;
  /** How many crests cross the viewport. */
  frequency?: number;
  /** Strength of the contour hairlines, 0 to disable them entirely. */
  contour?: number;
  className?: string;
};

/**
 * The achromatic wave field. Replaces the 40px squares that used to sit behind
 * the landing page — same job (something for the glass chrome to blur against)
 * without the graph-paper association.
 *
 * Renders one static frame under `prefers-reduced-motion`, and nothing at all
 * where WebGL is unavailable, in which case the parent's `--surface-sunken`
 * shows through and the page is merely plainer.
 */
export function GradientWaves({
  amplitude = 0.34,
  frequency = 2.1,
  contour = 0.42,
  className,
}: GradientWavesProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: Renderer;
    try {
      renderer = new Renderer({
        alpha: false,
        antialias: false,
        depth: false,
        // Two is enough for a field this soft, and it halves the fill cost on
        // a 3x phone.
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      });
    } catch {
      // No WebGL. The parent surface is the fallback.
      return;
    }

    const gl = renderer.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);

    const program = new Program(gl, {
      vertex: VERTEX,
      fragment: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [1, 1] },
        uAmplitude: { value: amplitude },
        uFrequency: { value: frequency },
        uContour: { value: contour },
        uC0: { value: [...RAMP[0]] },
        uC1: { value: [...RAMP[1]] },
        uC2: { value: [...RAMP[2]] },
        uC3: { value: [...RAMP[3]] },
      },
    });

    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    let frame = 0;
    let lost = false;

    const draw = (ms: number) => {
      frame = requestAnimationFrame(draw);
      program.uniforms.uTime.value = ms / 1000;
      renderer.render({ scene: mesh });
    };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      program.uniforms.uResolution.value = [w, h];
      // Repaint immediately so a resize is not a frame of stale pixels — and
      // so the reduced-motion path has something to show at all.
      if (!lost) renderer.render({ scene: mesh });
    };

    const onLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(frame);
    };

    canvas.addEventListener("webglcontextlost", onLost);

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    if (!reduced) frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [amplitude, frequency, contour]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    />
  );
}
