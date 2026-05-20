<script lang="ts">
  /**
   * ClaudeCanvas — Canvas 2D pixel-art mascot for Claude Code.
   *
   * A cute blob/robot creature with expressive animations.
   * States:
   * - idle: gentle floating, blinking, occasional thought sparks
   * - running: fast leg cycle, speed lines, excited expression
   * - waiting: shaking with frustration, amber prompt bubble
   */
  import { onMount } from "svelte";

  interface Props {
    status?: "idle" | "running" | "waiting" | "done";
    size?: number;
  }

  let { status = "idle", size = 27 }: Props = $props();

  let canvas: HTMLCanvasElement;
  let animFrame: number;
  let alive = $state(true);
  let startTime = 0;

  $effect(() => {
    const s = status;
    alive = false;
    setTimeout(() => {
      alive = true;
      startTime = performance.now();
    }, 50);
  });

  onMount(() => {
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    startTime = performance.now();
    render(ctx);

    return () => {
      if (animFrame) cancelAnimationFrame(animFrame);
    };
  });

  function render(ctx: CanvasRenderingContext2D) {
    const now = performance.now();
    const elapsed = (now - startTime) / 1000;

    ctx.clearRect(0, 0, size, size);

    switch (status) {
      case "idle":
        drawIdle(ctx, elapsed);
        break;
      case "running":
        drawRunning(ctx, elapsed);
        break;
      case "waiting":
        drawWaiting(ctx, elapsed);
        break;
      case "done":
        drawDone(ctx, elapsed);
        break;
    }

    animFrame = requestAnimationFrame(() => render(ctx));
  }

  // ── Grid helpers ──
  // 16x16 logical grid, centered and scaled
  function coord(ox: number, oy: number, s = 1): { x: number; y: number; w: number; h: number } {
    const scale = size / 16;
    return {
      x: ox * scale,
      y: oy * scale,
      w: s * scale,
      h: scale,
    };
  }

  function px(ctx: CanvasRenderingContext2D, ox: number, oy: number, color: string) {
    const { x, y, w, h } = coord(ox, oy, 1);
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
  }

  function rect(
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    w: number,
    h: number,
    color: string,
  ) {
    const { x, y, w: ww, h: hh } = coord(ox, oy, 1);
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(ww * w), Math.round(hh * h));
  }

  function lerp(kfs: [number, number][], t: number): number {
    if (t <= kfs[0][0]) return kfs[0][1];
    for (let i = 1; i < kfs.length; i++) {
      if (t <= kfs[i][0]) {
        const u = (t - kfs[i - 1][0]) / (kfs[i][0] - kfs[i - 1][0]);
        return kfs[i - 1][1] + (kfs[i][1] - kfs[i - 1][1]) * u;
      }
    }
    return kfs[kfs.length - 1][1];
  }

  // ── Palette ──
  const P = {
    body: "#7C3AED", // violet-600
    bodyD: "#6D28D9", // violet-700 (shadow)
    bodyL: "#A78BFA", // violet-400 (highlight)
    eye: "#1E1B4B", // dark
    eyeW: "#EDE9FE", // violet-50 (white)
    pupil: "#4C1D95", // violet-900
    cheek: "#F472B6", // pink-400
    foot: "#5B21B6", // violet-800
    prompt: "#000000",
    spark: "#DDD6FE", // violet-200
    amber: "#F59E0B",
    shadow: "rgba(0,0,0,0.18)",
    glow: "rgba(167,139,250,0.25)",
  };

  // ── Sprite definition ──
  // Each row is [x, color] pairs for that y row of the body
  // 16x16 grid, rows 0-15 top to bottom
  // Body shape: blob with head bump, feet, and a face

  function drawSprite(
    ctx: CanvasRenderingContext2D,
    pixels: Array<[number, number, string]>,
    dy = 0,
    flip = false,
  ) {
    for (const [x, y, c] of pixels) {
      const drawX = flip ? 15 - x : x;
      px(ctx, drawX, y + dy, c);
    }
  }

  // Body pixel map (x, y, color)
  type Pixel = [number, number, string];
  const BODY: Pixel[] = [
    // Top bump / antenna
    [7, 0, P.bodyL],
    [8, 0, P.bodyL],
    [6, 1, P.bodyL],
    [7, 1, P.body],
    [8, 1, P.body],
    [9, 1, P.bodyD],
    // Head top
    [4, 2, P.bodyL],
    [5, 2, P.body],
    [6, 2, P.body],
    [7, 2, P.body],
    [8, 2, P.body],
    [9, 2, P.body],
    [10, 2, P.body],
    [11, 2, P.bodyD],
    // Eyes row
    [3, 3, P.bodyL],
    [4, 3, P.body],
    [5, 3, P.body],
    [6, 3, P.eyeW],
    [7, 3, P.eye],
    [8, 3, P.body],
    [9, 3, P.eye],
    [10, 3, P.eyeW],
    [11, 3, P.body],
    [12, 3, P.bodyD],
    // Cheek row
    [2, 4, P.bodyL],
    [3, 4, P.body],
    [4, 4, P.body],
    [5, 4, P.eyeW],
    [6, 4, P.eye],
    [7, 4, P.body],
    [8, 4, P.body],
    [9, 4, P.eye],
    [10, 4, P.eyeW],
    [11, 4, P.body],
    [12, 4, P.body],
    [13, 4, P.bodyD],
    // Face
    [2, 5, P.bodyL],
    [3, 5, P.body],
    [4, 5, P.body],
    [5, 5, P.body],
    [6, 5, P.body],
    [7, 5, P.body],
    [8, 5, P.body],
    [9, 5, P.body],
    [10, 5, P.body],
    [11, 5, P.body],
    [12, 5, P.body],
    [13, 5, P.bodyD],
    [1, 6, P.bodyL],
    [2, 6, P.body],
    [3, 6, P.body],
    [4, 6, P.cheek],
    [5, 6, P.body],
    [6, 6, P.body],
    [7, 6, P.body],
    [8, 6, P.body],
    [9, 6, P.body],
    [10, 6, P.cheek],
    [11, 6, P.body],
    [12, 6, P.body],
    [13, 6, P.bodyD],
    [14, 6, P.bodyD],
    // Body sides
    [1, 7, P.bodyL],
    [2, 7, P.body],
    [3, 7, P.body],
    [4, 7, P.body],
    [5, 7, P.body],
    [6, 7, P.body],
    [7, 7, P.body],
    [8, 7, P.body],
    [9, 7, P.body],
    [10, 7, P.body],
    [11, 7, P.body],
    [12, 7, P.body],
    [13, 7, P.bodyD],
    [14, 7, P.bodyD],
    [1, 8, P.bodyL],
    [2, 8, P.body],
    [3, 8, P.body],
    [4, 8, P.body],
    [5, 8, P.body],
    [6, 8, P.body],
    [7, 8, P.body],
    [8, 8, P.body],
    [9, 8, P.body],
    [10, 8, P.body],
    [11, 8, P.body],
    [12, 8, P.body],
    [13, 8, P.bodyD],
    [14, 8, P.bodyD],
    // Lower body
    [2, 9, P.body],
    [3, 9, P.body],
    [4, 9, P.body],
    [5, 9, P.body],
    [6, 9, P.body],
    [7, 9, P.body],
    [8, 9, P.body],
    [9, 9, P.body],
    [10, 9, P.body],
    [11, 9, P.body],
    [12, 9, P.bodyD],
    [13, 9, P.bodyD],
    [2, 10, P.body],
    [3, 10, P.body],
    [4, 10, P.body],
    [5, 10, P.body],
    [6, 10, P.body],
    [7, 10, P.body],
    [8, 10, P.body],
    [9, 10, P.body],
    [10, 10, P.body],
    [11, 10, P.body],
    [12, 10, P.bodyD],
    [13, 10, P.bodyD],
    // Feet row
    [3, 11, P.body],
    [4, 11, P.body],
    [5, 11, P.body],
    [6, 11, P.foot],
    [7, 11, P.body],
    [8, 11, P.body],
    [9, 11, P.foot],
    [10, 11, P.body],
    [11, 11, P.body],
    [12, 11, P.bodyD],
    [4, 12, P.foot],
    [5, 12, P.foot],
    [9, 12, P.foot],
    [10, 12, P.foot],
  ];

  // ── Idle: floating, blinking, sparks ──
  function drawIdle(ctx: CanvasRenderingContext2D, t: number) {
    const bob = Math.sin((t / 1.4) * Math.PI * 2) * 0.7;
    const blink = Math.sin(t * 0.7);
    const isBlinking = blink > 0.92;

    // Shadow
    const shadowSway = Math.sin((t / 1.4) * Math.PI * 2) * 0.4;
    rect(ctx, 4 - shadowSway * 0.1, 14, 8, 1, P.shadow);

    // Body
    drawSprite(ctx, BODY, bob);

    // Blink: collapse eyes to a line
    if (isBlinking) {
      const { x, y, w, h } = coord(5, 3, 1);
      const { x: x2, y: y2, w: w2, h: h2 } = coord(10, 3, 1);
      ctx.fillStyle = P.eye;
      ctx.fillRect(Math.round(x), Math.round(y + bob), Math.round(w * 2), Math.ceil(h * 0.4));
      ctx.fillRect(Math.round(x2), Math.round(y2 + bob), Math.round(w2 * 2), Math.ceil(h2 * 0.4));
    }

    // Thought sparks
    for (let i = 0; i < 2; i++) {
      const phase = ((t * 0.6 + i * 1.8) % 3.5) / 3.5;
      if (phase > 0.75) continue;
      const opacity = phase < 0.5 ? phase * 2 : (1 - phase) * 4;
      const sx = i === 0 ? 13 : 14.5;
      const sy = 1.5 - phase * 2;
      const ss = 1 + (1 - phase) * 0.5;
      ctx.save();
      ctx.globalAlpha = opacity * 0.8;
      px(ctx, sx, sy, P.spark);
      if (ss > 1.2) px(ctx, sx + 0.3, sy - 0.3, P.spark);
      ctx.restore();
    }

    // Tiny cursor near body
    const cursorAlpha = ((Math.sin(t * 3) + 1) / 2) * 0.6;
    ctx.save();
    ctx.globalAlpha = cursorAlpha;
    rect(ctx, 4, 10 + bob, 1, 2, P.prompt);
    ctx.restore();
  }

  // ── Running: fast movement, leg cycle, speed lines ──
  function drawRunning(ctx: CanvasRenderingContext2D, t: number) {
    const cycle = t * 4.5; // fast cycle
    const leg = Math.sin(cycle) * 1.5;
    const bodyBob = Math.abs(Math.sin(cycle)) * 1.2;
    const tilt = Math.sin(cycle) * 0.15;

    // Speed lines (behind)
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const linePhase = ((t * 2 + i * 0.4) % 1.2) / 1.2;
      if (linePhase > 0.6) continue;
      const lx = 0.5 - linePhase * 0.4;
      const opacity = (1 - linePhase / 0.6) * 0.35;
      ctx.globalAlpha = opacity;
      rect(ctx, lx, 4 + i * 2, 1.5 + (1 - linePhase) * 2, 0.5, P.bodyL);
    }
    ctx.restore();

    // Shadow squish
    rect(ctx, 3.5 - bodyBob * 0.05, 14, 9 + bodyBob * 0.1, 1, P.shadow);

    // Body with tilt
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(tilt);
    ctx.translate(-size / 2, -size / 2);
    drawSprite(ctx, BODY, -bodyBob);
    ctx.restore();

    // Legs (drawn on top)
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(tilt);
    ctx.translate(-size / 2, -size / 2);
    // Left foot
    rect(ctx, 5 + leg * 0.5, 11 - bodyBob, 2, 2, P.foot);
    // Right foot
    rect(ctx, 9 - leg * 0.5, 11 - bodyBob, 2, 2, P.foot);
    ctx.restore();

    // Excited eyes (stars)
    const starPulse = (Math.sin(t * 8) + 1) / 2;
    drawStar(ctx, 6, 3 - bodyBob, starPulse > 0.5 ? P.spark : P.eyeW);
    drawStar(ctx, 9.5, 3 - bodyBob, starPulse > 0.5 ? P.eyeW : P.spark);

    // Motion trail blur hint
    ctx.save();
    ctx.globalAlpha = 0.12;
    drawSprite(ctx, BODY, -bodyBob, true); // ghost flip
    ctx.restore();
  }

  function drawStar(ctx: CanvasRenderingContext2D, ox: number, oy: number, color: string) {
    const { x, y, w, h } = coord(ox, oy, 1);
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y + h * 0.2), Math.ceil(w), Math.ceil(h * 0.6));
    ctx.fillRect(Math.round(x + w * 0.2), Math.round(y), Math.ceil(w * 0.6), Math.ceil(h));
  }

  // ── Done: satisfied, relaxed breathing, checkmark ──
  function drawDone(ctx: CanvasRenderingContext2D, t: number) {
    const breathe = Math.sin((t / 2.2) * Math.PI * 2) * 0.35;
    const sparkleT = t % 2.8;
    const checkPulse = Math.sin(t * 2.5) * 0.15 + 0.85;

    // Soft green tint glow
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "#34D399"; // emerald-400
    ctx.beginPath();
    ctx.arc(size / 2, size / 2 + 1, size * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Shadow
    rect(ctx, 4, 14, 8, 1, `rgba(0,0,0,${0.15 + breathe * 0.03})`);

    // Body with gentle breathe
    drawSprite(ctx, BODY, breathe);

    // Checkmark above head (satisfaction)
    if (sparkleT > 0.5 && sparkleT < 2.5) {
      const sparkleOpacity = Math.sin(((sparkleT - 0.5) / 2.0) * Math.PI);
      ctx.save();
      ctx.globalAlpha = sparkleOpacity * 0.9;
      ctx.strokeStyle = "#34D399";
      ctx.lineWidth = Math.max(0.5, size / 16);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const cx = (7.5 * size) / 16;
      const cy = (-1.5 * size) / 16;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + (1.5 * size) / 16, cy + (2 * size) / 16);
      ctx.lineTo(cx + (4 * size) / 16, cy - (1 * size) / 16);
      ctx.stroke();
      ctx.restore();
    }

    // Relaxed closed-eye smile (happy arcs for eyes)
    ctx.save();
    ctx.strokeStyle = P.eye;
    ctx.lineWidth = Math.max(0.8, size / 18);
    ctx.lineCap = "round";
    // Left eye arc
    ctx.beginPath();
    ctx.arc(
      (6.5 * size) / 16,
      ((3.3 + breathe) * size) / 16,
      (1.2 * size) / 16,
      0.1 * Math.PI,
      0.9 * Math.PI,
      false,
    );
    ctx.stroke();
    // Right eye arc
    ctx.beginPath();
    ctx.arc(
      (9.5 * size) / 16,
      ((3.3 + breathe) * size) / 16,
      (1.2 * size) / 16,
      0.1 * Math.PI,
      0.9 * Math.PI,
      false,
    );
    ctx.stroke();
    ctx.restore();

    // Pink blush cheeks (slightly bigger than idle)
    ctx.save();
    ctx.globalAlpha = 0.5 + breathe * 0.05;
    px(ctx, 4, 5 + breathe, P.cheek);
    px(ctx, 3, 6 + breathe, P.cheek);
    px(ctx, 10, 5 + breathe, P.cheek);
    px(ctx, 11, 6 + breathe, P.cheek);
    ctx.restore();

    // Checkmark badge near body
    ctx.save();
    ctx.globalAlpha = checkPulse;
    ctx.strokeStyle = "#34D399";
    ctx.lineWidth = Math.max(1, size / 14);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const bx = (13 * size) / 16;
    const by = ((10 + breathe) * size) / 16;
    ctx.beginPath();
    ctx.moveTo(bx - (1 * size) / 16, by);
    ctx.lineTo(bx - (0.2 * size) / 16, by + (1 * size) / 16);
    ctx.lineTo(bx + (1.5 * size) / 16, by - (1 * size) / 16);
    ctx.stroke();
    ctx.restore();
  }

  // ── Waiting: frustrated shake, prompt bubble ──
  function drawWaiting(ctx: CanvasRenderingContext2D, t: number) {
    const shakeT = (t % 2.4) / 2.4;
    const shakeX = lerp(
      [
        [0, 0],
        [0.08, 0.6],
        [0.15, -0.5],
        [0.22, 0.4],
        [0.3, -0.3],
        [0.4, 0.2],
        [0.55, 0],
        [1.0, 0],
      ] as [number, number][],
      shakeT,
    );

    const bounceY = lerp(
      [
        [0, 0],
        [0.08, 0],
        [0.1, -1.5],
        [0.14, 0],
        [0.2, -1],
        [0.26, 0],
        [0.32, -0.5],
        [0.4, 0],
        [1.0, 0],
      ] as [number, number][],
      shakeT,
    );

    const flash = lerp(
      [
        [0, 0],
        [0.05, 1],
        [0.12, 0.3],
        [0.18, 1],
        [0.25, 0.2],
        [0.32, 0.8],
        [0.4, 0],
        [1.0, 0],
      ] as [number, number][],
      shakeT,
    );

    const browFurrow = shakeT < 0.55 ? 1 : 0;

    // Shadow
    const shadowOp = 0.35 - Math.abs(bounceY) * 0.03;
    rect(ctx, 4, 14, 8, 1, `rgba(0,0,0,${shadowOp})`);

    // Glow
    if (alive && flash > 0.1) {
      ctx.save();
      ctx.globalAlpha = flash * 0.2;
      ctx.fillStyle = P.amber;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Speech bubble with "..."
    if (shakeT < 0.65) {
      const bubbleOpacity = lerp(
        [
          [0, 0],
          [0.05, 0.9],
          [0.5, 0.9],
          [0.65, 0],
          [1, 0],
        ] as [number, number][],
        shakeT,
      );
      if (bubbleOpacity > 0.05) {
        ctx.save();
        ctx.globalAlpha = bubbleOpacity;
        // Bubble body
        rect(ctx, 11, -1, 4, 4, "#FAFAFA");
        // Bubble tail
        px(ctx, 11, 2.5, "#FAFAFA");
        px(ctx, 12, 3, "#FAFAFA");
        // Dots
        ctx.fillStyle = P.amber;
        const dotX = 12.5;
        const dot1 = Math.sin(t * 5) > 0 ? 0 : -0.3;
        ctx.fillRect(
          Math.round((dotX * size) / 16),
          Math.round(((0.2 + dot1) * size) / 16),
          Math.ceil((size / 16) * 0.8),
          Math.ceil((size / 16) * 0.8),
        );
        ctx.fillRect(
          Math.round(((dotX + 1) * size) / 16),
          Math.round((0.2 * size) / 16),
          Math.ceil((size / 16) * 0.8),
          Math.ceil((size / 16) * 0.8),
        );
        ctx.fillRect(
          Math.round(((dotX + 2) * size) / 16),
          Math.round(((0.2 - dot1) * size) / 16),
          Math.ceil((size / 16) * 0.8),
          Math.ceil((size / 16) * 0.8),
        );
        ctx.restore();
      }
    }

    // Body with shake
    ctx.save();
    ctx.translate(shakeX * 0.5, 0);
    drawSprite(ctx, BODY, bounceY);

    // Furrowed brows
    if (browFurrow) {
      ctx.fillStyle = P.bodyD;
      ctx.fillRect(
        Math.round((5.2 * size) / 16),
        Math.round(((2.5 + bounceY) * size) / 16),
        Math.ceil((size / 16) * 2),
        Math.ceil((size / 16) * 0.5),
      );
      ctx.fillRect(
        Math.round((9 * size) / 16),
        Math.round(((2.5 + bounceY) * size) / 16),
        Math.ceil((size / 16) * 2),
        Math.ceil((size / 16) * 0.5),
      );
    }

    // Amber prompt
    const promptColor = flash > 0.4 ? P.amber : P.prompt;
    ctx.fillStyle = promptColor;
    const { x: p1x, y: p1y, w: p1w, h: p1h } = coord(4, 9 + bounceY, 1);
    const { x: p2x, y: p2y } = coord(5, 10 + bounceY, 1);
    ctx.fillRect(Math.round(p1x), Math.round(p1y), Math.ceil(p1w), Math.ceil(p1h));
    ctx.fillRect(Math.round(p2x), Math.round(p2y), Math.ceil(p1w), Math.ceil(p1h));
    ctx.restore();

    // Exclamation marks
    const bangOp = lerp(
      [
        [0, 0],
        [0.06, 1],
        [0.15, 0.8],
        [0.25, 0],
        [1, 0],
      ] as [number, number][],
      shakeT,
    );
    if (bangOp > 0.05) {
      ctx.save();
      ctx.globalAlpha = bangOp;
      ctx.fillStyle = P.amber;
      ctx.fillRect(
        Math.round((14 * size) / 16),
        Math.round((1.5 * size) / 16),
        Math.ceil((size / 16) * 0.7),
        Math.ceil((size / 16) * 2),
      );
      ctx.fillRect(
        Math.round((15 * size) / 16),
        Math.round((0.8 * size) / 16),
        Math.ceil((size / 16) * 0.7),
        Math.ceil((size / 16) * 1.5),
      );
      ctx.restore();
    }
  }
</script>

<canvas bind:this={canvas} class="inline-block" style="width: {size}px; height: {size}px;"></canvas>
