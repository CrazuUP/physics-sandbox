(() => {
    const G = 9.80665; // м/с^2
    const MAX_ENERGY_POINTS = 1200; // сколько точек хранить для графика энергии
    const ENERGY_SAMPLE_DT = 1 / 60; // сэмплирование энергии (сек)
    const SIM_TARGET_DT = 1 / 240; // шаг симуляции (s)
    const TWO_PI = Math.PI * 2;

    const canvasPend = document.getElementById('damped-pendulum-canvas'); // уже есть в HTML
    const canvasPhase = document.getElementById('pendulum-phase-canvas');  // доп. добавить
    const canvasEnergy = document.getElementById('pendulum-energy-canvas'); // доп. добавить

    if (!canvasPend || !canvasPhase || !canvasEnergy) {
        console.error('Не найдены все canvas. Убедитесь, что добавили canvas с id: damped-pendulum-canvas, pendulum-phase-canvas, pendulum-energy-canvas');
    }

    const ctxPend = canvasPend.getContext('2d');
    const ctxPhase = canvasPhase.getContext('2d');
    const ctxEnergy = canvasEnergy.getContext('2d');

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

    const startBtn = document.getElementById('pendulum-start');
    const resetBtn = document.getElementById('pendulum-reset');

    const state = {
        running: false,
        L: 1.0,      // длина, м
        m: 1.0,      // масса, кг
        theta: 20 * Math.PI / 180, // угол, рад
        omega: 0.0,  // угловая скорость, рад/с
        beta: 0.15,  // параметр демпфирования β (в уравнении θ'' + 2βθ' + ω0^2 sinθ = drive)
        driveAmp: 0.0, // амплитуда внешней силы (Н). Мы применим момент M = A * sin(2π f t)
        driveFreq: 1.2, // Гц
        t: 0.0,       // текущее время (s)
        energyHistory: [], // массив {t, E_total, E_kin, E_pot}
        phasePoints: [], // хранит точки для фазового портрета
        lastEnergySampleAcc: 0
    };

    // ---------- Инициализация UI (вывод значений) ----------
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
                // округлим красиво для отображения
                if (typeof v === 'number') {
                    if (Math.abs(v) >= 10) out.value = v.toFixed(1);
                    else out.value = (Math.round(v * 100) / 100).toString();
                } else out.value = v;
            };
            inp.addEventListener('input', upd);
            upd();
        });

        // кнопки
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
            readUItoState(true); // true -> сброс графиков
            renderAll();
        });

        // checkbox auto-critical: если выбран — ставим beta = beta_cr
        criticalCheckbox.addEventListener('change', () => {
            readUItoState();
            if (criticalCheckbox.checked) {
                const betaCrit = computeBetaCritical(state.L);
                state.beta = betaCrit;
                dampingInput.value = betaCrit;
                updateSingle(dampingInput, dampingOut);
            }
            updateCriticalBadge();
        });

        // live update параметров при движении слайдеров
        [lengthInput, massInput, angleInput, angVelInput, dampingInput, driveAmpInput, driveFreqInput].forEach(inp => {
            inp.addEventListener('input', () => {
                readUItoState();
                updateCriticalBadge();
                // если не запущено — перерисовать начальное состояние
                if (!state.running) renderAll();
            });
        });

        // флаги показа
        showPhaseCheckbox.addEventListener('change', renderAll);
        showEnergyCheckbox.addEventListener('change', renderAll);

        // ресайз canvas под размер контейнера при изменении окна
        window.addEventListener('resize', onResize);
        onResize(); // первичная установка
    }

    function updateSingle(inp, out) {
        let v = inp.value;
        out.value = (Math.round(v * 100) / 100).toString();
    }

    function readUItoState(resetGraphs = false) {
        state.L = parseFloat(lengthInput.value);
        state.m = parseFloat(massInput.value);
        state.theta = parseFloat(angleInput.value) * Math.PI / 180;
        state.omega = parseFloat(angVelInput.value);
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

    function computeOmega0(L) {
        return Math.sqrt(G / L);
    }
    function computeBetaCritical(L) {
        // уравнение в формате: θ'' + 2β θ' + ω0^2 θ = 0 => критика β_cr = ω0
        return computeOmega0(L);
    }
    function updateCriticalBadge() {
        const betaCrit = computeBetaCritical(state.L);
        criticalOut.textContent = betaCrit.toFixed(3);
    }

    // ---------- Resize handlers ----------
    function onResize() {
        fitCanvasToDisplaySize(canvasPend);
        fitCanvasToDisplaySize(canvasPhase);
        fitCanvasToDisplaySize(canvasEnergy);
        renderAll();
    }

    function fitCanvasToDisplaySize(canvas) {
        // приспосабливаем canvas к CSS размерам и учитываем DPR
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(200, Math.floor(rect.width));
        const h = Math.max(120, Math.floor(rect.height));
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // нормализуем координаты для рисования в CSS px
    }

    // ---------- Физика: правые части и интегратор RK4 ----------
    // Уравнение: θ'' = - (g/L) * sinθ - 2β * ω + (Moment_drive) / (m * L^2)
    // где внешняя сила задаётся моментом M(t) = driveAmp * sin(2π f t)
    function accel(theta, omega, t, params) {
        const { L, m, beta, driveAmp, driveFreq } = params;
        const omega0sqTerm = (G / L) * Math.sin(theta); // нелинейный
        const dampingTerm = 2 * beta * omega;
        const driveMoment = driveAmp * Math.sin(TWO_PI * driveFreq * t); // Н·м
        const driveTerm = 0;
        // driveMoment (Н·м) / (m * L^2) gives угловое ускорение
        const driveAcc = (driveMoment) / (m * L * L);
        return -omega0sqTerm - dampingTerm + driveAcc;
    }

    function rk4Step(theta, omega, t, dt, params) {
        // система: dθ/dt = ω ; dω/dt = a(θ, ω, t)
        const a1 = accel(theta, omega, t, params);
        const k1θ = omega;
        const k1ω = a1;

        const a2 = accel(theta + 0.5 * dt * k1θ, omega + 0.5 * dt * k1ω, t + 0.5 * dt, params);
        const k2θ = omega + 0.5 * dt * k1ω;
        const k2ω = a2;

        const a3 = accel(theta + 0.5 * dt * k2θ, omega + 0.5 * dt * k2ω, t + 0.5 * dt, params);
        const k3θ = omega + 0.5 * dt * k2ω;
        const k3ω = a3;

        const a4 = accel(theta + dt * k3θ, omega + dt * k3ω, t + dt, params);
        const k4θ = omega + dt * k3ω;
        const k4ω = a4;

        const thetaNext = theta + (dt / 6) * (k1θ + 2 * k2θ + 2 * k3θ + k4θ);
        const omegaNext = omega + (dt / 6) * (k1ω + 2 * k2ω + 2 * k3ω + k4ω);
        return { theta: thetaNext, omega: omegaNext };
    }

    function computeEnergies(theta, omega, params) {
        const { m, L } = params;
        const v = L * omega;
        const Ekin = 0.5 * m * v * v;
        const Epot = m * G * L * (1 - Math.cos(theta));
        const Etotal = Ekin + Epot;
        return { Ekin, Epot, Etotal };
    }

    function renderPendulum(ctx, state) {
        const W = ctx.canvas.width / (window.devicePixelRatio || 1);
        const H = ctx.canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, W, H);

        const cx = W / 2;
        const cy = H / 6 * 1.2; // опора чуть выше центра наверху
        const Lpix = Math.min(W, H) * 0.35; // длина нити в px (визуально)
        const bobRadius = Math.max(8, Math.min(28, state.m * 6));

        const x = cx + Lpix * Math.sin(state.theta);
        const y = cy + Lpix * Math.cos(state.theta);

        ctx.beginPath();
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.ellipse(x + 6, y + 6, bobRadius + 4, (bobRadius + 4) * 0.6, 0, 0, TWO_PI);
        ctx.fill();

        ctx.beginPath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#333';
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = '#222';
        ctx.fillRect(cx - 12, cy - 8, 24, 8);

        ctx.beginPath();
        ctx.fillStyle = '#1f77b4';
        ctx.arc(x, y, bobRadius, 0, TWO_PI);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();

        ctx.font = '13px sans-serif';
        ctx.fillStyle = '#111';
        const deg = (state.theta * 180 / Math.PI).toFixed(2);
        const omegaStr = state.omega.toFixed(3);
        ctx.fillText(`θ = ${deg}°`, 12, H - 40);
        ctx.fillText(`ω = ${omegaStr} rad/s`, 12, H - 24);

        const dragMag = 0.8 * Math.sign(state.omega) * Math.min(1.0, Math.abs(state.beta * state.omega) / 2);
        ctx.beginPath();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = 'rgba(200,30,30,0.9)';
        const ax = x - 18 * Math.cos(state.theta) * dragMag;
        const ay = y + 18 * Math.sin(state.theta) * dragMag;
        ctx.moveTo(x, y);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        // подпись силы
        ctx.fillStyle = '#b22222';
        ctx.fillText('', ax + 6, ay + 4);
    }

    // ---------- Фазовый портрет ----------
    function renderPhase(ctx, state) {
        const W = ctx.canvas.width / (window.devicePixelRatio || 1);
        const H = ctx.canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, W, H);

        // фон + axes
        ctx.fillStyle = '#fbfbfb';
        ctx.fillRect(0, 0, W, H);

        // рамка
        ctx.strokeStyle = '#ddd';
        ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

        // оси: θ по X, ω по Y
        // диапазоны: θ в [-π, π] (развернём по центру), ω — подберём динамически из истории или по max
        const thetaRange = Math.PI; // отображаем от -π..π
        // ωmax: визвеличим по истории
        let wmax = 2.0;
        if (state.phasePoints.length > 0) {
            for (let p of state.phasePoints) {
                wmax = Math.max(wmax, Math.abs(p[1]));
            }
        }
        wmax = Math.max(1.0, wmax * 1.2);

        function worldToScreenThetaOmega(th, w) {
            const x = (th + thetaRange) / (2 * thetaRange) * W;
            const y = H - ((w + wmax) / (2 * wmax) * H);
            return [x, y];
        }

        // сетка вертикальная θ=0, ±π/2, ±π
        ctx.strokeStyle = '#eee';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let t = -Math.PI; t <= Math.PI + 1e-6; t += Math.PI / 2) {
            const [x, ] = worldToScreenThetaOmega(t, 0);
            ctx.moveTo(x, 0); ctx.lineTo(x, H);
        }
        ctx.stroke();

        // рисуем траекторию фаз (точки)
        ctx.beginPath();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#2c7fb8';
        for (let i = 0; i < state.phasePoints.length; i++) {
            const [th, w] = state.phasePoints[i];
            const [x, y] = worldToScreenThetaOmega(th, w);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // текущая точка крупно
        if (state.phasePoints.length) {
            const last = state.phasePoints[state.phasePoints.length - 1];
            const [cxp, cyp] = worldToScreenThetaOmega(last[0], last[1]);
            ctx.beginPath();
            ctx.fillStyle = '#ff7f0e';
            ctx.arc(cxp, cyp, 4, 0, TWO_PI);
            ctx.fill();
        }

        // подписи осей
        ctx.fillStyle = '#333';
        ctx.font = '12px sans-serif';
        ctx.fillText('θ (rad)', 8, 14);
        ctx.fillText('ω (rad/s)', W - 60, 14);
    }

    // ---------- График энергии ----------
    function renderEnergy(ctx, state) {
        const W = ctx.canvas.width / (window.devicePixelRatio || 1);
        const H = ctx.canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, W, H);

        // фон
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, H);

        // если нет данных, напишем подсказку
        if (state.energyHistory.length < 2) {
            ctx.fillStyle = '#666';
            ctx.font = '13px sans-serif';
            ctx.fillText('График энергии появится после запуска симуляции', 12, H / 2);
            return;
        }

        // нарисуем оси
        const pad = 36;
        ctx.strokeStyle = '#ddd';
        ctx.beginPath();
        ctx.moveTo(pad, pad); ctx.lineTo(pad, H - pad); ctx.lineTo(W - pad, H - pad);
        ctx.stroke();

        // выберем временной масштаб — последние N точек
        const points = state.energyHistory;
        const t0 = points[0].t;
        const t1 = points[points.length - 1].t;
        const dt = Math.max(1e-6, t1 - t0);
        // найдем max энергии для масштаба
        let Emax = 0;
        for (let p of points) Emax = Math.max(Emax, p.Etotal, p.Ekin, p.Epot);
        Emax = Math.max(Emax, 1e-3);

        function sx(t) { return pad + ((t - t0) / dt) * (W - pad * 2); }
        function sy(E) { return H - pad - (E / Emax) * (H - pad * 2); }

        // рисуем линии: общая, кин, потенциальная
        // потенциальная — пунктир
        ctx.lineWidth = 2;
        // E_total
        ctx.beginPath();
        ctx.strokeStyle = '#1f77b4';
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const x = sx(p.t), y = sy(p.Etotal);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // E_kin
        ctx.beginPath();
        ctx.strokeStyle = '#2ca02c';
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const x = sx(p.t), y = sy(p.Ekin);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // E_pot
        ctx.beginPath();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#ff7f0e';
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const x = sx(p.t), y = sy(p.Epot);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // легенда
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#111';
        ctx.fillText('E total', W - pad - 70, pad + 12);
        ctx.fillStyle = '#1f77b4'; ctx.fillRect(W - pad - 92, pad + 4, 10, 8);
        ctx.fillStyle = '#111';
        ctx.fillText('E kin', W - pad - 70, pad + 28);
        ctx.fillStyle = '#2ca02c'; ctx.fillRect(W - pad - 92, pad + 20, 10, 8);
        ctx.fillStyle = '#111';
        ctx.fillText('E pot', W - pad - 70, pad + 44);
        ctx.fillStyle = '#ff7f0e'; ctx.fillRect(W - pad - 92, pad + 36, 10, 8);
    }

    // ---------- Главный цикл (с накоплением "физики" и отрисовки) ----------
    let lastFrameTs = null;
    function loop(ts) {
        if (!state.running) {
            lastFrameTs = null;
            return;
        }
        if (!lastFrameTs) lastFrameTs = ts;
        const realDt = Math.min(0.05, (ts - lastFrameTs) / 1000); // защита от больших шагов
        lastFrameTs = ts;

        // интегрируем с фиксированными субшагами dt <= SIM_TARGET_DT
        let acc = realDt;
        while (acc > 0) {
            const dt = Math.min(acc, SIM_TARGET_DT);
            stepPhysics(dt);
            acc -= dt;
        }

        // рендерим
        renderAll();

        requestAnimationFrame(loop);
    }

    // делаем один шаг физики (на dt секунд)
    function stepPhysics(dt) {
        const params = {
            L: state.L, m: state.m, beta: state.beta, driveAmp: state.driveAmp, driveFreq: state.driveFreq
        };
        // RK4 шаг
        const next = rk4Step(state.theta, state.omega, state.t, dt, params);
        state.theta = normalizeAngle(next.theta);
        state.omega = next.omega;
        state.t += dt;

        // записываем фазовую точку (ограничим длину)
        state.phasePoints.push([state.theta, state.omega]);
        if (state.phasePoints.length > 2000) state.phasePoints.shift();

        // записываем энергию с определённой частотой (ENERGY_SAMPLE_DT)
        state.lastEnergySampleAcc += dt;
        if (state.lastEnergySampleAcc >= ENERGY_SAMPLE_DT) {
            const en = computeEnergies(state.theta, state.omega, state);
            state.energyHistory.push({ t: state.t, Etotal: en.Etotal, Ekin: en.Ekin, Epot: en.Epot });
            if (state.energyHistory.length > MAX_ENERGY_POINTS) state.energyHistory.shift();
            state.lastEnergySampleAcc = 0;
        }
    }

    function normalizeAngle(a) {
        // приведём к диапазону [-π, π] для корректного фазового портрета
        a = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        return a;
    }

    // ---------- Рендер всего (в зависимости от чекбоксов) ----------
    function renderAll() {
        renderPendulum(ctxPend, state);
        if (showPhaseCheckbox.checked) renderPhase(ctxPhase, state);
        else {
            // очистить canvas
            ctxPhase.clearRect(0, 0, ctxPhase.canvas.width, ctxPhase.canvas.height);
        }
        if (showEnergyCheckbox.checked) renderEnergy(ctxEnergy, state);
        else ctxEnergy.clearRect(0, 0, ctxEnergy.canvas.width, ctxEnergy.canvas.height);
    }

    // ---------- Инициализация состояния по умолчанию ----------
    function initStateFromUI() {
        readUItoState(true);
        // при старте запишем начальные значения энергии и фазу
        const en = computeEnergies(state.theta, state.omega, state);
        state.energyHistory = [{ t: state.t, Etotal: en.Etotal, Ekin: en.Ekin, Epot: en.Epot }];
        state.phasePoints = [[state.theta, state.omega]];
        updateCriticalBadge();
    }

    // ---------- Запуск и инициализация ----------
    uiInit();
    initStateFromUI();
    renderAll();

    // ---------- Экспорт в глобал (на случай отладки) ----------
    window._dampedPendulumState = state;
    window._dampedPendulumReset = () => {
        state.running = false;
        readUItoState(true);
        initStateFromUI();
        renderAll();
    };

    // ---------- Конец closure ----------
})();
