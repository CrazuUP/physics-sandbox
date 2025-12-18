(() => {
    const G = 9.80665; // м/с^2
    const MAX_ENERGY_POINTS = 1200; // храним данные
    const ENERGY_SAMPLE_DT = 1 / 60; // частота обновления графика энергии
    const SIM_TARGET_DT = 1 / 240; // шаг физики
    const TWO_PI = Math.PI * 2;

    const canvasPend = document.getElementById('damped-pendulum-canvas');
    const canvasPhase = document.getElementById('pendulum-phase-canvas');
    const canvasEnergy = document.getElementById('pendulum-energy-canvas');

    if (!canvasPend || !canvasPhase || !canvasEnergy) {
        console.error('Не найдены все canvas.');
    }

    const ctxPend = canvasPend.getContext('2d');
    const ctxPhase = canvasPhase.getContext('2d');
    const ctxEnergy = canvasEnergy.getContext('2d');

    // Inputs
    const lengthInput = document.getElementById('pendulum-length');
    const lengthOut = document.getElementById('pendulum-length-value');
    const massInput = document.getElementById('pendulum-mass');
    const massOut = document.getElementById('pendulum-mass-value');
    const angleInput = document.getElementById('pendulum-angle');
    const angleOut = document.getElementById('pendulum-angle-value');
    const angVelInput = document.getElementById('pendulum-angular-velocity');
    const angVelOut = document.getElementById('pendulum-angular-velocity-value');
    const dampingInput = document.getElementById('pendulum-damping');
    const dampingOut = document.getElementById('pendulum-damping-value');
    const criticalCheckbox = document.getElementById('pendulum-auto-critical');
    const criticalOut = document.getElementById('pendulum-critical-factor');
    const driveAmpInput = document.getElementById('pendulum-drive-amplitude');
    const driveAmpOut = document.getElementById('pendulum-drive-amplitude-value');
    const driveFreqInput = document.getElementById('pendulum-drive-frequency');
    const driveFreqOut = document.getElementById('pendulum-drive-frequency-value');
    const showPhaseCheckbox = document.getElementById('pendulum-show-phase');
    const showEnergyCheckbox = document.getElementById('pendulum-show-energy');

    // Buttons
    const startBtn = document.getElementById('pendulum-start');
    const resetBtn = document.getElementById('pendulum-reset');
    const downloadBtn = document.getElementById('pendulum-download');

    // Defaults
    const DEFAULTS = {
        L: 1.0,
        m: 1.0,
        angle: 20,
        omega: 0.0,
        beta: 0.15,
        driveAmp: 0.0,
        driveFreq: 1.2
    };

    const state = {
        running: false,
        L: DEFAULTS.L,
        m: DEFAULTS.m,
        theta: DEFAULTS.angle * Math.PI / 180,
        omega: DEFAULTS.omega,
        beta: DEFAULTS.beta,
        driveAmp: DEFAULTS.driveAmp,
        driveFreq: DEFAULTS.driveFreq,
        t: 0.0,
        energyHistory: [],
        phasePoints: [],
        lastEnergySampleAcc: 0
    };

    // ---------- Init UI ----------
    function uiInit() {
        const pairs = [
            [lengthInput, lengthOut, parseFloat],
            [massInput, massOut, parseFloat],
            [angleInput, angleOut, parseFloat],
            [angVelInput, angVelOut, parseFloat],
            [dampingInput, dampingOut, parseFloat],
            [driveAmpInput, driveAmpOut, parseFloat],
            [driveFreqInput, driveFreqOut, parseFloat]
        ];

        pairs.forEach(([inp, out, parseFn]) => {
            const upd = () => {
                let v = inp.value;
                if (parseFn) v = parseFn(v);
                if (typeof v === 'number') {
                    if (Math.abs(v) >= 10) out.value = v.toFixed(1);
                    else out.value = (Math.round(v * 100) / 100).toString();
                } else out.value = v;
            };
            inp.addEventListener('input', upd);
            upd();
        });

        startBtn.addEventListener('click', () => {
            if (!state.running) {
                readUItoState();
                state.running = true;
                startBtn.textContent = 'Пауза';
                requestAnimationFrame(loop);
            } else {
                state.running = false;
                startBtn.textContent = 'Запуск симуляции';
            }
        });

        resetBtn.addEventListener('click', () => {
            state.running = false;
            startBtn.textContent = 'Запуск симуляции';

            lengthInput.value = DEFAULTS.L;
            massInput.value = DEFAULTS.m;
            angleInput.value = DEFAULTS.angle;
            angVelInput.value = DEFAULTS.omega;
            dampingInput.value = DEFAULTS.beta;
            driveAmpInput.value = DEFAULTS.driveAmp;
            driveFreqInput.value = DEFAULTS.driveFreq;
            criticalCheckbox.checked = false;

            [
                [lengthInput, lengthOut], [massInput, massOut],
                [angleInput, angleOut], [angVelInput, angVelOut],
                [dampingInput, dampingOut], [driveAmpInput, driveAmpOut],
                [driveFreqInput, driveFreqOut]
            ].forEach(([inp, out]) => {
                out.value = inp.value;
            });

            readUItoState(true);
            initStateFromUI();
            renderAll();
        });

        if (downloadBtn) {
            downloadBtn.addEventListener('click', downloadCSV);
        }

        criticalCheckbox.addEventListener('change', () => {
            readUItoState();
            if (criticalCheckbox.checked) {
                const betaCrit = computeBetaCritical(state.L);
                state.beta = betaCrit;
                dampingInput.value = betaCrit;
                dampingOut.value = (Math.round(betaCrit * 100) / 100).toString();
            }
            updateCriticalBadge();
        });

        [lengthInput, massInput, angleInput, angVelInput, dampingInput, driveAmpInput, driveFreqInput].forEach(inp => {
            inp.addEventListener('input', () => {
                readUItoState();
                updateCriticalBadge();
                if (!state.running) renderAll();
            });
        });

        showPhaseCheckbox.addEventListener('change', renderAll);
        showEnergyCheckbox.addEventListener('change', renderAll);

        window.addEventListener('resize', onResize);
        onResize();
    }

    function downloadCSV() {
        if (!state.energyHistory || state.energyHistory.length === 0) {
            alert("Нет данных для скачивания. Запустите симуляцию.");
            return;
        }
        let csvContent = "Time (s),Angle (rad),Omega (rad/s),Kinetic Energy (J),Potential Energy (J),Total Energy (J)\n";
        state.energyHistory.forEach(pt => {
            const row = [
                pt.t.toFixed(4),
                pt.theta.toFixed(4),
                pt.omega.toFixed(4),
                pt.Ekin.toFixed(5),
                pt.Epot.toFixed(5),
                pt.Etotal.toFixed(5)
            ];
            csvContent += row.join(",") + "\n";
        });
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "pendulum_data.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function readUItoState(resetGraphs = false) {
        state.L = parseFloat(lengthInput.value);
        state.m = parseFloat(massInput.value);
        if (resetGraphs) {
            state.theta = parseFloat(angleInput.value) * Math.PI / 180;
            state.omega = parseFloat(angVelInput.value);
        }
        state.beta = parseFloat(dampingInput.value);
        state.driveAmp = parseFloat(driveAmpInput.value);
        state.driveFreq = parseFloat(driveFreqInput.value);

        if (resetGraphs) {
            state.energyHistory = [];
            state.phasePoints = [];
            state.t = 0;
            state.lastEnergySampleAcc = 0;
        }
        updateCriticalBadge();
    }

    function computeOmega0(L) { return Math.sqrt(G / L); }
    function computeBetaCritical(L) { return computeOmega0(L); }
    function updateCriticalBadge() {
        const betaCrit = computeBetaCritical(state.L);
        criticalOut.textContent = betaCrit.toFixed(3);
    }

    function onResize() {
        fitCanvasToDisplaySize(canvasPend);
        fitCanvasToDisplaySize(canvasPhase);
        fitCanvasToDisplaySize(canvasEnergy);
        renderAll();
    }

    function fitCanvasToDisplaySize(canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const h = Math.floor(rect.height);
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ---------- Physics ----------
    function accel(theta, omega, t, params) {
        const { L, m, beta, driveAmp, driveFreq } = params;
        const omega0sqTerm = (G / L) * Math.sin(theta);
        const dampingTerm = 2 * beta * omega;
        const driveMoment = driveAmp * Math.sin(TWO_PI * driveFreq * t);
        const driveAcc = (driveMoment) / (m * L * L);
        return -omega0sqTerm - dampingTerm + driveAcc;
    }

    function rk4Step(theta, omega, t, dt, params) {
        const a1 = accel(theta, omega, t, params);
        const k1θ = omega, k1ω = a1;
        const a2 = accel(theta + 0.5 * dt * k1θ, omega + 0.5 * dt * k1ω, t + 0.5 * dt, params);
        const k2θ = omega + 0.5 * dt * k1ω, k2ω = a2;
        const a3 = accel(theta + 0.5 * dt * k2θ, omega + 0.5 * dt * k2ω, t + 0.5 * dt, params);
        const k3θ = omega + 0.5 * dt * k2ω, k3ω = a3;
        const a4 = accel(theta + dt * k3θ, omega + dt * k3ω, t + dt, params);
        const k4θ = omega + dt * k3ω, k4ω = a4;
        return {
            theta: theta + (dt / 6) * (k1θ + 2 * k2θ + 2 * k3θ + k4θ),
            omega: omega + (dt / 6) * (k1ω + 2 * k2ω + 2 * k3ω + k4ω)
        };
    }

    function computeEnergies(theta, omega, params) {
        const { m, L } = params;
        const v = L * omega;
        const Ekin = 0.5 * m * v * v;
        const Epot = m * G * L * (1 - Math.cos(theta));
        return { Ekin, Epot, Etotal: Ekin + Epot };
    }

    let lastFrameTs = null;
    function loop(ts) {
        if (!state.running) {
            lastFrameTs = null;
            return;
        }
        if (!lastFrameTs) lastFrameTs = ts;
        const realDt = Math.min(0.05, (ts - lastFrameTs) / 1000);
        lastFrameTs = ts;

        let acc = realDt;
        while (acc > 0) {
            const dt = Math.min(acc, SIM_TARGET_DT);
            stepPhysics(dt);
            acc -= dt;
        }
        renderAll();
        requestAnimationFrame(loop);
    }

    function stepPhysics(dt) {
        const params = { L: state.L, m: state.m, beta: state.beta, driveAmp: state.driveAmp, driveFreq: state.driveFreq };
        const next = rk4Step(state.theta, state.omega, state.t, dt, params);
        state.theta = normalizeAngle(next.theta);
        state.omega = next.omega;
        state.t += dt;

        state.phasePoints.push([state.theta, state.omega]);
        if (state.phasePoints.length > 2000) state.phasePoints.shift();

        state.lastEnergySampleAcc += dt;
        if (state.lastEnergySampleAcc >= ENERGY_SAMPLE_DT) {
            const en = computeEnergies(state.theta, state.omega, state);
            state.energyHistory.push({
                t: state.t, theta: state.theta, omega: state.omega,
                Etotal: en.Etotal, Ekin: en.Ekin, Epot: en.Epot
            });
            if (state.energyHistory.length > MAX_ENERGY_POINTS) state.energyHistory.shift();
            state.lastEnergySampleAcc = 0;
        }
    }

    function normalizeAngle(a) {
        return ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
    }

    // ---------- Rendering ----------
    function renderPendulum(ctx, state) {
        const W = ctx.canvas.width / (window.devicePixelRatio || 1);
        const H = ctx.canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, W, H);

        const cx = W / 2;
        const cy = H / 6 * 1.2;
        const Lpix = Math.min(W, H) * 0.35;
        const bobRadius = Math.max(8, Math.min(28, state.m * 6));

        const x = cx + Lpix * Math.sin(state.theta);
        const y = cy + Lpix * Math.cos(state.theta);

        // Ghost
        ctx.beginPath();
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        ctx.ellipse(x + 5, y + 10, bobRadius + 2, (bobRadius + 2) * 0.6, 0, 0, TWO_PI);
        ctx.fill();

        // Rod
        ctx.beginPath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#333';
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.stroke();

        // Support
        ctx.fillStyle = '#222';
        ctx.fillRect(cx - 15, cy - 5, 30, 5);

        // Bob
        ctx.beginPath();
        ctx.fillStyle = '#1f77b4';
        ctx.arc(x, y, bobRadius, 0, TWO_PI);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();

        ctx.font = '14px sans-serif';
        ctx.fillStyle = '#111';
        const deg = (state.theta * 180 / Math.PI).toFixed(1);
        ctx.fillText(`θ = ${deg}°`, 20, H - 30);
    }

    function renderPhase(ctx, state) {
        const W = ctx.canvas.width / (window.devicePixelRatio || 1);
        const H = ctx.canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, W, H);

        ctx.fillStyle = '#fff';
        ctx.fillRect(0,0,W,H);

        const thetaRange = Math.PI;
        let wmax = 2.0;
        state.phasePoints.forEach(p => wmax = Math.max(wmax, Math.abs(p[1])));
        wmax = Math.max(1.0, wmax * 1.1);

        function toScreen(th, w) {
            return [
                (th + thetaRange) / (2 * thetaRange) * W,
                H - ((w + wmax) / (2 * wmax) * H)
            ];
        }

        const [x0, y0] = toScreen(0, 0);

        // Axes
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y0); ctx.lineTo(W, y0);
        ctx.moveTo(x0, 0); ctx.lineTo(x0, H);
        ctx.stroke();

        // Ticks and Numbers
        ctx.fillStyle = '#666';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';

        // X Ticks (Theta) -3 to 3
        for(let i = -3; i <= 3; i++) {
            if (i === 0) continue; // skip 0 center
            const [tx, ] = toScreen(i, 0);
            ctx.beginPath(); ctx.moveTo(tx, y0 - 3); ctx.lineTo(tx, y0 + 3); ctx.stroke();
            ctx.fillText(i.toString(), tx, y0 + 14);
        }

        // Y Ticks (Omega)
        ctx.textAlign = 'right';
        const yStep = wmax / 2; // draw around 3 ticks top/bottom
        for(let val = -Math.floor(wmax); val <= Math.floor(wmax); val += 1) {
            if (val === 0) continue;
            // Avoid clutter if step is too small
            if (Math.abs(val) > wmax) continue;

            const [, ty] = toScreen(0, val);
            ctx.beginPath(); ctx.moveTo(x0 - 3, ty); ctx.lineTo(x0 + 3, ty); ctx.stroke();
            ctx.fillText(val.toFixed(1), x0 - 5, ty + 3);
        }

        // Zero
        ctx.textAlign = 'right';
        ctx.fillText('0', x0 - 4, y0 + 12);

        // Labels
        ctx.fillStyle = '#333';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('θ (рад)', W - 6, y0 - 6);
        ctx.textAlign = 'left';
        ctx.fillText('ω (рад/с)', x0 + 6, 14);

        if (state.phasePoints.length < 2) return;

        ctx.beginPath();
        ctx.strokeStyle = '#2c7fb8';
        ctx.lineWidth = 1.5;
        state.phasePoints.forEach((p, i) => {
            const [mx, my] = toScreen(p[0], p[1]);
            if (i===0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
        });
        ctx.stroke();
    }

    function renderEnergy(ctx, state) {
        const W = ctx.canvas.width / (window.devicePixelRatio || 1);
        const H = ctx.canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#fff'; ctx.fillRect(0,0,W,H);

        const pad = 35; // slightly more padding for Y labels

        ctx.strokeStyle = '#ddd';
        ctx.beginPath();
        ctx.moveTo(pad, pad); ctx.lineTo(pad, H - pad); ctx.lineTo(W - pad, H - pad);
        ctx.stroke();

        ctx.fillStyle = '#333';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('t (с)', W - pad, H - pad + 28);
        ctx.textAlign = 'left';
        ctx.fillText('E (Дж)', pad - 10, pad - 8);

        if (state.energyHistory.length < 2) {
            ctx.fillStyle = '#999';
            ctx.fillText('Ожидание данных...', pad + 10, H/2);
            return;
        }

        const points = state.energyHistory;
        const t0 = points[0].t;
        const t1 = points[points.length - 1].t;
        const dt = Math.max(0.001, t1 - t0);

        let maxE = 0;
        points.forEach(p => maxE = Math.max(maxE, p.Etotal));
        maxE = Math.max(maxE, 0.01);

        function sx(t) { return pad + ((t - t0) / dt) * (W - 2*pad); }
        function sy(E) { return H - pad - (E / maxE) * (H - 2*pad); }

        // --- Ticks & Numbers ---
        ctx.fillStyle = '#666';
        ctx.font = '10px sans-serif';

        // Y Axis (Energy) - 5 steps
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const val = (maxE * i) / 4;
            const y = sy(val);
            // Grid line (optional, kept light)
            ctx.strokeStyle = '#f0f0f0';
            ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
            // Tick
            ctx.strokeStyle = '#ccc';
            ctx.beginPath(); ctx.moveTo(pad - 3, y); ctx.lineTo(pad, y); ctx.stroke();
            // Text
            ctx.fillText(val.toFixed(2), pad - 5, y + 3);
        }

        // X Axis (Time) - 5 steps
        ctx.textAlign = 'center';
        for (let i = 0; i <= 4; i++) {
            const tVal = t0 + (dt * i) / 4;
            const x = sx(tVal);
            // Tick
            ctx.strokeStyle = '#ccc';
            ctx.beginPath(); ctx.moveTo(x, H - pad); ctx.lineTo(x, H - pad + 3); ctx.stroke();
            // Text
            ctx.fillText(tVal.toFixed(1), x, H - pad + 14);
        }
        // -----------------------

        function drawLine(prop, color, dash=[]) {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.setLineDash(dash);
            points.forEach((p, i) => {
                const x = sx(p.t);
                const y = sy(p[prop]);
                if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
            });
            ctx.stroke();
            ctx.setLineDash([]);
        }

        drawLine('Etotal', '#1f77b4');
        drawLine('Ekin', '#2ca02c');
        drawLine('Epot', '#ff7f0e', [3,3]);

        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#1f77b4'; ctx.fillText('Полная', W-50, pad + 0);
        ctx.fillStyle = '#2ca02c'; ctx.fillText('Кин.', W-50, pad + 12);
        ctx.fillStyle = '#ff7f0e'; ctx.fillText('Пот.', W-50, pad + 24);
    }

    function renderAll() {
        renderPendulum(ctxPend, state);
        if (showPhaseCheckbox.checked) renderPhase(ctxPhase, state);
        else ctxPhase.clearRect(0, 0, ctxPhase.canvas.width, ctxPhase.canvas.height);

        if (showEnergyCheckbox.checked) renderEnergy(ctxEnergy, state);
        else ctxEnergy.clearRect(0, 0, ctxEnergy.canvas.width, ctxEnergy.canvas.height);
    }

    function initStateFromUI() {
        readUItoState(true);
        const en = computeEnergies(state.theta, state.omega, state);
        state.energyHistory = [{
            t: state.t, theta: state.theta, omega: state.omega,
            Etotal: en.Etotal, Ekin: en.Ekin, Epot: en.Epot
        }];
        state.phasePoints = [[state.theta, state.omega]];
        updateCriticalBadge();
    }

    uiInit();
    initStateFromUI();
    renderAll();
})();
