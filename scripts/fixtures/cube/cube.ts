import { mountRenderHost, type SessionFactory } from 'fidelity-kit/browser/host';

// Deliberately independent of project renderers: exercises the public session contract with real WebGL work.
const createCube: SessionFactory = async (params, reporter, host) => {
  if (params.failSetup) throw new Error('Cube setup failed');
  const phase = reporter.phaseStart('shader');
  const canvas = document.createElement('canvas');
  canvas.width = Number(params.width ?? 320);
  canvas.height = Number(params.height ?? 240);
  host.append(canvas);
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 unavailable in contract browser');
  const shader = (type: number, source: string) => {
    const compiled = gl.createShader(type)!;
    gl.shaderSource(compiled, source);
    gl.compileShader(compiled);
    if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(compiled)!);
    return compiled;
  };
  const vertex = shader(
    gl.VERTEX_SHADER,
    `#version 300 es
    in vec3 position;
    uniform float angle;
    uniform float aspect;
    out vec3 color;
    void main() {
      float c = cos(angle), s = sin(angle);
      vec3 p = mat3(c,0.,-s, 0.,1.,0., s,0.,c) * position;
      p = mat3(1.,0.,0., 0.,.86,.5, 0.,-.5,.86) * p;
      float depth = p.z + 4.;
      gl_Position = vec4(p.x / aspect, p.y, p.z * .2, depth);
      color = position * .35 + .55;
    }`,
  );
  const fragment = shader(
    gl.FRAGMENT_SHADER,
    `#version 300 es
    precision highp float;
    in vec3 color;
    out vec4 pixel;
    void main() { pixel = vec4(color, 1.); }`,
  );
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
  const corners = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ];
  const triangles = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ];
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(triangles.flatMap((i) => corners[i]!)), gl.STATIC_DRAW);
  gl.useProgram(program);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.02, 0.03, 0.05, 1);
  gl.viewport(0, 0, canvas.width, canvas.height);
  const angleLocation = gl.getUniformLocation(program, 'angle');
  gl.uniform1f(gl.getUniformLocation(program, 'aspect'), canvas.width / canvas.height);
  let angle = 0;
  const state = { submitted: 0, completed: 0, disposed: false };
  Object.assign(window, { __cube: state });
  const draw = (delta = 1 / 60) => {
    if (params.failDraw && state.submitted > 0) throw new Error('Cube drawing failed');
    const token = reporter.frameBegin();
    angle += delta;
    gl.uniform1f(angleLocation, angle);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, triangles.length);
    state.submitted++;
    reporter.frameEnd(token);
  };
  const complete = async () => {
    gl.finish(); // A real GPU drain, once per batch in throughput mode.
    state.completed = state.submitted;
  };
  draw();
  await complete();
  reporter.phaseEnd(phase);
  reporter.environment({
    api: 'webgl2',
    gpuAdapter: { vendor: gl.getParameter(gl.VENDOR), description: gl.getParameter(gl.RENDERER) },
  });
  reporter.ready();
  return {
    canvas,
    draw,
    complete,
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.uniform1f(gl.getUniformLocation(program, 'aspect'), width / height);
    },
    dispose() {
      state.disposed = true;
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      canvas.remove();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
};
void mountRenderHost(createCube).catch(() => {}); // Host exposes structured failure markers for the test client.
