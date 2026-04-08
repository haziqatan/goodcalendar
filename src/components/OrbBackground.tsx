import { Mesh, Program, Renderer, Triangle, Vec3 } from 'ogl';
import { useEffect, useRef } from 'react';

function hexToVec3(hex: string) {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  return new Vec3(((bigint >> 16) & 255) / 255, ((bigint >> 8) & 255) / 255, (bigint & 255) / 255);
}

export function OrbBackground() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const renderer = new Renderer({ alpha: true, premultipliedAlpha: false, dpr: Math.min(window.devicePixelRatio, 2) });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    container.appendChild(gl.canvas);

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex: `
        attribute vec2 uv;
        attribute vec2 position;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 0.0, 1.0);
        }
      `,
      fragment: `
        precision highp float;
        uniform float iTime;
        uniform vec3 iResolution;
        uniform vec3 colorA;
        uniform vec3 colorB;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(in vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }

        void main() {
          vec2 uv = vUv * 2.0 - 1.0;
          uv.x *= iResolution.x / iResolution.y;
          float dist = length(uv);
          float pulse = 0.08 * sin(iTime * 0.8);
          float field = smoothstep(1.1 + pulse, 0.1, dist);
          float fog = noise(uv * 2.6 + iTime * 0.07) * 0.25 + noise(uv * 6.0 - iTime * 0.05) * 0.12;
          vec3 col = mix(colorB, colorA, field + fog);
          col += 0.12 * vec3(0.4, 0.2, 0.9) * smoothstep(0.8, 0.1, dist);
          gl_FragColor = vec4(col, 0.75 * smoothstep(1.2, 0.18, dist));
        }
      `,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Vec3(1, 1, 1) },
        colorA: { value: hexToVec3('#6d5dfc') },
        colorB: { value: hexToVec3('#0d1226') },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height);
      program.uniforms.iResolution.value.set(width, height, width / Math.max(height, 1));
    };

    resize();
    window.addEventListener('resize', resize);

    let frame = 0;
    const update = (t: number) => {
      frame = requestAnimationFrame(update);
      program.uniforms.iTime.value = t * 0.001;
      renderer.render({ scene: mesh });
    };

    frame = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      if (container.contains(gl.canvas)) container.removeChild(gl.canvas);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return <div className="orb-shell" ref={ref} aria-hidden="true" />;
}
