/* js/atwood-simulation.js
   Симуляция машины Атвуда с наклонами, трением и инерцией блока.
   Улучшения: правильные направления сил, ротация блока, метки, график v(t) и a(t).
   Физика: точная с распределением трения, Euler.
*/

(() => {
    // Константы
    const G = 9.81;
    const PULLEY_RADIUS = 0.05; // м (для theta = s / r)
    const PULLEY_PX = 30; // px
    const CARGO_PX = 20; // px размер груза (квадрат)
    const PLANE_LEN_PX = 300; // px
    const FIXED_DT = 1 / 240;
    const SAMPLE_DT = 0.1;
    const MAX_HISTORY = 800;
    const ARROW_SCALE = 0.08; // px / Н (уменьшил для красоты)
    const TWO_PI = Math.PI * 2;
    const EPS = 1e-4;

    // DOM
    const canvas = document.getElementById('atwood-canvas');
    const ctx = canvas.getContext('2d', { alpha: false });

    const graphCanvas = document.createElement('canvas');
    graphCanvas.id = 'atwood-graph-canvas';
    graphCanvas.className = 'simulation-canvas';
    graphCanvas.style.marginTop = '16px';
    canvas.after(graphCanvas);
    const gctx = graphCanvas.getContext('2d');

    const aOut = document.getElementById('atwood-a-value');
    const tnsOut = document.getElementById('atwood-tension-value');
    const vOut = document.getElementById('atwood-v-value');
    const timeOut = document.getElementById('atwood-t-value');

    const m1In = document.getElementById('atwood-m1');
    const ang1In = document.getElementById('atwood-angle1');
    const m2In = document.getElementById('atwood-m2');
    const ang2In = document.getElementById('atwood-angle2');
    const mpIn = document.getElementById('atwood-pulley-mass');
    const mukIn = document.getElementById('atwood-friction_k');
    const musIn = document.getElementById('atwood-friction_s');

    const showForcesChk = document.getElementById('show-forces-diagram');
    const inertiaChk = document.getElementById('enable-pulley-inertia');

    const startBtn = document.getElementById('start-simulation');
    const resetBtn = document.getElementById('reset-simulation');

    // Состояние
    const state = {
        running: false,
        m1: 3.0, alpha1: 0,
        m2: 1.0, alpha2: 90,
        mp: 0.1, muk: 0.15, mus: 0.3,
        showForces: true, inertia: false,
        t: 0, v: 0, s: 0, theta: 0,
        a: 0, T: 0, f1: 0, f2: 0,
        history: [],
        accum: 0, sampleAccum: 0
    };

    // UI
    function uiInit() {
        [m1In, ang1In, m2In, ang2In, mpIn, mukIn, musIn].forEach(inp => {
            inp.addEventListener('input', () => {
                readUI();
                if (!state.running) computePhysics(true);
                renderAll();
            });
        });

        showForcesChk.addEventListener('change', () => {
            state.showForces = showForcesChk.checked;
            renderAll();
        });
        inertiaChk.addEventListener('change', () => {
            state.inertia = inertiaChk.checked;
            computePhysics(state.v === 0);
            renderAll();
        });

        startBtn.addEventListener('click', () => {
            state.running = !state.running;
            startBtn.textContent = state.running ? 'Пауза' : 'Запуск симуляции';
            if (state.running) requestAnimationFrame(loop);
        });

        resetBtn.addEventListener('click', reset);

        window.addEventListener('resize', resize);
        resize();
    }

    function readUI() {
        state.m1 = parseFloat(m1In.value);
        state.alpha1 = parseFloat(ang1In.value);
        state.m2 = parseFloat(m2In.value);
        state.alpha2 = parseFloat(ang2In.value);
        state.mp = parseFloat(mpIn.value);
        state.muk = parseFloat(mukIn.value);
        state.mus = parseFloat(musIn.value);
    }

    function reset() {
        state.running = false;
        startBtn.textContent = 'Запуск симуляции';
        readUI();
        state.t = 0;
        state.v = 0;
        state.s = 0;
        state.theta = 0;
        state.history = [{ t: 0, v: 0, a: 0 }];
        state.accum = 0;
        state.sampleAccum = 0;
        computePhysics(true);
        renderAll();
    }

    // Resize
    function resize() {
        fitCanvas(canvas);
        fitCanvas(graphCanvas, 300);
        renderAll();
    }

    function fitCanvas(c, defH = 400) {
        const dpr = window.devicePixelRatio || 1;
        const rect = c.getBoundingClientRect();
        c.width = rect.width * dpr;
        c.height = (rect.height || defH) * dpr;
        c.style.width = rect.width + 'px';
        c.style.height = (rect.height || defH) + 'px';
        c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Физика
    function computePhysics(staticMode) {
        const rad1 = state.alpha1 * Math.PI / 180;
        const rad2 = state.alpha2 * Math.PI / 180;
        const sin1 = Math.sin(rad1), cos1 = Math.cos(rad1);
        const sin2 = Math.sin(rad2), cos2 = Math.cos(rad2);

        const F_drive = (state.m1 * sin1 - state.m2 * sin2) * G;
        const N1 = state.m1 * G * cos1;
        const N2 = state.m2 * G * cos2;
        const n_sum = N1 + N2;
        const frac1 = N1 / n_sum || 0;
        const frac2 = N2 / n_sum || 0;
        const f_stat_max = state.mus * n_sum;
        const eff_m = state.m1 + state.m2 + (state.inertia ? state.mp / 2 : 0);

        let sign_dir = Math.sign(F_drive);
        state.f1 = 0;
        state.f2 = 0;
        state.a = 0;
        state.T = 0;

        if (Math.abs(state.v) < EPS) {
            if (Math.abs(F_drive) <= f_stat_max) {
                // Static
                state.f1 = F_drive * frac1;
                state.f2 = F_drive * frac2;
                state.T = state.m1 * G * sin1 - state.f1;
                return;
            }
        }

        // Moving or starting to move
        const f_kin = state.muk * n_sum;
        state.a = (F_drive - sign_dir * f_kin) / eff_m;
        state.f1 = sign_dir * state.muk * N1;
        state.f2 = sign_dir * state.muk * N2;
        state.T = state.m1 * G * sin1 - state.f1 - state.m1 * state.a;
        if (state.T < 0) state.T = 0;
    }

    // Цикл
    let lastTs = null;
    function loop(ts) {
        if (!state.running) {
            lastTs = null;
            return;
        }

        if (!lastTs) lastTs = ts;
        const realDt = Math.min(0.05, (ts - lastTs) / 1000);
        lastTs = ts;

        state.accum += realDt;
        while (state.accum >= FIXED_DT) {
            computePhysics(false);
            state.v += state.a * FIXED_DT;
            state.s += state.v * FIXED_DT;
            state.theta += (state.v * FIXED_DT) / PULLEY_RADIUS;
            if (Math.abs(state.v) < EPS && state.a === 0) state.v = 0;
            if (state.s < 0) state.s = 0;
            state.accum -= FIXED_DT;

            state.sampleAccum += FIXED_DT;
            if (state.sampleAccum >= SAMPLE_DT) {
                state.history.push({ t: state.t, v: state.v, a: state.a });
                if (state.history.length > MAX_HISTORY) state.history.shift();
                state.sampleAccum = 0;
            }

            state.t += FIXED_DT;
        }

        renderAll();
        requestAnimationFrame(loop);
    }

    // Рендер анимации
    function renderAnim() {
        const W = canvas.width / window.devicePixelRatio;
        const H = canvas.height / window.devicePixelRatio;
        ctx.clearRect(0, 0, W, H);

        ctx.fillStyle = '#f8fbff';
        ctx.fillRect(0, 0, W, H);

        const cx = W / 2;
        const cy = 100;
        const rad1 = state.alpha1 * Math.PI / 180;
        const rad2 = state.alpha2 * Math.PI / 180;
        const sin1 = Math.sin(rad1), cos1 = Math.cos(rad1);
        const sin2 = Math.sin(rad2), cos2 = Math.cos(rad2);

        // Левый скат
        const leftSx = cx - 20;
        const leftSy = cy + 10;
        const leftEx = leftSx - PLANE_LEN_PX * cos1;
        const leftEy = leftSy + PLANE_LEN_PX * sin1;
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#333';
        ctx.beginPath();
        ctx.moveTo(leftSx, leftSy);
        ctx.lineTo(leftEx, leftEy);
        ctx.stroke();

        // Правый скат
        const rightSx = cx + 20;
        const rightSy = cy + 10;
        const rightEx = rightSx + PLANE_LEN_PX * cos2;
        const rightEy = rightSy + PLANE_LEN_PX * sin2;
        ctx.beginPath();
        ctx.moveTo(rightSx, rightSy);
        ctx.lineTo(rightEx, rightEy);
        ctx.stroke();

        // Блок (pulley) с ротацией
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(state.theta);
        ctx.fillStyle = '#aaa';
        ctx.beginPath();
        ctx.arc(0, 0, PULLEY_PX, 0, TWO_PI);
        ctx.fill();
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Шпицы для красоты
        ctx.strokeStyle = '#555';
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(PULLEY_PX * Math.cos(i * Math.PI / 2), PULLEY_PX * Math.sin(i * Math.PI / 2));
            ctx.stroke();
        }
        ctx.restore();

        // Положения грузов
        let s_px = state.s / 1 * (PLANE_LEN_PX / PLANE_LEN_PX); // s in m, but since scale arbitrary, assume 1 m = PLANE_LEN_PX px
        if (state.s < 0) state.s = 0;
        if (state.s > PLANE_LEN_PX - CARGO_PX) {
            state.running = false;
            startBtn.textContent = 'Запуск симуляции';
        }

        const leftCx = leftSx - s_px * cos1;
        const leftCy = leftSy + s_px * sin1;

        const rightCx = rightSx - s_px * cos2;
        const rightCy = rightSy - s_px * sin2;

        // Нить
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(leftCx, leftCy);
        ctx.lineTo(leftSx, leftSy);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, PULLEY_PX, Math.PI - 0.1, 0.1, true);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(rightSx, rightSy);
        ctx.lineTo(rightCx, rightCy);
        ctx.stroke();

        // Грузы (квадраты)
        ctx.fillStyle = '#007bff';
        ctx.fillRect(leftCx - CARGO_PX / 2, leftCy - CARGO_PX / 2, CARGO_PX, CARGO_PX);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(state.m1.toFixed(1) + ' кг', leftCx, leftCy + 4);

        ctx.fillStyle = '#ff7f0e';
        ctx.fillRect(rightCx - CARGO_PX / 2, rightCy - CARGO_PX / 2, CARGO_PX, CARGO_PX);
        ctx.fillStyle = '#fff';
        ctx.fillText(state.m2.toFixed(1) + ' кг', rightCx, rightCy + 4);

        // Силы
        if (state.showForces) {
            drawForces(leftCx, leftCy, state.m1, rad1, state.f1, N1, '#007bff', false);
            drawForces(rightCx, rightCy, state.m2, rad2, state.f2, N2, '#ff7f0e', true);
        }

        // Outputs
        aOut.textContent = state.a.toFixed(2);
        tnsOut.textContent = state.T.toFixed(2);
        vOut.textContent = state.v.toFixed(2);
        timeOut.textContent = state.t.toFixed(2);
    }

    function drawForces(cx, cy, m, rad, f, N, color, isRight) {
        const sin = Math.sin(rad), cos = Math.cos(rad);
        const mg = m * G;

        // Gravity
        drawArrow(ctx, cx, cy, 0, mg * ARROW_SCALE, '#ff0000', 'mg');

        if (cos > EPS) {
            // Normal
            const norm_x = (isRight ? -sin : sin);
            const norm_y = -cos;
            drawArrow(ctx, cx, cy, norm_x * N * ARROW_SCALE, norm_y * N * ARROW_SCALE, '#00ff00', 'N');

            // Friction
            const up_x = isRight ? -cos : cos;
            const up_y = -sin;
            drawArrow(ctx, cx, cy, up_x * f * ARROW_SCALE, up_y * f * ARROW_SCALE, '#ffa500', 'f');
        }

        // Tension
        const t_up_x = isRight ? -cos : cos;
        const t_up_y = -sin;
        drawArrow(ctx, cx, cy, t_up_x * state.T * ARROW_SCALE, t_up_y * state.T * ARROW_SCALE, '#0000ff', 'T');
    }

    // Рендер графика
    function renderGraph() {
        const W = graphCanvas.width / window.devicePixelRatio;
        const H = graphCanvas.height / window.devicePixelRatio;
        gctx.clearRect(0, 0, W, H);
        gctx.fillStyle = '#fff';
        gctx.fillRect(0, 0, W, H);

        if (state.history.length < 2) {
            gctx.fillStyle = '#666';
            gctx.font = '14px sans-serif';
            gctx.textAlign = 'center';
            gctx.fillText('Запустите симуляцию для графиков v(t) и a(t)', W / 2, H / 2);
            return;
        }

        const pad = 40;
        gctx.strokeStyle = '#ccc';
        gctx.beginPath();
        gctx.moveTo(pad, pad);
        gctx.lineTo(pad, H - pad);
        gctx.lineTo(W - pad, H - pad);
        gctx.stroke();

        const pts = state.history;
        const t0 = pts[0].t;
        const t1 = pts[pts.length - 1].t;
        const dt = t1 - t0 || 1;

        let vmin = 0, vmax = 0, amin = 0, amax = 0;
        pts.forEach(p => {
            vmin = Math.min(vmin, p.v); vmax = Math.max(vmax, p.v);
            amin = Math.min(amin, p.a); amax = Math.max(amax, p.a);
        });
        const vr = Math.max(0.01, vmax - vmin) * 1.2;
        const ar = Math.max(0.01, amax - amin) * 1.2;

        const sx = t => pad + (t - t0) / dt * (W - 2 * pad);
        const syV = v => H - pad - (v - vmin) / vr * (H - 2 * pad);
        const syA = a => H - pad - (a - amin) / ar * (H - 2 * pad);

        // v(t)
        gctx.beginPath();
        gctx.strokeStyle = '#1f77b4';
        gctx.lineWidth = 2;
        pts.forEach((p, i) => i === 0 ? gctx.moveTo(sx(p.t), syV(p.v)) : gctx.lineTo(sx(p.t), syV(p.v)));
        gctx.stroke();

        // a(t)
        gctx.beginPath();
        gctx.strokeStyle = '#ff7f0e';
        gctx.setLineDash([4, 4]);
        pts.forEach((p, i) => i === 0 ? gctx.moveTo(sx(p.t), syA(p.a)) : gctx.lineTo(sx(p.t), syA(p.a)));
        gctx.stroke();
        gctx.setLineDash([]);

        // Легенда
        gctx.font = '12px sans-serif';
        gctx.fillStyle = '#111';
        gctx.fillText('v (m/s)', W - pad - 70, pad + 12);
        gctx.fillStyle = '#1f77b4';
        gctx.fillRect(W - pad - 92, pad + 4, 10, 8);
        gctx.fillStyle = '#111';
        gctx.fillText('a (m/s²)', W - pad - 70, pad + 28);
        gctx.fillStyle = '#ff7f0e';
        gctx.fillRect(W - pad - 92, pad + 20, 10, 8);
    }

    // Рендер все
    function renderAll() {
        renderAnim();
        renderGraph();
    }

    uiInit();
    reset();
    renderAll();
})();