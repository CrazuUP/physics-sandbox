/* uniform-motion-improved.js
   Равномерное прямолинейное движение — переработанный, исправленный и оптимизированный
   Улучшена визуализация, производительность и добавлены подсказки/формулы.

   Используй вместе с имеющимся HTML (элементы с id, аналогичными исходному коду).
*/

(() => {
    // ====================== Константы ======================
    const SCALE = 40;                    // пикселей на метр
    const ARROW_SCALE = 15;
    const FIXED_DT = 1 / 240;            // шаг физики (фиксированный)
    const HISTORY_SAMPLE_DT = 0.05;      // как часто сохранять точки для графика
    const MAX_TRAIL = 600;
    const MAX_HISTORY = 1200;
    const TWO_PI = Math.PI * 2;

    const MODES = {
        uniform:     { name: "Равномерное",        a: 0,    v0: 2.0, color: "#007bff" },
        accelerated: { name: "Равноускоренное",   a: 0.8,  v0: 0.5, color: "#28a745" },
        decelerated: { name: "Равнозамедленное",   a: -0.8, v0: 4.0, color: "#dc3545" },
        custom:      { name: "Пользовательский",   a: null, v0: null, color: "#9b59b6" }
    };

    // ====================== DOM (кэшируем элементы) ======================
    const canvas = document.getElementById('motion-canvas');
    if (!canvas) return console.error('motion-canvas not found in DOM');
    const ctx = canvas.getContext('2d', { alpha: false });

    // График
    let graphCanvas = document.getElementById('motion-graph-canvas');
    if (!graphCanvas) {
        graphCanvas = document.createElement('canvas');
        graphCanvas.id = 'motion-graph-canvas';
        graphCanvas.className = 'simulation-canvas';
        graphCanvas.style.marginTop = '16px';
        canvas.after(graphCanvas);
    }
    const gctx = graphCanvas.getContext('2d');

    // выводы и контролы
    const xOut = document.getElementById('motion-x-value');
    const vOut = document.getElementById('motion-v-value');
    const tOut = document.getElementById('motion-t-value');

    const x0In   = document.getElementById('motion-x0');
    const v0In   = document.getElementById('motion-v0');
    const aIn    = document.getElementById('motion-a');
    const lenIn  = document.getElementById('motion-length');

    const startBtn = document.getElementById('start-simulation');
    const resetBtn = document.getElementById('reset-simulation');

    // режимы
    const modeSelect = document.getElementById('motion-mode');
    if (!modeSelect) {
        // если селектор не создан в HTML — создадим и вставим
        const controlsForm = document.querySelector('.controls-form');
        const modeWrapper = document.createElement('div');
        modeWrapper.className = 'parameter-control';
        modeWrapper.innerHTML = `\n            <label for="motion-mode">Режим движения:</label>\n            <select id="motion-mode"></select>\n        `;
        if (controlsForm) controlsForm.insertBefore(modeWrapper, controlsForm.firstElementChild ? controlsForm.firstElementChild.nextSibling : controlsForm.firstChild);
    }

    // повторное получение после потенциального создания
    const modeSelectFinal = document.getElementById('motion-mode');

    Object.entries(MODES).forEach(([key, val]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = val.name;
        modeSelectFinal.appendChild(opt);
    });

    // ====================== Состояние ======================
    const state = {
        running: false,
        x: 0, v: 2, a: 0,
        x0: 0, v0: 2,
        length: 20,
        t: 0,
        trail: [],
        history: [],
        accum: 0,
        sampleAccum: 0,
        mode: 'uniform',
        historyDirty: true,        // отметить, что график нужно отрисовать
    };

    // ====================== Утилиты ======================
    function fitCanvas(c) {
        const rect = c.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        c.width = Math.max(1, Math.floor(rect.width * dpr));
        c.height = Math.max(1, Math.floor(rect.height * dpr));
        c.style.width = rect.width + 'px';
        c.style.height = rect.height + 'px';
        const ctx2d = c.getContext('2d');
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

    function updateOutputs() {
        if (xOut) xOut.textContent = state.x.toFixed(2);
        if (vOut) vOut.textContent = state.v.toFixed(2);
        if (tOut) tOut.textContent = state.t.toFixed(2);
    }

    function applyMode(modeKey) {
        const m = MODES[modeKey];
        if (!m) return;
        if (modeKey !== 'custom') {
            state.a = m.a;
            state.v = m.v0;
            state.v0 = m.v0;
            aIn && (aIn.value = m.a);
            v0In && (v0In.value = m.v0);
            const aValEl = document.querySelector('#motion-a-value');
            const vValEl = document.querySelector('#motion-v0-value');
            if (aValEl) aValEl.textContent = (m.a !== null ? m.a.toFixed(2) : '—');
            if (vValEl) vValEl.textContent = (m.v0 !== null ? m.v0.toFixed(2) : '—');
        }
        state.mode = modeKey;
        if (modeSelectFinal) modeSelectFinal.value = modeKey;
    }

    // ====================== Физика ======================
    function step(dt) {
        // интеграция явным методом Эйлера — для постоянного ускорения точна
        state.v += state.a * dt;
        state.x += state.v * dt;
        state.t += dt;
    }

    // ====================== Рендер анимации ======================
    function render() {
        const dpr = window.devicePixelRatio || 1;
        const W = canvas.width / dpr;
        const H = canvas.height / dpr;
        // плавное очищение фона
        ctx.clearRect(0, 0, W, H);

        // фон (градиент)
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#f0f7ff');
        grad.addColorStop(1, '#ffffff');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        const axisY = H / 2;
        const zeroX = W / 2;

        // Ось и метки
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, axisY);
        ctx.lineTo(W, axisY);
        ctx.stroke();

        const stepMark = Math.max(1, Math.ceil(state.length / 20));
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillStyle = '#333';
        ctx.textAlign = 'center';
        for (let p = -state.length/2; p <= state.length/2; p += stepMark) {
            const sx = zeroX + p * SCALE;
            ctx.beginPath();
            ctx.moveTo(sx, axisY - 6);
            ctx.lineTo(sx, axisY + 6);
            ctx.stroke();
            ctx.fillText(String(p), sx, axisY + 22);
        }

        // Траектория — рендерим как мягкую линию
        if (state.trail.length > 1) {
            ctx.strokeStyle = 'rgba(0,0,0,0.12)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            state.trail.forEach((px, i) => i === 0 ? ctx.moveTo(px, axisY) : ctx.lineTo(px, axisY));
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Шарик
        const ballX = zeroX + state.x * SCALE;
        if (ballX >= -40 && ballX <= W + 40) {
            // тень
            ctx.fillStyle = 'rgba(0,0,0,0.18)';
            ctx.beginPath();
            ctx.ellipse(ballX + 3, axisY + 8, 12, 4, 0, 0, TWO_PI);
            ctx.fill();

            // сам шарик — с градиентом
            const color = (MODES[state.mode] && MODES[state.mode].color) || '#007bff';
            const g = ctx.createRadialGradient(ballX-4, axisY-4, 3, ballX, axisY, 20);
            g.addColorStop(0, '#fff');
            g.addColorStop(0.15, '#ffffff7a');
            g.addColorStop(1, color);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(ballX, axisY, 12, 0, TWO_PI);
            ctx.fill();

            // отражение
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.beginPath();
            ctx.ellipse(ballX - 5, axisY - 6, 4, 2.5, -0.3, 0, TWO_PI);
            ctx.fill();

            // стрелки (векторы) — рисуем только если достаточно большой модуль
            const pulse = 0.9 + 0.1 * Math.sin(state.t * 8);
            if (Math.abs(state.v) > 0.005) {
                drawArrow(ctx, ballX, axisY - 34, state.v * ARROW_SCALE * pulse, 0, '#28a745', `v = ${state.v.toFixed(2)} м/с`);
            }
            if (Math.abs(state.a) > 0.005) {
                drawArrow(ctx, ballX, axisY + 34, state.a * ARROW_SCALE * pulse, 0, '#dc3545', `a = ${state.a.toFixed(2)} м/с²`);
            }
        } else {
            // если мяч ушёл за пределы — останавливаем симуляцию
            if (state.running) {
                state.running = false;
                startBtn && (startBtn.textContent = 'Запуск симуляции');
            }
        }

        updateOutputs();
    }

    function drawArrow(ctx, x, y, dx, dy, color, text) {
        const head = 10;
        const angle = Math.atan2(dy, dx);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx, y + dy);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx - head*Math.cos(angle-Math.PI/6), y + dy - head*Math.sin(angle-Math.PI/6));
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx - head*Math.cos(angle+Math.PI/6), y + dy - head*Math.sin(angle+Math.PI/6));
        ctx.stroke();

        // подпись рядом со стрелкой
        ctx.fillStyle = color;
        ctx.font = 'bold 13px system-ui, sans-serif';
        const tw = ctx.measureText(text).width;
        ctx.fillText(text, x + dx + (dx > 0 ? 8 : -tw - 8), y + dy - 8);
    }

    // ====================== График (оптимизация: рисуем только при изменении history) ======================
    function renderGraph() {
        if (!state.historyDirty) return; // ничего не делаем, если нет новых данных
        state.historyDirty = false;

        const dpr = window.devicePixelRatio || 1;
        const W = graphCanvas.width / dpr;
        const H = graphCanvas.height / dpr;
        gctx.clearRect(0, 0, W, H);
        gctx.fillStyle = '#fff';
        gctx.fillRect(0, 0, W, H);

        if (state.history.length < 2) {
            gctx.fillStyle = '#666';
            gctx.font = '16px system-ui, sans-serif';
            gctx.textAlign = 'center';
            gctx.fillText('Запустите симуляцию, чтобы увидеть графики x(t) и v(t)', W/2, H/2);
            return;
        }

        const pad = 50;
        gctx.strokeStyle = '#eee';
        gctx.lineWidth = 1;
        gctx.beginPath();
        gctx.moveTo(pad, pad); gctx.lineTo(pad, H-pad);
        gctx.lineTo(W-pad, H-pad);
        gctx.stroke();

        const t0 = state.history[0].t;
        const t1 = state.history[state.history.length-1].t;
        const dt = Math.max(1e-6, t1 - t0);

        let xmin = Infinity, xmax = -Infinity, vmin = Infinity, vmax = -Infinity;
        state.history.forEach(p => {
            xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x);
            vmin = Math.min(vmin, p.v); vmax = Math.max(vmax, p.v);
        });
        const xr = Math.max(0.1, (xmax - xmin)) * 1.05;
        const vr = Math.max(0.1, (vmax - vmin)) * 1.05;

        const sx = t => pad + (t - t0)/dt * (W - 2*pad);
        const syX = v => H - pad - (v - (xmin - xr*0.05)) / xr * (H - 2*pad);
        const syV = v => H - pad - (v - (vmin - vr*0.05)) / vr * (H - 2*pad);

        // x(t)
        gctx.strokeStyle = '#1f77b4';
        gctx.lineWidth = 2.5;
        gctx.beginPath();
        state.history.forEach((p,i) => {
            const x = sx(p.t), y = syX(p.x);
            i===0 ? gctx.moveTo(x,y) : gctx.lineTo(x,y);
        });
        gctx.stroke();

        // v(t)
        gctx.strokeStyle = '#ff7f0e';
        gctx.setLineDash([5,4]);
        gctx.beginPath();
        state.history.forEach((p,i) => {
            const x = sx(p.t), y = syV(p.v);
            i===0 ? gctx.moveTo(x,y) : gctx.lineTo(x,y);
        });
        gctx.stroke();
        gctx.setLineDash([]);

        // легенда
        gctx.font = '12px system-ui, sans-serif';
        gctx.fillStyle = '#000';
        gctx.textAlign = 'left';
        gctx.fillText('x(t)', W-160, 30);
        gctx.fillStyle = '#1f77b4';
        gctx.fillRect(W-180, 20, 15, 10);
        gctx.fillStyle = '#000';
        gctx.fillText('v(t)', W-160, 50);
        gctx.fillStyle = '#ff7f0e';
        gctx.fillRect(W-180, 40, 15, 10);

        // подписываем оси
        gctx.fillStyle = '#333';
        gctx.textAlign = 'center';
        gctx.fillText('t, с', W/2, H - 10);
        gctx.save();
        gctx.translate(14, H/2);
        gctx.rotate(-Math.PI/2);
        gctx.fillText('x / v', 0, 0);
        gctx.restore();
    }

    // ====================== Цикл ======================
    let lastTime = null;
    function loop(ts) {
        if (!state.running) { lastTime = null; return; }
        if (!lastTime) lastTime = ts;
        let dt = (ts - lastTime)/1000;
        // лимитируем max dt чтобы избежать «скачков» при сворачивании вкладки
        dt = Math.min(dt, 0.05);
        lastTime = ts;

        state.accum += dt;
        while (state.accum >= FIXED_DT) {
            step(FIXED_DT);
            state.accum -= FIXED_DT;

            // trail
            const dpr = window.devicePixelRatio || 1;
            const W = canvas.width / dpr;
            state.trail.push(W/2 + state.x * SCALE);
            if (state.trail.length > MAX_TRAIL) state.trail.shift();

            // history
            state.sampleAccum += FIXED_DT;
            if (state.sampleAccum >= HISTORY_SAMPLE_DT) {
                state.history.push({t: state.t, x: state.x, v: state.v});
                if (state.history.length > MAX_HISTORY) state.history.shift();
                state.sampleAccum = 0;
                state.historyDirty = true;
            }
        }

        render();
        renderGraph();
        requestAnimationFrame(loop);
    }

    // ====================== Обработчики ======================
    function reset() {
        state.running = false;
        startBtn && (startBtn.textContent = 'Запуск симуляции');

        // чтение входных значений с защитой
        state.x = x0In ? parseFloat(x0In.value || '0') : 0;
        state.x0 = state.x;
        state.v = v0In ? parseFloat(v0In.value || '0') : 0;
        state.v0 = state.v;
        state.a = aIn ? parseFloat(aIn.value || '0') : 0;
        state.length = lenIn ? parseFloat(lenIn.value || '20') : 20;

        state.t = 0;
        state.trail.length = 0;
        state.history.length = 0;
        state.history.push({t:0, x:state.x, v:state.v});
        state.accum = state.sampleAccum = 0;
        state.historyDirty = true;

        render();
        renderGraph();
    }

    startBtn && (startBtn.onclick = () => {
        if (state.running) {
            state.running = false;
            startBtn.textContent = 'Запуск симуляции';
        } else {
            // считываем актуальные параметры
            state.x = x0In ? parseFloat(x0In.value || '0') : 0;
            state.x0 = state.x;
            state.v = v0In ? parseFloat(v0In.value || '0') : 0;
            state.v0 = state.v;
            state.a = aIn ? parseFloat(aIn.value || '0') : 0;
            state.length = lenIn ? parseFloat(lenIn.value || '20') : 20;

            // валидируем разумные пределы
            state.length = clamp(state.length, 2, 200);

            state.running = true;
            startBtn.textContent = 'Пауза';
            requestAnimationFrame(loop);
        }
    });

    resetBtn && (resetBtn.onclick = reset);

    // смена режима
    modeSelectFinal && (modeSelectFinal.onchange = () => {
        const mode = modeSelectFinal.value;
        if (mode !== 'custom') applyMode(mode);
        reset();
    });

    // при ручном изменении ползунков — переключаемся в custom и оставляем значения
    [x0In, v0In, aIn, lenIn].forEach(el => {
        if (!el) return;
        el.addEventListener('input', () => {
            const prev = state.mode;
            state.mode = 'custom';
            if (modeSelectFinal) modeSelectFinal.value = 'custom';
            // сразу обновляем метки значений
            const aValEl = document.querySelector('#motion-a-value');
            const vValEl = document.querySelector('#motion-v0-value');
            aValEl && (aValEl.textContent = (aIn.value ? parseFloat(aIn.value).toFixed(2) : '—'));
            vValEl && (vValEl.textContent = (v0In.value ? parseFloat(v0In.value).toFixed(2) : '—'));
        });
    });

    // ресайз
    function onResize() {
        fitCanvas(canvas);
        fitCanvas(graphCanvas);
        state.historyDirty = true;
        render();
        renderGraph();
    }
    window.addEventListener('resize', onResize);

    // ====================== Подсказки и формулы ======================
    // создаём панель с формулами и подсказкой (если ещё нет)
    let infoPanel = document.getElementById('motion-info-panel');
    if (!infoPanel) {
        infoPanel = document.createElement('div');
        infoPanel.id = 'motion-info-panel';
        infoPanel.style.cssText = 'position:relative;margin-top:12px;font-family:system-ui, sans-serif;';
        const parent = canvas.parentElement || document.body;
        parent.appendChild(infoPanel);
    }

    infoPanel.innerHTML = `
        <details style="max-width:720px;">
            <summary style="cursor:pointer;font-weight:600">Формулы и подсказки</summary>
            <div style="padding:8px 12px;line-height:1.45;color:#222">
                <div><strong>Кинематические формулы (одномерное движение с постоянным a):</strong></div>
                <div style="margin-top:6px"><code>x(t) = x₀ + v₀·t + 0.5·a·t²</code></div>
                <div><code>v(t) = v₀ + a·t</code></div>
                <div style="margin-top:8px;color:#444">Подсказки: можно выбрать готовый режим, либо установить значения вручную.
                На графике отображаются x(t) (сплошная) и v(t) (пунктирная).</div>
            </div>
        </details>
    `;

    // Всплывающая подсказка (tooltip) — показываем параметры при наведении на шарик
    let tooltip = document.getElementById('motion-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'motion-tooltip';
        tooltip.style.cssText = 'position:absolute;pointer-events:none;padding:6px 8px;border-radius:6px;background:rgba(0,0,0,0.75);color:#fff;font-size:12px;transform:translate(-50%,-120%);visibility:hidden;white-space:nowrap;';
        const parent = canvas.parentElement || document.body;
        parent.appendChild(tooltip);
    }

    // позиционирование tooltip — слушаем mousemove над canvas
    canvas.addEventListener('mousemove', (ev) => {
        const rect = canvas.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const my = ev.clientY - rect.top;
        const zeroX = rect.width / 2;
        const ballX = zeroX + state.x * SCALE;
        const dist = Math.abs(mx - ballX);
        if (dist < 20 && Math.abs(my - rect.height/2) < 30) {
            tooltip.style.left = (rect.left + ballX) + 'px';
            tooltip.style.top = (rect.top + rect.height/2) + 'px';
            tooltip.style.visibility = 'visible';
            tooltip.innerHTML = `<strong>x:</strong> ${state.x.toFixed(2)} м<br><strong>v:</strong> ${state.v.toFixed(2)} м/с<br><strong>a:</strong> ${state.a.toFixed(2)} м/с²`;
        } else {
            tooltip.style.visibility = 'hidden';
        }
    });

    canvas.addEventListener('mouseleave', () => tooltip.style.visibility = 'hidden');

    // ====================== Старт ======================
    // адаптивный initial fit
    fitCanvas(canvas);
    fitCanvas(graphCanvas);
    applyMode('uniform');
    reset();
    render();
    renderGraph();

})();
